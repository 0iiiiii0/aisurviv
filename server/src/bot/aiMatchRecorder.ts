import fs, { type WriteStream } from "node:fs";
import path from "node:path";

export const DEFAULT_RECORDING_STORAGE_LIMIT = 1024 ** 3;

export interface MatchRecorderOptions {
    enabled?: boolean;
    rootDir?: string;
    sampleMs?: number;
    maxPartBytes?: number;
    /** Total cap for the complete recording root, not a per-match cap. */
    maxStorageBytes?: number;
    /** Maximum data waiting in a Node write stream before recording is cut. */
    maxBufferedBytes?: number;
}

export interface RecorderBotRegistration {
    botId: number;
    difficulty: string;
    squadId: number;
    squadSlot: number;
    role: string;
}

interface PartStream {
    stream: WriteStream;
    part: number;
    bytes: number;
    tempPath: string;
    finalPath: string;
    closing: boolean;
}

interface MatchWriter {
    matchId: string;
    dir: string;
    createdAt: number;
    mapWritten: boolean;
    truncated: boolean;
    events: PartStream;
    frames: PartStream;
    lastFrameAtByBot: Map<number, number>;
    registeredBots: Set<number>;
    /** Bots that already reported a terminal finish for this match. */
    finishedBots: Set<number>;
    finishedReasons: Array<{ botId: number; reason: string }>;
    /** Total behavior frames written for this match. */
    framesWritten: number;
    matchEnded: boolean;
}

const envFlag = (name: string, fallback: boolean): boolean => {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return value !== "0" && value.toLowerCase() !== "false";
};

const envNumber = (name: string, fallback: number, min: number, max: number): number => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96) || "unknown";

const timestampName = (timestamp: number): string => new Date(timestamp).toISOString().replace(/[:.]/g, "-");

const jsonLine = (value: unknown): string =>
    `${
        JSON.stringify(value, (_key, item) => {
            if (typeof item === "number" && !Number.isFinite(item)) return null;
            if (typeof item === "number" && !Number.isInteger(item)) {
                return Math.round(item * 1000) / 1000;
            }
            if (typeof item === "bigint") return item.toString();
            return item;
        })
    }\n`;

const fileOrDirectorySize = (target: string): number => {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(target);
    } catch {
        return 0;
    }
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const name of fs.readdirSync(target)) {
        total += fileOrDirectorySize(path.join(target, name));
    }
    return total;
};

interface DeletableSession {
    dir: string;
    modifiedAt: number;
    bytes: number;
    /** False when every match in the session is still an unfinished .part file. */
    hasFinalizedEvents: boolean;
}

/** Low-overhead local recorder with a hard total-storage quota. */
export class AiMatchRecorder {
    readonly enabled: boolean;
    readonly rootDir: string;
    readonly sessionDir: string;
    readonly sampleMs: number;
    readonly maxPartBytes: number;
    readonly maxStorageBytes: number;
    readonly maxBufferedBytes: number;

    private readonly matches = new Map<string, MatchWriter>();
    private trackedStorageBytes = 0;
    private closed = false;

    constructor(options: MatchRecorderOptions = {}) {
        // Production auto-fill must not record every ordinary bot unless an
        // operator explicitly enables diagnostics. A busy server used to start
        // hundreds of JSON recorders and serialize full tactical frames every
        // 750ms, multiplying both CPU and memory pressure.
        this.enabled = options.enabled ?? envFlag("BOT_MATCH_RECORDING", false);
        this.sampleMs = options.sampleMs ?? envNumber("BOT_RECORD_SAMPLE_MS", 750, 100, 5000);
        const maxPartMb = envNumber("BOT_RECORD_PART_MB", 64, 4, 1024);
        this.maxPartBytes = options.maxPartBytes ?? Math.round(maxPartMb * 1024 * 1024);
        const envStorageBytes = Number(process.env.BOT_RECORD_MAX_BYTES);
        const envStorageGb = Number(process.env.BOT_RECORD_MAX_GB);
        const configuredStorage = Number.isFinite(envStorageBytes) && envStorageBytes > 0
            ? envStorageBytes
            : Number.isFinite(envStorageGb) && envStorageGb > 0
            ? envStorageGb * 1024 ** 3
            : DEFAULT_RECORDING_STORAGE_LIMIT;
        this.maxStorageBytes = Math.max(
            4096,
            Math.floor(options.maxStorageBytes ?? configuredStorage),
        );
        this.maxBufferedBytes = Math.max(
            64 * 1024,
            Math.floor(
                options.maxBufferedBytes
                    ?? envNumber("BOT_RECORD_MAX_BUFFER_MB", 8, 1, 64) * 1024 * 1024,
            ),
        );
        this.rootDir = path.resolve(
            options.rootDir
                ?? process.env.BOT_RECORD_DIR
                // Keep recordings OUTSIDE server/ (e.g. <project>/ai-match-recordings):
                // the dev server runs under `node --watch` which watches the whole
                // server tree, and frame writes every 750ms would restart the server
                // and disconnect every live match ("Host closed the connection"
                // seconds after joining).
                ?? path.join(process.cwd(), "..", "ai-match-recordings"),
        );
        this.sessionDir = path.join(
            this.rootDir,
            `${timestampName(Date.now())}_pid-${process.pid}`,
        );

        if (!this.enabled) return;
        fs.mkdirSync(this.rootDir, { recursive: true });
        this.trackedStorageBytes = fileOrDirectorySize(this.rootDir);
        this.ensureCapacity(16 * 1024);
        fs.mkdirSync(this.sessionDir, { recursive: true });

        this.writeSessionFile(
            "manifest.json",
            JSON.stringify(
                {
                    format: "survivio-ai-match-recording",
                    version: 13,
                    createdAt: Date.now(),
                    createdAtIso: new Date().toISOString(),
                    pid: process.pid,
                    sampleMs: this.sampleMs,
                    maxPartBytes: this.maxPartBytes,
                    maxStorageBytes: this.maxStorageBytes,
                    maxBufferedBytes: this.maxBufferedBytes,
                    maxStorageGiB: this.maxStorageBytes / 1024 ** 3,
                    rotationPolicy: "delete-oldest-inactive-session-then-truncate-current-match",
                    node: process.version,
                    platform: process.platform,
                    worker: {
                        botIdOffset: Number(process.env.BOT_ID_OFFSET ?? 0) || 0,
                        botCount: Number(process.env.BOT_COUNT ?? 0) || 0,
                        forcedTeamIds: process.env.BOT_FORCED_TEAM_IDS ?? "[]",
                    },
                    files: {
                        map: "Static generated map snapshot received from the server.",
                        events:
                            "Discrete AI decisions, gunfire blocks, threat interruption, tactical strobe counters, hard-cover flanks, airdrop/resource decisions, dual-switch events, damage and match lifecycle.",
                        frames:
                            "Sampled AI state, transmitted trigger state, scope/target offsets, shot intent, healing pressure, navigation, airstrike decisions and nearby tactical environment.",
                    },
                },
                null,
                2,
            ),
        );
        this.writeSessionFile(
            "README.txt",
            [
                "Surviv.io AI 对局记录器",
                "",
                "整个记录根目录总容量上限默认为 1 GiB；达到上限时先删除最旧的非活动会话。",
                "如果当前会话本身达到上限，该场会创建 recording.truncated 标记并停止继续写入。",
                "正在写入的文件使用 .part 后缀，正常关闭后原子改名为 .jsonl。",
                "生产环境默认关闭；用 BOT_MATCH_RECORDING=1 临时开启诊断。",
                "BOT_RECORD_MAX_BYTES 或 BOT_RECORD_MAX_GB 调整总上限。",
                "",
            ].join("\r\n"),
        );

        process.once("beforeExit", () => this.close());
        process.once("SIGINT", () => {
            this.close();
            process.exit(130);
        });
        process.once("SIGTERM", () => {
            this.close();
            process.exit(143);
        });
    }

    get storageBytes(): number {
        return this.trackedStorageBytes;
    }

    registerBot(matchId: string, registration: RecorderBotRegistration): void {
        if (!this.enabled || this.closed) return;
        const writer = this.writer(matchId);
        if (writer.truncated || writer.registeredBots.has(registration.botId)) return;
        writer.registeredBots.add(registration.botId);
        this.recordEvent(matchId, { type: "bot_registered", at: Date.now(), ...registration });
    }

    recordMap(matchId: string, map: unknown): void {
        if (!this.enabled || this.closed) return;
        const writer = this.writer(matchId);
        if (writer.mapWritten || writer.truncated) return;
        const content = JSON.stringify({ recordedAt: Date.now(), matchId: writer.matchId, map });
        const bytes = Buffer.byteLength(content);
        if (!this.ensureCapacity(bytes)) {
            this.markTruncated(writer, "map-quota");
            return;
        }
        writer.mapWritten = true;
        const temp = path.join(writer.dir, "map.json.part");
        const final = path.join(writer.dir, "map.json");
        fs.writeFileSync(temp, content);
        fs.renameSync(temp, final);
        this.trackedStorageBytes += bytes;
        this.recordEvent(matchId, { type: "map_recorded", at: Date.now() });
    }

    recordEvent(matchId: string, event: Record<string, unknown>): void {
        if (!this.enabled || this.closed) return;
        const writer = this.writer(matchId);
        this.writePart(writer, "events", event);
    }

    recordFrame(
        matchId: string,
        botId: number,
        timestamp: number,
        frame: Record<string, unknown>,
        force = false,
    ): void {
        if (!this.enabled || this.closed) return;
        const writer = this.writer(matchId);
        if (writer.truncated) return;
        const last = writer.lastFrameAtByBot.get(botId) ?? 0;
        if (!force && timestamp - last < this.sampleMs) return;
        writer.lastFrameAtByBot.set(botId, timestamp);
        writer.framesWritten += 1;
        this.writePart(writer, "frames", { type: "frame", at: timestamp, botId, ...frame });
    }

    finishBot(matchId: string, botId: number, reason: string, detail: Record<string, unknown> = {}): void {
        if (!this.enabled || this.closed) return;
        this.recordEvent(matchId, { type: "bot_finished", at: Date.now(), botId, reason, ...detail });
        const writer = this.matches.get(safeName(matchId));
        if (!writer || writer.truncated || writer.matchEnded) return;
        if (writer.finishedBots.has(botId)) return;
        writer.finishedBots.add(botId);
        writer.finishedReasons.push({ botId, reason });
        if (writer.registeredBots.size > 0 && writer.finishedBots.size >= writer.registeredBots.size) {
            writer.matchEnded = true;
            this.recordEvent(matchId, {
                type: "match_ended",
                at: Date.now(),
                durationMs: Date.now() - writer.createdAt,
                botCount: writer.registeredBots.size,
                framesWritten: writer.framesWritten,
                results: writer.finishedReasons.map((entry) => ({ ...entry })),
            });
        }
    }

    close(): void {
        if (!this.enabled || this.closed) return;
        this.closed = true;
        for (const writer of this.matches.values()) {
            this.finalizePart(writer.events);
            this.finalizePart(writer.frames);
        }
    }

    private writeSessionFile(filename: string, content: string): void {
        const bytes = Buffer.byteLength(content);
        if (!this.ensureCapacity(bytes)) return;
        fs.writeFileSync(path.join(this.sessionDir, filename), content, "utf8");
        this.trackedStorageBytes += bytes;
    }

    private writer(matchId: string): MatchWriter {
        const normalized = safeName(matchId);
        const existing = this.matches.get(normalized);
        if (existing) return existing;

        const dir = path.join(this.sessionDir, `match-${normalized}`);
        fs.mkdirSync(dir, { recursive: true });
        const writer: MatchWriter = {
            matchId: normalized,
            dir,
            createdAt: Date.now(),
            mapWritten: false,
            truncated: false,
            events: this.openPart(dir, "events", 1),
            frames: this.openPart(dir, "frames", 1),
            lastFrameAtByBot: new Map(),
            registeredBots: new Set(),
            finishedBots: new Set(),
            finishedReasons: [],
            framesWritten: 0,
            matchEnded: false,
        };
        this.matches.set(normalized, writer);
        this.writePart(writer, "events", { type: "match_recording_started", at: writer.createdAt });
        return writer;
    }

    private openPart(dir: string, prefix: "events" | "frames", part: number): PartStream {
        const base = `${prefix}-${String(part).padStart(3, "0")}.jsonl`;
        const finalPath = path.join(dir, base);
        const tempPath = `${finalPath}.part`;
        return {
            stream: fs.createWriteStream(tempPath, { flags: "a", encoding: "utf8" }),
            part,
            bytes: fileOrDirectorySize(tempPath),
            tempPath,
            finalPath,
            closing: false,
        };
    }

    private finalizePart(part: PartStream): void {
        if (part.closing) return;
        part.closing = true;
        part.stream.end(() => {
            try {
                if (fs.existsSync(part.tempPath)) fs.renameSync(part.tempPath, part.finalPath);
            } catch {
                // Preserve the .part file for startup/manual recovery instead of crashing the server.
            }
        });
    }

    private writePart(
        writer: MatchWriter,
        key: "events" | "frames",
        value: Record<string, unknown>,
    ): void {
        if (writer.truncated) return;
        let target = writer[key];
        const line = jsonLine(value);
        const bytes = Buffer.byteLength(line);
        if (!this.ensureCapacity(bytes)) {
            this.markTruncated(writer, `${key}-quota`);
            return;
        }
        if (target.bytes > 0 && target.bytes + bytes > this.maxPartBytes) {
            this.finalizePart(target);
            target = this.openPart(writer.dir, key, target.part + 1);
            writer[key] = target;
        }
        if (target.stream.writableLength + bytes > this.maxBufferedBytes) {
            this.markTruncated(writer, `${key}-backpressure`);
            return;
        }
        target.stream.write(line);
        target.bytes += bytes;
        this.trackedStorageBytes += bytes;
    }

    private markTruncated(writer: MatchWriter, reason: string): void {
        if (writer.truncated) return;
        writer.truncated = true;
        try {
            fs.closeSync(fs.openSync(path.join(writer.dir, "recording.truncated"), "w"));
            fs.writeFileSync(
                path.join(writer.dir, "recording-truncated.json"),
                JSON.stringify({ at: Date.now(), reason, maxStorageBytes: this.maxStorageBytes }),
                { flag: "wx" },
            );
            this.trackedStorageBytes += fileOrDirectorySize(
                path.join(writer.dir, "recording-truncated.json"),
            );
        } catch {
            // A zero-byte marker is best effort; quota failure must never stop the game server.
        }
        this.finalizePart(writer.events);
        this.finalizePart(writer.frames);
    }

    private sessionHasFinalizedEvents(dir: string): boolean {
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            return false;
        }
        for (const entry of names) {
            if (!entry.startsWith("match-")) continue;
            try {
                const files = fs.readdirSync(path.join(dir, entry));
                if (files.some((file) => /^events-\d+\.jsonl$/.test(file))) return true;
            } catch {
                // Ignore unreadable match dirs; they still count as deletable.
            }
        }
        return false;
    }

    private deletableSessions(): DeletableSession[] {
        if (!fs.existsSync(this.rootDir)) return [];
        const sessions: DeletableSession[] = [];
        for (const name of fs.readdirSync(this.rootDir)) {
            const dir = path.join(this.rootDir, name);
            if (dir === this.sessionDir) continue;
            let stat: fs.Stats;
            try {
                stat = fs.statSync(dir);
            } catch {
                continue;
            }
            if (!stat.isDirectory()) continue;
            const hasFinalizedEvents = this.sessionHasFinalizedEvents(dir);
            sessions.push({ dir, modifiedAt: stat.mtimeMs, bytes: fileOrDirectorySize(dir), hasFinalizedEvents });
        }
        // Delete interrupted sessions (everything still in .part) before
        // complete ones, then the oldest within each group. Short aborted
        // recordings carry little replay value, so quota pressure removes
        // them first and preserves complete matches for analysis.
        return sessions.sort((a, b) => {
            const aPriority = a.hasFinalizedEvents ? 1 : 0;
            const bPriority = b.hasFinalizedEvents ? 1 : 0;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.modifiedAt - b.modifiedAt;
        });
    }

    private ensureCapacity(requiredBytes: number): boolean {
        if (requiredBytes <= 0) return true;
        if (this.trackedStorageBytes + requiredBytes <= this.maxStorageBytes) return true;
        for (const session of this.deletableSessions()) {
            try {
                fs.rmSync(session.dir, { recursive: true, force: true });
                this.trackedStorageBytes = Math.max(0, this.trackedStorageBytes - session.bytes);
            } catch {
                continue;
            }
            if (this.trackedStorageBytes + requiredBytes <= this.maxStorageBytes) return true;
        }
        return this.trackedStorageBytes + requiredBytes <= this.maxStorageBytes;
    }
}

export const aiMatchRecorder = new AiMatchRecorder();
