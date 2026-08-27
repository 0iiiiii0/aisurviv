export type SpecialActionPhase =
    | "planned"
    | "moving-to-valid-position"
    | "requesting-equip"
    | "waiting-equip-confirmation"
    | "aligning"
    | "holding"
    | "released"
    | "waiting-server-confirmation"
    | "completed"
    | "cancelled"
    | "failed";

export type SpecialActionTerminalReason =
    | "completed"
    | "superseded-by-gas"
    | "superseded-by-airstrike"
    | "superseded-by-visible-threat"
    | "role-changed"
    | "expired"
    | "wrong-layer"
    | "weapon-missing"
    | "no-ammo"
    | "not-outdoors"
    | "trajectory-invalid"
    | "unsafe-trajectory"
    | "equip-timeout"
    | "gun-window-opened"
    | "server-confirm-timeout"
    | "manual-reset"
    | "unknown";

export interface SpecialActionLifecycleFields {
    actionId: string;
    phase: SpecialActionPhase;
    phaseEnteredAt: number;
    equipAttempts: number;
    lastFailureReason?: SpecialActionTerminalReason;
}

export function createSpecialActionId(
    botId: number,
    sequence: number,
    timestamp: number,
): string {
    return `bot-${Math.max(0, Math.trunc(botId))}-${Math.max(1, Math.trunc(sequence))}-${
        Math.max(0, Math.trunc(timestamp))
    }`;
}

export function shouldSendSpecialEquipRequest(input: {
    attempts: number;
    lastRequestedAt?: number;
    timestamp: number;
    retryMs: number;
    maxAttempts?: number;
}): boolean {
    const attempts = Math.max(0, Math.trunc(Number(input.attempts) || 0));
    const maxAttempts = Math.max(1, Math.trunc(Number(input.maxAttempts) || 2));
    if (attempts >= maxAttempts) return false;
    if (input.lastRequestedAt === undefined) return true;
    return input.timestamp - input.lastRequestedAt >= Math.max(50, input.retryMs);
}

export function specialEquipTimedOut(input: {
    attempts: number;
    lastRequestedAt?: number;
    timestamp: number;
    retryMs: number;
    maxAttempts?: number;
}): boolean {
    const maxAttempts = Math.max(1, Math.trunc(Number(input.maxAttempts) || 2));
    return Boolean(
        input.attempts >= maxAttempts
            && input.lastRequestedAt !== undefined
            && input.timestamp - input.lastRequestedAt >= Math.max(50, input.retryMs),
    );
}
