import type { HttpRequest, HttpResponse, TemplatedApp } from "uWebSockets.js";
import { version } from "../../package.json";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { PerkProperties } from "../../shared/defs/gameObjects/perkDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { AdminAuthError, AdminAuthManager } from "./adminAuth.ts";
import { getBotAutoFillModeKey, getBotAutoFillPolicy } from "./botAutoFill.ts";
import { isAiDifficultyRatios, isAiThinkIntervals } from "./botDifficulty.ts";
import {
    Config,
    PersistenceError,
    saveAnnouncementConfig,
    saveBotAutoFillConfig,
    saveDuelConfig,
    saveExtractionAiDropItemsConfig,
    saveExtractionAiLoadouts,
    saveExtractionBossConfig,
    saveExtractionHuntersConfig,
    saveExtractionSecretAiLoadouts,
    saveExtractionSecretConfig,
    saveModeConfig,
    saveRoomPlayerLimitsConfig,
    saveSandevistanConfig,
    saveShopConfig,
} from "./config.ts";
import {
    type DuelAiDifficulty,
    getDuelThrowableCatalog,
    isDuelAiDifficulty,
    isDuelArmorLevel,
    isDuelBoost,
    isDuelScope,
    isDuelThrowables,
    normalizeDuelThrowables,
} from "./duelLoadout.ts";
import type { DuelLobbyLoadout, DuelLobbyMatchData } from "./duelLobby.ts";
import type { DuelPlayerWeapons } from "./duelMatchTypes.ts";
import { getDuelWeaponCatalog, isDuelWeapon } from "./duelWeapons.ts";
import { shopAdminCatalog, shopPriceOverrides } from "./economy/shopManager.ts";
import { type ExtractionAiLoadoutPreset, normalizePreset } from "./extractionLoadouts.ts";
import type { GameData, GameManager, ServerGameConfig } from "./game/gameManager.ts";
import { createServerGameConfig, isAdminVisibleGame } from "./game/gameManager.ts";
import { PlayerAccounts } from "./playerAccounts.ts";
import { getStashCatalog } from "./stash/stashManager.ts";
import { stashManager } from "./stash/stashManager.ts";
import { GIT_VERSION } from "./utils/gitRevision.ts";
import { cors, getIp, HTTPRateLimit, readPostedJSON } from "./utils/serverHelpers.ts";

export interface AdminGameManager {
    getPlayerCount(): number;
    listGames(): GameData[];
    createGame(config: ServerGameConfig): Promise<GameData>;
    stopGame(id: string): boolean;
}

export interface AdminPureAiDuelRequest {
    loadout: DuelLobbyLoadout;
    contestantLoadouts: [DuelPlayerWeapons, DuelPlayerWeapons];
    difficulties: [DuelAiDifficulty, DuelAiDifficulty];
}

export interface AdminGameActions {
    createSpectatorMatch(gameId: string): Promise<DuelLobbyMatchData>;
    createPureAiDuel(request: AdminPureAiDuelRequest): Promise<{
        gameId: string;
        matchData: DuelLobbyMatchData;
        spectatorShareCode: string;
    }>;
    addAiToGame(
        gameId: string,
        difficulty: DuelAiDifficulty,
    ): Promise<{ gameId: string; difficulty: DuelAiDifficulty }>;
    onBotAutoFillConfigChanged?(): void;
    updateBlock?: {
        set(minutes: number): {
            active: boolean;
            until: number;
            remainingSeconds: number;
        };
        clear(): { active: boolean; until: number; remainingSeconds: number };
        status(): { active: boolean; until: number; remainingSeconds: number };
    };
}

export class AdminService {
    constructor(
        private readonly manager: AdminGameManager,
        private readonly regionId: string,
        private readonly regionAddress: string,
        private readonly persistModes: () => void = saveModeConfig,
        private readonly persistDuel: () => void = saveDuelConfig,
        private readonly persistAnnouncement: () => void = saveAnnouncementConfig,
        private readonly gameActions?: AdminGameActions,
        private readonly persistBotAutoFill: () => void = saveBotAutoFillConfig,
        private readonly persistRoomPlayerLimits: () => void = saveRoomPlayerLimitsConfig,
        private readonly persistSandevistan: () => void = saveSandevistanConfig,
        private readonly persistExtractionLoadouts: () => void = saveExtractionAiLoadouts,
        private readonly persistExtractionSecretLoadouts: () => void = saveExtractionSecretAiLoadouts,
        private readonly persistExtractionSecret: () => void = saveExtractionSecretConfig,
        private readonly persistExtractionBoss: () => void = saveExtractionBossConfig,
        private readonly persistExtractionHunters: () => void = saveExtractionHuntersConfig,
        private readonly persistExtractionAiDropItems: () => void = saveExtractionAiDropItemsConfig,
    ) {}

    /** 玩家账号（与 apiServer 共享同一数据文件，内部带锁 + 磁盘重载）。 */
    private readonly playerAccounts = new PlayerAccounts();

    /** 更新维护阻断控制（由 GameServer 注入）。 */
    get updateBlock(): AdminGameActions["updateBlock"] | undefined {
        return this.gameActions?.updateBlock;
    }

    getStatus() {
        const games = this.manager
            .listGames()
            .filter(isAdminVisibleGame)
            .map(toGameSnapshot)
            .sort((a, b) => b.startedTime - a.startedTime);
        const memory = process.memoryUsage();
        const humanPlayerCount = games.reduce((sum, game) => sum + game.humanPlayerCount, 0);
        const aiPlayerCount = games.reduce((sum, game) => sum + game.aiPlayerCount, 0);
        const spectatorCount = games.reduce((sum, game) => sum + game.spectatorCount, 0);

        return {
            server: {
                version,
                gitVersion: GIT_VERSION,
                regionId: this.regionId,
                address: this.regionAddress,
                processMode: Config.processMode,
                uptimeSeconds: process.uptime(),
                memoryRssBytes: memory.rss,
                heapUsedBytes: memory.heapUsed,
                now: new Date().toISOString(),
            },
            summary: {
                playerCount: humanPlayerCount + aiPlayerCount,
                humanPlayerCount,
                aiPlayerCount,
                spectatorCount,
                gameCount: games.length,
                joinableGameCount: games.filter((game) => game.canJoin).length,
            },
            modes: Config.modes.map(toModeSnapshot),
            duel: toDuelSnapshot(),
            announcement: { ...Config.announcement },
            liveAnnouncement: getLiveAnnouncementSnapshot(),
            botAutoFill: toBotAutoFillSnapshot(),
            roomPlayerLimits: { ...Config.roomPlayerLimits },
            sandevistan: { ...Config.sandevistan },
            extractionSecret: { ...Config.extractionSecret },
            extractionBoss: { ...Config.extractionBoss },
            extractionHunters: { ...Config.extractionHunters },
            extractionAiDropItems: Config.extractionAiDropItems,
            updateBlock: this.gameActions?.updateBlock
                ? this.gameActions.updateBlock.status()
                : { active: false, until: 0, remainingSeconds: 0 },
            games,
        };
    }

    setModeEnabled(modeIndex: unknown, enabled: unknown) {
        if (!Number.isInteger(modeIndex)) {
            throw new AdminInputError("??????");
        }
        if (typeof enabled !== "boolean") {
            throw new AdminInputError("??????");
        }

        const index = modeIndex as number;
        const mode = Config.modes[index];
        if (!mode) {
            throw new AdminInputError("???????");
        }
        if (mode.mapName === "duel") {
            throw new AdminInputError("???1v1??????????");
        }
        const forceEnabled = mode.mapName === "extraction";
        const previous = mode.enabled;
        mode.enabled = forceEnabled ? true : enabled;
        try {
            this.persistModes();
        } catch (error) {
            mode.enabled = previous;
            throw error;
        }

        return { mode: toModeSnapshot(mode, index) };
    }

    setSandevistanConfig(playerTimeScale: unknown, worldTimeScale: unknown) {
        const playerScale = validateScale(playerTimeScale, "玩家自身时间倍率");
        const worldScale = validateScale(worldTimeScale, "对局时间倍率");
        const previous = { ...Config.sandevistan };
        Config.sandevistan.playerTimeScale = playerScale;
        Config.sandevistan.worldTimeScale = worldScale;
        try {
            this.persistSandevistan();
        } catch (error) {
            Config.sandevistan = previous;
            throw error;
        }
        return { sandevistan: { ...Config.sandevistan } };
    }

    /** 搜打撤·绝密模式：开关 + AI 难度。AI 装备复用 extractionAiLoadouts。 */
    setExtractionSecretConfig(
        enabled: unknown,
        aiDifficulty: unknown,
        immortalBoost: unknown,
    ) {
        const difficulty = isDuelAiDifficulty(aiDifficulty)
            ? aiDifficulty
            : Config.extractionSecret.aiDifficulty;
        const previous = { ...Config.extractionSecret };
        Config.extractionSecret.enabled = enabled !== false;
        Config.extractionSecret.aiDifficulty = difficulty;
        Config.extractionSecret.immortalBoost = immortalBoost !== false;
        // 绝密搜打撤是独立播放列表，与普通搜打撤同时运行。开启/关闭时同步
        // 对应播放列表的启用状态，使后台开关与模式网格保持一致。
        const secretModes = Config.modes.filter(
            (mode) => mode.mapName === "extraction_secret",
        );
        const previousEnabled = secretModes.map((mode) => mode.enabled);
        secretModes.forEach((mode) => {
            mode.enabled = Config.extractionSecret.enabled;
        });
        try {
            this.persistExtractionSecret();
            this.persistModes();
        } catch (error) {
            Config.extractionSecret = previous;
            secretModes.forEach((mode, idx) => {
                mode.enabled = previousEnabled[idx] ?? mode.enabled;
            });
            throw error;
        }
        return { extractionSecret: { ...Config.extractionSecret } };
    }

    /** 搜打撤 Boss（高级资源点守卫）配置：开关 / 血量 / 数量 / 掉落表。 */
    setExtractionBossConfig(
        enabled: unknown,
        maxHealth: unknown,
        count: unknown,
        bossDefaultPerks: unknown,
        bossPerks: unknown,
        weapons: unknown,
        bossPositions: unknown,
        dropItems: unknown,
        armor: unknown,
        minions: unknown,
    ) {
        const previous = JSON.parse(JSON.stringify(Config.extractionBoss)) as typeof Config.extractionBoss;
        const health = validateInteger(maxHealth, "Boss 血量", 50, 5000);
        const bossCount = validateInteger(count, "Boss 数量", 1, 6);
        // 护卫数量（按人数）：solo/duo/squad 各 0-20。
        // 未填写（缺省/空串）的项保留原配置，避免"没填的位置保存报错"。
        const minionsRaw = minions && typeof minions === "object"
            ? (minions as Record<string, unknown>)
            : {};
        const previousMinions = Config.extractionBoss.minions ?? {
            solo: 0,
            duo: 2,
            squad: 3,
        };
        const MINION_LABELS: Record<"solo" | "duo" | "squad", string> = {
            solo: "单人护卫",
            duo: "双人护卫",
            squad: "四人护卫",
        };
        const minionValue = (key: "solo" | "duo" | "squad"): number => {
            const raw = minionsRaw[key];
            if (raw === undefined || raw === null || raw === "") {
                return previousMinions[key];
            }
            return validateInteger(raw, MINION_LABELS[key], 0, 20);
        };
        const minionsConfig = {
            solo: minionValue("solo"),
            duo: minionValue("duo"),
            squad: minionValue("squad"),
        };
        // 能力过滤用 GameObjectDefs（全部能力，含 firepower 等纯标记能力）；
        // PerkProperties 只含带属性效果的子集，会漏掉并"掉能力"。
        const isPerkType = (perk: string) => perk.length > 0 && GameObjectDefs[perk]?.type === "perk";
        const defaultPerks = Array.isArray(bossDefaultPerks)
            ? bossDefaultPerks.map((perk) => String(perk ?? "").trim()).filter(isPerkType)
            : [];
        const perks = Array.isArray(bossPerks)
            ? bossPerks.map((perk) => String(perk ?? "").trim()).filter(isPerkType)
            : [];
        // Boss 位置：后台面板不发送该字段（无位置 UI），未传时必须保留
        // 原配置（否则每次保存都会把手工配置的 bossPositions 清空，
        // 表现为"保存后 Boss 位置无效"）。
        const positions: Record<string, Array<{ x: number; y: number }>> = bossPositions === undefined
            ? Config.extractionBoss.bossPositions
            : (() => {
                const parsed: Record<
                    string,
                    Array<{ x: number; y: number }>
                > = {};
                if (bossPositions && typeof bossPositions === "object") {
                    for (
                        const [mapName, list] of Object.entries(
                            bossPositions as Record<string, unknown>,
                        )
                    ) {
                        const arr = Array.isArray(list) ? list : [];
                        const parsedList = arr
                            .map((entry) => {
                                const p = entry as {
                                    x?: unknown;
                                    y?: unknown;
                                };
                                const x = Number(p?.x);
                                const y = Number(p?.y);
                                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                                    return null;
                                }
                                return {
                                    x: Math.round(x),
                                    y: Math.round(y),
                                };
                            })
                            .filter(
                                (
                                    entry,
                                ): entry is { x: number; y: number } => entry !== null,
                            );
                        if (parsedList.length > 0) {
                            parsed[mapName] = parsedList;
                        }
                    }
                }
                return parsed;
            })();
        const weaponList = Array.isArray(weapons)
            ? weapons
                .map((entry) => {
                    const item = entry as { type?: unknown; count?: unknown };
                    const type = String(item?.type ?? "").trim();
                    if (!type) return null;
                    return {
                        type,
                        count: Math.max(
                            1,
                            Math.floor(Number(item?.count) || 1),
                        ),
                    };
                })
                .filter(
                    (entry): entry is { type: string; count: number } => entry !== null,
                )
            : [];
        const drops = Array.isArray(dropItems)
            ? dropItems
                .map((entry) => {
                    const item = entry as {
                        type?: unknown;
                        count?: unknown;
                        weight?: unknown;
                    };
                    const type = String(item?.type ?? "").trim();
                    if (!type) return null;
                    return {
                        type,
                        count: Math.max(
                            1,
                            Math.floor(Number(item?.count) || 1),
                        ),
                        weight: Math.max(
                            0,
                            Math.min(
                                100,
                                Math.floor(Number(item?.weight) || 0),
                            ),
                        ),
                    };
                })
                .filter(
                    (entry): entry is NonNullable<typeof entry> => entry !== null,
                )
            : [];
        const armorInput = armor && typeof armor === "object"
            ? (armor as Record<string, unknown>)
            : {};
        const bossArmor = {
            helmet: String(armorInput.helmet ?? "").trim() || undefined,
            chest: String(armorInput.chest ?? "").trim() || undefined,
            backpack: String(armorInput.backpack ?? "").trim() || undefined,
            scope: String(armorInput.scope ?? "").trim() || undefined,
        };
        Config.extractionBoss.enabled = enabled !== false;
        Config.extractionBoss.maxHealth = health;
        Config.extractionBoss.count = bossCount;
        Config.extractionBoss.bossDefaultPerks = defaultPerks;
        Config.extractionBoss.bossPerks = perks;
        Config.extractionBoss.weapons = weaponList;
        Config.extractionBoss.bossPositions = positions;
        Config.extractionBoss.dropItems = drops;
        Config.extractionBoss.armor = bossArmor;
        Config.extractionBoss.minions = minionsConfig;
        try {
            this.persistExtractionBoss();
        } catch (error) {
            Config.extractionBoss = previous;
            throw error;
        }
        return { extractionBoss: { ...Config.extractionBoss } };
    }

    /** 搜打撤 AI 追杀玩家的数量（普通/绝密 × 单人/双人/四人分别配置）。 */
    setExtractionHuntersConfig(normal: unknown, secret: unknown) {
        const previous = {
            normal: { ...Config.extractionHunters.normal },
            secret: { ...Config.extractionHunters.secret },
        };
        const parseMode = (value: unknown, label: string) => {
            const obj = value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
            const num = (v: unknown, sub: string) => validateInteger(v, `${label}${sub}`, 0, 50);
            return {
                solo: num(obj.solo, "单人"),
                duo: num(obj.duo, "双人"),
                squad: num(obj.squad, "四人"),
            };
        };
        Config.extractionHunters.normal = parseMode(normal, "普通搜打撤");
        Config.extractionHunters.secret = parseMode(secret, "绝密搜打撤");
        try {
            this.persistExtractionHunters();
        } catch (error) {
            Config.extractionHunters = previous;
            throw error;
        }
        return { extractionHunters: { ...Config.extractionHunters } };
    }

    /** 搜打撤 AI（普通/绝密）死亡额外掉落物：后台配置，每个条目按 weight 概率掉落。 */
    setExtractionAiDropItemsConfig(dropItems: unknown) {
        const previous = Config.extractionAiDropItems;
        const drops = Array.isArray(dropItems)
            ? dropItems
                .map((entry) => {
                    const item = entry as {
                        type?: unknown;
                        count?: unknown;
                        weight?: unknown;
                    };
                    const type = String(item?.type ?? "").trim();
                    if (!type) return null;
                    return {
                        type,
                        count: Math.max(
                            1,
                            Math.floor(Number(item?.count) || 1),
                        ),
                        weight: Math.max(
                            0,
                            Math.min(
                                100,
                                Math.floor(Number(item?.weight) || 0),
                            ),
                        ),
                    };
                })
                .filter((entry): entry is { type: string; count: number; weight: number } => entry !== null)
            : [];
        Config.extractionAiDropItems = drops;
        try {
            this.persistExtractionAiDropItems();
        } catch (error) {
            Config.extractionAiDropItems = previous;
            throw error;
        }
        return { extractionAiDropItems: Config.extractionAiDropItems };
    }

    getExtractionAiLoadouts() {
        return {
            presets: Config.extractionAiLoadouts
                .map(normalizePreset)
                .filter((preset): preset is ExtractionAiLoadoutPreset => preset !== null),
        };
    }

    setExtractionAiLoadouts(raw: unknown) {
        const presets = Array.isArray(raw)
            ? raw
                .map(normalizePreset)
                .filter((preset): preset is ExtractionAiLoadoutPreset => preset !== null)
            : [];
        if (presets.length === 0) throw new AdminInputError("至少需要一个有效的配装方案");
        const previous = Config.extractionAiLoadouts;
        Config.extractionAiLoadouts = presets;
        try {
            this.persistExtractionLoadouts();
        } catch (error) {
            Config.extractionAiLoadouts = previous;
            throw error;
        }
        return this.getExtractionAiLoadouts();
    }

    /** 绝密模式 AI 配装（与普通搜打撤 AI 独立）。 */
    getExtractionSecretAiLoadouts() {
        return {
            presets: Config.extractionSecretAiLoadouts
                .map(normalizePreset)
                .filter((preset): preset is ExtractionAiLoadoutPreset => preset !== null),
        };
    }

    setExtractionSecretAiLoadouts(raw: unknown) {
        const presets = Array.isArray(raw)
            ? raw
                .map(normalizePreset)
                .filter((preset): preset is ExtractionAiLoadoutPreset => preset !== null)
            : [];
        if (presets.length === 0) throw new AdminInputError("至少需要一个有效的配装方案");
        const previous = Config.extractionSecretAiLoadouts;
        Config.extractionSecretAiLoadouts = presets;
        try {
            this.persistExtractionSecretLoadouts();
        } catch (error) {
            Config.extractionSecretAiLoadouts = previous;
            throw error;
        }
        return this.getExtractionSecretAiLoadouts();
    }

    getExtractionStash() {
        return { players: stashManager.listAll() };
    }

    getEquipmentReturnRequests() {
        return { requests: stashManager.listEquipmentReturnRequests() };
    }

    reviewEquipmentReturnRequest(body: {
        id?: unknown;
        decision?: unknown;
        adminNote?: unknown;
    }) {
        const id = String(body?.id ?? "").trim();
        const decision = String(body?.decision ?? "");
        if (!id) throw new AdminInputError("申请 ID 不能为空");
        if (decision !== "approve" && decision !== "reject") {
            throw new AdminInputError("审批决定无效");
        }
        const adminNote = String(body?.adminNote ?? "").trim().slice(0, 300);
        const result = stashManager.reviewEquipmentReturnRequest(id, decision, adminNote);
        return {
            ...result,
            requests: stashManager.listEquipmentReturnRequests(),
        };
    }

    /** 后台：列出全部玩家账号。 */
    getPlayerAccounts() {
        return { accounts: this.playerAccounts.listAccounts() };
    }

    /** 后台：删除玩家账号（同步清理该账号的登录会话与对应仓库）。 */
    deletePlayerAccount(body: { username?: unknown }) {
        const username = String(body?.username ?? "").trim().toLowerCase();
        if (!username) throw new AdminInputError("用户名无效");
        const account = this.playerAccounts
            .listAccounts()
            .find((candidate) => candidate.username === username);
        if (!account) throw new AdminInputError("账号不存在");
        this.playerAccounts.deleteAccount(username);
        // 账号的仓库 key 是 displayName（与用户名可能不同），都尝试清理。
        stashManager.removePlayer(account.displayName);
        if (account.displayName !== account.username) {
            stashManager.removePlayer(account.username);
        }
        return { ok: true, accounts: this.playerAccounts.listAccounts() };
    }

    /** 后台修改玩家仓库物品：action = add / remove / set（默认 set）。 */
    modifyExtractionStashItem(body: {
        name?: string;
        type?: string;
        count?: number;
        action?: string;
    }) {
        const name = String(body?.name ?? "").trim();
        const type = String(body?.type ?? "").trim();
        if (!name) throw new AdminInputError("玩家名为空");
        if (!type) throw new AdminInputError("物品类型为空");
        const count = Math.max(0, Math.floor(Number(body?.count) || 0));
        const action = String(body?.action ?? "set");
        const result = action === "add"
            ? stashManager.addItem(name, type, count)
            : action === "remove"
            ? stashManager.removeItem(name, type, count)
            : stashManager.setItem(name, type, count);
        return { ok: result.ok, reason: result.reason, players: stashManager.listAll() };
    }

    /** 后台给指定的已有玩家发放金币。只允许正整数，避免输错名字创建幽灵仓库。 */
    grantExtractionStashCoins(body: { name?: unknown; amount?: unknown }) {
        const name = String(body?.name ?? "").trim();
        if (!name) throw new AdminInputError("玩家名为空");
        if (!stashManager.listAll().some((player) => player.name === name)) {
            throw new AdminInputError("玩家仓库不存在，请刷新后重新选择");
        }
        const amount = validateInteger(
            body?.amount,
            "金币数量",
            1,
            1_000_000_000,
        );
        const coins = stashManager.addCoins(name, amount);
        return {
            ok: true,
            name,
            amount,
            coins,
            players: stashManager.listAll(),
        };
    }

    /** 后台批量：给全体已有玩家仓库添加同一物品。 */
    addItemToAllPlayers(body: { type?: string; count?: number }) {
        const type = String(body?.type ?? "").trim();
        if (!type) throw new AdminInputError("物品类型为空");
        const count = Math.max(1, Math.floor(Number(body?.count) || 1));
        const result = stashManager.addItemToAll(type, count);
        return { ok: result.ok, reason: result.reason, updatedCount: result.updatedCount };
    }

    /** 后台商店配置：逐物品价格覆盖 + 完整目录（商店常开、初始金币固定为 0）。 */
    getShopConfig() {
        return {
            prices: shopPriceOverrides(),
            catalog: shopAdminCatalog(),
        };
    }

    /** 保存后台商店配置（逐物品购买/出售开关及价格覆盖）。 */
    setShopConfig(body: {
        prices?: Record<
            string,
            {
                buyEnabled?: boolean;
                sellEnabled?: boolean;
                buy?: number | null;
                sell?: number | null;
            }
        >;
    }) {
        if (body?.prices && typeof body.prices === "object" && !Array.isArray(body.prices)) {
            const prices: typeof Config.shop.prices = {};
            for (const [type, override] of Object.entries(body.prices)) {
                if (!override || typeof override !== "object") continue;
                const normalized: {
                    buyEnabled?: boolean;
                    sellEnabled?: boolean;
                    buy?: number | null;
                    sell?: number | null;
                } = {};
                if (typeof override.buyEnabled === "boolean") {
                    normalized.buyEnabled = override.buyEnabled;
                }
                if (typeof override.sellEnabled === "boolean") {
                    normalized.sellEnabled = override.sellEnabled;
                }
                if (override.buy === null) {
                    normalized.buy = null;
                } else if (typeof override.buy === "number") {
                    const value = Math.max(0, Math.floor(override.buy));
                    normalized.buy = value > 0 ? value : null;
                }
                if (override.sell === null) {
                    normalized.sell = null;
                } else if (typeof override.sell === "number") {
                    const value = Math.max(0, Math.floor(override.sell));
                    normalized.sell = value > 0 ? value : null;
                }
                if (
                    normalized.buyEnabled !== undefined
                    || normalized.sellEnabled !== undefined
                    || normalized.buy !== undefined
                    || normalized.sell !== undefined
                ) {
                    prices[type] = normalized;
                }
            }
            Config.shop.prices = prices;
        }
        saveShopConfig();
        return this.getShopConfig();
    }

    setDuelConfig(
        weapons: unknown,
        adrenalineEnabled: unknown,
        boost: unknown,
        helmetLevel: unknown,
        chestLevel: unknown,
        scope: unknown,
        throwables: unknown,
        aiEnabled: unknown,
        aiDifficulty: unknown,
        randomModeEnabled: unknown,
        roomModeEnabled: unknown,
    ) {
        if (
            !Array.isArray(weapons)
            || weapons.length !== 2
            || !weapons.every(isDuelWeapon)
        ) {
            throw new AdminInputError("1v1 武器配置无效");
        }
        if (typeof adrenalineEnabled !== "boolean") {
            throw new AdminInputError("1v1 激素开关配置无效");
        }
        if (!isDuelBoost(boost)) {
            throw new AdminInputError("1v1 初始肾上腺素必须是 0 到 100 的整数");
        }
        if (!isDuelArmorLevel(helmetLevel)) {
            throw new AdminInputError("1v1 头盔等级必须是 0 到 3");
        }
        if (!isDuelArmorLevel(chestLevel)) {
            throw new AdminInputError("1v1 防弹衣等级必须是 0 到 3");
        }
        if (!isDuelScope(scope)) {
            throw new AdminInputError("1v1 倍镜配置无效");
        }
        if (!isDuelThrowables(throwables)) {
            throw new AdminInputError("1v1 投掷物配置无效");
        }
        if (typeof aiEnabled !== "boolean") {
            throw new AdminInputError("1v1 AI 开关配置无效");
        }
        if (!isDuelAiDifficulty(aiDifficulty)) {
            throw new AdminInputError("1v1 AI 难度配置无效");
        }
        if (typeof randomModeEnabled !== "boolean") {
            throw new AdminInputError("随机1v1模式开关配置无效");
        }
        if (typeof roomModeEnabled !== "boolean") {
            throw new AdminInputError("1v1房间模式开关配置无效");
        }

        const duelMode = Config.modes.find((mode) => mode.mapName === "duel");
        if (!duelMode) throw new AdminInputError("找不到1v1模式配置");
        const previous = {
            weapons: [...Config.duel.weapons] as [string, string],
            adrenalineEnabled: Config.duel.adrenalineEnabled,
            boost: Config.duel.boost,
            helmetLevel: Config.duel.helmetLevel,
            chestLevel: Config.duel.chestLevel,
            scope: Config.duel.scope,
            throwables: { ...Config.duel.throwables },
            aiEnabled: Config.duel.aiEnabled,
            aiDifficulty: Config.duel.aiDifficulty,
            randomModeEnabled: duelMode.enabled,
            roomModeEnabled: Config.duel.roomModeEnabled,
        };
        Config.duel.weapons = [weapons[0], weapons[1]] as [string, string];
        Config.duel.adrenalineEnabled = adrenalineEnabled;
        Config.duel.boost = boost;
        Config.duel.helmetLevel = helmetLevel;
        Config.duel.chestLevel = chestLevel;
        Config.duel.scope = scope;
        Config.duel.throwables = normalizeDuelThrowables(throwables);
        Config.duel.aiEnabled = aiEnabled;
        Config.duel.aiDifficulty = aiDifficulty;
        duelMode.enabled = randomModeEnabled;
        Config.duel.roomModeEnabled = roomModeEnabled;
        try {
            this.persistDuel();
            this.persistModes();
        } catch (error) {
            Config.duel.weapons = previous.weapons;
            Config.duel.adrenalineEnabled = previous.adrenalineEnabled;
            Config.duel.boost = previous.boost;
            Config.duel.helmetLevel = previous.helmetLevel;
            Config.duel.chestLevel = previous.chestLevel;
            Config.duel.scope = previous.scope;
            Config.duel.throwables = previous.throwables;
            Config.duel.aiEnabled = previous.aiEnabled;
            Config.duel.aiDifficulty = previous.aiDifficulty;
            duelMode.enabled = previous.randomModeEnabled;
            Config.duel.roomModeEnabled = previous.roomModeEnabled;
            throw error;
        }

        return { duel: toDuelSnapshot() };
    }

    setDuelWeapons(weapons: unknown) {
        return this.setDuelConfig(
            weapons,
            Config.duel.adrenalineEnabled,
            Config.duel.boost,
            Config.duel.helmetLevel,
            Config.duel.chestLevel,
            Config.duel.scope,
            Config.duel.throwables,
            Config.duel.aiEnabled,
            Config.duel.aiDifficulty,
            Config.modes.find((mode) => mode.mapName === "duel")?.enabled === true,
            Config.duel.roomModeEnabled,
        );
    }

    setAnnouncement(
        heading: unknown,
        date: unknown,
        title: unknown,
        body: unknown,
    ) {
        const next = {
            heading: validateAnnouncementText(heading, "公告栏标题", 60),
            date: validateAnnouncementText(date, "公告日期", 60, true),
            title: validateAnnouncementText(title, "公告标题", 100),
            body: validateAnnouncementText(body, "公告正文", 5000),
            updatedAt: new Date().toISOString(),
        };
        const previous = { ...Config.announcement };
        Config.announcement = next;
        try {
            this.persistAnnouncement();
        } catch (error) {
            Config.announcement = previous;
            throw error;
        }
        return { announcement: { ...Config.announcement } };
    }

    publishLiveAnnouncement(message: unknown, durationSeconds: unknown) {
        const cleanMessage = validateAnnouncementText(
            message,
            "对局公告",
            300,
        );
        const duration = validateInteger(
            durationSeconds,
            "公告持续时间",
            5,
            24 * 60 * 60,
        );
        const publishedAt = new Date();
        Config.liveAnnouncement = {
            message: cleanMessage,
            publishedAt: publishedAt.toISOString(),
            expiresAt: new Date(
                publishedAt.getTime() + duration * 1000,
            ).toISOString(),
        };
        return { liveAnnouncement: getLiveAnnouncementSnapshot() };
    }

    clearLiveAnnouncement() {
        Config.liveAnnouncement = {
            message: "",
            publishedAt: "",
            expiresAt: "",
        };
        return { liveAnnouncement: getLiveAnnouncementSnapshot() };
    }

    setBotAutoFillConfig(
        defaultJoinIntervalMs: unknown,
        soloTargetPlayerCount: unknown,
        duoTargetPlayerCount: unknown,
        squadTargetPlayerCount: unknown,
        factionTargetPlayerCount: unknown,
        extractionSecretSoloTargetPlayerCount: unknown,
        extractionSecretDuoTargetPlayerCount: unknown,
        extractionSecretSquadTargetPlayerCount: unknown,
        difficultyRatios: unknown,
        thinkIntervalsMs: unknown,
        highBudgetIntervalMs: unknown,
        maxBotWorkers: unknown = Config.botAutoFill.maxBotWorkers,
    ) {
        const defaultInterval = validateInteger(
            defaultJoinIntervalMs,
            "统一AI加入间隔",
            500,
            60000,
        );
        const soloTarget = validateInteger(
            soloTargetPlayerCount,
            "单人补齐目标",
            1,
            100,
        );
        const duoTarget = validateInteger(
            duoTargetPlayerCount,
            "双人补齐目标",
            1,
            100,
        );
        const squadTarget = validateInteger(
            squadTargetPlayerCount,
            "四人补齐目标",
            1,
            100,
        );
        const factionTarget = validateInteger(
            factionTargetPlayerCount,
            "50v50补齐人数上限（真人+AI）",
            1,
            100,
        );
        const secretSoloTarget = validateInteger(
            extractionSecretSoloTargetPlayerCount ?? 0,
            "绝密搜打撤单人补齐目标（真人+AI，0=跟随普通模式）",
            0,
            100,
        );
        const secretDuoTarget = validateInteger(
            extractionSecretDuoTargetPlayerCount ?? 0,
            "绝密搜打撤双人补齐目标（真人+AI，0=跟随普通模式）",
            0,
            100,
        );
        const secretSquadTarget = validateInteger(
            extractionSecretSquadTargetPlayerCount ?? 0,
            "绝密搜打撤四人补齐目标（真人+AI，0=跟随普通模式）",
            0,
            100,
        );
        if (!isAiDifficultyRatios(difficultyRatios)) {
            throw new AdminInputError(
                "AI类型占比必须都是0到100的整数，并且合计为100%",
            );
        }
        const normalizedThinkIntervals = isAiThinkIntervals(thinkIntervalsMs)
            ? { ...thinkIntervalsMs }
            : {
                ...Config.botAutoFill.thinkIntervalsMs,
                legit: validateInteger(
                    highBudgetIntervalMs,
                    "LEGIT AI决策间隔",
                    1,
                    250,
                ),
                forbidden: validateInteger(
                    highBudgetIntervalMs,
                    "HACKER AI决策间隔",
                    1,
                    250,
                ),
            };
        const workerLimit = validateInteger(
            maxBotWorkers,
            "AI worker 全局并发上限",
            1,
            64,
        );
        const previous = JSON.parse(JSON.stringify(Config.botAutoFill)) as typeof Config.botAutoFill;
        Config.botAutoFill.defaultJoinIntervalMs = defaultInterval;
        Config.botAutoFill.soloTargetPlayerCount = soloTarget;
        Config.botAutoFill.duoTargetPlayerCount = duoTarget;
        Config.botAutoFill.squadTargetPlayerCount = squadTarget;
        Config.botAutoFill.factionTargetPlayerCount = factionTarget;
        Config.botAutoFill.extractionSecretSoloTargetPlayerCount = secretSoloTarget;
        Config.botAutoFill.extractionSecretDuoTargetPlayerCount = secretDuoTarget;
        Config.botAutoFill.extractionSecretSquadTargetPlayerCount = secretSquadTarget;
        Config.botAutoFill.difficultyRatios = { ...difficultyRatios };
        Config.botAutoFill.thinkIntervalsMs = normalizedThinkIntervals;
        Config.botAutoFill.highBudgetIntervalMs = normalizedThinkIntervals.legit;
        Config.botAutoFill.maxBotWorkers = workerLimit;
        // One backend-wide AI join interval: per-mode overrides are cleared so
        // every playlist (including 50v50) uses the same cadence.
        Config.botAutoFill.modeOverrides = {};
        try {
            this.persistBotAutoFill();
        } catch (error) {
            Config.botAutoFill.defaultJoinIntervalMs = previous.defaultJoinIntervalMs;
            Config.botAutoFill.soloTargetPlayerCount = previous.soloTargetPlayerCount;
            Config.botAutoFill.duoTargetPlayerCount = previous.duoTargetPlayerCount;
            Config.botAutoFill.squadTargetPlayerCount = previous.squadTargetPlayerCount;
            Config.botAutoFill.factionTargetPlayerCount = previous.factionTargetPlayerCount;
            Config.botAutoFill.extractionSecretSoloTargetPlayerCount = previous.extractionSecretSoloTargetPlayerCount;
            Config.botAutoFill.extractionSecretDuoTargetPlayerCount = previous.extractionSecretDuoTargetPlayerCount;
            Config.botAutoFill.extractionSecretSquadTargetPlayerCount = previous.extractionSecretSquadTargetPlayerCount;
            Config.botAutoFill.difficultyRatios = previous.difficultyRatios;
            Config.botAutoFill.thinkIntervalsMs = previous.thinkIntervalsMs;
            Config.botAutoFill.highBudgetIntervalMs = previous.highBudgetIntervalMs;
            Config.botAutoFill.modeOverrides = previous.modeOverrides;
            throw error;
        }
        this.gameActions?.onBotAutoFillConfigChanged?.();
        return { botAutoFill: toBotAutoFillSnapshot() };
    }

    setRoomPlayerLimits(solo: unknown, duo: unknown, squad: unknown, faction: unknown) {
        const normalize = (value: unknown, label: string, teamSize: number) => {
            const number = validateInteger(value, label, teamSize, 100);
            if (number % teamSize !== 0) {
                throw new AdminInputError(`${label}必须是${teamSize}的倍数`);
            }
            return number;
        };
        const next = {
            solo: normalize(solo, "单排房间上限", 1),
            duo: normalize(duo, "双排房间上限", 2),
            squad: normalize(squad, "四排房间上限", 4),
            faction: validateInteger(faction, "50v50房间上限", 2, 100),
        };
        const previous = { ...Config.roomPlayerLimits };
        Config.roomPlayerLimits = next;
        try {
            this.persistRoomPlayerLimits();
        } catch (error) {
            Config.roomPlayerLimits = previous;
            throw error;
        }
        this.gameActions?.onBotAutoFillConfigChanged?.();
        return { roomPlayerLimits: { ...Config.roomPlayerLimits } };
    }

    async createPureAiDuel(input: unknown) {
        if (!this.gameActions) throw new AdminInputError("纯AI对局功能未启用");
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new AdminInputError("纯AI对局配置无效");
        }
        const record = input as Record<string, unknown>;
        const difficulties = record.difficulties;
        const contestantLoadouts = record.contestantLoadouts;
        const loadout = record.loadout;
        if (
            !Array.isArray(difficulties) || difficulties.length !== 2
            || !difficulties.every(isDuelAiDifficulty)
        ) {
            throw new AdminInputError("双方AI难度无效");
        }
        if (!Array.isArray(contestantLoadouts) || contestantLoadouts.length !== 2) {
            throw new AdminInputError("双方AI武器配置不完整");
        }
        const normalizedContestants = contestantLoadouts.map((entry, index) => {
            const weapons = (entry as Record<string, unknown>)?.weapons;
            if (!Array.isArray(weapons) || weapons.length !== 2 || !weapons.every(isDuelWeapon)) {
                throw new AdminInputError(`AI ${index + 1} 武器配置无效`);
            }
            return { weapons: [String(weapons[0]), String(weapons[1])] as [string, string] };
        }) as [DuelPlayerWeapons, DuelPlayerWeapons];
        if (!loadout || typeof loadout !== "object" || Array.isArray(loadout)) {
            throw new AdminInputError("纯AI公共装备配置无效");
        }
        const raw = loadout as Record<string, unknown>;
        const sharedWeapons = normalizedContestants[0].weapons;
        if (typeof raw.adrenalineEnabled !== "boolean") throw new AdminInputError("激素开关无效");
        if (!isDuelBoost(raw.boost)) throw new AdminInputError("初始肾上腺素无效");
        if (!isDuelArmorLevel(raw.helmetLevel) || !isDuelArmorLevel(raw.chestLevel)) {
            throw new AdminInputError("护甲等级无效");
        }
        if (!isDuelScope(raw.scope)) throw new AdminInputError("倍镜配置无效");
        if (!isDuelThrowables(raw.throwables)) throw new AdminInputError("投掷物配置无效");
        const normalizedLoadout: DuelLobbyLoadout = {
            weapons: [...sharedWeapons],
            weaponSelectionMode: "individual",
            adrenalineEnabled: raw.adrenalineEnabled,
            boost: raw.adrenalineEnabled ? raw.boost : 0,
            helmetLevel: raw.helmetLevel,
            chestLevel: raw.chestLevel,
            scope: raw.scope,
            throwables: normalizeDuelThrowables(raw.throwables),
            aiEnabled: true,
            aiDifficulty: difficulties[1] as DuelAiDifficulty,
        };
        return this.gameActions.createPureAiDuel({
            loadout: normalizedLoadout,
            contestantLoadouts: normalizedContestants,
            difficulties: [difficulties[0], difficulties[1]] as [DuelAiDifficulty, DuelAiDifficulty],
        });
    }

    async createGame(modeIndex: unknown) {
        if (!Number.isInteger(modeIndex)) {
            throw new AdminInputError("模式编号无效");
        }
        const mode = Config.modes[modeIndex as number];
        if (!mode) {
            throw new AdminInputError("找不到这个模式");
        }
        const game = await this.manager.createGame(createServerGameConfig(mode));
        return { game: toGameSnapshot(game) };
    }

    async createSpectatorMatch(gameId: unknown) {
        const id = this.requireGameId(gameId);
        if (!this.gameActions) throw new AdminInputError("观战功能未启用");
        return { matchData: await this.gameActions.createSpectatorMatch(id) };
    }

    async addAiToGame(gameId: unknown, difficulty: unknown) {
        const id = this.requireGameId(gameId);
        if (!isDuelAiDifficulty(difficulty)) {
            throw new AdminInputError("AI 难度无效");
        }
        if (!this.gameActions) throw new AdminInputError("AI 功能未启用");
        return this.gameActions.addAiToGame(id, difficulty);
    }

    private requireGameId(gameId: unknown): string {
        if (typeof gameId !== "string" || !/^[a-f0-9]{40}$/.test(gameId)) {
            throw new AdminInputError("房间 ID 无效");
        }
        return gameId;
    }

    stopGame(gameId: unknown) {
        const id = this.requireGameId(gameId);
        if (!this.manager.stopGame(id)) {
            throw new AdminNotFoundError("房间不存在或已经结束");
        }
        return { stopped: true, gameId: id };
    }
}

function toBotAutoFillSnapshot() {
    return {
        enabled: Config.botAutoFill.enabled,
        requireHumanBeforeFill: Config.botAutoFill.requireHumanBeforeFill,
        defaultJoinIntervalMs: Config.botAutoFill.defaultJoinIntervalMs,
        soloTargetPlayerCount: Config.botAutoFill.soloTargetPlayerCount,
        duoTargetPlayerCount: Config.botAutoFill.duoTargetPlayerCount,
        squadTargetPlayerCount: Config.botAutoFill.squadTargetPlayerCount,
        factionTargetPlayerCount: Config.botAutoFill.factionTargetPlayerCount,
        extractionSecretSoloTargetPlayerCount: Config.botAutoFill.extractionSecretSoloTargetPlayerCount,
        extractionSecretDuoTargetPlayerCount: Config.botAutoFill.extractionSecretDuoTargetPlayerCount,
        extractionSecretSquadTargetPlayerCount: Config.botAutoFill.extractionSecretSquadTargetPlayerCount,
        difficultyRatios: { ...Config.botAutoFill.difficultyRatios },
        thinkIntervalsMs: { ...Config.botAutoFill.thinkIntervalsMs },
        highBudgetIntervalMs: Config.botAutoFill.highBudgetIntervalMs,
        maxBotWorkers: Config.botAutoFill.maxBotWorkers,
        modes: Config.modes.flatMap((mode, index) => {
            const policy = getBotAutoFillPolicy(mode.mapName, mode.teamMode);
            if (!policy) return [];
            return [{
                modeIndex: index,
                mapName: mode.mapName,
                displayName: toModeSnapshot(mode, index).displayName,
                teamMode: mode.teamMode,
                factionMode: policy.factionMode,
                maxPlayers: policy.maxPlayers,
                targetPlayerCount: policy.targetPlayerCount,
            }];
        }),
    };
}

export function getLiveAnnouncementSnapshot(now = Date.now()) {
    const expiresAt = Date.parse(Config.liveAnnouncement.expiresAt);
    const active = Boolean(Config.liveAnnouncement.message)
        && Number.isFinite(expiresAt)
        && expiresAt > now;
    return {
        ...Config.liveAnnouncement,
        active,
        remainingSeconds: active
            ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
            : 0,
    };
}

function validateInteger(
    value: unknown,
    label: string,
    min: number,
    max: number,
): number {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
        throw new AdminInputError(`${label}必须是 ${min} 到 ${max} 的整数`);
    }
    return Number(value);
}

function validateScale(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0.01 || value > 1) {
        throw new AdminInputError(`${label}必须是 1% 到 100% 之间的数值`);
    }
    return Math.round(value * 1000) / 1000;
}

function toDuelSnapshot() {
    return {
        weapons: [...Config.duel.weapons],
        adrenalineEnabled: Config.duel.adrenalineEnabled,
        boost: Config.duel.boost,
        helmetLevel: Config.duel.helmetLevel,
        chestLevel: Config.duel.chestLevel,
        scope: Config.duel.scope,
        throwables: { ...Config.duel.throwables },
        aiEnabled: Config.duel.aiEnabled,
        aiDifficulty: Config.duel.aiDifficulty,
        randomModeEnabled: Config.modes.find((mode) => mode.mapName === "duel")?.enabled === true,
        roomModeEnabled: Config.duel.roomModeEnabled,
        catalog: getDuelWeaponCatalog(),
        throwableCatalog: getDuelThrowableCatalog(),
    };
}

function toModeSnapshot(mode: (typeof Config.modes)[number], index: number) {
    const map = MapDefs[mode.mapName];
    const teamNames: Record<number, string> = {
        1: "单人",
        2: "双人",
        4: "四人",
    };
    const isFactionMode = Boolean(map.gameMode.factionMode);
    const hasFixedDisplayName = isFactionMode || mode.mapName === "duel";
    const teamName = isFactionMode
        ? "两大阵营"
        : teamNames[mode.teamMode] ?? `${mode.teamMode}人`;
    return {
        index,
        modeId: mode.modeId,
        mapName: mode.mapName,
        title: mode.title,
        displayName: hasFixedDisplayName ? mode.title : `${mode.title} ${teamName}`,
        teamName,
        teamMode: mode.teamMode,
        enabled: mode.enabled,
        maxPlayers: map.gameMode.maxPlayers,
    };
}

function toGameSnapshot(game: GameData): GameData {
    return {
        id: game.id,
        teamMode: game.teamMode,
        mapName: game.mapName,
        ...(game.mapName === "zombie"
            ? { zombieDifficulty: game.zombieDifficulty ?? "normal" }
            : {}),
        canJoin: game.canJoin,
        aliveCount: game.aliveCount,
        connectedCount: game.connectedCount,
        humanPlayerCount: game.humanPlayerCount,
        aiPlayerCount: game.aiPlayerCount,
        spectatorCount: game.spectatorCount,
        serverBotCount: game.serverBotCount,
        contestantAdmissionCount: game.contestantAdmissionCount,
        serverBotTeamCounts: [...game.serverBotTeamCounts],
        reservedHumanCount: game.reservedHumanCount,
        startedTime: game.startedTime,
        stopped: game.stopped,
        over: Boolean(game.over),
        privateGame: game.privateGame,
        ...(game.processHealth ? { processHealth: game.processHealth } : {}),
        ...(game.processPid ? { processPid: game.processPid } : {}),
        ...(game.lastProcessFault
            ? { lastProcessFault: { ...game.lastProcessFault } }
            : {}),
    };
}

export class AdminInputError extends Error {}
export class AdminNotFoundError extends Error {}

function validateAnnouncementText(
    value: unknown,
    label: string,
    maxLength: number,
    allowEmpty = false,
): string {
    if (typeof value !== "string") {
        throw new AdminInputError(`${label}无效`);
    }
    const normalized = value.replace(/\r\n/g, "\n").trim();
    if (!allowEmpty && !normalized) {
        throw new AdminInputError(`${label}不能为空`);
    }
    if (normalized.length > maxLength) {
        throw new AdminInputError(`${label}不能超过 ${maxLength} 个字符`);
    }
    return normalized;
}

function getSessionToken(req: HttpRequest): string {
    const authorization = req.getHeader("authorization");
    if (authorization.toLowerCase().startsWith("bearer ")) {
        return authorization.slice(7).trim();
    }
    return req.getHeader("x-admin-session").trim();
}

function authorize(
    res: HttpResponse,
    req: HttpRequest,
    auth: AdminAuthManager,
): boolean {
    if (!Config.admin.enabled) {
        returnAdminStatus(res, "404 Not Found", "Not Found");
        return false;
    }
    if (!auth.authorize(getSessionToken(req))) {
        returnAdminStatus(res, "401 Unauthorized", "Unauthorized");
        return false;
    }
    return true;
}

function returnAdminStatus(
    res: HttpResponse,
    status: string,
    body: string,
    contentType = "text/plain; charset=utf-8",
): void {
    if (res.aborted) return;
    res.cork(() => {
        res.writeStatus(status);
        cors(res);
        res.writeHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.writeHeader("Content-Type", contentType).end(body);
    });
}

function returnAdminJson(
    res: HttpResponse,
    data: Record<string, unknown>,
): void {
    if (res.aborted) return;
    res.cork(() => {
        res.writeStatus("200 OK");
        cors(res);
        res.writeHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.writeHeader("Content-Type", "application/json").end(JSON.stringify(data));
    });
}

function returnError(res: HttpResponse, error: unknown): void {
    if (res.aborted) return;
    const status = error instanceof AdminAuthError
        ? "401 Unauthorized"
        : error instanceof AdminInputError
        ? "400 Bad Request"
        : error instanceof AdminNotFoundError
        ? "404 Not Found"
        : error instanceof PersistenceError
        ? "503 Service Unavailable"
        : "500 Internal Server Error";
    const message = error instanceof Error ? error.message : "服务器内部错误";
    res.cork(() => {
        res.writeStatus(status);
        cors(res);
        res.writeHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.writeHeader("Content-Type", "application/json").end(
            JSON.stringify({ error: message }),
        );
    });
}

export function mountAdminApi(
    app: TemplatedApp,
    manager: GameManager,
    regionId: string,
    regionAddress: string,
    gameActions?: AdminGameActions,
): void {
    const service = new AdminService(
        manager,
        regionId,
        regionAddress,
        saveModeConfig,
        saveDuelConfig,
        saveAnnouncementConfig,
        gameActions,
        saveBotAutoFillConfig,
        saveRoomPlayerLimitsConfig,
        saveExtractionAiLoadouts,
    );
    const auth = new AdminAuthManager();
    const loginRateLimit = new HTTPRateLimit(5, 60_000, true);

    app.options("/admin-api/*", (res) => {
        cors(res);
        res.end();
    });

    app.post("/admin-api/auth/login", (res) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!Config.admin.enabled) {
            returnAdminStatus(res, "404 Not Found", "Not Found");
            return;
        }
        const ip = getIp(res);
        if (loginRateLimit.isRateLimited(ip)) {
            returnAdminStatus(
                res,
                "429 Too Many Requests",
                JSON.stringify({ error: "登录尝试过于频繁，请稍后再试" }),
                "application/json",
            );
            return;
        }
        readPostedJSON<{ password: unknown }>(
            res,
            (body) => {
                try {
                    returnAdminJson(res, auth.login(body.password) as unknown as Record<string, unknown>);
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/auth/logout", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        const token = getSessionToken(req);
        if (!authorize(res, req, auth)) return;
        auth.logout(token);
        returnAdminJson(res, { loggedOut: true });
    });

    app.post("/admin-api/auth/change-password", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ currentPassword: unknown; newPassword: unknown }>(
            res,
            (body) => {
                try {
                    auth.changePassword(body.currentPassword, body.newPassword);
                    returnAdminJson(res, { passwordChanged: true });
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/status", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.getStatus());
    });

    app.post("/admin-api/update-block", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ minutes?: unknown; clear?: unknown }>(
            res,
            (body) => {
                try {
                    if (!service.updateBlock) {
                        returnError(res, new AdminInputError("该进程未启用更新维护控制"));
                        return;
                    }
                    if (body.clear === true) {
                        returnAdminJson(res, service.updateBlock.clear());
                        return;
                    }
                    const minutes = Math.floor(Number(body.minutes) || 0);
                    if (minutes <= 0 || minutes > 10) {
                        returnError(res, new AdminInputError("时长需为 1-10 分钟"));
                        return;
                    }
                    returnAdminJson(res, service.updateBlock.set(minutes));
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/games", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ modeIndex: unknown }>(
            res,
            async (body) => {
                try {
                    const result = await service.createGame(body.modeIndex);
                    returnAdminJson(res, result);
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/room-player-limits", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ solo: unknown; duo: unknown; squad: unknown; faction: unknown }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setRoomPlayerLimits(
                            body.solo,
                            body.duo,
                            body.squad,
                            body.faction,
                        ),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/extraction/ai-loadouts", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.getExtractionAiLoadouts());
    });

    app.post("/admin-api/extraction/ai-loadouts", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<unknown>(
            res,
            (body) => {
                try {
                    returnAdminJson(res, service.setExtractionAiLoadouts(body));
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/extraction/secret-ai-loadouts", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.getExtractionSecretAiLoadouts());
    });

    app.post("/admin-api/extraction/secret-ai-loadouts", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<unknown>(
            res,
            (body) => {
                try {
                    returnAdminJson(res, service.setExtractionSecretAiLoadouts(body));
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/extraction/stash", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        try {
            returnAdminJson(res, service.getExtractionStash());
        } catch (error) {
            if (!res.aborted) returnError(res, error);
        }
    });

    app.get("/admin-api/extraction/equipment-return", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        try {
            returnAdminJson(res, service.getEquipmentReturnRequests());
        } catch (error) {
            if (!res.aborted) returnError(res, error);
        }
    });

    app.post("/admin-api/extraction/equipment-return/review", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ id?: unknown; decision?: unknown; adminNote?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.reviewEquipmentReturnRequest(body);
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction/stash", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ name?: string; type?: string; count?: number; action?: string }>(
            res,
            (body) => {
                try {
                    const result = service.modifyExtractionStashItem(body);
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction/stash/coins", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ name?: unknown; amount?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.grantExtractionStashCoins(body);
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction/stash/all", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ type?: string; count?: number }>(
            res,
            (body) => {
                try {
                    const result = service.addItemToAllPlayers(body);
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/player-accounts", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.getPlayerAccounts());
    });

    app.post("/admin-api/player-accounts/delete", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ username?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.deletePlayerAccount(body ?? {});
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.get("/admin-api/shop/config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.getShopConfig());
    });

    app.post("/admin-api/shop/config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            prices?: Record<
                string,
                {
                    buyEnabled?: boolean;
                    sellEnabled?: boolean;
                    buy?: number | null;
                    sell?: number | null;
                }
            >;
        }>(
            res,
            (body) => {
                try {
                    const result = service.setShopConfig(body ?? {});
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/pure-ai-duel", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<Record<string, unknown>>(
            res,
            async (body) => {
                try {
                    const result = await service.createPureAiDuel(body);
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/mode-action", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ modeIndex: unknown; enabled: unknown }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setModeEnabled(body.modeIndex, body.enabled),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/sandevistan-config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ playerTimeScale: unknown; worldTimeScale: unknown }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setSandevistanConfig(body.playerTimeScale, body.worldTimeScale),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction-secret-config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ enabled?: unknown; aiDifficulty?: unknown; immortalBoost?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.setExtractionSecretConfig(
                        body?.enabled,
                        body?.aiDifficulty,
                        body?.immortalBoost,
                    );
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction-boss-config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            enabled?: unknown;
            maxHealth?: unknown;
            count?: unknown;
            bossDefaultPerks?: unknown;
            bossPerks?: unknown;
            weapons?: unknown;
            bossPositions?: unknown;
            dropItems?: unknown;
            armor?: unknown;
            minions?: unknown;
        }>(
            res,
            (body) => {
                try {
                    const result = service.setExtractionBossConfig(
                        body?.enabled,
                        body?.maxHealth,
                        body?.count,
                        body?.bossDefaultPerks,
                        body?.bossPerks,
                        body?.weapons,
                        body?.bossPositions,
                        body?.dropItems,
                        body?.armor,
                        body?.minions,
                    );
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction-hunters-config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ normal?: unknown; secret?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.setExtractionHuntersConfig(
                        body?.normal,
                        body?.secret,
                    );
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/extraction-ai-drop-items", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ dropItems?: unknown }>(
            res,
            (body) => {
                try {
                    const result = service.setExtractionAiDropItemsConfig(
                        body?.dropItems,
                    );
                    if (!res.aborted) returnAdminJson(res, result);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });

    // 后台仓库完整物品目录（所有合法物品按类别分组，含全部能力）。
    app.get("/admin-api/stash-catalog", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        if (!res.aborted) {
            returnAdminJson(res, { catalog: getStashCatalog() });
        }
    });

    app.post("/admin-api/duel-config", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            weapons: unknown;
            adrenalineEnabled: unknown;
            boost: unknown;
            helmetLevel: unknown;
            chestLevel: unknown;
            scope: unknown;
            throwables: unknown;
            aiEnabled: unknown;
            aiDifficulty: unknown;
            randomModeEnabled: unknown;
            roomModeEnabled: unknown;
        }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setDuelConfig(
                            body.weapons,
                            body.adrenalineEnabled,
                            body.boost,
                            body.helmetLevel,
                            body.chestLevel,
                            body.scope,
                            body.throwables,
                            body.aiEnabled,
                            body.aiDifficulty,
                            body.randomModeEnabled,
                            body.roomModeEnabled,
                        ),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/bot-autofill", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            defaultJoinIntervalMs: unknown;
            soloTargetPlayerCount: unknown;
            duoTargetPlayerCount: unknown;
            squadTargetPlayerCount: unknown;
            factionTargetPlayerCount: unknown;
            extractionSecretSoloTargetPlayerCount: unknown;
            extractionSecretDuoTargetPlayerCount: unknown;
            extractionSecretSquadTargetPlayerCount: unknown;
            difficultyRatios: unknown;
            thinkIntervalsMs: unknown;
            highBudgetIntervalMs: unknown;
            maxBotWorkers: unknown;
        }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setBotAutoFillConfig(
                            body.defaultJoinIntervalMs,
                            body.soloTargetPlayerCount,
                            body.duoTargetPlayerCount,
                            body.squadTargetPlayerCount,
                            body.factionTargetPlayerCount,
                            body.extractionSecretSoloTargetPlayerCount,
                            body.extractionSecretDuoTargetPlayerCount,
                            body.extractionSecretSquadTargetPlayerCount,
                            body.difficultyRatios,
                            body.thinkIntervalsMs,
                            body.highBudgetIntervalMs,
                            body.maxBotWorkers,
                        ),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/announcement", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            heading: unknown;
            date: unknown;
            title: unknown;
            body: unknown;
        }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.setAnnouncement(
                            body.heading,
                            body.date,
                            body.title,
                            body.body,
                        ),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/live-announcement", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{ message: unknown; durationSeconds: unknown }>(
            res,
            (body) => {
                try {
                    returnAdminJson(
                        res,
                        service.publishLiveAnnouncement(
                            body.message,
                            body.durationSeconds,
                        ),
                    );
                } catch (error) {
                    returnError(res, error);
                }
            },
            () => {},
        );
    });

    app.post("/admin-api/live-announcement/clear", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        returnAdminJson(res, service.clearLiveAnnouncement());
    });

    app.post("/admin-api/game-action", (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });
        if (!authorize(res, req, auth)) return;
        readPostedJSON<{
            action: unknown;
            gameId: unknown;
            difficulty?: unknown;
        }>(
            res,
            async (body) => {
                try {
                    let result: unknown;
                    switch (body.action) {
                        case "stop":
                            result = service.stopGame(body.gameId);
                            break;
                        case "spectate":
                            result = await service.createSpectatorMatch(body.gameId);
                            break;
                        case "add-ai":
                            result = await service.addAiToGame(
                                body.gameId,
                                body.difficulty ?? "normal",
                            );
                            break;
                        default:
                            throw new AdminInputError("不支持的房间操作");
                    }
                    if (!res.aborted) returnAdminJson(res, result as Record<string, unknown>);
                } catch (error) {
                    if (!res.aborted) returnError(res, error);
                }
            },
            () => {},
        );
    });
}
