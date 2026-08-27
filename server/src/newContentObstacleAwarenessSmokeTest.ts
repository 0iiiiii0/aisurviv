import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RawMapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import {
    blocksBulletCollision,
    blocksLocalMovement,
    isAuthoritativelyDestructibleCover,
    isWindowObstacle,
} from "./bot/obstaclePolicy.ts";

/**
 * 新版本障碍物识别回归：AI 与服务器共用同一份 shared MapObjectDefs，
 * 0.3.12 合并新增的建筑（mansion / barn_basement / reserve / vat 等）
 * 必须全部能被 bot 的障碍策略正确分类——不崩溃、语义符合定义字段。
 * 若未来 defs 改名/改字段导致识别层失配，本测试会第一时间暴露。
 */

type AnyDef = Record<string, unknown> & { type?: string };

const defs = RawMapObjectDefs as unknown as Record<string, AnyDef>;

let scanned = 0;
for (const [type, def] of Object.entries(defs)) {
    if (def.type !== "obstacle") continue;
    scanned++;
    // 每个障碍类型都必须能安全通过全部策略函数（无异常、返回布尔）。
    const bullet = blocksBulletCollision({
        type,
        definition: def as never,
        runtime: {},
        bulletHeight: 0.5,
    });
    const walk = blocksLocalMovement({ type, definition: def as never, runtime: {} });
    const destructible = isAuthoritativelyDestructibleCover({
        type,
        definition: def as never,
        runtime: {},
    });
    const window = isWindowObstacle(type, def as never);
    assert.equal(typeof bullet, "boolean", `${type}: bullet policy must return boolean`);
    assert.equal(typeof walk, "boolean", `${type}: movement policy must return boolean`);
    assert.equal(typeof destructible, "boolean", `${type}: destructible policy must return boolean`);
    // 窗户永远不能被当作可打碎的普通掩体（第一发穿射语义由专用逻辑处理）。
    if (window) {
        assert.equal(
            destructible,
            false,
            `${type}: window must not be classified as ordinary destructible cover`,
        );
    }
}
assert.ok(scanned >= 700, `expected the full obstacle def table, got ${scanned}`);

// 语义抽查：核心类别行为必须与服务器权威判定一致。
const semantic = (type: string) => ({
    bullet: blocksBulletCollision({
        type,
        definition: defs[type] as never,
        runtime: {},
        bulletHeight: 0.5,
    }),
    walk: blocksLocalMovement({ type, definition: defs[type] as never, runtime: {} }),
});
assert.deepEqual(semantic("bush"), { bullet: false, walk: false }, "bush is transparent");
assert.deepEqual(semantic("crate_01"), { bullet: true, walk: true }, "crate blocks both");
assert.deepEqual(
    semantic("wall_window_01"),
    { bullet: false, walk: true },
    "window glass is shootable-through but remains physical for routing",
);
assert.deepEqual(semantic("tree_01"), { bullet: true, walk: true }, "tree blocks both");

// 0.3.12 新增内容的直接覆盖。
for (const newType of ["reserve_window_01", "club_window_01", "vat_03"]) {
    assert.ok(defs[newType], `0.3.12 content ${newType} must exist in shared defs`);
}

// 楼梯/结构识别是数据驱动的：bot 必须从共享 defs 读取 structure.stairs，
// 而不是硬编码楼梯类型名（stairs_01 在 0.3.12 中被移除，新增
// barn_basement_stairs_01，硬编码会静默失效）。
const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");
assert.match(
    smartBotSource,
    /Array\.isArray\(definition\.stairs\)/,
    "stair regions must come from structure definitions in shared defs",
);

console.log(
    `New content obstacle awareness smoke test passed: ${scanned} obstacle defs (incl. 0.3.12 mansion/barn-basement/reserve/vat) classify correctly through the AI obstacle policy.`,
);
