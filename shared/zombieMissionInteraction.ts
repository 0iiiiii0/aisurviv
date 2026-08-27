import { ZOMBIE_MISSION_ELEMENT_COUNT, ZOMBIE_MISSION_INTERACT_RADIUS } from "./defs/zombieDefs.ts";
import { ZombieMissionPhase } from "./net/zombieMissionMsg.ts";
import { v2, type Vec2 } from "./utils/v2.ts";

export type ZombieMissionInteractionTarget =
    | { kind: "pickup"; elementIndex: number }
    | { kind: "place"; elementIndex: number };

export interface ZombieMissionInteractionSnapshot {
    phase: ZombieMissionPhase;
    groundMask: number;
    carriedElement: number;
    devicePos: Vec2;
    elementPositions: ReadonlyArray<Vec2>;
}

/**
 * Resolve the mission action that the authoritative server will accept at the
 * player's current position. Keeping this separate from world-object scanning
 * is important because mission icons are HUD sprites, not normal loot objects.
 */
export function getZombieMissionInteractionTarget(
    snapshot: ZombieMissionInteractionSnapshot,
    playerPos: Vec2,
): ZombieMissionInteractionTarget | null {
    if (snapshot.phase !== ZombieMissionPhase.Collecting) return null;

    if (snapshot.carriedElement !== 0xff) {
        if (
            snapshot.carriedElement < 0
            || snapshot.carriedElement >= ZOMBIE_MISSION_ELEMENT_COUNT
        ) {
            return null;
        }
        return v2.distance(playerPos, snapshot.devicePos)
                <= ZOMBIE_MISSION_INTERACT_RADIUS
            ? { kind: "place", elementIndex: snapshot.carriedElement }
            : null;
    }

    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ZOMBIE_MISSION_ELEMENT_COUNT; i++) {
        if ((snapshot.groundMask & (1 << i)) === 0) continue;
        const elementPos = snapshot.elementPositions[i];
        if (!elementPos) continue;
        const distance = v2.distance(playerPos, elementPos);
        if (
            distance <= ZOMBIE_MISSION_INTERACT_RADIUS
            && distance < closestDistance
        ) {
            closestIndex = i;
            closestDistance = distance;
        }
    }

    return closestIndex >= 0
        ? { kind: "pickup", elementIndex: closestIndex }
        : null;
}
