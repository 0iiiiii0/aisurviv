import type { Vec2 } from "../utils/v2.ts";

/**
 * 搜打撤 (search-fight-extract) mode constants shared by the server
 * (validation) and every client (markers / extraction HUD).
 */
export const EXTRACTION_POINT_COUNT = 5;
/** Standing radius of an extraction zone. */
export const EXTRACTION_ZONE_RADIUS = 3.5;
/** Seconds a player must stay inside the active zone to extract. */
export const EXTRACTION_HOLD_SECONDS = 5;
/** Total match time limit in seconds; when it expires everyone is eliminated. */
export const EXTRACTION_MATCH_TIME_LIMIT_SECONDS = 600;
/** 绝密模式：撤离点在前 5 分钟关闭（对局开始 300 秒后才开放）。 */
export const EXTRACTION_SECRET_OPEN_SECONDS = 300;
/** 绝密模式最晚加入时间：对局开始 2 分钟（120 秒）内可加入，严于普通搜打撤的 5 分钟。 */
export const EXTRACTION_SECRET_JOIN_LIMIT_SECONDS = 120;

/** Matchmaking refuses to send a player into a match with less than this much
 *  time remaining (5 minutes). Ordinary BR rooms already lock at gas stage 2. */
export const MIN_JOINABLE_REMAINING_SECONDS = 300;
/** Seconds remaining at which the client shows a "hurry up" warning. */
export const EXTRACTION_TIME_WARNING_SECONDS = 150;

function hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministically plans the extraction points for a map. The server and every
 * client derive the exact same set from the map name + dimensions, so no extra
 * network state is required. Points are spread around the map perimeter with a
 * safe margin.
 */
export function generateExtractionPoints(
    mapName: string,
    width: number,
    height: number,
): Vec2[] {
    const rand = mulberry32(hashSeed(`${mapName}:${width}:${height}`));
    const margin = Math.max(24, Math.min(width, height) * 0.06);
    const points: Vec2[] = [];
    for (let i = 0; i < EXTRACTION_POINT_COUNT; i++) {
        const side = Math.floor(rand() * 4);
        const along = 0.12 + rand() * 0.76;
        const jitter = 4 + rand() * 14;
        let x = 0;
        let y = 0;
        switch (side) {
            case 0:
                x = margin + along * (width - 2 * margin);
                y = margin + jitter;
                break;
            case 1:
                x = width - margin - jitter;
                y = margin + along * (height - 2 * margin);
                break;
            case 2:
                x = margin + along * (width - 2 * margin);
                y = height - margin - jitter;
                break;
            default:
                x = margin + jitter;
                y = margin + along * (height - 2 * margin);
                break;
        }
        points.push({ x, y });
    }
    return points;
}

/**
 * 搜打撤·高级资源点（Boss 刷新点）：与撤离点独立的确定性坐标，散布在地图
 * 中段，彼此保持最小间距，避免 Boss 挤在角落或互相重叠。服务端据此生成
 * Boss；客户端无需额外同步刷新点。
 */
export function generateBossPoints(
    mapName: string,
    width: number,
    height: number,
    count: number,
): Vec2[] {
    const rand = mulberry32(hashSeed(`boss:${mapName}:${width}:${height}`));
    const margin = Math.max(48, Math.min(width, height) * 0.12);
    const minGap = Math.max(64, Math.min(width, height) * 0.18);
    const points: Vec2[] = [];
    let guard = 0;
    while (points.length < count && guard++ < 200) {
        const x = margin + rand() * (width - 2 * margin);
        const y = margin + rand() * (height - 2 * margin);
        if (
            points.some(
                (p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minGap * minGap,
            )
        ) {
            continue;
        }
        points.push({ x, y });
    }
    return points;
}

/** The active extraction point is the one farthest from the given position. */
export function farthestExtractionPoint(
    points: readonly Vec2[],
    pos: Vec2,
): Vec2 {
    let best = points[0] ?? { x: 0, y: 0 };
    let bestDistSq = -1;
    for (const point of points) {
        const dx = point.x - pos.x;
        const dy = point.y - pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > bestDistSq) {
            bestDistSq = distSq;
            best = point;
        }
    }
    return best;
}

/** True when the player stands inside the given extraction zone. */
export function insideExtractionZone(
    zone: Vec2,
    pos: Vec2,
    radius = EXTRACTION_ZONE_RADIUS,
): boolean {
    const dx = zone.x - pos.x;
    const dy = zone.y - pos.y;
    return dx * dx + dy * dy <= radius * radius;
}

/** 搜打撤/绝密：带入能力的数量上限（配装最多 4 个）。 */
export const PERK_BRING_IN_MAX = 4;
/** 搜打撤/绝密：能力带出的最高额外槽位数。 */
export const PERK_CARRY_OUT_EXTRA_MAX = 3;
/** 搜打撤/绝密：能力带出的总上限（带入 + 额外）。 */
export const PERK_CARRY_OUT_MAX = 7;

/**
 * 搜打撤/绝密：由“带入能力数”计算撤离时最多可带出的能力数量。
 * - 带入 N 个能力 → 可带出 N + 额外 个；每多带入 1 个能力就多 1 个额外槽位。
 * - 额外槽位最高 PERK_CARRY_OUT_EXTRA_MAX 个，总带出上限 PERK_CARRY_OUT_MAX。
 *   带入 1 → 1，2 → 3，3 → 5，4 → 7。
 * - 槽位在进局发放时按“实际带入数量”锁定：局内丢掉旧能力不会增减带出槽位。
 * 仅用于搜打撤/绝密两种模式；其他模式不受影响。
 */
export function perkCarryOutCap(broughtInCount: number): number {
    const n = Math.max(0, Math.floor(Number(broughtInCount) || 0));
    if (n <= 0) return 0;
    const extra = Math.min(n - 1, PERK_CARRY_OUT_EXTRA_MAX);
    return Math.min(n + extra, PERK_CARRY_OUT_MAX);
}
