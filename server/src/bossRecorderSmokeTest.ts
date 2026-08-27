import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { JoinTokenData } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousSecret = { ...Config.extractionSecret };
const prevRecordDir = process.env.BOT_RECORD_DIR;
const prevRecording = process.env.BOT_MATCH_RECORDING;

function joinHuman(game: Game, name: string): Player {
    game.addJoinToken(`br-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `br-${name}`;
    msg.name = name;
    const p = game.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player ?? (() => { throw new Error(`failed to join ${name}`); })();
    if (!p) throw new Error(`failed to join ${name}`);
    return p;
}

void (async () => {
    // 记录到临时目录，验证后删除。
    const tmpDir = path.join(
        process.env.TEMP ?? ".",
        `boss-rec-test-${Date.now()}`,
    );
    process.env.BOT_RECORD_DIR = tmpDir;
    process.env.BOT_MATCH_RECORDING = "1";
    try {
        Config.extractionSecret.enabled = true;
        Config.extractionBoss.enabled = true;
        Config.extractionBoss.maxHealth = 800;
        Config.extractionBoss.bossDefaultPerks = ["steelskin"];
        Config.extractionBoss.bossPerks = ["firepower"];
        Config.extractionBoss.bossPositions = {};
        Config.extractionBoss.weapons = [{ type: "m249", count: 1 }];
        Config.extractionBoss.dropItems = [];

        const game = new Game(
            `boss-rec-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction_secret", teamMode: TeamMode.Solo },
        );
        const boss = (
            game.playerBarn.players.filter(
                (p) => (p as unknown as { isBoss?: boolean }).isBoss === true,
            ) as Player[]
        )[0];
        assert.ok(boss, "boss must spawn");
        boss.pos.x = 300;
        boss.pos.y = 300;
        boss.layer = 0;
        boss.aimLayer = 0;
        (boss as unknown as { bossPatrolCenter: { x: number; y: number } }).bossPatrolCenter = { x: 300, y: 300 };
        for (const obj of game.objectRegister.objects) {
            const o = obj as unknown as {
                __type?: number;
                dead?: boolean;
                collidable?: boolean;
                pos?: { x: number; y: number };
                bounds?: { min?: { x: number; y: number }; max?: { x: number; y: number } };
            };
            const isSolid = o.collidable === true || o.__type === ObjectType.Building || o.__type === ObjectType.Structure;
            if (!isSolid) continue;
            if (o.bounds?.min && o.bounds?.max) {
                const wMin = { x: o.bounds.min.x + (o.pos?.x ?? 0), y: o.bounds.min.y + (o.pos?.y ?? 0) };
                const wMax = { x: o.bounds.max.x + (o.pos?.x ?? 0), y: o.bounds.max.y + (o.pos?.y ?? 0) };
                if (wMin.x < 335 && wMax.x > 295 && wMin.y < 335 && wMax.y > 295) o.dead = true;
            }
        }
        stashManager.addItem("RecTarget", "m4a1", 1);
        stashManager.setLoadout("RecTarget", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human = joinHuman(game, "RecTarget");
        human.pos.x = 325;
        human.pos.y = 300;
        human.layer = 0;
        // 模拟 60 帧（记录采样 5 tick → 约 12 帧写入）。
        const updateBossAI = () =>
            (game as unknown as { updateBossAI(dt: number): void }).updateBossAI(1 / 30);
        const g = game as unknown as {
            bossRecorder: { tick(g: unknown): void; enabled: boolean; endMatch(id: string): void };
        };
        for (let i = 0; i < 60; i++) {
            updateBossAI();
            if (g.bossRecorder?.enabled) g.bossRecorder.tick(game as never);
        }
        assert.ok(g.bossRecorder?.enabled, "recorder enabled");
        g.bossRecorder.endMatch(game.id);
        // 等待写流 flush。
        await new Promise((r) => setTimeout(r, 300));

        const sessionDir = fs
            .readdirSync(tmpDir)
            .map((n) => path.join(tmpDir, n))
            .find((p) => fs.statSync(p).isDirectory());
        assert.ok(sessionDir, "session dir created");
        const matchDir = fs
            .readdirSync(sessionDir)
            .filter((n) => n.startsWith("match-"))
            .map((n) => path.join(sessionDir, n))
            .find((p) => fs.statSync(p).isDirectory());
        assert.ok(matchDir, "match dir created");
        const files = fs.readdirSync(matchDir);
        const framesFile = files.find((f) => f.startsWith("boss-frames"));
        assert.ok(framesFile, `boss-frames must exist, got ${files.join(",")}`);
        const eventsFile = files.find((f) => f.startsWith("boss-events"));
        assert.ok(eventsFile, "boss-events must exist");
        const lines = fs
            .readFileSync(path.join(matchDir, framesFile), "utf8")
            .split("\n")
            .filter((l) => l.trim());
        assert.ok(lines.length >= 1, "boss frames written");
        const frame = JSON.parse(lines[0]);
        assert.equal(frame.type ?? "frame", "frame");
        const b = frame.bosses[0];
        assert.ok(b, "frame has boss entry");
        // 新诊断字段齐全。
        for (const key of [
            "decision", "moveDir", "hasLos", "targetDist",
            "patrolTarget", "stuckStationaryMs", "unstuckRemainingMs",
            "stuckCount", "flankSign",
        ]) {
            assert.ok(key in b, `frame field ${key} must exist`);
        }
        assert.ok(typeof b.decision === "string" && b.decision.length > 0, "decision set");
        console.log(
            `Boss recorder test passed: ${lines.length} frames, fields: ${Object.keys(b).join(",")}`,
        );
        console.log("  sample frame:", JSON.stringify({ decision: b.decision, moveDir: b.moveDir, hasLos: b.hasLos, targetDist: b.targetDist, patrolTarget: b.patrolTarget, stuckCount: b.stuckCount, flankSign: b.flankSign }));
    } finally {
        Config.extractionBoss = previousBoss;
        Config.extractionSecret = previousSecret;
        if (prevRecordDir === undefined) delete process.env.BOT_RECORD_DIR;
        else process.env.BOT_RECORD_DIR = prevRecordDir;
        if (prevRecording === undefined) delete process.env.BOT_MATCH_RECORDING;
        else process.env.BOT_MATCH_RECORDING = prevRecording;
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
})();
