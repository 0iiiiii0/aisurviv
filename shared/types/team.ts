// /api/team_v2 websocket msgs typing

import { z } from "zod";
import type { FindGameMatchData } from "./api.ts";

/**
 * The browser must send traffic more frequently than the websocket idle
 * timeout. Keeping both values in the shared protocol prevents drift.
 */
export const TEAM_KEEP_ALIVE_INTERVAL_SECONDS = 10;
export const TEAM_SOCKET_IDLE_TIMEOUT_SECONDS = 60;

export const TEAM_ROOM_CODE_LENGTH = 4;

/**
 * Accept a raw invite code, a hash ("#Ab12"), or a copied invite URL.
 * Room codes remain case-sensitive because the server generates mixed case.
 */
export function normalizeTeamRoomUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;

    let roomCode = value.trim();
    if (!roomCode) return null;
    try {
        roomCode = decodeURIComponent(roomCode);
    } catch {
        return null;
    }

    const hashIndex = roomCode.lastIndexOf("#");
    if (hashIndex >= 0) roomCode = roomCode.slice(hashIndex + 1);
    roomCode = roomCode.trim();

    const pattern = new RegExp(`^[A-Za-z0-9]{${TEAM_ROOM_CODE_LENGTH}}$`);
    return pattern.test(roomCode) ? `#${roomCode}` : null;
}

export type TeamMenuErrorType =
    | "join_full"
    | "join_not_found"
    | "join_failed"
    | "create_failed"
    | "lost_conn"
    | "join_game_failed"
    | "find_game_error"
    | "find_game_full"
    | "find_game_invalid_protocol"
    | "find_game_invalid_captcha"
    | "login_required"
    | "kicked"
    | "banned"
    | "behind_proxy"
    | "rate_limited";

export interface RoomData {
    roomUrl: string;
    findingGame: boolean;
    lastError: TeamMenuErrorType | undefined;
    region: string;
    autoFill: boolean;
    enabledGameModeIdxs: number[];
    gameModeIdx: number;
    maxPlayers: number;
    captchaEnabled: boolean;
}

//
// Team msgs that the server sends to clients
//

/**
 * send by the server to all clients to make them join the game
 */
export interface TeamJoinGameMsg {
    readonly type: "joinGame";
    data: FindGameMatchData;
}

export interface TeamMenuPlayer {
    name: string;
    playerId: number;
    isLeader: boolean;
    inGame: boolean;
}

/**
 * Send by the server to update the client team ui
 */
export interface TeamStateMsg {
    readonly type: "state";
    data: {
        localPlayerId: number; // always -1 by default since it can only be set when the socket is actually sending state to each individual client
        room: RoomData;
        players: TeamMenuPlayer[];
    };
}

/**
 * Send by the server when the player gets kicked from the team room
 */
export interface TeamKickedMsg {
    readonly type: "kicked";
    data: {};
}

export interface TeamErrorMsg {
    readonly type: "error";
    data: {
        type: TeamMenuErrorType;
    };
}

export type ServerToClientTeamMsg =
    | TeamJoinGameMsg
    | TeamStateMsg
    | TeamKeepAliveMsg
    | TeamKickedMsg
    | TeamErrorMsg;

//
// Team Msgs that the client sends to the server
//

export const zClientRoomData = z.object({
    roomUrl: z.string(),
    findingGame: z.boolean(),
    lastError: z.string().optional(),
    region: z.string(),
    autoFill: z.boolean(),
    gameModeIdx: z.number(),
});

export type ClientRoomData = z.infer<typeof zClientRoomData>;

export const zKeepAliveMsg = z.object({
    type: z.literal("keepAlive"),
    data: z.object({}).optional(),
});
export type TeamKeepAliveMsg = z.infer<typeof zKeepAliveMsg>;

/** Refreshes the account session attached to an already-open team socket. */
export const zTeamUpdateAccountMsg = z.object({
    type: z.literal("updateAccount"),
    data: z.object({
        accountToken: z.string().optional(),
    }),
});
export type TeamUpdateAccountMsg = z.infer<typeof zTeamUpdateAccountMsg>;

export const zTeamJoinMsg = z.object({
    type: z.literal("join"),
    data: z.object({
        roomUrl: z.string(),
        playerData: z.object({
            name: z.string(),
            accountToken: z.string().optional(),
        }),
    }),
});
export type TeamJoinMsg = z.infer<typeof zTeamJoinMsg>;

export const zTeamChangeNameMsg = z.object({
    type: z.literal("changeName"),
    data: z.object({
        name: z.string(),
    }),
});

export type TeamChangeNameMsg = z.infer<typeof zTeamChangeNameMsg>;

export const zTeamSetRoomPropsMsg = z.object({
    type: z.literal("setRoomProps"),
    data: zClientRoomData,
});

export type TeamSetRoomPropsMsg = z.infer<typeof zTeamSetRoomPropsMsg>;

export const zTeamCreateMsg = z.object({
    type: z.literal("create"),
    data: z.object({
        roomData: zClientRoomData,
        playerData: z.object({
            name: z.string(),
            accountToken: z.string().optional(),
        }),
    }),
});

export type TeamCreateMsg = z.infer<typeof zTeamCreateMsg>;

export const zTeamKickMsg = z.object({
    type: z.literal("kick"),
    data: z.object({
        playerId: z.number(),
    }),
});

export type TeamKickMsg = z.infer<typeof zTeamKickMsg>;

export const zTeamPlayGameMsg = z.object({
    type: z.literal("playGame"),
    data: z.object({
        version: z.number(),
        region: z.string(),
        zones: z.array(z.string()),
        turnstileToken: z.string().optional(),
        /** Revalidated for the leader immediately before custom matchmaking. */
        accountToken: z.string().optional(),
        zombieDifficulty: z.enum(["simple", "normal", "hard"]).optional(),
    }),
});

export type TeamPlayGameMsg = z.infer<typeof zTeamPlayGameMsg>;

export const zGameCompleteMsg = z.object({
    type: z.literal("gameComplete"),
    data: z.object({}).optional(),
});

export type TeamGameCompleteMsg = z.infer<typeof zGameCompleteMsg>;

export const zTeamClientMsg = z.discriminatedUnion("type", [
    zTeamCreateMsg,
    zTeamUpdateAccountMsg,
    zTeamSetRoomPropsMsg,
    zTeamJoinMsg,
    zTeamPlayGameMsg,
    zTeamKickMsg,
    zTeamChangeNameMsg,
    zGameCompleteMsg,
    zKeepAliveMsg,
]);

export type ClientToServerTeamMsg =
    | TeamKeepAliveMsg
    | TeamUpdateAccountMsg
    | TeamJoinMsg
    | TeamChangeNameMsg
    | TeamSetRoomPropsMsg
    | TeamCreateMsg
    | TeamKickMsg
    | TeamGameCompleteMsg
    | TeamPlayGameMsg;
