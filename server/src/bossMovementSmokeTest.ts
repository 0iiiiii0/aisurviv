import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousSecret = { ...Config.extractionSecret };

function joinHuman(game: Game, name: string): Player {
    return game.playerBarn.addTestPlayer({ name });
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

        const game = new Game(
            `boss-move-${Math.random().toString(36).slice(2)}`,
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
        // MoveTarget 需要合格配装（绝密资格校验）。
        stashManager.addItem("MoveTarget", "m4a1", 1);
        stashManager.setLoadout("MoveTarget", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human = joinHuman(game, "MoveTarget");
        human.pos.x = 500; // 远处，Boss 无目标进入巡逻
        human.pos.y = 500;
        human.layer = 0;
        const updateBossAI = () =>
            (game as unknown as { updateBossAI(dt: number): void }).updateBossAI(1 / 30);
        const now = Date.now();
        const B = boss as unknown as {
            bossStuckSince: number;
            bossLastStuckPos: { x: number; y: number };
            bossStationaryUntil: number;
            bossStuckCount: number;
            bossUnstuckDir: { x: number; y: number };
            bossUnstuckUntil: number;
            bossPatrolTarget: { x: number; y: number };
            bossTarget: unknown;
            bossPatrolTimer: number;
            bossMoveDir: { x: number; y: number };
            bossDecision: string;
            bossReturnTimer: number;
        };
        B.bossTarget = null;

        // 1) 巡逻到点后的主动等待不能被误判为卡墙。即使带着旧版站桩
        //    latch，当前 tick 也必须保持正常 patrol-wait，而不是进入 stationary。
        B.bossStationaryUntil = now + 4000;
        B.bossUnstuckUntil = 0;
        B.bossReturnTimer = 0;
        B.bossStuckCount = 1;
        B.bossStuckSince = now - 1001;
        B.bossLastStuckPos = { x: 300, y: 300 };
        B.bossMoveDir = { x: 0, y: 0 };
        B.bossPatrolTarget = { x: 300, y: 300 };
        B.bossPatrolTimer = 4;
        boss.pos.x = 300;
        boss.pos.y = 300;
        updateBossAI();
        assert.equal(B.bossDecision, "patrol-wait", "主动等待不得进入站桩状态");
        assert.equal(B.bossStuckCount, 0, "没有移动指令时应重置卡墙计数");
        assert.equal(B.bossUnstuckUntil, 0, "主动等待不得触发逃逸");

        // 用多次“时间快进”覆盖旧日志中的 5 秒周期：等待再久也不会产生
        // stationary/escape 循环。
        for (let i = 0; i < 12; i++) {
            B.bossStuckSince = Date.now() - 1100;
            updateBossAI();
            assert.equal(B.bossDecision, "patrol-wait", "长期等待不得转成站桩/逃逸循环");
            assert.equal(B.bossUnstuckUntil, 0, "长期等待不得产生虚假逃逸");
        }

        // 2) 上一周期明确要求移动但一秒内没有位移 → 立即主动逃逸，
        //    不再先原地罚站 5 秒。
        B.bossStationaryUntil = 0;
        B.bossStuckCount = 0;
        B.bossStuckSince = now - 1001;
        B.bossLastStuckPos = { x: 300, y: 300 };
        B.bossMoveDir = { x: 1, y: 0 };
        boss.pos.x = 300;
        boss.pos.y = 300;
        updateBossAI();
        assert.ok(
            B.bossUnstuckUntil > now,
            "真实卡墙必须立即触发可通行方向逃逸",
        );
        assert.equal(B.bossStuckCount, 0, "逃逸后计数清零");
        assert.equal(B.bossStationaryUntil, 0, "真实卡墙也不得进入站桩罚时");

        // 3) 逃逸期间：Boss 输出移动方向（不站桩）。
        const moved = boss.moveLeft || boss.moveRight || boss.moveUp || boss.moveDown;
        assert.ok(moved, "逃逸期间 Boss 必须输出移动输入");
        assert.equal(B.bossDecision, "escape", "无目标卡墙应进入 escape 状态");

        // 4) 正常移动后计数清零。
        B.bossUnstuckUntil = 0;
        B.bossStationaryUntil = 0;
        B.bossStuckCount = 3;
        B.bossStuckSince = now - 1001;
        B.bossLastStuckPos = { x: 300, y: 300 };
        B.bossMoveDir = { x: 1, y: 0 };
        boss.pos.x = 320; // 位移 > 1 → 正常
        boss.pos.y = 300;
        updateBossAI();
        assert.equal(B.bossStuckCount, 0, "正常移动后卡墙计数清零");

        // 5) 战斗脱困仍保持移动，并在视线清晰时继续还击。
        boss.pos.x = 300;
        boss.pos.y = 300;
        human.pos.x = 320;
        human.pos.y = 300;
        B.bossTarget = human;
        B.bossUnstuckDir = { x: 0, y: 1 };
        B.bossUnstuckUntil = Date.now() + 1000;
        B.bossStuckSince = Date.now();
        B.bossMoveDir = { x: 0, y: 1 };
        updateBossAI();
        assert.equal(B.bossDecision, "combat-escape", "战斗卡墙应边脱困边交战");
        assert.ok(
            boss.moveLeft || boss.moveRight || boss.moveUp || boss.moveDown,
            "战斗脱困不能站着挨打",
        );
        assert.equal(boss.shootStart, true, "战斗脱困有视线时必须继续还击");

        console.log("Boss movement test passed: idle is not stuck; real/combat stuck escapes without stationary");
    } finally {
        Config.extractionBoss = previousBoss;
        Config.extractionSecret = previousSecret;
    }
})();
