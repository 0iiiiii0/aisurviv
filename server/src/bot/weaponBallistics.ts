import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";

export interface ProjectileGunBallistics {
    damage: number;
    obstacleDamage: number;
    speed: number;
    range: number;
    onHit: string;
}

/**
 * Gun definitions such as the Spud Gun fire a near-invisible bookkeeping
 * bullet and create a real throwable projectile beside it. AI must evaluate
 * the projectile/explosion rather than the zero-damage bookkeeping bullet.
 */
export function resolveProjectileGunBallistics(
    gunType: string,
): ProjectileGunBallistics | null {
    const gun = GameObjectDefs[gunType] as any;
    if (!gun || gun.type !== "gun" || !gun.projType) return null;

    const projectile = GameObjectDefs[gun.projType] as any;
    if (!projectile || projectile.type !== "throwable") return null;

    const explosion = projectile.explosionType
        ? (GameObjectDefs[projectile.explosionType] as any)
        : undefined;
    if (!explosion || explosion.type !== "explosion") return null;

    return {
        damage: Math.max(0, Number(explosion.damage ?? 0)),
        obstacleDamage: Math.max(0, Number(explosion.obstacleDamage ?? 1)),
        speed: Math.max(1, Number(projectile.throwPhysics?.speed ?? 1)),
        range: Math.max(1, Number(projectile.aimDistance ?? 1)),
        onHit: String(explosion.explosionEffectType ?? projectile.explosionType),
    };
}
