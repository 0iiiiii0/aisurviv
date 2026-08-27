import type { Vec2 } from "../../../shared/utils/v2.ts";

interface CollisionLike {
    type?: number;
    pos?: Vec2;
    rad?: number;
    min?: Vec2;
    max?: Vec2;
}

interface InteractableDefinitionLike {
    collision?: CollisionLike;
    button?: { interactionRad?: number };
    door?: { interactionRad?: number };
}

export interface InteractionApproachPlan {
    approachPoint: Vec2;
    aimPoint: Vec2;
    surfaceDistance: number;
    interactionReach: number;
    canInteract: boolean;
}

export interface ColliderApproachPlan {
    /** Nearest point on the transformed collider surface. */
    surfacePoint: Vec2;
    /** Point slightly inside the collider, suitable for aiming a melee attack. */
    aimPoint: Vec2;
    /** Actor-centre position that keeps the requested stand-off from the surface. */
    approachPoint: Vec2;
    /** Actor-centre distance to the real transformed collider surface. */
    surfaceDistance: number;
    /** Maximum surface distance at which the requested action can reach. */
    reach: number;
    canReach: boolean;
}

const rotate = (value: Vec2, radians: number): Vec2 => ({
    x: value.x * Math.cos(radians) - value.y * Math.sin(radians),
    y: value.x * Math.sin(radians) + value.y * Math.cos(radians),
});

const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = Math.hypot(value.x, value.y);
    return len > 1e-6 ? { x: value.x / len, y: value.y / len } : fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

interface LocalSurfaceResult {
    closestLocal: Vec2;
    outwardLocal: Vec2;
    surfaceDistance: number;
}

function localColliderSurface(input: {
    collision: CollisionLike | undefined;
    actorLocal: Vec2;
    scale: number;
}): LocalSurfaceResult {
    const { collision, actorLocal, scale } = input;
    let closestLocal: Vec2 = { x: 0, y: 0 };
    let outwardLocal: Vec2 = normalize(actorLocal);
    let surfaceDistance = Math.hypot(actorLocal.x, actorLocal.y) * scale;

    if (collision && typeof collision.rad === "number") {
        const center = collision.pos ?? { x: 0, y: 0 };
        const radial = {
            x: actorLocal.x - center.x,
            y: actorLocal.y - center.y,
        };
        outwardLocal = normalize(radial);
        closestLocal = {
            x: center.x + outwardLocal.x * Math.max(0, collision.rad),
            y: center.y + outwardLocal.y * Math.max(0, collision.rad),
        };
        surfaceDistance = Math.max(0, Math.hypot(radial.x, radial.y) - collision.rad) * scale;
    } else if (collision?.min && collision.max) {
        const { min, max } = collision;
        closestLocal = {
            x: clamp(actorLocal.x, min.x, max.x),
            y: clamp(actorLocal.y, min.y, max.y),
        };
        const delta = {
            x: actorLocal.x - closestLocal.x,
            y: actorLocal.y - closestLocal.y,
        };

        // If the actor is numerically inside the collider, choose the nearest
        // face. This avoids NaN steering and gives recovery code a deterministic
        // outward direction after a lag spike or stale snapshot.
        if (Math.abs(delta.x) + Math.abs(delta.y) < 1e-6) {
            const distances = [
                {
                    value: Math.abs(actorLocal.x - min.x),
                    normal: { x: -1, y: 0 },
                    point: { x: min.x, y: clamp(actorLocal.y, min.y, max.y) },
                },
                {
                    value: Math.abs(max.x - actorLocal.x),
                    normal: { x: 1, y: 0 },
                    point: { x: max.x, y: clamp(actorLocal.y, min.y, max.y) },
                },
                {
                    value: Math.abs(actorLocal.y - min.y),
                    normal: { x: 0, y: -1 },
                    point: { x: clamp(actorLocal.x, min.x, max.x), y: min.y },
                },
                {
                    value: Math.abs(max.y - actorLocal.y),
                    normal: { x: 0, y: 1 },
                    point: { x: clamp(actorLocal.x, min.x, max.x), y: max.y },
                },
            ].sort((a, b) => a.value - b.value);
            closestLocal = distances[0].point;
            outwardLocal = distances[0].normal;
            surfaceDistance = 0;
        } else {
            outwardLocal = normalize(delta);
            surfaceDistance = Math.hypot(delta.x, delta.y) * scale;
        }
    } else {
        const fallbackRadius = 1.25;
        outwardLocal = normalize(actorLocal);
        closestLocal = {
            x: outwardLocal.x * fallbackRadius,
            y: outwardLocal.y * fallbackRadius,
        };
        surfaceDistance = Math.max(0, Math.hypot(actorLocal.x, actorLocal.y) - fallbackRadius) * scale;
    }

    return { closestLocal, outwardLocal, surfaceDistance };
}

/**
 * Resolves an arbitrary Circle/AABB definition into world-space surface,
 * aim and approach points. This is intentionally shared by target scoring,
 * navigation and attack validation so a large or offset resource cannot be
 * considered "far" by one subsystem and "in range" by another.
 */
export function colliderApproachPlan(input: {
    definition: InteractableDefinitionLike | undefined;
    objectPos: Vec2;
    objectOri?: number;
    objectScale?: number;
    actorPos: Vec2;
    reach: number;
    standOff?: number;
    margin?: number;
}): ColliderApproachPlan {
    const scale = Math.max(0.05, Number(input.objectScale ?? 1));
    const radians = (Number(input.objectOri ?? 0) % 4) * Math.PI * 0.5;
    const margin = Math.max(0.02, Number(input.margin ?? 0.12));
    const reach = Math.max(0.1, Number(input.reach));
    const standOff = clamp(
        Number(input.standOff ?? Math.min(reach, 1.05)),
        0.05,
        Math.max(0.05, reach - margin),
    );

    const actorDeltaWorld = {
        x: input.actorPos.x - input.objectPos.x,
        y: input.actorPos.y - input.objectPos.y,
    };
    const actorLocalScaled = rotate(actorDeltaWorld, -radians);
    const actorLocal = {
        x: actorLocalScaled.x / scale,
        y: actorLocalScaled.y / scale,
    };
    const local = localColliderSurface({
        collision: input.definition?.collision,
        actorLocal,
        scale,
    });

    const worldPoint = (point: Vec2): Vec2 => {
        const offset = rotate({ x: point.x * scale, y: point.y * scale }, radians);
        return {
            x: input.objectPos.x + offset.x,
            y: input.objectPos.y + offset.y,
        };
    };
    const surfacePoint = worldPoint(local.closestLocal);
    const approachLocal = {
        x: local.closestLocal.x + local.outwardLocal.x * (standOff / scale),
        y: local.closestLocal.y + local.outwardLocal.y * (standOff / scale),
    };
    const aimInset = Math.max(0.06, Math.min(0.28, reach * 0.08));
    const aimLocal = {
        x: local.closestLocal.x - local.outwardLocal.x * (aimInset / scale),
        y: local.closestLocal.y - local.outwardLocal.y * (aimInset / scale),
    };

    return {
        surfacePoint,
        aimPoint: worldPoint(aimLocal),
        approachPoint: worldPoint(approachLocal),
        surfaceDistance: local.surfaceDistance,
        reach,
        canReach: local.surfaceDistance <= reach - margin,
    };
}

/**
 * Builds a point just outside an interactable obstacle's real collider.
 *
 * Steering to the obstacle centre fails for large airdrop shells because the
 * player collider can never reach the centre. The authoritative server tests
 * the player circle against the obstacle collider expanded by interactionRad,
 * so the bot must reason about distance to the collider surface instead.
 */
export function interactionApproachPlan(input: {
    definition: InteractableDefinitionLike | undefined;
    objectPos: Vec2;
    objectOri?: number;
    objectScale?: number;
    actorPos: Vec2;
    actorRadius: number;
    margin?: number;
}): InteractionApproachPlan {
    const definition = input.definition;
    const collision = definition?.collision;
    const scale = Math.max(0.05, Number(input.objectScale ?? 1));
    const radians = (Number(input.objectOri ?? 0) % 4) * Math.PI * 0.5;
    const interactionRad = Math.max(
        0,
        Number(definition?.button?.interactionRad ?? definition?.door?.interactionRad ?? 0),
    );
    const margin = Math.max(0.05, Number(input.margin ?? 0.18));
    const interactionReach = Math.max(0.1, input.actorRadius + interactionRad - margin);

    const actorDeltaWorld = {
        x: input.actorPos.x - input.objectPos.x,
        y: input.actorPos.y - input.objectPos.y,
    };
    const actorLocalScaled = rotate(actorDeltaWorld, -radians);
    const actorLocal = {
        x: actorLocalScaled.x / scale,
        y: actorLocalScaled.y / scale,
    };

    const local = localColliderSurface({ collision, actorLocal, scale });
    const { closestLocal, outwardLocal, surfaceDistance } = local;

    const approachLocal = {
        x: closestLocal.x + outwardLocal.x * (interactionReach / scale),
        y: closestLocal.y + outwardLocal.y * (interactionReach / scale),
    };
    const approachWorldOffset = rotate(
        { x: approachLocal.x * scale, y: approachLocal.y * scale },
        radians,
    );
    const approachPoint = {
        x: input.objectPos.x + approachWorldOffset.x,
        y: input.objectPos.y + approachWorldOffset.y,
    };
    const aimInset = Math.max(0.06, Math.min(0.22, interactionReach * 0.08));
    const aimLocal = {
        x: closestLocal.x - outwardLocal.x * (aimInset / scale),
        y: closestLocal.y - outwardLocal.y * (aimInset / scale),
    };
    const aimWorldOffset = rotate(
        { x: aimLocal.x * scale, y: aimLocal.y * scale },
        radians,
    );

    return {
        approachPoint,
        aimPoint: {
            x: input.objectPos.x + aimWorldOffset.x,
            y: input.objectPos.y + aimWorldOffset.y,
        },
        surfaceDistance,
        interactionReach,
        canInteract: surfaceDistance <= interactionReach,
    };
}
