import { z } from "zod";
import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { type FindGameMatchData, type FindGamePrivateError, loadoutSchema } from "../../../shared/types/api.ts";
import { zSpectateFilter } from "../../../shared/types/moderation.ts";
import type { MatchDataTable } from "../api/db/schema.ts";
import type { ServerGameConfig as CompatibilityServerGameConfig } from "../game/gameManager.ts";

export const zUpdateRegionBody = z.object({
    regionId: z.string(),
    data: z.object({
        playerCount: z.number(),
    }),
});
export type UpdateRegionBody = z.infer<typeof zUpdateRegionBody>;

export const zSetGameModeBody = z.object({
    index: z.number(),
    team_mode: z.enum(TeamMode).optional(),
    map_name: z.string().optional(),
    enabled: z.boolean().optional(),
});

export const zSetClientThemeBody = z.object({
    theme: z.string(),
});

export interface SaveGameBody {
    matchData: (MatchDataTable & { ip: string; findGameIp: string })[];
}

export type ServerGameConfig = CompatibilityServerGameConfig;

export const zFindGamePrivateBody = z.object({
    region: z.string(),
    version: z.number(),
    autoFill: z.boolean(),
    mapName: z.string(),
    teamMode: z.number(),
    zombieDifficulty: z.enum(["simple", "normal", "hard"]).optional(),
    playerData: z.array(
        z.object({
            joinToken: z.string(),
            userId: z.string().nullable(),
            // Authoritative identity resolved by the API from the legacy JSON
            // account token. Never derive achievement ownership from JoinMsg.
            stashName: z.string().optional(),
            ip: z.string(),
            loadout: loadoutSchema.optional(),
            quests: z.array(z.string()).optional(),
        }),
    ),
});

export type FindGamePrivateBody = z.infer<typeof zFindGamePrivateBody>;

export type FindGamePrivateRes =
    | {
        urls: string[];
    }
    | { error: FindGamePrivateError };

export type SpectateGamePrivateRes = {
    players: Array<{
        gameId: string;
        mapName: MapDefKey;
        teamMode: TeamMode;
        data: FindGameMatchData;
    }>;
};

export type ModRouterSpectateGameRes = SpectateGamePrivateRes & {
    region: string;
    done: boolean;
};

export const zSpectateGamePrivateBody = z.object({
    filter: zSpectateFilter,
});

export type SpectateGamePrivateBody = z.infer<typeof zSpectateGamePrivateBody>;
