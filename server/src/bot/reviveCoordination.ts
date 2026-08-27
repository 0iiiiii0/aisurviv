export interface ReviveActorLike {
    id: number;
    dead: boolean;
    disconnected: boolean;
    actionType: number;
    actionTargetId: number;
    reviveTargetId: number;
}

/** Returns the actor that already owns the revive, excluding the caller. */
export function activeReviverFor(
    actors: readonly ReviveActorLike[],
    callerId: number,
    targetId: number,
    reviveActionType: number,
): ReviveActorLike | undefined {
    return actors.find(
        (actor) =>
            actor.id !== callerId
            && !actor.dead
            && !actor.disconnected
            && actor.actionType === reviveActionType
            && actor.actionTargetId === targetId
            && actor.reviveTargetId === targetId,
    );
}
