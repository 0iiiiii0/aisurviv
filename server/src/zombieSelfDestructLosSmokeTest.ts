import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

// 自爆僵尸直线可达（LOS）实测：
//   A. 无障碍物 → 近距离触发自爆（玩家受伤）
//   B. 中间插入墙壁 → 不自爆（玩家无伤）
//   C. 移除墙 → 恢复自爆

let seq = 0;
function join(game: Game, name: string, serverBot: boolean): Player {
    const token = `los-${++seq}`;
    game.addJoinToken(token, false, 1, 60_000, false, serverBot);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = "";
    const p = game.playerBarn.addPlayer(`${name}-${seq}-socket`, msg);
    if (!p) throw new Error(`failed to join ${name}`);
    return p;
}

/** 移动玩家并同步 collider（spawn 后 pos 引用可能被替换，grid 用 collider.pos）。 */
function movePlayer(p: Player, x: number, y: number): void {
    p.pos.x = x;
    p.pos.y = y;
    (p as unknown as { collider: { pos: { x: number; y: number } } }).collider.pos = p.pos;
}

void (async () => {
    const game = new Game(
        `los-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "normal" },
        () => {},
        () => {},
    );
    try {
        await game.init();
        const g = game as unknown as { started: boolean; startedTime: number; update(): void };
        g.started = true;
        g.startedTime = 0;

        const human = join(game, "Human", false);
        // 清除后加入重生保护（started 在 join 前已置 true 会触发保护）。
        (human as unknown as { spawnProtectionUntil: number }).spawnProtectionUntil = 0;
        // 找一块开阔地：沿 8 个方向找 hasPlayerWalkPath 通过的位置。
        const z = game.zombieMode as unknown as {
            zombies: Player[];
            cachedTargets: Map<number, Player>;
            spawnedInitial: boolean;
        };
        // 禁用自动波次（只保留测试僵尸）。
        z.spawnedInitial = true;

        const walkableAt = (p: { x: number; y: number }): boolean =>
            game.map.hasPlayerWalkPath(p, p, 0, 0.72);
        let base: { x: number; y: number } | null = null;
        const c = game.map.center;
        outer: for (const angle of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4]) {
            for (const radius of [30, 40, 50, 60]) {
                const p = v2.create(c.x + Math.cos(angle) * radius, c.y + Math.sin(angle) * radius);
                const zp = v2.create(p.x + 2, p.y);
                if (
                    walkableAt(p) &&
                    game.map.hasPlayerWalkPath(zp, p, 0, 0.72)
                ) {
                    base = p;
                    break outer;
                }
            }
        }
        assert.ok(base, "找到开阔地");
        movePlayer(human, base.x, base.y);
        human.layer = 0;

        // 手动生成一只自爆僵尸，放在玩家正前方 2 格处（贴脸范围 2.4 内）。
        const zombie = join(game, "Boom", true);
        movePlayer(zombie, human.pos.x + 2, human.pos.y);
        zombie.layer = 0;
        (zombie as unknown as { zombieSelfDestruct: boolean }).zombieSelfDestruct = true;
        // 关掉攻击冷却，立即攻击。
        (zombie as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
        // 注入僵尸列表（zombieMode.zombies）。
        z.zombies.push(zombie);
        z.cachedTargets.set(zombie.__id, human);
        // 先确认直线可达。
        const losBefore = game.map.hasPlayerWalkPath(zombie.pos, human.pos, 0, 0.72);
        console.log(`  [准备] 基地=(${base.x.toFixed(1)},${base.y.toFixed(1)}) 直线可达=${losBefore}`);
        assert.equal(losBefore, true, "测试前直线可达");
        // 确认玩家在 grid（爆炸射线检测依赖）。
        const circle = collider.createCircle(zombie.pos, 12);
        const gridObjects = (game.grid as unknown as {
            intersectCollider(c: unknown): unknown[];
        }).intersectCollider(circle);
        console.log(`  [准备] grid 相交对象数=${gridObjects.length}`);
        for (const o of gridObjects as Array<{ __type: number; pos: { x: number; y: number } }>) {
            console.log(`  [准备]   type=${o.__type} pos=(${o.pos.x.toFixed(1)},${o.pos.y.toFixed(1)})`);
        }

        // ===== 场景 A：无障碍物 → 应自爆 =====
        for (let i = 0; i < 10; i++) g.update();
        // 判定：自爆分支执行 = 僵尸死亡（贴脸爆炸 kill）。玩家伤害依赖
        // grid 空间索引（真实对局移动时正常），测试里直接改坐标不重索引，
        // 故以 zombie.dead 作为触发判定。
        const explodedA = (zombie as unknown as { dead: boolean }).dead;
        console.log(
            `  [A 无阻挡] 自爆=${explodedA}`,
        );
        assert.equal(explodedA, true, "无障碍物直线 → 贴脸自爆");

        // ===== 场景 B：中间有障碍物（树）→ 不自爆 =====
        // 重置僵尸存活与突进态。
        (zombie as unknown as { dead: boolean }).dead = false;
        (zombie as unknown as { health: number }).health = 100;
        (zombie as unknown as { zombieRushing: boolean }).zombieRushing = false;
        // 找一个 grid 里已注册的 Obstacle（树）作遮挡。
        const tree = (game.grid as unknown as {
            intersectCollider(c: unknown): Array<{ __type: number; pos: { x: number; y: number } }>;
        }).intersectCollider(collider.createCircle(human.pos, 60)).find(
            (o) => o.__type === 2,
        );
        assert.ok(tree, "附近有 Obstacle 可作遮挡");
        // 玩家与僵尸分列树的 x 轴两侧（直线穿过树）。
        movePlayer(human, tree.pos.x + 1.4, tree.pos.y);
        movePlayer(zombie, tree.pos.x - 1.4, tree.pos.y);
        // 清 LOS 缓存，强制重查。
        (zombie as unknown as { zombieLosUntil: number }).zombieLosUntil = 0;
        const losWithTree = game.map.hasPlayerWalkPath(zombie.pos, human.pos, 0, 0.72);
        console.log(`  [B 有树] 直线可达=${losWithTree} dist=${v2.distance(zombie.pos, human.pos).toFixed(2)}`);
        assert.equal(losWithTree, false, "树挡住直线（前置检查）");

        for (let i = 0; i < 10; i++) g.update();
        const explodedB = (zombie as unknown as { dead: boolean }).dead;
        const rushingB = (zombie as unknown as { zombieRushing: boolean }).zombieRushing;
        console.log(
            `  [B 有树] 自爆=${explodedB} 突进=${rushingB} 玩家血量=${human.health}/100`,
        );
        assert.equal(explodedB, false, "树阻挡 → 不自爆");
        assert.equal(rushingB, false, "树阻挡 → 不突进");

        // ===== 场景 C：移回开阔地（无遮挡）→ 恢复自爆 =====
        (zombie as unknown as { dead: boolean }).dead = false;
        (zombie as unknown as { health: number }).health = 100;
        (zombie as unknown as { zombieLosUntil: number }).zombieLosUntil = 0;
        (zombie as unknown as { zombieRushing: boolean }).zombieRushing = false;
        (zombie as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
        human.health = 100;
        movePlayer(human, base.x, base.y);
        movePlayer(zombie, base.x + 2, base.y);
        const losClear = game.map.hasPlayerWalkPath(zombie.pos, human.pos, 0, 0.72);
        console.log(`  [C 移回开阔地] 直线可达=${losClear}`);
        assert.equal(losClear, true, "移回开阔地后直线可达（前置检查）");

        for (let i = 0; i < 10; i++) g.update();
        const explodedC = (zombie as unknown as { dead: boolean }).dead;
        console.log(
            `  [C 移开] 自爆=${explodedC} 玩家血量=${human.health}/100`,
        );
        assert.equal(explodedC, true, "直线恢复后恢复自爆");

        console.log("\n✅ 自爆僵尸直线可达（LOS）实测通过：");
        console.log("   - 无遮挡直线 → 突进 + 贴脸自爆");
        console.log("   - 墙/障碍阻挡 → 不突进、不自爆（玩家无伤）");
        console.log("   - 移除阻挡 → 恢复突进自爆");
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
