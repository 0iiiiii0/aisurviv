/** Pure revive-ownership checks shared by runtime code and regression tests. */
export function ownsReviveTarget(input: {
    actorId: number;
    targetId: number;
    targetRevivedById: number;
}): boolean {
    return (
        input.actorId > 0
        && input.targetId > 0
        && input.actorId === input.targetRevivedById
    );
}

export function shouldApplyAreaRevive(input: {
    actorHasAoeHeal: boolean;
    actorId: number;
    targetId: number;
    targetRevivedById: number;
}): boolean {
    return input.actorHasAoeHeal && ownsReviveTarget(input);
}
