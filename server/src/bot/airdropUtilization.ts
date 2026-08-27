export interface AirdropObjectLike {
    type?: string;
    dead?: boolean;
    button?: {
        canUse?: boolean;
        onOff?: boolean;
    };
}

/** Standard and event military shells that can be opened with their interaction button. */
export function isUsableAirdropShell(data: AirdropObjectLike | undefined): boolean {
    if (!data || data.dead) return false;
    return (
        /^airdrop_crate_0[1-4](?:$|_)/i.test(String(data.type ?? ""))
        // Some normal-mode snapshots omit canUse until the bot is near the
        // interaction radius. Only an explicit false disables the objective.
        && data.button?.canUse !== false
        && !data.button?.onOff
    );
}

/** Loot-bearing payloads left after a military shell opens. */
export function isHighValueAirdropPayload(data: AirdropObjectLike | undefined): boolean {
    if (!data || data.dead) return false;
    return /^crate_1[0-3]$/i.test(String(data.type ?? ""));
}

export function airdropSearchRadius(options: {
    kind: "shell" | "payload" | "gun";
    unarmed?: boolean;
    mapProfileId?: string;
    interest?: number;
}): number {
    const interest = Math.max(0, Number(options.interest) || 0.55);
    const mainMap = /^(?:main|adaptive)$/.test(String(options.mapProfileId ?? ""));
    const base = options.kind === "gun"
        ? options.unarmed
            ? 118
            : 82
        : options.unarmed
        ? 142
        : 118;
    const normalBonus = mainMap ? (options.unarmed ? 42 : 34) : 0;
    return Math.round(base * (0.9 + Math.min(1.4, interest) * 0.22) + normalBonus);
}

export function airdropGunPriorityBias(sourceHighValue: number): number {
    return Math.max(10, Math.min(24, Number(sourceHighValue) * 0.11));
}

/**
 * Gives airdrop objectives a stable advantage over ordinary world crates without
 * forcing an unarmed bot through active enemy fire. The caller remains
 * responsible for path, gas and combat safety checks.
 */
export function airdropObjectivePriority(
    kind: "shell" | "payload",
    distance: number,
    options: {
        unarmed?: boolean;
        friendlySide?: boolean;
        expectedLootValue?: number;
        estimatedBreakCost?: number;
    } = {},
): number {
    const dist = Math.max(0, Number(distance) || 0);
    const expected = Math.max(0, Number(options.expectedLootValue) || 0);
    const cost = Math.max(0, Number(options.estimatedBreakCost) || 0);
    if (kind === "shell") {
        return (
            1120
            + (options.unarmed ? 210 : 0)
            + (options.friendlySide ? 85 : 0)
            - dist * 4.15
        );
    }
    return (
        1660
        + (options.unarmed ? 180 : 0)
        + (options.friendlySide ? 105 : 0)
        + expected * 1.75
        - cost * 7.2
        - dist * 4.45
    );
}

export function shouldReuseAirdropWeaponLease(input: {
    currentTargetId: number;
    candidateId: number;
    timestamp: number;
    lockUntil: number;
    candidateValid: boolean;
}): boolean {
    return Boolean(
        input.candidateValid
            && input.currentTargetId > 0
            && input.currentTargetId === input.candidateId
            && input.timestamp < input.lockUntil,
    );
}

export function shouldRefreshAirdropReservation(
    timestamp: number,
    refreshAt: number,
): boolean {
    return timestamp >= refreshAt;
}
