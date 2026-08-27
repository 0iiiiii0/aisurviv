import fs, { type WriteStream } from "node:fs";
import path from "node:path";

/**
 * 服务器侧 Boss 对局录制器：把搜打撤 Boss 的每帧状态与关键行为事件
 * 写入本地 JSONL（与 bot 录制同目录，方便对照分析 Boss 的索敌/射击/
 * 受击/移动问题——Bot 录制只覆盖 smartBot worker 的 AI，不含 Boss）。
 *
 * 输出：<BOT_RECORD_DIR>/<会话>/<match>/boss-frames-001.jsonl(.part)
 *       + boss-events-001.jsonl(.part) + map.json
 * 开关：生产环境默认关闭；BOT_MATCH_RECORDING=1 开启（与 bot 录制一致）。
 */

const envFlag = (name: string, fallback: boolean): boolean => {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return value !== "0" && value.toLowerCase() !== "false";
};

const timestampName = (timestamp: number): string => new Date(timestamp).toISOString().replace(/[:.]/g, "-");

const jsonLine = (value: unknown): string =>
    `${
        JSON.stringify(value, (_key, item) => {
            if (typeof item === "number" && !Number.isFinite(item)) return null;
            if (typeof item === "number" && !Number.isInteger(item)) {
                return Math.round(item * 1000) / 1000;
            }
            return item;
        })
    }\n`;

interface BossFrame {
    ts: number;
    atIso?: string;
    matchId: string;
    tick: number;
    bosses: Array<{
        name: string;
        id: number;
        pos: { x: number; y: number };
        layer: number;
        aimLayer: number;
        health: number;
        healthBuffer: number;
        targetId: number | null;
        targetName: string | null;
        targetDist: number;
        hasLos: boolean;
        shootStart: boolean;
        dir: { x: number; y: number };
        ammo: number;
        actionType: number;
        patrolRadius: number;
        patrolTarget: { x: number; y: number };
        decision: string;
        moveDir: { x: number; y: number };
        retreating: boolean;
        hitChaseRemainingMs: number;
        stuckStationaryMs: number;
        unstuckRemainingMs: number;
        stuckCount: number;
        flankSign: number;
    }>;
}

export class BossRecorder {
    readonly enabled: boolean;
    readonly rootDir: string;
    readonly sessionDir: string;
    readonly sampleTicks: number;
    private readonly matches = new Map<string, {
        dir: string;
        frames: WriteStream;
        events: WriteStream;
        part: number;
        bytes: number;
        tempFrames: string;
        tempEvents: string;
        finalFrames: string;
        finalEvents: string;
        mapWritten: boolean;
        closed: boolean;
    }>();
    private closed = false;
    private tickCounter = 0;

    constructor() {
        this.enabled = envFlag("BOT_MATCH_RECORDING", false);
        this.sampleTicks = 5; // 约每 5 tick（~166ms）一帧
        this.rootDir = path.resolve(
            process.env.BOT_RECORD_DIR
                ?? path.join(process.cwd(), "..", "ai-match-recordings"),
        );
        this.sessionDir = path.join(
            this.rootDir,
            `${timestampName(Date.now())}_pid-${process.pid}`,
        );
        if (!this.enabled) return;
        try {
            fs.mkdirSync(this.sessionDir, { recursive: true });
            fs.writeFileSync(
                path.join(this.sessionDir, "manifest.json"),
                JSON.stringify(
                    {
                        format: "survivio-boss-recording",
                        version: 1,
                        createdAt: Date.now(),
                        createdAtIso: new Date().toISOString(),
                        pid: process.pid,
                        sampleTicks: this.sampleTicks,
                        note: "Server-side extraction boss frames/events. Set BOT_MATCH_RECORDING=1 to enable.",
                    },
                    null,
                    2,
                ),
            );
            fs.writeFileSync(
                path.join(this.sessionDir, "README.txt"),
                [
                    "Surviv.io Boss 对局记录器（服务器侧）",
                    "",
                    "记录搜打撤 Boss 的每帧状态与关键行为事件（索敌/射击/受击/移动），",
                    "用于排查 Boss 隔墙射击、站着挨打、卡位等问题。",
                    "Boss 不在 smartBot 录制范围内，此为独立录制。",
                    "生产环境默认关闭；用 BOT_MATCH_RECORDING=1 临时开启。",
                    "目录可用 BOT_RECORD_DIR 指定。",
                ].join("\r\n"),
            );
        } catch {
            // 录制失败不影响游戏
        }
    }

    get matchIds(): string[] {
        return [...this.matches.keys()];
    }

    beginMatch(matchId: string): void {
        if (!this.enabled || this.closed) return;
        if (this.matches.has(matchId)) return;
        try {
            const dir = path.join(this.sessionDir, `match-${matchId}`);
            fs.mkdirSync(dir, { recursive: true });
            const part = 1;
            const tempFrames = path.join(dir, `boss-frames-001.jsonl.part`);
            const tempEvents = path.join(dir, `boss-events-001.jsonl.part`);
            const finalFrames = path.join(dir, `boss-frames-001.jsonl`);
            const finalEvents = path.join(dir, `boss-events-001.jsonl`);
            const frames = fs.createWriteStream(tempFrames, { flags: "a" });
            const events = fs.createWriteStream(tempEvents, { flags: "a" });
            this.matches.set(matchId, {
                dir,
                frames,
                events,
                part,
                bytes: 0,
                tempFrames,
                tempEvents,
                finalFrames,
                finalEvents,
                mapWritten: false,
                closed: false,
            });
            this.recordEvent(matchId, {
                type: "boss_recording_started",
                at: Date.now(),
                matchId,
            });
        } catch {
            // ignore
        }
    }

    recordMap(matchId: string, map: unknown): void {
        const writer = this.matches.get(matchId);
        if (!writer || writer.mapWritten || writer.closed) return;
        try {
            const content = JSON.stringify({ recordedAt: Date.now(), matchId, map });
            fs.writeFileSync(path.join(writer.dir, "map.json"), content);
            writer.mapWritten = true;
        } catch {
            // ignore
        }
    }

    recordEvent(matchId: string, event: Record<string, unknown>): void {
        const writer = this.matches.get(matchId);
        if (!writer || writer.closed) return;
        try {
            const line = jsonLine(event);
            writer.events.write(line);
            writer.bytes += Buffer.byteLength(line);
        } catch {
            // ignore
        }
    }

    /** 每 tick 调用：按采样间隔写入所有 Boss 的状态帧。 */
    tick(game: {
        id: string;
        tick: number;
        bossPlayers: Array<{
            name: string;
            __id: number;
            pos: { x: number; y: number };
            layer: number;
            aimLayer: number;
            health: number;
            bossHealthBuffer: number;
            bossTarget: { __id: number; name: string } | null;
            shootStart: boolean;
            dir: { x: number; y: number };
            weapons: Array<{ ammo: number }>;
            actionType: number;
            bossPatrolRadius: number;
            bossPatrolTarget: { x: number; y: number };
            bossRetreating: boolean;
            bossHitChaseUntil: number;
            bossStationaryUntil: number;
            bossUnstuckUntil: number;
            bossStuckCount: number;
            bossFlankSign: number;
            bossMoveDir: { x: number; y: number };
            bossHasLosNow: boolean;
            bossDecision: string;
            bossTargetDist: number;
        }>;
    }): void {
        if (!this.enabled || this.closed) return;
        this.tickCounter++;
        if (this.tickCounter % this.sampleTicks !== 0) return;
        const writer = this.matches.get(game.id);
        if (!writer || writer.closed || game.bossPlayers.length === 0) return;
        const now = Date.now();
        const frame: BossFrame = {
            ts: now,
            matchId: game.id,
            tick: game.tick,
            bosses: game.bossPlayers.map((b) => ({
                name: b.name,
                id: b.__id,
                pos: { x: Math.round(b.pos.x * 10) / 10, y: Math.round(b.pos.y * 10) / 10 },
                layer: b.layer,
                aimLayer: b.aimLayer,
                health: Math.round(b.health),
                healthBuffer: Math.round(b.bossHealthBuffer),
                targetId: b.bossTarget?.__id ?? null,
                targetName: b.bossTarget?.name ?? null,
                targetDist: Math.round(b.bossTargetDist * 10) / 10,
                hasLos: b.bossHasLosNow,
                shootStart: b.shootStart,
                dir: { x: Math.round(b.dir.x * 100) / 100, y: Math.round(b.dir.y * 100) / 100 },
                ammo: b.weapons[0]?.ammo ?? 0,
                actionType: b.actionType,
                patrolRadius: b.bossPatrolRadius,
                patrolTarget: {
                    x: Math.round(b.bossPatrolTarget.x * 10) / 10,
                    y: Math.round(b.bossPatrolTarget.y * 10) / 10,
                },
                decision: b.bossDecision,
                moveDir: {
                    x: Math.round(b.bossMoveDir.x * 100) / 100,
                    y: Math.round(b.bossMoveDir.y * 100) / 100,
                },
                retreating: b.bossRetreating,
                hitChaseRemainingMs: Math.max(0, b.bossHitChaseUntil - now),
                stuckStationaryMs: Math.max(0, b.bossStationaryUntil - now),
                unstuckRemainingMs: Math.max(0, b.bossUnstuckUntil - now),
                stuckCount: b.bossStuckCount,
                flankSign: b.bossFlankSign,
            })),
        };
        try {
            const line = jsonLine(frame);
            writer.frames.write(line);
            writer.bytes += Buffer.byteLength(line);
        } catch {
            // ignore
        }
    }

    endMatch(matchId: string): void {
        const writer = this.matches.get(matchId);
        if (!writer || writer.closed) return;
        writer.closed = true;
        try {
            writer.frames.end();
            writer.events.end();
            writer.frames.on("close", () => {
                try {
                    fs.renameSync(writer.tempFrames, writer.finalFrames);
                } catch {
                    // ignore
                }
            });
            writer.events.on("close", () => {
                try {
                    fs.renameSync(writer.tempEvents, writer.finalEvents);
                } catch {
                    // ignore
                }
            });
        } catch {
            // ignore
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const [matchId, writer] of this.matches) {
            this.endMatch(matchId);
        }
    }
}
