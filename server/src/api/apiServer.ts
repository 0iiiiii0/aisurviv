import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import fs from "node:fs";
import type { SiteInfoRes } from "../../../shared/types/api.ts";
import { Config, getServerConfigFilePath } from "../config.ts";
import { TeamMenu } from "../teamMenu.ts";
import { GIT_VERSION } from "../utils/gitRevision.ts";
import { defaultLogger, ServerLogger } from "../utils/logger.ts";
import type { FindGamePrivateBody, FindGamePrivateRes } from "../utils/types.ts";
import { legacyPlayerAccounts } from "./routes/legacy/LegacyRouter.ts";

class Region {
    data: (typeof Config)["regions"][string];
    playerCount = 0;

    lastUpdateTime = Date.now();

    constructor(readonly id: string) {
        this.data = Config.regions[this.id];
    }

    async fetch<Data extends object>(endPoint: string, body: object) {
        const url = `http${this.data.https ? "s" : ""}://${this.data.address}/${endPoint}`;

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "survev-api-key": Config.secrets.SURVEV_API_KEY,
                },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                return (await res.json()) as Data;
            }

            defaultLogger.warn(`Region ${this.id} returned status ${res.statusText}`);
        } catch (err) {
            defaultLogger.error(`Error fetching region ${this.id}`, err);
        }
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        const data = await this.fetch<FindGamePrivateRes>("api/find_game", body);
        if (!data) {
            return { error: "find_game_failed" };
        }
        return data;
    }
}

interface RegionData {
    playerCount: number;
}

export class ApiServer {
    readonly logger = new ServerLogger("Server");

    /** JSON-account adapter retained during the 0.3 data migration window. */
    readonly playerAccounts = legacyPlayerAccounts;

    teamMenu = new TeamMenu(this);

    regions: Record<string, Region> = {};

    modes = [...Config.modes];
    private extractionSecretEnabled = Config.extractionSecret.enabled === true;
    clientTheme = Config.clientTheme;

    captchaEnabled = Config.captchaEnabled;

    constructor() {
        for (const region in Config.regions) {
            this.regions[region] = new Region(region);
        }
    }

    init(app: Hono, upgradeWebSocket: UpgradeWebSocket) {
        this.teamMenu.init(app, upgradeWebSocket);
    }

    /**
     * The admin UI runs in the game-server process while this catalogue lives
     * in the API process. Reload the small public portion of the persisted
     * config before serving/using it so an admin mode switch takes effect
     * without restarting the API process.
     */
    refreshPublicConfig(): void {
        try {
            const filePath = getServerConfigFilePath("survivio-config.json");
            const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
                modes?: Array<{
                    modeId?: string;
                    mapName?: string;
                    teamMode?: number;
                    enabled?: boolean;
                }>;
                extractionSecret?: { enabled?: boolean };
            };
            const persistedModes = Array.isArray(parsed.modes) ? parsed.modes : [];
            const byId = new Map(
                persistedModes
                    .filter((mode) => typeof mode.modeId === "string")
                    .map((mode) => [mode.modeId!, mode]),
            );
            const byKey = new Map(
                persistedModes.map((mode) => [
                    `${mode.mapName}:${mode.teamMode}`,
                    mode,
                ]),
            );
            const secretEnabled = typeof parsed.extractionSecret?.enabled === "boolean"
                ? parsed.extractionSecret.enabled
                : this.extractionSecretEnabled;

            this.modes = this.modes.map((mode) => {
                const persisted = byId.get(mode.modeId)
                    ?? byKey.get(`${mode.mapName}:${mode.teamMode}`);
                return {
                    ...mode,
                    enabled: mode.mapName === "extraction_secret"
                        ? secretEnabled
                        : typeof persisted?.enabled === "boolean"
                        ? persisted.enabled
                        : mode.enabled,
                };
            });
            this.extractionSecretEnabled = secretEnabled;
        } catch (error) {
            this.logger.warn("Unable to refresh public mode config; keeping the last valid snapshot", error);
        }
    }

    getSiteInfo(): SiteInfoRes {
        this.refreshPublicConfig();
        const data: SiteInfoRes & {
            duelRoomEnabled: boolean;
            announcement: typeof Config.announcement;
            sandevistan: typeof Config.sandevistan;
            extractionSecret: { enabled: boolean };
        } = {
            modes: this.modes,
            pops: {},
            youtube: { name: "", link: "" },
            twitch: [],
            country: "US",
            gitRevision: GIT_VERSION,
            captchaEnabled: this.captchaEnabled,
            clientTheme: this.clientTheme,
            duelRoomEnabled: Config.duel.roomModeEnabled,
            announcement: { ...Config.announcement },
            sandevistan: { ...Config.sandevistan },
            extractionSecret: { enabled: this.extractionSecretEnabled },
        };

        for (const region in this.regions) {
            data.pops[region] = {
                playerCount: this.regions[region].playerCount,
                l10n: Config.regions[region].l10n,
            };
        }
        return data;
    }

    updateRegion(regionId: string, regionData: RegionData) {
        const region = this.regions[regionId];
        if (!region) {
            this.logger.warn("updateRegion: Invalid region", regionId);
            return;
        }
        region.playerCount = regionData.playerCount;
        region.lastUpdateTime = Date.now();
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        if (body.region in this.regions) {
            return await this.regions[body.region].findGame(body);
        }
        return { error: "invalid_region" };
    }
}

export const server = new ApiServer();
