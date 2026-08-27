import type { Vec2 } from "../../../shared/utils/v2.ts";

/**
 * 跨楼层射击安全模块。
 *
 * surviv.io 的 layer 不是“高度”，而是位掩码：
 *   0 = 地面层
 *   1 = 地下层
 *   2 = 地面侧楼梯
 *   3 = 地下侧楼梯
 *
 * 服务端允许 layer 2/3 与对应楼层交互，但这并不代表地图上任意两个
 * layer 0/1/2/3 坐标都能互相射击。V55 的旧判断只看 layer 位，导致 AI
 * 可能隔着楼板向另一座楼梯或楼下空地射击。
 *
 * 本模块要求跨层射线必须经过“同一个真实楼梯碰撞区”，并且双方必须位于
 * 该楼梯正确的一侧。普通同层射击不受影响。
 */

export interface StairFireRegion {
    structureId: number;
    stairIndex: number;
    min: Vec2;
    max: Vec2;
    /** 指向楼梯下端/地下侧的单位方向。 */
    downDir: Vec2;
}

export interface CrossFloorShotInput {
    shooterPos: Vec2;
    shooterLayer: number;
    targetPos: Vec2;
    targetLayer: number;
    stairs: readonly StairFireRegion[];
    /** 玩家半径与网络误差的额外容差。 */
    bodyMargin?: number;
    /** 非楼梯端允许退后射击的最大距离。 */
    endpointReach?: number;
}

export interface CrossFloorShotDecision {
    allowed: boolean;
    reason:
        | "same-exact-layer"
        | "cross-layer-without-stair-state"
        | "no-matching-stair-connector"
        | "verified-same-stair-connector";
    structureId?: number;
    stairIndex?: number;
}

const sqr = (value: number): number => value * value;
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const length = (value: Vec2): number => Math.sqrt(sqr(value.x) + sqr(value.y));
const normalize = (value: Vec2): Vec2 => {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : { x: 0, y: 1 };
};

/** 去掉楼梯位后，0 表示地面侧，1 表示地下侧。 */
export function baseFloorLayer(layer: number): number {
    return Number(layer) & 0x1;
}

/** layer 2/3 都带有楼梯位。 */
export function isStairLayer(layer: number): boolean {
    return (Number(layer) & 0x2) !== 0;
}

function expandAabb(
    min: Vec2,
    max: Vec2,
    amount: number,
): { min: Vec2; max: Vec2 } {
    return {
        min: { x: min.x - amount, y: min.y - amount },
        max: { x: max.x + amount, y: max.y + amount },
    };
}

function pointInsideAabb(point: Vec2, min: Vec2, max: Vec2): boolean {
    return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y;
}

function pointDistanceToAabb(point: Vec2, min: Vec2, max: Vec2): number {
    const dx = point.x < min.x ? min.x - point.x : point.x > max.x ? point.x - max.x : 0;
    const dy = point.y < min.y ? min.y - point.y : point.y > max.y ? point.y - max.y : 0;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Liang-Barsky 线段/AABB 相交。用于确认射线确实穿过楼梯开口。 */
function segmentIntersectsAabb(a: Vec2, b: Vec2, min: Vec2, max: Vec2): boolean {
    const delta = sub(b, a);
    let tMin = 0;
    let tMax = 1;

    const axes: Array<[number, number, number, number]> = [
        [a.x, delta.x, min.x, max.x],
        [a.y, delta.y, min.y, max.y],
    ];

    for (const [origin, direction, axisMin, axisMax] of axes) {
        if (Math.abs(direction) < 0.000001) {
            if (origin < axisMin || origin > axisMax) return false;
            continue;
        }
        const inv = 1 / direction;
        let near = (axisMin - origin) * inv;
        let far = (axisMax - origin) * inv;
        if (near > far) [near, far] = [far, near];
        tMin = Math.max(tMin, near);
        tMax = Math.min(tMax, far);
        if (tMin > tMax) return false;
    }
    return true;
}

/**
 * 验证一个点是否处于楼梯对应的正确一侧。
 * downDir 指向地下端：base layer 1 应位于正方向，base layer 0 应位于反方向。
 * sideSlack 允许玩家圆形身体跨越楼梯中心线时仍被正确识别。
 */
function pointMatchesFloorSide(
    point: Vec2,
    layer: number,
    stair: StairFireRegion,
    sideSlack: number,
): boolean {
    const center = {
        x: (stair.min.x + stair.max.x) * 0.5,
        y: (stair.min.y + stair.max.y) * 0.5,
    };
    const projection = dot(sub(point, center), normalize(stair.downDir));
    return baseFloorLayer(layer) === 1
        ? projection >= -sideSlack
        : projection <= sideSlack;
}

/**
 * 判定跨层射击是否经过真实且相同的楼梯。
 *
 * 允许：
 * - 完全相同 layer；
 * - 敌人在楼梯下端/上端，射线经过该楼梯，另一方位于相应楼层一侧；
 * - 双方都在同一楼梯碰撞区。
 *
 * 拒绝：
 * - 普通 layer 0 与 layer 1 隔楼板射击；
 * - 目标虽带 layer 2/3，但属于另一座楼梯；
 * - 射线只是在二维投影上经过目标，却没有穿过楼梯开口。
 */
export function evaluateCrossFloorShot(
    input: CrossFloorShotInput,
): CrossFloorShotDecision {
    const shooterLayer = Number(input.shooterLayer ?? 0);
    const targetLayer = Number(input.targetLayer ?? 0);

    if (shooterLayer === targetLayer) {
        return { allowed: true, reason: "same-exact-layer" };
    }

    // 不同基础楼层且双方都不在楼梯状态，必然是隔楼板/天花板的错误射击。
    if (!isStairLayer(shooterLayer) && !isStairLayer(targetLayer)) {
        return { allowed: false, reason: "cross-layer-without-stair-state" };
    }

    const bodyMargin = Math.max(0.5, input.bodyMargin ?? 1.35);
    const endpointReach = Math.max(bodyMargin, input.endpointReach ?? 13);
    const sideSlack = bodyMargin + 1.25;

    for (const stair of input.stairs) {
        const expanded = expandAabb(stair.min, stair.max, bodyMargin);
        const shooterInside = pointInsideAabb(input.shooterPos, expanded.min, expanded.max);
        const targetInside = pointInsideAabb(input.targetPos, expanded.min, expanded.max);

        // 带楼梯 layer 的一方必须真的位于该楼梯碰撞区附近，不能只凭 layer 位放行。
        if (isStairLayer(shooterLayer) && !shooterInside) continue;
        if (isStairLayer(targetLayer) && !targetInside) continue;

        const shooterDistance = pointDistanceToAabb(input.shooterPos, stair.min, stair.max);
        const targetDistance = pointDistanceToAabb(input.targetPos, stair.min, stair.max);
        if (shooterDistance > endpointReach || targetDistance > endpointReach) continue;

        if (!segmentIntersectsAabb(input.shooterPos, input.targetPos, expanded.min, expanded.max)) {
            continue;
        }

        if (!pointMatchesFloorSide(input.shooterPos, shooterLayer, stair, sideSlack)) continue;
        if (!pointMatchesFloorSide(input.targetPos, targetLayer, stair, sideSlack)) continue;

        return {
            allowed: true,
            reason: "verified-same-stair-connector",
            structureId: stair.structureId,
            stairIndex: stair.stairIndex,
        };
    }

    return { allowed: false, reason: "no-matching-stair-connector" };
}
