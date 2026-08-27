import assert from "assert";
import type { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import {
    AdminInputError,
    AdminNotFoundError,
    AdminService,
    type AdminGameManager,
    type AdminPureAiDuelRequest,
} from "./adminServer.ts";
import type { GameData, ServerGameConfig } from "./game/gameManager.ts";
import { stashManager } from "./stash/stashManager.ts";

const gameId = "a".repeat(40);
const games: GameData[] = [];
let lastCreatedConfig: ServerGameConfig | undefined;

const manager: AdminGameManager = {
    getPlayerCount: () => games.reduce((sum, game) => sum + game.aliveCount, 0),
    listGames: () => games,
    async createGame(config: ServerGameConfig) {
        lastCreatedConfig = config;
        const game: GameData = {
            id: gameId,
            mapName: config.mapName,
            teamMode: config.teamMode as TeamMode,
            aliveCount: 0,
            connectedCount: 0,
            humanPlayerCount: 0,
            aiPlayerCount: 0,
            spectatorCount: 0,
            serverBotCount: 0,
            serverBotTeamCounts: [],
            reservedHumanCount: 0,
            canJoin: true,
            startedTime: 0,
            stopped: false,
            privateGame: Boolean(config.privateGame),
        };
        games.push(game);
        return game;
    },
    stopGame(id: string) {
        const index = games.findIndex((game) => game.id === id);
        if (index === -1) return false;
        games.splice(index, 1);
        return true;
    },
};

async function run(): Promise<void> {
    let persistCount = 0;
    let persistDuelCount = 0;
    let persistAnnouncementCount = 0;
    let persistBotAutoFillCount = 0;
    let persistRoomPlayerLimitsCount = 0;
    let persistSandevistanCount = 0;
    let botConfigChangedCount = 0;
    let lastPureAiRequest: AdminPureAiDuelRequest | undefined;
    const service = new AdminService(
        manager,
        "local",
        "127.0.0.1:8001",
        () => {
            persistCount++;
        },
        () => {
            persistDuelCount++;
        },
        () => {
            persistAnnouncementCount++;
        },
        {
            async createSpectatorMatch() {
                throw new Error("unused");
            },
            async createPureAiDuel(request) {
                lastPureAiRequest = request;
                return {
                    gameId: "c".repeat(40),
                    spectatorShareCode: "ABCDEFGH",
                    matchData: {
                        zone: "local",
                        gameId: "c".repeat(40),
                        useHttps: false,
                        hosts: ["127.0.0.1:8001"],
                        addrs: ["127.0.0.1:8001"],
                        data: "observer-token",
                        spectatorShareCode: "ABCDEFGH",
                    },
                };
            },
            async addAiToGame() {
                throw new Error("unused");
            },
            onBotAutoFillConfigChanged() {
                botConfigChangedCount++;
            },
        },
        () => {
            persistBotAutoFillCount++;
        },
        () => {
            persistRoomPlayerLimitsCount++;
        },
        () => {
            persistSandevistanCount++;
        },
    );
    // 正式配置 defaultJoinIntervalMs 可能被改为非 2000 的值；测试临时固定，
    // 结束后恢复，避免断言依赖全局默认。
    const previousDefaultJoin = Config.botAutoFill.defaultJoinIntervalMs;
    Config.botAutoFill.defaultJoinIntervalMs = 2000;
    const initial = service.getStatus();
    assert.equal(initial.summary.gameCount, 0);
    assert.equal(initial.summary.humanPlayerCount, 0);
    assert.equal(initial.summary.aiPlayerCount, 0);
    assert.equal(initial.summary.spectatorCount, 0);
    // 后台指定玩家发金币：原子累加、返回最新余额，并拒绝非法数量和不存在仓库。
    const coinTestPlayer = "AdminCoinGrantSmokeTest";
    stashManager.removePlayer(coinTestPlayer);
    try {
        stashManager.setCoins(coinTestPlayer, 250);
        const grantedCoins = service.grantExtractionStashCoins({
            name: coinTestPlayer,
            amount: 1_000,
        });
        assert.equal(grantedCoins.ok, true);
        assert.equal(grantedCoins.amount, 1_000);
        assert.equal(grantedCoins.coins, 1_250);
        assert.equal(stashManager.getCoins(coinTestPlayer), 1_250);
        assert.throws(
            () =>
                service.grantExtractionStashCoins({
                    name: coinTestPlayer,
                    amount: 0,
                }),
            AdminInputError,
        );
        assert.throws(
            () =>
                service.grantExtractionStashCoins({
                    name: "AdminCoinGrantMissingPlayer",
                    amount: 1,
                }),
            AdminInputError,
        );
    } finally {
        stashManager.removePlayer(coinTestPlayer);
    }
    // The runtime config file is user-tunable, so compare against the live
    // Config values rather than hard-coded defaults.
    assert.deepEqual(initial.sandevistan, { ...Config.sandevistan });
    assert.deepEqual(service.setSandevistanConfig(0.25, 0.4).sandevistan, {
        playerTimeScale: 0.25,
        worldTimeScale: 0.4,
    });
    assert.equal(persistSandevistanCount, 1);
    assert.throws(() => service.setSandevistanConfig(0, 0.4), AdminInputError);
    assert.throws(() => service.setSandevistanConfig(0.25, 1.1), AdminInputError);
    service.setSandevistanConfig(0.1, 0.1);
    // 搜打撤·绝密模式配置：开关 + AI 难度。
    const secretResult = service.setExtractionSecretConfig(true, "pro", true);
    assert.equal(secretResult.extractionSecret.enabled, true);
    assert.equal(secretResult.extractionSecret.aiDifficulty, "pro");
    assert.equal(
        service.setExtractionSecretConfig(false, "not-a-difficulty", true)
            .extractionSecret.aiDifficulty,
        "pro",
        "invalid difficulty must keep the previous value",
    );
    service.setExtractionSecretConfig(false, "normal", true);
    assert.ok(initial.announcement.heading.length > 0);
    assert.equal(initial.botAutoFill.defaultJoinIntervalMs, 2000);
    assert.equal(initial.botAutoFill.soloTargetPlayerCount, 20);
    assert.equal(initial.botAutoFill.duoTargetPlayerCount, 20);
    assert.equal(initial.botAutoFill.squadTargetPlayerCount, 20);
    assert.equal(initial.botAutoFill.factionTargetPlayerCount, 40);
    assert.deepEqual(initial.botAutoFill.difficultyRatios, {
        normal: 50,
        hard: 33,
        pro: 17,
        legit: 0,
    });
    assert.equal(initial.botAutoFill.highBudgetIntervalMs, 6);
    const previousRoomPlayerLimits = { ...initial.roomPlayerLimits };
    assert.ok(initial.roomPlayerLimits.solo >= 1);
    assert.equal(initial.roomPlayerLimits.duo % 2, 0);
    assert.equal(initial.roomPlayerLimits.squad % 4, 0);
    const roomLimitsResult = service.setRoomPlayerLimits(18, 24, 32, 96);
    assert.deepEqual(roomLimitsResult.roomPlayerLimits, { solo: 18, duo: 24, squad: 32, faction: 96 });
    assert.equal(persistRoomPlayerLimitsCount, 1);
    assert.equal(botConfigChangedCount, 1);
    assert.throws(() => service.setRoomPlayerLimits(18, 23, 32, 96), AdminInputError);
    assert.throws(() => service.setRoomPlayerLimits(18, 24, 30, 96), AdminInputError);
    assert.throws(() => service.setRoomPlayerLimits(18, 24, 32, 1), AdminInputError, "50v50 room cap below 2 must be rejected");
    assert.equal(
        initial.botAutoFill.modes.length,
        initial.modes.filter((mode) => mode.mapName !== "duel").length,
    );
    const botConfigResult = service.setBotAutoFillConfig(
        1500,
        12,
        12,
        12,
        16,
        0,
        0,
        0,
        { normal: 40, hard: 30, pro: 20, legit: 10 },
        { normal: 125, hard: 60, pro: 28, legit: 3, forbidden: 3 },
        3,
        12,
    );
    assert.equal(botConfigResult.botAutoFill.defaultJoinIntervalMs, 1500);
    assert.equal(botConfigResult.botAutoFill.soloTargetPlayerCount, 12);
    assert.equal(botConfigResult.botAutoFill.duoTargetPlayerCount, 12);
    assert.equal(botConfigResult.botAutoFill.squadTargetPlayerCount, 12);
    assert.equal(botConfigResult.botAutoFill.factionTargetPlayerCount, 16);
    assert.equal(
        botConfigResult.botAutoFill.extractionSecretSoloTargetPlayerCount,
        0,
        "admin bot-auto-fill config must accept the secret-extraction solo target (0 = follow normal)",
    );
    assert.equal(
        botConfigResult.botAutoFill.extractionSecretDuoTargetPlayerCount,
        0,
        "admin bot-auto-fill config must accept the secret-extraction duo target",
    );
    assert.equal(
        botConfigResult.botAutoFill.extractionSecretSquadTargetPlayerCount,
        0,
        "admin bot-auto-fill config must accept the secret-extraction squad target",
    );
    assert.equal(botConfigResult.botAutoFill.difficultyRatios.legit, 10);
    assert.equal(botConfigResult.botAutoFill.highBudgetIntervalMs, 3);
    assert.equal(
        botConfigResult.botAutoFill.maxBotWorkers,
        12,
        "admin bot-auto-fill config must accept the global worker cap",
    );
    // The AI join interval is a single backend-wide value; per-mode delay
    // fields were removed from the snapshot.
    assert.equal(
        "joinIntervalMs" in botConfigResult.botAutoFill.modes[0],
        false,
        "per-mode AI join delay must not be exposed",
    );
    assert.equal(
        botConfigResult.botAutoFill.modes.find((mode) => mode.factionMode)?.targetPlayerCount,
        16,
    );
    assert.equal(persistBotAutoFillCount, 1);
    assert.equal(botConfigChangedCount, 2);
    assert.throws(
        () =>
            service.setBotAutoFillConfig(
                100,
                12,
                12,
                12,
                16,
                0,
                0,
                0,
                { normal: 40, hard: 30, pro: 20, legit: 10 },
                { normal: 125, hard: 60, pro: 28, legit: 3, forbidden: 3 },
                3,
            ),
        AdminInputError,
    );
    assert.throws(
        () =>
            service.setBotAutoFillConfig(
                1500,
                12,
                12,
                12,
                16,
                0,
                0,
                0,
                { normal: 40, hard: 30, pro: 20, legit: 9 },
                { normal: 125, hard: 60, pro: 28, legit: 3, forbidden: 3 },
                3,
            ),
        AdminInputError,
    );
    assert.throws(
        () =>
            service.setBotAutoFillConfig(
                1500,
                12,
                12,
                12,
                16,
                0,
                0,
                0,
                { normal: 40, hard: 30, pro: 20, legit: 10 },
                { normal: 125, hard: 60, pro: 28, legit: 0, forbidden: 3 },
                0,
            ),
        AdminInputError,
    );
    const previousAnnouncement = { ...initial.announcement };
    const announcement = service.setAnnouncement(
        "服务器公告",
        "2026-07-23",
        "欢迎参加1v1",
        "可以使用邀请码邀请好友。\n\n祝游戏愉快！",
    );
    assert.equal(announcement.announcement.title, "欢迎参加1v1");
    assert.equal(announcement.announcement.body.includes("邀请码"), true);
    assert.equal(persistAnnouncementCount, 1);
    assert.equal(initial.liveAnnouncement.active, false);
    const liveAnnouncement = service.publishLiveAnnouncement(
        "全服测试公告",
        90,
    );
    assert.equal(liveAnnouncement.liveAnnouncement.active, true);
    assert.equal(liveAnnouncement.liveAnnouncement.message, "全服测试公告");
    assert.ok(liveAnnouncement.liveAnnouncement.remainingSeconds > 0);
    assert.throws(
        () => service.publishLiveAnnouncement("持续时间错误", 4),
        AdminInputError,
    );
    assert.equal(service.clearLiveAnnouncement().liveAnnouncement.active, false);
    assert.throws(
        () => service.setAnnouncement("服务器公告", "", "", "正文"),
        AdminInputError,
    );
    assert.equal(initial.duel.weapons.length, 2);
    assert.equal(initial.duel.throwableCatalog.length, 6);
    assert.equal(initial.duel.boost >= 0 && initial.duel.boost <= 100, true);
    assert.equal(initial.duel.helmetLevel >= 0 && initial.duel.helmetLevel <= 3, true);
    assert.equal(initial.duel.chestLevel >= 0 && initial.duel.chestLevel <= 3, true);
    assert.ok(
        initial.duel.catalog.length >= 65,
        "the duel catalog may grow as valid weapons are added",
    );
    assert.equal(new Set(initial.duel.catalog.map((weapon) => weapon.category)).size, 8);
    const tierOrder = new Map<string | null, number>([
        ["S+", 0],
        ["S", 1],
        ["A", 2],
        ["B", 3],
        ["C", 4],
        ["D", 5],
        [null, 6],
    ]);
    for (let index = 1; index < initial.duel.catalog.length; index++) {
        const previous = initial.duel.catalog[index - 1];
        const current = initial.duel.catalog[index];
        if (previous.category === current.category) {
            assert.ok(tierOrder.get(previous.tier)! <= tierOrder.get(current.tier)!);
        }
    }
    assert.equal(
        initial.duel.catalog.every(
            (weapon) => weapon.image.startsWith("/img/loot/") && weapon.image.endsWith(".svg"),
        ),
        true,
    );
    const catalogById = new Map(initial.duel.catalog.map((weapon) => [weapon.id, weapon]));
    assert.equal(catalogById.get("awc")?.tier, "S+");
    assert.equal(catalogById.get("m1014")?.name, "Super 90");
    assert.equal(catalogById.get("m1014")?.tier, "S+");
    assert.equal(catalogById.get("scarssr")?.name, "Mk 20 SSR");
    assert.equal(catalogById.get("scarssr")?.tier, "S");
    assert.equal(catalogById.get("vector")?.tier, "A");
    assert.equal(catalogById.get("vector45")?.tier, "A");
    assert.equal(catalogById.get("glock_dual")?.tier, "C");
    assert.equal(catalogById.get("m9_dual")?.tier, "D");
    const untieredWeaponIds = new Set(
        initial.duel.catalog.filter((weapon) => !weapon.tier).map((weapon) => weapon.id),
    );
    for (const weaponId of ["bugle", "flare_gun", "flare_gun_dual"]) {
        assert.ok(untieredWeaponIds.has(weaponId), `${weaponId} must remain available`);
    }
    assert.equal(
        initial.duel.catalog.find((weapon) => weapon.id === "flare_gun")?.note,
        "1v1中不会召唤空投",
    );
    assert.equal(
        initial.duel.catalog.find((weapon) => weapon.id === "flare_gun_dual")?.note,
        "1v1中不会召唤空投",
    );
    assert.ok(initial.modes.some((mode) => mode.mapName === "duel"));
    assert.equal(
        initial.modes.find((mode) => mode.mapName === "duel")?.displayName,
        "1v1",
    );
    assert.deepEqual(
        initial.modes
            .filter((mode) => mode.mapName === "main")
            .map((mode) => mode.displayName),
        ["Normal 单人", "Normal 双人", "Normal 四人"],
    );
    const potatoModes = initial.modes.filter((mode) => mode.mapName === "potato");
    assert.deepEqual(
        potatoModes.map((mode) => mode.teamMode),
        [1, 2, 4],
    );
    assert.equal(initial.modes.length, Config.modes.length); // catalogue parity
    assert.deepEqual(
        new Set(initial.modes.map((mode) => mode.mapName)),
        new Set([
            "main",
            "main_spring",
            "main_summer",
            "desert",
            "faction",
            "halloween",
            "potato",
            "potato_spring",
            "snow",
            "woods",
            "woods_snow",
            "woods_spring",
            "woods_summer",
            "savannah",
            "cobalt",
            "turkey",
            "sandevistan",
            "extraction",
            "extraction_secret",
            "zombie",
            "duel",
        ]),
    );
    // Live zombie room snapshots must carry their per-room difficulty so the
    // admin room list can prefix the actual room name, not just the playlist.
    games.push({
        id: "z".repeat(40),
        mapName: "zombie",
        teamMode: 4 as TeamMode,
        zombieDifficulty: "hard",
        aliveCount: 1,
        connectedCount: 1,
        humanPlayerCount: 1,
        aiPlayerCount: 0,
        spectatorCount: 0,
        serverBotCount: 0,
        serverBotTeamCounts: [],
        reservedHumanCount: 0,
        canJoin: true,
        startedTime: 0,
        stopped: false,
        privateGame: false,
    });
    const zombieRoomSnapshot = service
        .getStatus()
        .games.find((game) => game.mapName === "zombie");
    assert.equal(
        zombieRoomSnapshot?.zombieDifficulty,
        "hard",
        "admin live room snapshot must preserve zombie difficulty",
    );
    games.pop();

    const faction = initial.modes.find((mode) => mode.mapName === "faction");
    assert.equal(faction?.displayName, "50v50");
    assert.equal(faction?.teamName, "两大阵营");
    assert.equal(faction?.teamMode, 4);
    const duelMode = initial.modes.find((mode) => mode.mapName === "duel");
    assert(duelMode);
    assert.equal(duelMode.enabled, false);
    assert.equal(initial.duel.randomModeEnabled, false);
    assert.equal(initial.duel.roomModeEnabled, true);
    // The per-mode open/close admin toggle is back: each playlist can be
    // opened or closed individually, but it must never act on the duel mode
    // (duel keeps its own random/room toggles).
    assert.throws(
        () => service.setModeEnabled(duelMode.index, true),
        AdminInputError,
        "the generic mode endpoint must not act as a third 1v1 switch",
    );

    const potato = potatoModes[0];
    const potatoWasEnabled = potato.enabled;

    // 前面 setExtractionSecretConfig 也会持久化 modes（绝密独立播放列表同步），
    // 重置计数以便只统计 setModeEnabled 的持久化次数。
    persistCount = 0;
    const enabledPotato = service.setModeEnabled(potato.index, !potatoWasEnabled);
    assert.equal(enabledPotato.mode.enabled, !potatoWasEnabled);
    assert.equal(service.getStatus().modes[potato.index].enabled, !potatoWasEnabled);
    assert.equal(persistCount, 1);
    service.setModeEnabled(potato.index, potatoWasEnabled);
    assert.equal(persistCount, 2);
    assert.throws(() => service.setModeEnabled("4", true), AdminInputError);
    assert.throws(() => service.setModeEnabled(potato.index, "yes"), AdminInputError);

    const previousDuelConfig = {
        weapons: [...initial.duel.weapons] as [string, string],
        adrenalineEnabled: initial.duel.adrenalineEnabled,
        boost: initial.duel.boost,
        helmetLevel: initial.duel.helmetLevel,
        chestLevel: initial.duel.chestLevel,
        scope: initial.duel.scope,
        throwables: { ...initial.duel.throwables },
        aiEnabled: initial.duel.aiEnabled,
        aiDifficulty: initial.duel.aiDifficulty,
        randomModeEnabled: initial.duel.randomModeEnabled,
        roomModeEnabled: initial.duel.roomModeEnabled,
    };
    const configuredThrowables = {
        frag: 4,
        mirv: 1,
        smoke: 2,
        strobe: 0,
        snowball: 6,
        potato: 3,
    };
    const configuredDuel = service.setDuelConfig(
        ["ak47", "mosin"],
        true,
        75,
        3,
        1,
        "8xscope",
        configuredThrowables,
        true,
        "hard",
        true,
        false,
    );
    assert.deepEqual(configuredDuel.duel.weapons, ["ak47", "mosin"]);
    assert.equal(configuredDuel.duel.boost, 75);
    assert.equal(configuredDuel.duel.helmetLevel, 3);
    assert.equal(configuredDuel.duel.chestLevel, 1);
    assert.equal(configuredDuel.duel.scope, "8xscope");
    assert.deepEqual(configuredDuel.duel.throwables, configuredThrowables);
    assert.equal(configuredDuel.duel.randomModeEnabled, true);
    assert.equal(configuredDuel.duel.roomModeEnabled, false);
    assert.equal(persistDuelCount, 1);
    assert.throws(
        () => service.setDuelConfig(["fists", "mosin"], true, 75, 3, 1, "8xscope", configuredThrowables, false, "normal", true, true),
        AdminInputError,
    );
    assert.throws(
        () => service.setDuelConfig(["ak47", "mosin"], true, 101, 3, 1, "8xscope", configuredThrowables, false, "normal", true, true),
        AdminInputError,
    );
    assert.throws(
        () => service.setDuelConfig(["ak47", "mosin"], true, 75, 4, 1, "8xscope", configuredThrowables, false, "normal", true, true),
        AdminInputError,
    );
    assert.throws(
        () => service.setDuelConfig(["ak47", "mosin"], true, 75, 3, 4, "8xscope", configuredThrowables, false, "normal", true, true),
        AdminInputError,
    );
    assert.throws(
        () => service.setDuelConfig(["ak47", "mosin"], true, 75, 3, 1, "8xscope", { frag: 100 }, false, "normal", true, true),
        AdminInputError,
    );
    assert.throws(
        () => service.setDuelConfig(["ak47", "mosin"], true, 75, 3, 1, "3xscope", configuredThrowables, false, "normal", true, true),
        AdminInputError,
    );

    const pureAi = await service.createPureAiDuel({
        difficulties: ["pro", "hard"],
        contestantLoadouts: [
            { weapons: ["ak47", "mosin"] },
            { weapons: ["m39", "mp220"] },
        ],
        loadout: {
            adrenalineEnabled: true,
            boost: 80,
            helmetLevel: 2,
            chestLevel: 2,
            scope: "4xscope",
            throwables: configuredThrowables,
        },
    });
    assert.equal(pureAi.gameId, "c".repeat(40));
    assert.equal(pureAi.spectatorShareCode, "ABCDEFGH");
    assert.deepEqual(lastPureAiRequest?.difficulties, ["pro", "hard"]);
    assert.deepEqual(lastPureAiRequest?.contestantLoadouts, [
        { weapons: ["ak47", "mosin"] },
        { weapons: ["m39", "mp220"] },
    ]);
    assert.equal(lastPureAiRequest?.loadout.weaponSelectionMode, "individual");
    assert.equal(lastPureAiRequest?.loadout.boost, 80);
    await assert.rejects(
        () => service.createPureAiDuel({
            difficulties: ["pro"],
            contestantLoadouts: [],
            loadout: {},
        }),
        AdminInputError,
    );

    const duelModeIndex = Config.modes.findIndex((mode) => mode.mapName === "duel");
    assert.ok(duelModeIndex >= 0, "duel mode index exists");
    const created = await service.createGame(duelModeIndex);
    assert.equal(created.game.mapName, "duel");
    assert.deepEqual(lastCreatedConfig?.duelWeapons, ["ak47", "mosin"]);
    assert.equal(lastCreatedConfig?.duelBoost, 75);
    assert.equal(lastCreatedConfig?.duelHelmetLevel, 3);
    assert.equal(lastCreatedConfig?.duelChestLevel, 1);
    assert.equal(lastCreatedConfig?.duelScope, "8xscope");
    assert.deepEqual(lastCreatedConfig?.duelThrowables, configuredThrowables);
    games[0].humanPlayerCount = 2;
    games[0].aiPlayerCount = 5;
    games[0].spectatorCount = 1;
    games[0].connectedCount = 7;
    games[0].serverBotCount = 5;
    const populatedStatus = service.getStatus();
    assert.equal(populatedStatus.summary.gameCount, 1);
    assert.equal(populatedStatus.summary.humanPlayerCount, 2);
    assert.equal(populatedStatus.summary.aiPlayerCount, 5);
    assert.equal(populatedStatus.summary.spectatorCount, 1);
    assert.equal(populatedStatus.summary.playerCount, 7);
    assert.equal(populatedStatus.games[0].humanPlayerCount, 2);
    assert.equal(populatedStatus.games[0].aiPlayerCount, 5);
    assert.equal(populatedStatus.games[0].spectatorCount, 1);
    const statusJson = JSON.stringify(populatedStatus);
    assert.ok(statusJson.includes(gameId));
    assert.ok(!statusJson.includes("pluginManager"));

    games[0].over = true;
    assert.equal(
        service.getStatus().summary.gameCount,
        0,
        "a winner-decided room must disappear before its delayed worker stop",
    );
    games[0].over = false;
    games[0].processHealth = "warning";
    assert.equal(
        service.getStatus().summary.gameCount,
        0,
        "an unresponsive room snapshot must not be rendered as spectatable",
    );
    games[0].processHealth = "healthy";

    await assert.rejects(() => service.createGame("3"), AdminInputError);
    assert.deepEqual(service.stopGame(gameId), { stopped: true, gameId });
    assert.throws(() => service.stopGame(gameId), AdminNotFoundError);

    service.setDuelConfig(
        previousDuelConfig.weapons,
        previousDuelConfig.adrenalineEnabled,
        previousDuelConfig.boost,
        previousDuelConfig.helmetLevel,
        previousDuelConfig.chestLevel,
        previousDuelConfig.scope,
        previousDuelConfig.throwables,
        previousDuelConfig.aiEnabled,
        previousDuelConfig.aiDifficulty,
        previousDuelConfig.randomModeEnabled,
        previousDuelConfig.roomModeEnabled,
    );
    assert.equal(persistDuelCount, 2);

    service.setRoomPlayerLimits(
        previousRoomPlayerLimits.solo,
        previousRoomPlayerLimits.duo,
        previousRoomPlayerLimits.squad,
        previousRoomPlayerLimits.faction,
    );
    assert.equal(persistRoomPlayerLimitsCount, 2);

    service.setAnnouncement(
        previousAnnouncement.heading,
        previousAnnouncement.date,
        previousAnnouncement.title,
        previousAnnouncement.body,
    );
    assert.equal(persistAnnouncementCount, 2);
    Config.botAutoFill.defaultJoinIntervalMs = previousDefaultJoin;

    console.log("Admin smoke test passed: dashboard data, player coin grants, room limits, pure-AI duel creation, bot auto-fill settings, modes, announcement, duel weapons, rooms and actions.");
}

void run();
