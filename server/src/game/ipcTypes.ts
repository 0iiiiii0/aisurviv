import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import type { TeamMode } from "../../../shared/gameConfig.ts";
import type { FindGamePrivateBody, ServerGameConfig } from "../utils/types.ts";
import type { SpectateTokenData } from "./game.ts";

export interface GameData {
    id: string;
    teamMode: TeamMode;
    mapName: MapDefKey;
    /** Authoritative procedural-map seed used by remote AI to verify its local map. */
    mapSeed: number;
    canJoin: boolean;
    aliveCount: number;
    connectedCount: number;
    humanPlayerCount: number;
    pendingHumanCount: number;
    aiPlayerCount: number;
    spectatorCount: number;
    serverBotCount: number;
    contestantAdmissionCount: number;
    serverBotTeamCounts: number[];
    reservedHumanCount: number;
    reservedBotCount: number;
    startedTime: number;
    stopped: boolean;
    over: boolean;
    privateGame: boolean;
    pureAiMatch: boolean;
    zombieDifficulty: "simple" | "normal" | "hard";
    extractionSecretEnabled: boolean;
    duelAdrenalineEnabled?: boolean;
    arenaRound?: number;
    totalRounds?: number;
    arenaScores?: Record<string, number>;
    timeRunning: number;

    livingPlayers: Array<{
        id: number;
        userId: string | null;
        name: string;
        disconnected: boolean;
    }>;
}

export enum ProcessMsgType {
    Create,
    KeepAlive,
    UpdateData,
    AddJoinToken,
    AddSpectateToken,
    Fault,
    ForbiddenContextRequest,
    ForbiddenContextResponse,
    JoinTokenAck,
    RemoveJoinToken,
}

export interface CreateGameMsg {
    type: ProcessMsgType.Create;
    config: ServerGameConfig;
    id: string;
}

export interface KeepAliveMsg {
    type: ProcessMsgType.KeepAlive;
}

export interface UpdateDataMsg extends GameData {
    type: ProcessMsgType.UpdateData;
}

export interface AddJoinTokenMsg {
    type: ProcessMsgType.AddJoinToken;
    autoFill: boolean;
    tokens: FindGamePrivateBody["playerData"];
    /** Compatibility credential for custom bot/private/spectator rooms. */
    legacyToken?: {
        /** Parent/room handshake id. The join address is not returned until this token is installed. */
        requestId: string;
        token: string;
        playerCount: number;
        expiresInMs: number;
        spectator: boolean;
        serverBot: boolean;
        serverBotTeamIds?: readonly number[];
        duelLoadoutIndex?: number;
    };
}

export interface JoinTokenAckMsg {
    type: ProcessMsgType.JoinTokenAck;
    requestId: string;
}

export interface RemoveJoinTokenMsg {
    type: ProcessMsgType.RemoveJoinToken;
    token: string;
}

export interface AddSpectateTokenMsg {
    type: ProcessMsgType.AddSpectateToken;
    token: string;
    data: SpectateTokenData;
}

export interface ProcessFaultMsg {
    type: ProcessMsgType.Fault;
    gameId: string;
    at: number;
    stage: string;
    message: string;
    stack?: string;
    fatal: boolean;
    consecutive: number;
    recent: number;
}

export interface ForbiddenContextRequestMsg {
    type: ProcessMsgType.ForbiddenContextRequest;
    requestId: string;
    botPlayerId: number;
    sequence: number;
    difficulty: "forbidden" | "legit";
}

export interface ForbiddenContextResponseMsg {
    type: ProcessMsgType.ForbiddenContextResponse;
    requestId: string;
    payload: unknown;
}

export type ProcessMsg =
    | CreateGameMsg
    | KeepAliveMsg
    | UpdateDataMsg
    | AddJoinTokenMsg
    | AddSpectateTokenMsg
    | ProcessFaultMsg
    | ForbiddenContextRequestMsg
    | ForbiddenContextResponseMsg
    | JoinTokenAckMsg
    | RemoveJoinTokenMsg;
