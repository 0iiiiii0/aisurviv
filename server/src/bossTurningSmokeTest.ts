import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

/**
 * Boss 转向回归：玩家 update() 每 tick 执行 dir = dirNew（dirNew 仅由客户端
 * InputMsg 更新）。Boss 是服务端 AI，若 AI 只写 dir 不同步 dirNew，朝向会在
 * 同帧被重置回出生默认 (1,0)——表现为 Boss 永远朝东不转向、子弹固定向东飞。
 * 本测试走完整 game.update() 管线（含覆盖逻辑）验证 Boss 朝向目标转身。
 */

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;

function advanceFrame(game: Game): void {
    (game as unknown as { now: number }).now = performance.now() - 125;
    game.update();
}

void (async () => {
    try {
        Config.extractionSecret.enabled = true;
        Config.extractionBoss.enabled = true;
        Config.extractionBoss.maxHealth = 800;
        Config.extractionBoss.bossDefaultPerks = ["steelskin"];
        Config.extractionBoss.bossPerks = ["firepower"];
        Config.extractionBoss.bossPositions = {};
        Config.extractionBoss.weapons = [{ type: "m249", count: 1 }];
        Config.extractionBoss.dropItems = [];

        const game = new Game(`boss-turn-${Math.random().toString(36).slice(2)}`, {
            mapName: "extraction_secret",
            teamMode: TeamMode.Solo,
        });
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
        (boss as unknown as { bossPatrolCenter: { x: number; y: number } }).bossPatrolCenter = {
            x: 300,
            y: 300,
        };

        // 清空 Boss 与目标之间的直线障碍，保证 LOS 判定为可见。
        for (const obj of game.objectRegister.objects) {
            const o = obj as unknown as {
                __type?: number;
                dead?: boolean;
                collidable?: boolean;
                pos?: { x: number; y: number };
                bounds?: { min?: { x: number; y: number }; max?: { x: number; y: number } };
            };
            const isSolid = o.collidable === true
                || o.__type === ObjectType.Building
                || o.__type === ObjectType.Structure;
            if (!isSolid) continue;
            if (
                o.bounds?.min
                && o.bounds?.max
                && o.bounds.min.x + (o.pos?.x ?? 0) < 340
                && o.bounds.max.x + (o.pos?.x ?? 0) > 260
                && o.bounds.min.y + (o.pos?.y ?? 0) < 340
                && o.bounds.max.y + (o.pos?.y ?? 0) > 260
            ) {
                o.dead = true;
            }
        }

        // 目标在 Boss 正北方 20 距离（追击范围 48 内、巡逻圈内）。
        stashManager.addItem("TurnTarget", "m4a1", 1);
        stashManager.setLoadout("TurnTarget", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human = game.playerBarn.addTestPlayer({ name: "TurnTarget" });
        human.pos.x = 300;
        human.pos.y = 280;
        human.layer = 0;
        human.aimLayer = 0;
        human.health = 10000; // 防止 Boss 开火击杀目标导致断言抖动

        // 出生默认朝向为 (1,0)（朝东）。目标在正北，跑完整管线后 Boss
        // 必须转向正北；dirNew 必须与 dir 同步（否则下一帧又被重置）。
        assert.ok(boss.dir.x > 0.9, "spawn default facing is east (1,0)");
        for (let i = 0; i < 6; i++) advanceFrame(game);

        const len = Math.hypot(boss.dir.x, boss.dir.y) || 1;
        const dirX = boss.dir.x / len;
        const dirY = boss.dir.y / len;
        assert.ok(
            dirY < -0.7 && Math.abs(dirX) < 0.7,
            `boss must turn north toward the target, got dir=(${dirX.toFixed(2)}, ${dirY.toFixed(2)})`,
        );
        const newLen = Math.hypot(boss.dirNew.x, boss.dirNew.y) || 1;
        assert.ok(
            boss.dirNew.y / newLen < -0.7,
            `dirNew must stay in sync with the AI-facing, got dirNew=(${boss.dirNew.x.toFixed(2)}, ${boss.dirNew.y.toFixed(2)})`,
        );

        // 反向验证：把目标挪到正东，Boss 应转回朝东（证明是持续转向而非巧合）。
        human.pos.x = 330;
        human.pos.y = 300;
        for (let i = 0; i < 6; i++) advanceFrame(game);
        const len2 = Math.hypot(boss.dir.x, boss.dir.y) || 1;
        assert.ok(
            boss.dir.x / len2 > 0.7,
            `boss must turn east when the target moves east, got dir=(${(boss.dir.x / len2).toFixed(2)}, ${(boss.dir.y / len2).toFixed(2)})`,
        );

        game.stop();
        console.log(
            "Boss turning smoke test passed: boss (and dirNew sync) turns toward its target through the full update pipeline instead of being reset to the spawn facing.",
        );
    } finally {
        Config.extractionBoss = previousBoss;
        stashManager.removePlayer("TurnTarget");
    }
})();
