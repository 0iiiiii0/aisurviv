import { v2, type Vec2 } from "../../../shared/utils/v2.ts";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * A projectile snapshot as seen by an ordinary bot. The wire carries no
 * fuseTime, velocity or owner, so the bot approximates remaining fuse with the
 * first-seen age and predicts a short travel window along `dir`.
 */
export interface GrenadeThreatProjectile {
    id: number;
    type: string;
    layer: number;
    pos: Vec2;
    dir: Vec2;
}

export interface GrenadeEscapeContext {
    botPos: Vec2;
    botLayer: number;
    projectiles: ReadonlyArray<GrenadeThreatProjectile>;
    mapWidth: number;
    mapHeight: number;
    /**
     * Seconds since the bot first saw each projectile id. Returns Infinity when
     * the id is unknown (treats it as freshly seen).
     */
    ageSeconds: (id: number) => number;
}

/**
 * Chooses an escape direction away from nearby explosive projectiles (frag,
 * MIRV, martyrdom, potato). Works for every bot difficulty; ordinary bots call
 * it with whatever projectile data their object pool exposes.
 */
export function chooseGrenadeEscape(ctx: GrenadeEscapeContext): Vec2 | null {
    let vector = v2.create(0, 0);
    let weight = 0;
    for (const projectile of ctx.projectiles) {
        if (projectile.layer !== ctx.botLayer) continue;
        if (!/frag|mirv|martyr|potato/i.test(projectile.type)) continue;

        // Bound the danger window. A frag/MIRV burns ~4 s, martyrdom ~3 s and
        // potato explodes on impact, so anything older is a stale pool entry
        // and must never keep the bot panicking forever.
        const maxAgeSeconds = /martyr/i.test(projectile.type)
            ? 3.4
            : /potato/i.test(projectile.type)
            ? 2.2
            : 4.6;
        const rawAge = ctx.ageSeconds(projectile.id);
        const ageSeconds = Number.isFinite(rawAge) ? rawAge : 0;
        if (ageSeconds > maxAgeSeconds) continue;

        // The wire only carries the unit `dir`, so predict a conservative
        // ~0.35 s travel window (~7 units at typical throw speed) and treat
        // both the current and predicted position as danger points.
        const predicted = v2.add(projectile.pos, v2.mul(projectile.dir, 7));
        const dangerRadius = /mirv(?!_mini)/i.test(projectile.type)
            ? 15
            : /mirv_mini|martyr/i.test(projectile.type)
            ? 10
            : 13;
        const currentDist = v2.length(v2.sub(ctx.botPos, projectile.pos));
        const predictedDist = v2.length(v2.sub(ctx.botPos, predicted));
        const dist = Math.min(currentDist, predictedDist);
        if (dist > dangerRadius + 6) continue;

        // Older projectiles are closer to detonation; closer danger points are
        // more urgent. The floor keeps a freshly seen grenade from being
        // ignored just because it cannot have burned long yet.
        const urgency = 0.35 + 0.65 * Math.min(1, ageSeconds / maxAgeSeconds);
        const distanceWeight = clamp(
            (dangerRadius + 6 - dist) / (dangerRadius + 6),
            0,
            1,
        );
        const danger = urgency * distanceWeight;
        vector = v2.add(
            vector,
            v2.mul(v2.normalizeSafe(v2.sub(ctx.botPos, predicted)), danger),
        );
        weight += danger;
    }
    if (weight < 0.06) return null;

    let direction = v2.normalizeSafe(vector, v2.create(1, 0));
    const future = v2.add(ctx.botPos, v2.mul(direction, 8));
    if (
        future.x < 1.5
        || future.y < 1.5
        || future.x > ctx.mapWidth - 1.5
        || future.y > ctx.mapHeight - 1.5
    ) {
        // Never push the bot into the map border; fall back to map center.
        direction = v2.normalizeSafe(
            v2.sub(
                v2.create(ctx.mapWidth * 0.5, ctx.mapHeight * 0.5),
                ctx.botPos,
            ),
        );
    }
    return direction;
}
