import fs from "fs";
import path from "path";
import { App } from "uWebSockets.js";
import { TeamMode } from "../../shared/gameConfig.ts";
import { util } from "../../shared/utils/util.ts";
import { formatHostPort } from "../../shared/utils/networkAddress.ts";
import { Config } from "./config.ts";
import { GameServer, type AutoAiCapabilityMatchRequest } from "./gameServer.ts";
import type { GameData } from "./game/gameManager.ts";
import { Logger } from "./utils/logger.ts";
import { getListenHosts, listenOnHosts } from "./utils/listen.ts";

/**
 * Automatic pure-AI capability match.
 *
 * Boots the single-thread dev game server, creates a private pure-AI
 * battle-royale match on a standard map (default: main/solo with 10 bots),
 * lets real smart-bot workers play it to completion, then aggregates the AI
 * match recordings into a search / gas-escape / combat capability report.
 *
 * Environment knobs:
 *   AI_TEST_MAP=main|faction|potato|...
 *   AI_TEST_TEAM=1|2|4
 *   AI_TEST_BOTS=<2-60>
 *   AI_TEST_TIMEOUT_MS=<match timeout, default 10 min>
 *   AI_TEST_DIFFICULTIES=normal,hard,pro,legit,forbidden (optional cycle)
 *   AI_TEST_SIMULATE_HUMAN=1  spawn one serverBot=false worker (faction escort test)
 *   AI_TEST_PORT=<port>       override the dev/game server port (default 8001)
 */
process.env.BOT_MATCH_RECORDING = "1";
const logger = new Logger("AI capability test");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const mapName = process.env.AI_TEST_MAP ?? "main";
const teamModeRaw = Number(process.env.AI_TEST_TEAM ?? TeamMode.Solo);
const teamMode = [TeamMode.Solo, TeamMode.Duo, TeamMode.Squad].includes(teamModeRaw as TeamMode)
    ? (teamModeRaw as TeamMode)
    : TeamMode.Solo;
const botCount = Math.max(2, Math.min(60, Math.floor(Number(process.env.AI_TEST_BOTS ?? 10))));
const timeoutMs = Math.max(60_000, Math.floor(Number(process.env.AI_TEST_TIMEOUT_MS ?? 10 * 60_000)));
const simulateHuman = process.env.AI_TEST_SIMULATE_HUMAN === "1";
const portOverride = Number(process.env.AI_TEST_PORT);
if (Number.isFinite(portOverride) && portOverride > 0) {
    util.mergeDeep(Config, {
        devServer: { port: portOverride },
        gameServer: { port: portOverride },
    });
}
const difficulties = (process.env.AI_TEST_DIFFICULTIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ["normal", "hard", "pro", "legit", "forbidden"].includes(value)) as Array<
    "normal" | "hard" | "pro" | "legit" | "forbidden"
>;

interface EventEntry {
    type: string;
    at?: number;
    botId?: number;
    [key: string]: unknown;
}

interface FrameEntry {
    type: string;
    at?: number;
    botId?: number;
    state?: string;
    intent?: { kind?: string } | null;
    gasDecision?: { danger?: boolean } | null;
    self?: { weapons?: Array<{ type?: string }> } | null;
}

interface RecordingAggregate {
    eventCounts: Record<string, number>;
    damageTaken: { events: number; total: number };
    weaponSearchAbandoned: { events: number; ageMsTotal: number };
    resourceTargetAbandoned: Record<string, number>;
    gasEscapes: { started: number; ended: number };
    kills: number;
    gameOverBots: number;
    survivors: number[];
    humanSupportStarted: number;
    humanSupportEnded: number;
    humanEscortFrames: number;
    firstFrameAt: number;
    lastFrameAt: number;
    frameStates: Record<string, number>;
    gasDangerFrames: number;
    botsWithWeapon: Set<number>;
    timeToFirstWeaponMs: number | null;
    frameCount: number;
    registeredBots: Set<number>;
}

function collectRecordings(gameId: string): RecordingAggregate {
    const aggregate: RecordingAggregate = {
        eventCounts: {},
        damageTaken: { events: 0, total: 0 },
        weaponSearchAbandoned: { events: 0, ageMsTotal: 0 },
        resourceTargetAbandoned: {},
        gasEscapes: { started: 0, ended: 0 },
        kills: 0,
        gameOverBots: 0,
        survivors: [],
        humanSupportStarted: 0,
        humanSupportEnded: 0,
        humanEscortFrames: 0,
        firstFrameAt: Number.POSITIVE_INFINITY,
        lastFrameAt: 0,
        frameStates: {},
        gasDangerFrames: 0,
        botsWithWeapon: new Set(),
        timeToFirstWeaponMs: null,
        frameCount: 0,
        registeredBots: new Set(),
    };
            // Keep recordings outside server/ (see aiMatchRecorder.ts) so the
            // dev `node --watch` watcher does not restart on every frame write.
            const recordingRoot = path.join(process.cwd(), "..", "ai-match-recordings");
    if (!fs.existsSync(recordingRoot)) return aggregate;

    const matchDirName = `match-${gameId}`;
    for (const sessionName of fs.readdirSync(recordingRoot)) {
        const matchDir = path.join(recordingRoot, sessionName, matchDirName);
        if (!fs.existsSync(matchDir) || !fs.statSync(matchDir).isDirectory()) continue;
        for (const file of fs.readdirSync(matchDir)) {
            if (/^events-\d+\.jsonl(\.part)?$/.test(file)) {
                for (const line of fs.readFileSync(path.join(matchDir, file), "utf8").split(/\r?\n/)) {
                    if (!line.trim()) continue;
                    let entry: EventEntry;
                    try {
                        entry = JSON.parse(line) as EventEntry;
                    } catch {
                        continue;
                    }
                    aggregate.eventCounts[entry.type] = (aggregate.eventCounts[entry.type] ?? 0) + 1;
                    if (entry.type === "bot_registered" && entry.botId !== undefined) {
                        aggregate.registeredBots.add(entry.botId);
                    }
                    if (entry.type === "damage_taken") {
                        aggregate.damageTaken.events += 1;
                        aggregate.damageTaken.total += Number(entry.damage ?? 0);
                    }
                    if (entry.type === "weapon_search_abandoned") {
                        aggregate.weaponSearchAbandoned.events += 1;
                        aggregate.weaponSearchAbandoned.ageMsTotal += Number(entry.ageMs ?? 0);
                    }
                    if (entry.type === "resource_target_abandoned") {
                        const reason = String(entry.reason ?? "unknown");
                        aggregate.resourceTargetAbandoned[reason] =
                            (aggregate.resourceTargetAbandoned[reason] ?? 0) + 1;
                    }
                    if (entry.type === "gas_escape_started") aggregate.gasEscapes.started += 1;
                    if (entry.type === "gas_escape_ended") aggregate.gasEscapes.ended += 1;
                    if (entry.type === "game_over") {
                        aggregate.kills += Math.max(0, Number(entry.kills ?? 0));
                        if (entry.won === true && entry.botId !== undefined) {
                            aggregate.survivors.push(entry.botId);
                        }
                        aggregate.gameOverBots += 1;
                    }
                    if (entry.type === "human_support_started") {
                        aggregate.humanSupportStarted += 1;
                    }
                    if (entry.type === "human_support_ended") {
                        aggregate.humanSupportEnded += 1;
                    }
                }
            } else if (/^frames-\d+\.jsonl(\.part)?$/.test(file)) {
                for (const line of fs.readFileSync(path.join(matchDir, file), "utf8").split(/\r?\n/)) {
                    if (!line.trim()) continue;
                    let frame: FrameEntry;
                    try {
                        frame = JSON.parse(line) as FrameEntry;
                    } catch {
                        continue;
                    }
                    aggregate.frameCount += 1;
                    if (frame.at !== undefined) {
                        if (frame.at < aggregate.firstFrameAt) aggregate.firstFrameAt = frame.at;
                        if (frame.at > aggregate.lastFrameAt) aggregate.lastFrameAt = frame.at;
                    }
                    const state = frame.state ?? "unknown";
                    aggregate.frameStates[state] = (aggregate.frameStates[state] ?? 0) + 1;
                    if (frame.intent?.kind === "human-escort") {
                        aggregate.humanEscortFrames += 1;
                    }
                    if (frame.gasDecision?.danger === true) aggregate.gasDangerFrames += 1;
                    const weapons = frame.self?.weapons ?? [];
                    const hasWeapon = weapons.some(
                        (weapon) => weapon.type && weapon.type !== "" && weapon.type !== "fists",
                    );
                    if (hasWeapon && frame.botId !== undefined && !aggregate.botsWithWeapon.has(frame.botId)) {
                        aggregate.botsWithWeapon.add(frame.botId);
                        if (
                            aggregate.timeToFirstWeaponMs === null &&
                            frame.at !== undefined &&
                            aggregate.firstFrameAt !== Number.POSITIVE_INFINITY
                        ) {
                            aggregate.timeToFirstWeaponMs = frame.at - aggregate.firstFrameAt;
                        }
                    }
                }
            }
        }
    }
    if (aggregate.firstFrameAt === Number.POSITIVE_INFINITY) aggregate.firstFrameAt = 0;
    return aggregate;
}

function buildReport(
    match: { gameId: string; botCount: number; mapName: string; teamMode: TeamMode },
    final: GameData | undefined,
    aliveSamples: Array<{ at: number; alive: number }>,
    recordings: RecordingAggregate,
    observedMs: number,
) {
    const totalFrames = Math.max(1, recordings.frameCount);
    const state = (name: string) => recordings.frameStates[name] ?? 0;
    const searchStateShare = Math.round(((state("loot") + state("break-crate")) / totalFrames) * 100) / 100;
    const combatStateShare =
        Math.round(
            ((state("combat") + state("counterfire") + state("retreat")) / totalFrames) * 100,
        ) / 100;
    const gasStateShare = Math.round((state("gas") / totalFrames) * 100) / 100;

    return {
        version: "V56",
        createdAt: new Date().toISOString(),
        match: {
            gameId: match.gameId,
            map: match.mapName,
            teamMode: match.teamMode,
            botCount: match.botCount,
            recordedBots: recordings.registeredBots.size,
        },
        server: {
            observedMs,
            stopped: Boolean(final?.stopped),
            finalAliveCount: final?.aliveCount ?? 0,
            aliveCountSamples: aliveSamples,
        },
        search: {
            lootStateShare: searchStateShare,
            weaponSearchAbandoned: recordings.weaponSearchAbandoned.events,
            weaponSearchAbandonedAvgAgeMs: recordings.weaponSearchAbandoned.events
                ? Math.round(recordings.weaponSearchAbandoned.ageMsTotal / recordings.weaponSearchAbandoned.events)
                : 0,
            resourceTargetAbandoned: recordings.resourceTargetAbandoned,
            intentProgressAbandoned: recordings.eventCounts.intent_progress_abandoned ?? 0,
            botsThatFoundWeapon: recordings.botsWithWeapon.size,
            timeToFirstWeaponMs: recordings.timeToFirstWeaponMs,
        },
        gas: {
            gasStateShare,
            gasDangerFrameShare: Math.round((recordings.gasDangerFrames / totalFrames) * 100) / 100,
            gasEscapesStarted: recordings.gasEscapes.started,
            gasEscapesEnded: recordings.gasEscapes.ended,
        },
        combat: {
            combatStateShare,
            damageTakenEvents: recordings.damageTaken.events,
            damageTakenTotal: Math.round(recordings.damageTaken.total * 100) / 100,
            visibleThreatInterrupts: recordings.eventCounts.visible_threat_interrupt ?? 0,
            gunfireWallBlocked: recordings.eventCounts.gunfire_wall_blocked ?? 0,
            finalVisibleTriggerRestored: recordings.eventCounts.final_visible_trigger_restored ?? 0,
            hiddenContactsSelected: recordings.eventCounts.hidden_contact_selected ?? 0,
            hardCoverFlanks: recordings.eventCounts.hard_cover_flank_started ?? 0,
            kills: recordings.kills,
            survivors: recordings.survivors,
        },
        activity: {
            frameCount: recordings.frameCount,
            recordedDurationMs: recordings.lastFrameAt - recordings.firstFrameAt,
            stateChanges: recordings.eventCounts.state_changed ?? 0,
            intentChanges: recordings.eventCounts.intent_changed ?? 0,
            pathRecoveries: recordings.eventCounts.path_recovery_triggered ?? 0,
            botFinished: recordings.eventCounts.bot_finished ?? 0,
        },
        humanSupport: {
            simulatedHuman: simulateHuman,
            startedEvents: recordings.humanSupportStarted,
            endedEvents: recordings.humanSupportEnded,
            escortIntentFrames: recordings.humanEscortFrames,
        },
    };
}

async function main(): Promise<void> {
    util.mergeDeep(Config, {
        regions: {
            local: {
                https: false,
                address: `${Config.devServer.host}:${Config.devServer.port}`,
                l10n: "index-local",
            },
        },
    });

    const gameServer = new GameServer();
    const app = App();
    gameServer.init(app);

    await new Promise<void>((resolve) => {
        listenOnHosts(
            app,
            getListenHosts(Config.devServer.host, Config.network.ipv6, Config.network.ipv6Host),
            Config.devServer.port,
            () => resolve(),
            () => resolve(),
        );
    });
    logger.log(`Dev game server listening on ${formatHostPort(Config.devServer.host, Config.devServer.port)}`);

    const request: AutoAiCapabilityMatchRequest = {
        mapName,
        teamMode,
        botCount,
        ...(difficulties.length > 0 ? { difficulties } : {}),
        ...(simulateHuman ? { simulateHuman: true } : {}),
    };
    logger.log(
        `Starting pure-AI capability match: map=${mapName} team=${teamMode} bots=${botCount} timeout=${Math.round(timeoutMs / 1000)}s`,
    );
    const match = await gameServer.createAutoAiCapabilityMatch(request);
    logger.log(`Match created: game=${match.gameId}`);

    const aliveSamples: Array<{ at: number; alive: number }> = [];
    const startedAt = Date.now();
    let final: GameData | undefined;
    while (Date.now() - startedAt < timeoutMs) {
        const current = gameServer.manager.getById(match.gameId);
        if (!current) {
            // The room closed itself (e.g. the simulated human died and no
            // contestant remained).
            final = { id: match.gameId, stopped: true } as GameData;
            break;
        }
        if (current.stopped) {
            final = current;
            break;
        }
        aliveSamples.push({ at: Date.now() - startedAt, alive: current.aliveCount });
        await sleep(2000);
    }
    if (!final) {
        final = gameServer.manager.getById(match.gameId);
        logger.warn(`Match did not finish within ${Math.round(timeoutMs / 1000)}s; stopping`);
        gameServer.manager.stopGame(match.gameId);
    }
    // Give the smart-bot workers a moment to finalize their recordings.
    await sleep(1500);

    const recordings = collectRecordings(match.gameId);
    const observedMs = Date.now() - startedAt;
    const report = buildReport(match, final, aliveSamples, recordings, observedMs);

    const outputPath = path.resolve(__dirname, "..", "..", "V56_AI_CAPABILITY_REPORT.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    logger.log(`Report written to ${outputPath}`);

    const summary = [
        "==== AI CAPABILITY MATCH SUMMARY ====",
        `map=${match.mapName}/${match.teamMode} bots=${match.botCount} durationMs=${observedMs} stopped=${Boolean(final?.stopped)}`,
        `SEARCH : lootStateShare=${report.search.lootStateShare} weaponSearchAbandoned=${report.search.weaponSearchAbandoned} botsFoundWeapon=${report.search.botsThatFoundWeapon}/${match.botCount} timeToFirstWeaponMs=${report.search.timeToFirstWeaponMs}`,
        `GAS    : gasStateShare=${report.gas.gasStateShare} gasEscapes=${report.gas.gasEscapesStarted}/${report.gas.gasEscapesEnded} dangerFrameShare=${report.gas.gasDangerFrameShare}`,
        `COMBAT : combatStateShare=${report.combat.combatStateShare} damageEvents=${report.combat.damageTakenEvents} totalDamage=${report.combat.damageTakenTotal} kills=${report.combat.kills} survivors=${JSON.stringify(report.combat.survivors)}`,
        `ESCORT : simulateHuman=${report.humanSupport.simulatedHuman} supportStarted=${report.humanSupport.startedEvents} supportEnded=${report.humanSupport.endedEvents} escortIntentFrames=${report.humanSupport.escortIntentFrames}`,
        "==================================",
    ].join("\n");
    console.log("\n" + summary + "\n");

    process.exit(final?.stopped ? 0 : 1);
}

void main().catch((error) => {
    logger.warn(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
