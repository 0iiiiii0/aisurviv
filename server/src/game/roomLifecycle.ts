export const BOT_ONLY_ROOM_GRACE_MS = 5_000;

export interface BotOnlyRoomState {
    mapName: string;
    hadConnectedHuman: boolean;
    connectedHumanCount: number;
    /** Disconnected, alive humans whose player records still exist for reconnect. */
    disconnectedAliveHumanCount: number;
    connectedServerBotCount: number;
}

/**
 * A room which has been used by a real client becomes disposable once no real
 * client (player or spectator) remains connected. The Game owns the short
 * reconnect grace period before it actually stops the room.
 *
 * Disconnected player records must not keep an AI-filled room alive for the
 * full reconnect timeout (or forever in extraction mode). Likewise, duel rooms
 * are only exempt while they have never been watched by a real client.
 */
export function shouldCloseUnwatchedBotRoom(state: BotOnlyRoomState): boolean {
    if (!state.hadConnectedHuman) return false;
    return state.connectedHumanCount === 0;
}
