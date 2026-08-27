import $ from "jquery";
import * as PIXI from "pixi.js-legacy";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import type {
    FindGameBody,
    FindGameError,
    FindGameMatchData,
    FindGameResponse,
    GameWsDisconnectReason,
} from "../../shared/types/api.ts";
import { math } from "../../shared/utils/math.ts";
import { resolveAdvertisedAddress, resolveAdvertisedUrl } from "../../shared/utils/networkAddress.ts";
import { Account } from "./account.ts";
import { Ambiance } from "./ambiance.ts";
import { api } from "./api.ts";
import { AudioManager } from "./audioManager.ts";
import { ConfigManager, type ConfigType } from "./config.ts";
import { device } from "./device.ts";
import { errorLogManager } from "./errorLogs.ts";
import { initExtractionStashUi } from "./extractionStashUi.ts";
import { Game } from "./game.ts";
import { helpers } from "./helpers.ts";
import { InputHandler } from "./input.ts";
import { InputBinds, InputBindUi } from "./inputBinds.ts";
import { PingTest } from "./pingTest.ts";
import { PlayerAccount } from "./playerAccount.ts";
import { proxy } from "./proxy.ts";
import { ResourceManager } from "./resources.ts";
import { SDK } from "./sdk/sdk.ts";
import { SiteInfo } from "./siteInfo.ts";
import { AimTrainingLobby } from "./ui/aimTrainingLobby.ts";
import { DuelLobby } from "./ui/duelLobby.ts";
import { LoadoutMenu } from "./ui/loadoutMenu.ts";
import { Localization } from "./ui/localization.ts";
import Menu from "./ui/menu.ts";
import { MenuModal } from "./ui/menuModal.ts";
import { LoadoutDisplay } from "./ui/opponentDisplay.ts";
import { Pass } from "./ui/pass.ts";
import { ProfileUi } from "./ui/profileUi.ts";
import { SpectateLobby } from "./ui/spectateLobby.ts";
import { TeamMenu } from "./ui/teamMenu.ts";
import { loadStaticDomImages } from "./ui/ui2.ts";

// Kept in the production bundle so deployment scripts can reject stale clients.
document.documentElement.dataset.survivBuild = "V260_14_NEW_CORE";

/** Legacy custom-lobby response; normal matchmaking uses FindGameMatchData. */
export interface MatchData {
    zone: string;
    gameId: number | string;
    useHttps: boolean;
    hosts: string[];
    addrs: string[];
    data: string;
    spectatorShareCode?: string;
    fill?: {
        humanPlayers: number;
        botPlayers: number;
        totalPlayers: number;
        targetPlayers: number;
        reservedPlayers?: number;
    };
}

interface EquipmentReturnNotification {
    id: string;
    matchId: string;
    mapName: string;
    status: "approved" | "auto-refunded";
    returnedAt: number;
    adminNote?: string;
}

const ACCOUNT_NICKNAME_PREFIX = "surviv_nickname_";
function accountNicknameKey(account: string): string {
    return `${ACCOUNT_NICKNAME_PREFIX}${account || ""}`;
}
function loadAccountNickname(account: string): string {
    try {
        return localStorage.getItem(accountNicknameKey(account)) || "";
    } catch {
        return "";
    }
}
function saveAccountNickname(account: string, nickname: string): void {
    try {
        if (nickname) localStorage.setItem(accountNicknameKey(account), nickname);
        else localStorage.removeItem(accountNicknameKey(account));
    } catch {
        // A blocked localStorage must not prevent entering a match.
    }
}

export class Application {
    nameInput = $("#player-name-input-solo");
    serverSelect = $("#server-select-main");
    muteBtns = $(".btn-sound-toggle");
    aimLineBtn = $("#btn-game-aim-line");
    masterSliders = $<HTMLInputElement>(".sl-master-volume");
    soundSliders = $<HTMLInputElement>(".sl-sound-volume");
    musicSliders = $<HTMLInputElement>(".sl-music-volume");
    serverWarning = $("#server-warning");
    languageSelect = $<HTMLSelectElement>(".language-select");
    startMenuWrapper = $("#start-menu-wrapper");
    gameAreaWrapper = $("#game-area-wrapper");
    playButtons = $(".play-button-container");
    playLoading = $(".play-loading-outer");
    errorModal = new MenuModal($("#modal-notification"));
    refreshModal = new MenuModal($("#modal-refresh"));
    ipBanModal = new MenuModal($("#modal-ip-banned"));
    secretRuleModal = new MenuModal($("#modal-extraction-secret-rule"));
    allModesModal = new MenuModal($("#modal-all-modes"));
    config = new ConfigManager();
    localization = new Localization();

    account!: Account;
    playerAccount = new PlayerAccount();
    loadoutMenu!: LoadoutMenu;
    pass!: Pass;
    profileUi!: ProfileUi;

    pingTest = new PingTest();
    audioManager = new AudioManager();
    ambience = new Ambiance();

    siteInfo!: SiteInfo;
    private secretEligibleCache:
        | Array<{
            id: string;
            name: string;
            categoryName: string;
            image: string;
            tier?: string | null;
        }>
        | null = null;
    teamMenu!: TeamMenu;
    duelLobby!: DuelLobby;
    aimTrainingLobby!: AimTrainingLobby;
    spectateLobby!: SpectateLobby;

    pixi: PIXI.Application<PIXI.ICanvas> | null = null;
    resourceManager: ResourceManager | null = null;
    input: InputHandler | null = null;
    inputBinds: InputBinds | null = null;
    inputBindUi: InputBindUi | null = null;
    game: Game | null = null;
    loadoutDisplay: LoadoutDisplay | null = null;
    domContentLoaded = false;
    configLoaded = false;
    initialized = false;
    active = false;
    sessionId = helpers.random64();
    contextListener = function(e: MouseEvent) {
        e.preventDefault();
    };

    errorMessage = "";
    quickPlayPendingModeIdx = -1;
    findGameAttempts = 0;
    findGameTime = 0;
    /** 持久化对局 URL 失败后的自动重连次数（上限 3 次）。 */
    reconnectAttempts = 0;
    pauseTime = 0;
    wasPlayingVideo = false;
    checkedPingTest = false;
    hasFocus = true;
    newsDisplayed = true;
    private equipmentReturnNotificationRequest: Promise<void> | null = null;
    private equipmentReturnNotificationRetry = false;
    private equipmentReturnNotificationTimer: number | null = null;
    private readonly equipmentReturnNotificationsShown = new Set<string>();

    updateLogoBasedOnLanguage(lang: string) {
        const header = $("#start-row-header");
        if (!header.length) return;
        header.toggleClass("lang-ru", lang === "ru");
    }

    constructor() {
        this.allModesModal.skipFade = true;
        this.account = new Account(this.config);
        this.loadoutMenu = new LoadoutMenu(this.account, this.localization);
        this.pass = new Pass(this.account, this.loadoutMenu, this.localization);
        this.profileUi = new ProfileUi(
            this.account,
            this.localization,
            this.loadoutMenu,
            this.errorModal,
        );
        this.siteInfo = new SiteInfo(this.config, this.localization);

        this.teamMenu = new TeamMenu(
            this.config,
            this.pingTest,
            this.siteInfo,
            this.localization,
            this.audioManager,
            () => this.playerAccount.token || "",
            (gameModeIdx) => this.requireLoginForMode(gameModeIdx),
            this.onTeamMenuJoinGame.bind(this),
            this.onTeamMenuLeave.bind(this),
        );

        const onLoadComplete = () => {
            this.config.load(() => {
                this.configLoaded = true;
                this.tryLoad();
            });
        };
        this.loadBrowserDeps(onLoadComplete);
    }

    async loadBrowserDeps(onLoadCompleteCb: () => void) {
        await SDK.init(this);
        onLoadCompleteCb();
    }

    tryLoad() {
        if (this.domContentLoaded && this.configLoaded && !this.initialized) {
            this.initialized = true;
            // this should be this.config.config.teamAutofill = true???
            // this.config.teamAutoFill = true;
            if (device.mobile) {
                Menu.applyMobileBrowserStyling(device.tablet);
            }
            if (SDK.isSpellSync) {
                this.localization.setLocale(window.spellSync.language);
                this.updateLogoBasedOnLanguage(window.spellSync.language);
            } else {
                const language = this.config.get("language") || this.localization.detectLocale();
                this.config.set("language", language);
                this.localization.setLocale(language);
                this.updateLogoBasedOnLanguage(language);
            }
            this.localization.populateLanguageSelect();
            this.startPingTest();
            const applySiteInfo = () => {
                this.syncSandevistanScale();
                this.syncExtractionSecretEntry();
                this.refreshUi();
            };
            this.siteInfo.load(applySiteInfo);
            // Returning from the admin tab refreshes mode visibility without a
            // page reload. The API process also reloads the persisted snapshot.
            const refreshSiteInfo = () => {
                if (document.visibilityState === "visible") {
                    this.siteInfo.refresh(applySiteInfo);
                }
            };
            window.addEventListener("focus", refreshSiteInfo);
            document.addEventListener("visibilitychange", refreshSiteInfo);
            this.localization.localizeIndex();
            this.account.init();
            this.initPlayerAccount();
            this.duelLobby = new DuelLobby(
                () => {
                    this.setConfigFromDOM();
                    return this.config.get("playerName")!;
                },
                (matchData, spectator) => {
                    const joinPrivateDuel = () => {
                        if (!this.game) {
                            window.setTimeout(joinPrivateDuel, 100);
                            return;
                        }
                        this.game.privateDuelMatch = true;
                        this.game.sharedSpectator = spectator;
                        this.joinGame(matchData);
                    };
                    this.waitOnAccount(joinPrivateDuel);
                },
            );
            this.duelLobby.init();
            $("#btn-duel-lobby").on("click", () => {
                this.duelLobby.open();
            });
            this.aimTrainingLobby = new AimTrainingLobby(
                () => {
                    this.setConfigFromDOM();
                    return this.config.get("playerName")!;
                },
                (matchData) => {
                    const joinTraining = () => {
                        if (!this.game) {
                            window.setTimeout(joinTraining, 100);
                            return;
                        }
                        this.game.privateDuelMatch = false;
                        this.game.sharedSpectator = false;
                        this.joinGame(matchData);
                    };
                    this.waitOnAccount(joinTraining);
                },
                (settings) => this.game?.applyAimTrainingSettings(settings),
            );
            this.aimTrainingLobby.init();
            $("#btn-aim-training").on("click", () => void this.aimTrainingLobby.open());
            this.spectateLobby = new SpectateLobby((matchData) => {
                const joinSpectate = () => {
                    if (!this.game) {
                        window.setTimeout(joinSpectate, 100);
                        return;
                    }
                    this.game.privateDuelMatch = false;
                    this.game.sharedSpectator = false;
                    this.joinGame(matchData);
                };
                this.waitOnAccount(joinSpectate);
            });
            this.spectateLobby.init();
            initExtractionStashUi();
            $("#aim-training-settings-open").on("click", () => void this.aimTrainingLobby.openSettings());
            $("#aim-training-exit").on("click", () => {
                if (this.game?.m_map.mapName === "aim_training") {
                    this.game.m_uiManager.quitGame();
                }
            });

            this.nameInput.attr("maxLength", net.Constants.PlayerNameMaxLen);

            this.playButtons.on("click", ".quick-play-mode-button", (event) => {
                const button = $(event.currentTarget);
                if (button.hasClass("btn-disabled-main")) return;
                const gameModeIdx = Number(button.data("game-mode-index"));
                if (Number.isInteger(gameModeIdx)) {
                    SDK.requestMidGameAd(() => this.tryQuickStartGame(gameModeIdx));
                }
            });

            $("#btn-all-modes").on("click", () => this.allModesModal.show());
            $("#all-modes-list").on("click", ".all-modes-entry", (event) => {
                const entry = $(event.currentTarget);
                const specialLobby = String(entry.attr("data-special-lobby") || "");
                this.allModesModal.hide();
                if (specialLobby === "duel") {
                    this.duelLobby.open();
                    return;
                }
                if (specialLobby === "zombie") {
                    const zombieLobby = $("#modal-zombie-lobby");
                    zombieLobby.data("allow-unlisted-mode", true);
                    $("#zombie-lobby-status").text("").css("color", "#7dffa8");
                    zombieLobby.show();
                    return;
                }
                const gameModeIdx = Number(entry.attr("data-game-mode-index"));
                if (!Number.isInteger(gameModeIdx)) return;
                const teamMode = Number(entry.attr("data-team-mode"));
                if (Number.isInteger(teamMode) && teamMode > TeamMode.Solo) {
                    // The all-modes chooser can expose unlisted duo/squad and
                    // 50v50 playlists. Preserve that exact playlist while
                    // opening an invite-code room instead of immediately
                    // putting one player into matchmaking.
                    this.config.set("gameModeIdx", gameModeIdx);
                    void this.tryJoinTeam(true);
                    return;
                }
                this.tryQuickStartGame(gameModeIdx, true);
            });

            this.serverSelect.on("change", () => {
                const t = this.serverSelect.find(":selected").val();
                this.config.set("region", t as string);
            });
            this.nameInput.on("blur", (_t) => {
                if (this.playerAccount.loggedIn) {
                    const accountKey = this.playerAccount.username || this.playerAccount.displayName;
                    const nickname = String(this.nameInput.val() ?? "").trim();
                    if (nickname) saveAccountNickname(accountKey, nickname);
                }
                this.setConfigFromDOM();
            });
            // 改名确认按钮：保存昵称并给出明确反馈。
            $("#btn-name-confirm").on("click", () => {
                if (this.playerAccount.loggedIn) {
                    const accountKey = this.playerAccount.username || this.playerAccount.displayName;
                    const nickname = String(this.nameInput.val() ?? "").trim();
                    if (nickname) saveAccountNickname(accountKey, nickname);
                }
                this.setConfigFromDOM();
                const btn = $("#btn-name-confirm");
                const original = btn.text();
                btn.text("已保存 ✓");
                window.setTimeout(() => btn.text(original), 1500);
            });
            // 排行榜入口（搜打撤进入界面顶部）→ 独立的搜打撤页。
            $("#btn-leaderboard").on("click", (event) => {
                event.preventDefault();
                window.location.href = "/extraction";
            });
            this.muteBtns.on("click", (_t) => {
                this.config.set("muteAudio", !this.config.get("muteAudio"));
            });
            this.muteBtns.on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.masterSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.soundSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            $(this.musicSliders).on("mousedown", (e) => {
                e.stopPropagation();
            });
            this.masterSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setMasterVolume(r);
                this.config.set("masterVolume", r);
            });
            this.soundSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setSoundVolume(r);
                this.config.set("soundVolume", r);
            });
            this.musicSliders.on("input", (t) => {
                const r = Number($(t.target).val()) / 100;
                this.audioManager.setMusicVolume(r);
                this.config.set("musicVolume", r);
            });
            $(".modal-settings-item")
                .children("input")
                .each((_t, r) => {
                    const a = $(r);
                    a.prop("checked", this.config.get(a.prop("id")));
                });
            $(".modal-settings-item > input:checkbox").on("change", (t) => {
                const r = $(t.target);
                this.config.set(r.prop("id"), r.is(":checked"));
            });
            $(".btn-fullscreen-toggle").on("click", () => {
                helpers.toggleFullScreen();
            });
            this.languageSelect.on("change", (t) => {
                const r = t.target.value;
                if (r) {
                    this.config.set("language", r as ConfigType["language"]);
                    if (SDK.isSpellSync && window.spellSync) {
                        window.spellSync.changeLanguage(r);
                    }
                    this.updateLogoBasedOnLanguage(r);
                }
            });
            $("#btn-create-team").on("click", () => {
                void this.tryJoinTeam(true);
            });
            $("#btn-extraction-team").on("click", () => {
                // 搜打撤专属邀请组队：创建队伍时把房间队列模式预选为
                // 搜打撤双排（需后台已启用该模式），队友通过邀请链接加入。
                const duoIdx = Number($("#btn-extraction-team").data("extraction-duo-index"));
                if (Number.isInteger(duoIdx)) {
                    this.config.set("gameModeIdx", duoIdx);
                }
                void this.tryJoinTeam(true);
            });
            // 点击「搜打撤」标题进入独立的搜打撤页（排行榜 / 查看他人仓库）。
            $("#extraction-mode-section > .extraction-mode-title").on("click", () => {
                window.location.href = "/extraction";
            });
            $("#btn-extraction-squad-team").on("click", () => {
                // 搜打撤四人组队：预选搜打撤四排播放列表。
                const squadIdx = Number(
                    $("#btn-extraction-squad-team").data("extraction-squad-index"),
                );
                if (Number.isInteger(squadIdx)) {
                    this.config.set("gameModeIdx", squadIdx);
                }
                void this.tryJoinTeam(true);
            });
            // 僵尸模式大厅：点击主菜单"僵尸模式"打开，选难度/规模后开始。
            const zombieLobby = $("#modal-zombie-lobby");
            const zombieDifficulty = () =>
                String(
                    $(".zombie-difficulty-btn.selected").attr("data-diff")
                        || "normal",
                );
            $(".zombie-difficulty-btn").on("click", (event) => {
                $(".zombie-difficulty-btn").removeClass("selected");
                $(event.currentTarget).addClass("selected");
            });
            const openZombieLobby = () => {
                zombieLobby.data("allow-unlisted-mode", false);
                $("#zombie-lobby-status").text("").css("color", "#7dffa8");
                zombieLobby.show();
            };
            $("#btn-zombie-lobby").on("click", openZombieLobby);
            $("#btn-zombie-lobby-close").on("click", () => zombieLobby.hide());
            zombieLobby.on("click", (event) => {
                if (event.target === zombieLobby[0]) zombieLobby.hide();
            });
            $("#btn-zombie-lobby-solo").on("click", () => {
                const gameModeIdx = Number(
                    $("#btn-zombie-lobby-solo").data("game-mode-index"),
                );
                if (Number.isInteger(gameModeIdx)) {
                    (window as unknown as { survivZombieDifficulty?: string })
                        .survivZombieDifficulty = zombieDifficulty();
                    zombieLobby.hide();
                    this.tryQuickStartGame(
                        gameModeIdx,
                        zombieLobby.data("allow-unlisted-mode") === true,
                    );
                }
            });
            $("#btn-zombie-lobby-duo").on("click", () => {
                const duoIdx = Number($("#btn-zombie-lobby-duo").data("game-mode-index"));
                if (Number.isInteger(duoIdx)) {
                    this.config.set("gameModeIdx", duoIdx);
                    (window as unknown as { survivZombieDifficulty?: string })
                        .survivZombieDifficulty = zombieDifficulty();
                }
                zombieLobby.hide();
                void this.tryJoinTeam(true);
            });
            $("#btn-zombie-lobby-squad").on("click", () => {
                const squadIdx = Number(
                    $("#btn-zombie-lobby-squad").data("game-mode-index"),
                );
                if (Number.isInteger(squadIdx)) {
                    this.config.set("gameModeIdx", squadIdx);
                    (window as unknown as { survivZombieDifficulty?: string })
                        .survivZombieDifficulty = zombieDifficulty();
                }
                zombieLobby.hide();
                void this.tryJoinTeam(true);
            });
            // 搜打撤栏位于右侧栏（不在 .play-button-container 内），
            // 需要独立的开始按钮委托。普通搜打撤入口始终开始普通对局。
            $("#btn-extraction-start").on("click", () => {
                const gameModeIdx = Number($("#btn-extraction-start").data("game-mode-index"));
                if (Number.isInteger(gameModeIdx)) {
                    this.tryQuickStartGame(gameModeIdx);
                }
            });
            // 绝密搜打撤与普通搜打撤同时运行：绝密入口走绝密播放列表，
            // 需要 A/S/S+ 武器资格校验。
            $("#btn-extraction-secret-team").on("click", () => {
                const duoIdx = Number(
                    $("#btn-extraction-secret-team").data("extraction-secret-duo-index"),
                );
                if (Number.isInteger(duoIdx)) {
                    this.config.set("gameModeIdx", duoIdx);
                }
                void this.tryJoinTeam(true);
            });
            $("#btn-extraction-secret-squad-team").on("click", () => {
                // 绝密搜打撤四人组队：预选绝密四排播放列表。
                const squadIdx = Number(
                    $("#btn-extraction-secret-squad-team").data(
                        "extraction-secret-squad-index",
                    ),
                );
                if (Number.isInteger(squadIdx)) {
                    this.config.set("gameModeIdx", squadIdx);
                }
                void this.tryJoinTeam(true);
            });
            $("#btn-extraction-secret-start").on("click", async () => {
                const gameModeIdx = Number(
                    $("#btn-extraction-secret-start").data("game-mode-index"),
                );
                if (Number.isInteger(gameModeIdx)) {
                    // 绝密模式：至少配备一把 A/S/S+ 武器（单持手枪除外）。
                    if (!(await this.checkExtractionSecretEligible())) {
                        this.showExtractionSecretRule();
                        return;
                    }
                    this.tryQuickStartGame(gameModeIdx);
                }
            });
            $("#btn-team-mobile-link-join").on("click", () => {
                let t = $<HTMLInputElement>("#team-link-input").val()!.trim()!;
                const r = t.indexOf("#");
                if (r >= 0) {
                    t = t.slice(r + 1);
                }
                if (t.length > 0) {
                    $("#team-mobile-link").css("display", "none");
                    void this.tryJoinTeam(false, t);
                } else {
                    $("#team-mobile-link-desc").css("display", "none");
                    $("#team-mobile-link-warning").css("display", "none").fadeIn(100);
                }
            });
            $("#btn-team-leave").on("click", () => {
                if (window.history) {
                    window.history.replaceState("", "", "/");
                }
                $("#news-block").css("display", "block");
                this.game?.free();
                this.teamMenu.leave();
            });

            // hide pass and show news by default if login is unsupported
            const loginSupported = !SDK.isAnySDK && proxy.anyLoginSupported();
            if (loginSupported) {
                $("#news-wrapper").hide();
                $("#pass-wrapper").show();
                this.newsDisplayed = false;
            } else {
                $(".right-column-toggle").hide();
                $("#news-wrapper").show();
                $("#pass-wrapper").hide();
                this.newsDisplayed = true;
            }

            const currentNews = $("#news-current").data("date");
            const currentNewsTime = new Date(currentNews).getTime();
            $(".right-column-toggle").on("click", () => {
                if (this.newsDisplayed) {
                    $("#news-wrapper").fadeOut(250);
                    $("#pass-wrapper").fadeIn(250);
                } else {
                    this.config.set("lastNewsTimestamp", currentNewsTime);
                    $(".news-toggle").find(".account-alert").css("display", "none");
                    $("#news-wrapper").fadeIn(250);
                    $("#pass-wrapper").fadeOut(250);
                }
                this.newsDisplayed = !this.newsDisplayed;
            });
            const lastSeenNewsTime = this.config.get("lastNewsTimestamp")!;
            if (currentNewsTime > lastSeenNewsTime) {
                $(".news-toggle").find(".account-alert").css("display", "block");
            }
            this.setDOMFromConfig();
            this.setAppActive(true);
            const domCanvas = document.querySelector<HTMLCanvasElement>("#cvs")!;

            const rendererRes = window.devicePixelRatio > 1 ? 2 : 1;

            if (device.os == "ios") {
                PIXI.settings.PRECISION_FRAGMENT = PIXI.PRECISION.HIGH;
            }

            const createPixiApplication = (forceCanvas: boolean) => {
                return new PIXI.Application({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    view: domCanvas,
                    antialias: false,
                    resolution: rendererRes,
                    hello: true,
                    forceCanvas,
                });
            };
            let pixi = null;
            try {
                pixi = createPixiApplication(false);
            } catch (_e) {
                pixi = createPixiApplication(true);
            }
            this.pixi = pixi;
            this.pixi.renderer.events.destroy();
            this.pixi.ticker.add(this.update, this);
            this.pixi.renderer.background.color = 7378501;
            this.resourceManager = new ResourceManager(
                this.pixi.renderer,
                this.audioManager,
                this.config,
            );
            this.resourceManager.loadMapAssets("main");
            this.input = new InputHandler(document.getElementById("game-touch-area")!);
            this.inputBinds = new InputBinds(this.input, this.config);
            this.inputBindUi = new InputBindUi(
                this.input,
                this.inputBinds,
                this.localization,
            );
            const onJoin = () => {
                this.loadoutDisplay!.free();
                this.game!.init();
                this.onResize();
                this.findGameAttempts = 0;
                this.ambience.onGameStart();
            };
            const onQuit = (errMsg?: GameWsDisconnectReason) => {
                const returnToDuelLobby = this.duelLobby?.isInMatch() ?? false;
                if (this.game!.m_updatePass) {
                    this.pass.scheduleUpdatePass(this.game!.m_updatePassDelay);
                }
                this.game!.free();
                this.errorMessage = errMsg ? this.getErrorString(errMsg, "host_closed") : "";
                // Preserve the current URL only for a reconnectable host closure.
                this.reconnectAttempts = 0;
                if (errMsg !== "host_closed") this.clearMatchUrl();
                this.teamMenu.onGameComplete(this.errorMessage);
                this.ambience.onGameComplete(this.audioManager);
                this.setAppActive(true);
                this.setPlayLockout(false);
                if (returnToDuelLobby) this.duelLobby.returnAfterMatch();

                if (errMsg == "invalid_protocol") {
                    this.showInvalidProtocolModal();
                }
                if (errMsg == "behind_proxy" || errMsg == "ip_banned") {
                    this.showErrorModal(errMsg);
                }
                if (errMsg) {
                    console.warn("Quitting", errMsg);
                }

                SDK.gamePlayStop();
            };
            this.game = new Game(
                this.pixi,
                this.audioManager,
                this.localization,
                this.config,
                this.input,
                this.inputBinds,
                this.inputBindUi,
                this.ambience,
                this.resourceManager,
                onJoin,
                onQuit,
            );
            this.syncSandevistanScale();
            this.loadoutDisplay = new LoadoutDisplay(
                this.pixi,
                this.audioManager,
                this.config,
                this.inputBinds,
                this.account,
            );
            this.loadoutMenu.loadoutDisplay = this.loadoutDisplay;
            this.onResize();
            if (
                !this.tryJoinAdminSpectator()
                && !this.tryJoinPersistedMatch()
            ) {
                void this.tryJoinTeam(false);
            }
            Menu.setupModals(this.inputBinds, this.inputBindUi);
            this.onConfigModified();
            this.config.addModifiedListener(this.onConfigModified.bind(this));
            loadStaticDomImages();

            SDK.gameLoadComplete();

            this.tryJoinGameFromParam();
        }
    }

    onUnload() {
        this.teamMenu.leave();
    }

    onResize() {
        device.onResize();
        Menu.onResize();
        this.loadoutMenu.onResize();
        this.pixi?.renderer.resize(device.screenWidth, device.screenHeight);
        if (this.game?.initialized) {
            this.game.resize();
        }
        if (this.loadoutDisplay?.initialized) {
            this.loadoutDisplay.resize();
        }
        this.refreshUi();
    }

    startPingTest() {
        const regions = this.config.get("regionSelected")
            ? [this.config.get("region")!]
            : this.pingTest.getRegionList();
        this.pingTest.start(regions);
    }

    /** 回到主界面时显示尚未读过的装备返还成功通知。 */
    private checkEquipmentReturnNotifications(): void {
        const token = this.playerAccount.token;
        if (!this.active || !token) return;
        if (this.equipmentReturnNotificationRequest) {
            this.equipmentReturnNotificationRetry = true;
            return;
        }

        this.equipmentReturnNotificationRetry = false;
        this.equipmentReturnNotificationRequest = this.loadEquipmentReturnNotifications(
            token,
        ).finally(() => {
            this.equipmentReturnNotificationRequest = null;
            if (this.equipmentReturnNotificationRetry && this.active) {
                this.equipmentReturnNotificationRetry = false;
                window.setTimeout(
                    () => this.checkEquipmentReturnNotifications(),
                    0,
                );
            }
        });
    }

    private async loadEquipmentReturnNotifications(token: string): Promise<void> {
        try {
            const response = await fetch(
                `/api/extraction/equipment-return/notifications?token=${encodeURIComponent(token)}`,
                {
                    headers: { Accept: "application/json" },
                    cache: "no-store",
                },
            );
            if (!response.ok) return;
            const data = (await response.json()) as {
                ok?: boolean;
                notifications?: EquipmentReturnNotification[];
            };
            if (
                !data.ok
                || !this.active
                || this.playerAccount.token !== token
                || !Array.isArray(data.notifications)
            ) {
                return;
            }

            const notifications = data.notifications.filter(
                (notification) =>
                    typeof notification?.id === "string"
                    && (notification.status === "approved"
                        || notification.status === "auto-refunded")
                    && !this.equipmentReturnNotificationsShown.has(notification.id),
            );
            if (notifications.length === 0) return;
            for (const notification of notifications) {
                this.equipmentReturnNotificationsShown.add(notification.id);
            }

            const approvedCount = notifications.filter(
                (notification) => notification.status === "approved",
            ).length;
            const automaticCount = notifications.length - approvedCount;
            const details: string[] = ["带入装备已返还仓库，请前往仓库查看。"];
            if (approvedCount > 0) {
                details.push(`后台审批返还：${approvedCount} 局`);
            }
            if (automaticCount > 0) {
                details.push(`服务器卡顿自动返还：${automaticCount} 局`);
            }
            const noted = notifications.filter(
                (notification) =>
                    notification.status === "approved"
                    && typeof notification.adminNote === "string"
                    && notification.adminNote.trim().length > 0,
            );
            for (const notification of noted) {
                const label = notification.mapName || notification.matchId || "返还记录";
                details.push(`后台留言（${label}）：${notification.adminNote!.trim()}`);
            }
            this.errorModal.selector
                .find(".modal-body-text")
                .text(details.join("\n"))
                .css("white-space", "pre-line");
            this.errorModal.show();

            // 先展示，再确认已读；确认失败时只会在下次刷新/回主页重试提示。
            await fetch("/api/extraction/equipment-return/notifications", {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                cache: "no-store",
                body: JSON.stringify({
                    token,
                    ids: notifications.map((notification) => notification.id),
                }),
            });
        } catch {
            // 通知接口不可用不能阻止玩家进入主界面；下次返回时继续尝试。
        }
    }

    setAppActive(active: boolean) {
        this.active = active;
        this.quickPlayPendingModeIdx = -1;
        this.refreshUi();

        // Certain systems, like the account, can throw errors
        // while the user is already in a game.
        // Seeing these errors when returning to the menu would be
        // confusing, so we'll hide the modal instead.
        if (active) {
            this.errorModal.hide();
            this.checkEquipmentReturnNotifications();
            if (this.equipmentReturnNotificationTimer === null) {
                this.equipmentReturnNotificationTimer = window.setInterval(
                    () => this.checkEquipmentReturnNotifications(),
                    10_000,
                );
            }
        } else if (this.equipmentReturnNotificationTimer !== null) {
            window.clearInterval(this.equipmentReturnNotificationTimer);
            this.equipmentReturnNotificationTimer = null;
        }
    }

    setPlayLockout(lock: boolean) {
        let delay = lock ? 0 : 1000;
        if (IS_DEV) {
            delay = 0;
        }
        this.playButtons
            .stop()
            .delay(delay)
            .animate(
                {
                    opacity: lock ? 0.5 : 1,
                },
                IS_DEV ? 0 : 250,
            );
        this.playLoading
            .stop()
            .delay(delay)
            .animate(
                {
                    opacity: lock ? 1 : 0,
                },
                {
                    duration: IS_DEV ? 0 : 250,
                    start: () => {
                        this.playLoading.css({
                            "pointer-events": lock ? "initial" : "none",
                        });
                    },
                },
            );
    }

    onTeamMenuJoinGame(data: FindGameMatchData) {
        this.waitOnAccount(() => {
            this.joinGame(data);
        });
    }

    onTeamMenuLeave(errTxt?: string) {
        if (errTxt && window.history) {
            window.history.replaceState("", "", "/");
        }

        this.errorMessage = errTxt || "";
        this.setDOMFromConfig();
        this.refreshUi();
    }

    // 玩家账号密码登录（主菜单登录面板 + 进局前置检查）。
    initPlayerAccount() {
        (window as unknown as { survivPlayerAccount?: PlayerAccount }).survivPlayerAccount = this.playerAccount;
        const usernameInput = $("#account-username-input");
        const passwordInput = $("#account-password-input");
        const statusEl = $("#account-status");
        const setStatus = (text: string, isError = false) => {
            statusEl.text(text).css("color", isError ? "#ff7c81" : "#7dffa8");
        };
        const applyLoggedInState = () => {
            const loggedIn = this.playerAccount.loggedIn;
            // Team rooms can remain open while the player logs in/out. Refresh
            // the socket identity immediately instead of waiting for reconnect.
            this.teamMenu.syncAccountToken();
            $(".player-account-logged-out").css("display", loggedIn ? "none" : "");
            $(".player-account-logged-in").css("display", loggedIn ? "" : "none");
            $("#account-display-name").text(
                this.playerAccount.displayName || this.playerAccount.username,
            );
            // 登录成功后关闭登录模态框。
            if (loggedIn) {
                this.closeLoginModal();
            }
            if (loggedIn) {
                // 即使登录账号，也能更改游戏内昵称：输入框保持可编辑，
                // 昵称与账号显示名/仓库身份分开保存（仓库身份仍绑定账号）。
                const accountKey = this.playerAccount.username || this.playerAccount.displayName;
                const nickname = loadAccountNickname(accountKey);
                const inGameName = nickname || this.playerAccount.displayName || "";
                this.config.set("playerName", inGameName);
                this.nameInput.val(inGameName);
                this.nameInput.prop("readonly", false);
                this.nameInput.css("display", "");
                $("#player-name-confirm-row").css("display", "");
            } else {
                // 游客仍可游玩所有非搜打撤模式，因此必须保留可编辑昵称。
                // 退出账号时沿用当前对局昵称，不把它清空或隐藏。
                const guestName = String(this.nameInput.val() ?? "").trim()
                    || this.config.get("playerName")
                    || "Player";
                this.config.set("playerName", guestName);
                this.nameInput.val(guestName);
                this.nameInput.prop("readonly", false);
                this.nameInput.css("display", "");
                $("#player-name-confirm-row").css("display", "");
            }
        };
        const doLogin = async (
            registerMode: boolean,
            usernameEl: JQuery<HTMLElement> = usernameInput,
            passwordEl: JQuery<HTMLElement> = passwordInput,
            status: (text: string, isError?: boolean) => void = setStatus,
        ) => {
            const username = String(usernameEl.val() ?? "").trim();
            const password = String(passwordEl.val() ?? "");
            if (!username) {
                status("请输入账号", true);
                return;
            }
            if (!password) {
                status("请输入密码", true);
                return;
            }
            try {
                if (registerMode) {
                    await this.playerAccount.register(username, password);
                    status("注册成功，已自动登录");
                } else {
                    await this.playerAccount.login(username, password);
                    status("登录成功");
                }
                passwordEl.val("");
                applyLoggedInState();
                this.checkEquipmentReturnNotifications();
            } catch (error) {
                status(error instanceof Error ? error.message : "操作失败", true);
            }
        };
        $("#btn-account-login").on("click", () => void doLogin(false));
        $("#btn-account-register").on("click", () => void doLogin(true));
        passwordInput.on("keydown", (event) => {
            if (event.key === "Enter") void doLogin(false);
        });
        // 登录模态框（搜打撤入口 + 服务端拒绝时弹出）。
        const loginModal = $("#modal-account-login");
        const loginModalUsername = $("#login-modal-username");
        const loginModalPassword = $("#login-modal-password");
        const loginModalStatus = $("#login-modal-status");
        const loginModalSetStatus = (text: string, isError = false) => {
            loginModalStatus.text(text).css("color", isError ? "#ff7c81" : "#7dffa8");
        };
        this.openLoginModal = (message?: string) => {
            loginModal.show();
            loginModalSetStatus(
                message ?? "登录后才能游玩搜打撤",
                Boolean(message),
            );
            loginModalUsername.trigger("focus");
        };
        this.closeLoginModal = () => {
            loginModal.hide();
            loginModalPassword.val("");
        };
        $("#btn-login-modal-close").on("click", () => this.closeLoginModal());
        $("#btn-login-modal-login").on(
            "click",
            () => void doLogin(false, loginModalUsername, loginModalPassword, loginModalSetStatus),
        );
        $("#btn-login-modal-register").on(
            "click",
            () => void doLogin(true, loginModalUsername, loginModalPassword, loginModalSetStatus),
        );
        loginModalPassword.on("keydown", (event) => {
            if (event.key === "Enter") {
                void doLogin(false, loginModalUsername, loginModalPassword, loginModalSetStatus);
            }
        });
        // 点击遮罩关闭。
        loginModal.on("click", (event) => {
            if (event.target === loginModal[0]) this.closeLoginModal();
        });
        $("#btn-account-logout").on("click", async () => {
            await this.playerAccount.logout();
            applyLoggedInState();
            setStatus("已退出登录");
        });
        // 修改密码（登录后可见；默认初始密码 1234，玩家可自行更改）。
        const changePasswordPanel = $("#account-change-password-panel");
        const currentPwInput = $("#account-current-password-input");
        const nextPwInput = $("#account-next-password-input");
        const changePwStatus = $("#account-change-password-status");
        const setChangePwStatus = (text: string, isError = false) => {
            changePwStatus.text(text).css("color", isError ? "#ff7c81" : "#7dffa8");
        };
        const closeChangePassword = () => {
            changePasswordPanel.css("display", "none");
            currentPwInput.val("");
            nextPwInput.val("");
            setChangePwStatus("");
        };
        $("#btn-account-change-password").on("click", () => {
            changePasswordPanel.css("display", "");
            currentPwInput.trigger("focus");
        });
        $("#btn-account-change-password-cancel").on("click", closeChangePassword);
        $("#btn-account-change-password-confirm").on("click", async () => {
            const current = String(currentPwInput.val() ?? "");
            const next = String(nextPwInput.val() ?? "");
            if (!current || !next) {
                setChangePwStatus("请填写当前密码和新密码", true);
                return;
            }
            if (next.length < 4) {
                setChangePwStatus("新密码至少 4 个字符", true);
                return;
            }
            try {
                await this.playerAccount.changePassword(current, next);
                setChangePwStatus("密码已修改");
                currentPwInput.val("");
                nextPwInput.val("");
            } catch (error) {
                setChangePwStatus(error instanceof Error ? error.message : "修改失败", true);
            }
        });
        nextPwInput.on("keydown", (event) => {
            if (event.key === "Enter") {
                $("#btn-account-change-password-confirm").trigger("click");
            }
        });
        void this.playerAccount.restoreSession().then(() => {
            applyLoggedInState();
            this.checkEquipmentReturnNotifications();
        });
        applyLoggedInState();
    }

    /** 只有会读写持久仓库的搜打撤播放列表需要账号。 */
    private modeRequiresLogin(gameModeIdx: number): boolean {
        const mapName = this.siteInfo.info?.modes?.[gameModeIdx]?.mapName;
        return mapName === "extraction" || mapName === "extraction_secret";
    }

    /** 普通模式允许游客；搜打撤在进入匹配/队伍时提示登录。 */
    private requireLoginForMode(gameModeIdx: number): boolean {
        if (!this.modeRequiresLogin(gameModeIdx) || this.playerAccount.loggedIn) {
            return true;
        }
        this.openLoginModal("游玩搜打撤需要登录");
        this.refreshUi();
        return false;
    }

    /** 打开登录模态框（搜打撤需要登录时弹出）。 */
    openLoginModal: (message?: string) => void = () => {};

    /** 关闭登录模态框。 */
    closeLoginModal: () => void = () => {};

    /** 显示并高亮登录面板，滚动到视野内（小屏菜单截断时也能找到入口）。 */
    private revealLoginPanel(): void {
        $(".player-account-logged-out").css("display", "");
        const panelRoot = $("#player-account-panel");
        panelRoot.css("display", "flex");
        panelRoot
            .stop(true)
            .css("box-shadow", "0 0 0 3px rgba(110, 197, 190, 0.9)")
            .animate({ "box-shadow": "0 0 0 3px rgba(110, 197, 190, 0)" }, 900)
            .delay(300)
            .animate({ "box-shadow": "0 0 0 3px rgba(110, 197, 190, 0.9)" }, 500)
            .animate({ "box-shadow": "0 0 0 3px rgba(110, 197, 190, 0)" }, 900);
        try {
            panelRoot[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
            // ignore
        }
    }

    /** 绝密搜打撤与普通搜打撤同时运行：绝密入口是否显示由 siteInfo.modes
     *  中 extraction_secret 播放列表的启用状态决定。 */
    private syncExtractionSecretEntry(): void {
        const secret = Boolean(
            this.siteInfo?.info?.extractionSecret?.enabled
                || (this.siteInfo?.info?.modes ?? []).some(
                    (mode) => mode.mapName === "extraction_secret" && mode.enabled,
                ),
        );
        (window as unknown as { survivExtractionSecret?: boolean }).survivExtractionSecret = secret;
    }

    private async loadSecretEligible(): Promise<
        Array<{
            id: string;
            name: string;
            categoryName: string;
            image: string;
            tier?: string | null;
        }>
    > {
        if (this.secretEligibleCache) return this.secretEligibleCache;
        try {
            const response = await fetch("/api/extraction/secret/eligible");
            const data = (await response.json()) as {
                weapons?: Array<{
                    id: string;
                    name: string;
                    categoryName: string;
                    image: string;
                    tier?: string | null;
                }>;
            };
            this.secretEligibleCache = data.weapons ?? [];
        } catch {
            this.secretEligibleCache = [];
        }
        return this.secretEligibleCache;
    }

    /** 绝密模式：当前配装是否包含合格武器（A/S/S+ 且非单持手枪）。 */
    private async checkExtractionSecretEligible(): Promise<boolean> {
        const eligible = await this.loadSecretEligible();
        if (eligible.length === 0) return true; // 目录拉取失败不拦截
        const token = this.playerAccount.token || "";
        if (!token) return false; // 未登录没有仓库/配装
        try {
            const response = await fetch(
                `/api/extraction/stash?token=${encodeURIComponent(token)}`,
            );
            const data = (await response.json()) as {
                loadout?: { guns?: string[] };
                items?: { guns?: Record<string, number> };
            };
            const guns = data?.loadout?.guns ?? [];
            const owned = data?.items?.guns ?? {};
            const eligibleIds = new Set(eligible.map((weapon) => weapon.id));
            return guns.some((gun) => {
                if (!eligibleIds.has(gun)) return false;
                // “幽灵武器”：配装里引用了但仓库实际没有的枪，不能算合格，
                // 否则会直接空手进绝密。双枪形态需要 2 把基准枪。
                const dual = gun.endsWith("_dual");
                const base = dual ? gun.slice(0, -5) : gun;
                return Number(owned[base] ?? 0) >= (dual ? 2 : 1);
            });
        } catch {
            return true; // 配装拉取失败不拦截
        }
    }

    /** 展示绝密模式进入规则（合格武器按类型分类，图片 + 名称）。 */
    private showExtractionSecretRule(): void {
        const container = $("#extraction-secret-rule-weapons");
        container.empty();
        const weapons = this.secretEligibleCache ?? [];
        const groups = new Map<
            string,
            Array<{ id: string; name: string; image: string; tier?: string | null }>
        >();
        for (const weapon of weapons) {
            const list = groups.get(weapon.categoryName) ?? [];
            list.push(weapon);
            groups.set(weapon.categoryName, list);
        }
        for (const [category, list] of groups) {
            const group = $("<div class='extraction-secret-rule-group'></div>");
            group.append(
                `<div class='extraction-secret-rule-group-title'>${category}</div>`,
            );
            const grid = $("<div class='extraction-secret-rule-grid'></div>");
            for (const weapon of list) {
                grid.append(
                    `<div class='extraction-secret-rule-weapon' title='${weapon.name}'>`
                        + `<img src='${weapon.image}' alt='' draggable='false' />`
                        + `<span>${weapon.name}</span>`
                        + (weapon.tier ? `<em>${weapon.tier}</em>` : "")
                        + `</div>`,
                );
            }
            group.append(grid);
            container.append(group);
        }
        // 用 MenuModal 显示：右下/右上关闭按钮与点击遮罩都能关闭。
        this.secretRuleModal.show();
    }

    // Config
    setConfigFromDOM() {
        const inputName = helpers.sanitizeNameInput(this.nameInput.val() as string);
        const playerName = inputName
            || (this.playerAccount.loggedIn ? this.playerAccount.displayName : "");
        this.config.set("playerName", playerName);
        const region = this.serverSelect.find(":selected").val();
        this.config.set("region", region as string);
    }

    setDOMFromConfig() {
        if (SDK.isAnySDK && !this.config.get("playerName")) {
            SDK.getPlayerName().then((username) => {
                if (!username) return;
                this.config.set("playerName", username);
                this.nameInput.val(username);
            });
        }

        this.nameInput.val(this.config.get("playerName")!);
        // 单服部署：配置里存的旧区域（如 "na"）在选项里不存在时回退到本服唯一区域 "local"，
        // 避免 find_game 因 region 不匹配而报 "Failed finding game"。
        let regionMatched = false;
        this.serverSelect.find("option").each((_i, ele) => {
            const spellSyncLang = SDK.isSpellSync && window.spellSync.language;
            const configRegion = this.config.get("region");
            ele.selected = spellSyncLang
                ? ele.value === spellSyncLang
                : ele.value === configRegion;
            if (ele.selected) regionMatched = true;
        });
        if (!regionMatched) {
            const local = this.serverSelect.find("option[value=\"local\"]");
            if (local.length > 0) {
                local.prop("selected", true);
            }
        }
        this.languageSelect.val(this.localization.getLocale());
    }

    onConfigModified(key?: string) {
        const muteAudio = this.config.get("muteAudio")!;
        if (muteAudio != this.audioManager.mute) {
            this.muteBtns.removeClass(muteAudio ? "audio-on-icon" : "audio-off-icon");
            this.muteBtns.addClass(muteAudio ? "audio-off-icon" : "audio-on-icon");
            this.audioManager.setMute(muteAudio);
        }

        const masterVolume = this.config.get("masterVolume")!;
        this.masterSliders.val(masterVolume * 100);
        this.audioManager.setMasterVolume(masterVolume);

        const soundVolume = this.config.get("soundVolume")!;
        this.soundSliders.val(soundVolume * 100);
        this.audioManager.setSoundVolume(soundVolume);

        const musicVolume = this.config.get("musicVolume")!;
        this.musicSliders.val(musicVolume * 100);
        this.audioManager.setMusicVolume(musicVolume);

        if (key == "language") {
            const language = this.config.get("language")!;
            this.localization.setLocale(language);
            this.updateLogoBasedOnLanguage(language);
        }

        if (key == "region") {
            this.config.set("regionSelected", true);
            this.startPingTest();
        }

        if (key == "highResTex") {
            location.reload();
        }

        if (key === "debugHUD") {
            this.game?.debugHUD?.onConfigModified();
        }
    }

    refreshUi() {
        this.startMenuWrapper.css("display", this.active ? "flex" : "none");
        this.gameAreaWrapper.css({
            display: this.active ? "none" : "block",
            opacity: this.active ? 0 : 1,
        });
        if (this.active) {
            $("body").removeClass("user-select-none");
            document.removeEventListener("contextmenu", this.contextListener);
        } else {
            $("body").addClass("user-select-none");
            $("#start-main").stop(true);
            document.addEventListener("contextmenu", this.contextListener);
        }

        // Hide the left section if on mobile, oriented portrait, and viewing create team
        $("#left-column").css(
            "display",
            !device.isLandscape && this.teamMenu.active ? "none" : "block",
        );

        // Warning
        const hasError = this.active && this.errorMessage != "";
        this.serverWarning.css({
            display: "block",
            opacity: hasError ? 1 : 0,
        });
        this.serverWarning.html(this.errorMessage);

        const updateButton = (ele: JQuery<HTMLElement>, gameModeIdx: number) => {
            const storedLabel = ele.data("label");
            const localizationKey = ele.data("l10n");
            const label = (
                typeof storedLabel === "string" && storedLabel
            ) || (
                typeof localizationKey === "string"
                    ? this.localization.translate(localizationKey)
                    : ""
            ) || ele.text();
            // Cache the visible fallback before replacing it with a spinner so
            // custom quick-play buttons without localization metadata can be
            // restored on the next refresh.
            if (label) ele.data("label", label);
            ele.html(
                this.quickPlayPendingModeIdx === gameModeIdx
                    ? "<div class=\"ui-spinner\"></div>"
                    : label,
            );
        };

        $(".quick-play-mode-button").each((_index, element) => {
            const button = $(element);
            const gameModeIdx = Number(button.data("game-mode-index"));
            if (Number.isInteger(gameModeIdx)) updateButton(button, gameModeIdx);
        });
    }

    waitOnAccount(cb: () => void) {
        if (this.account.requestsInFlight == 0) {
            cb();
        } else {
            // Wait some maximum amount of time for pending account requests
            const timeout = setTimeout(() => {
                runOnce();
                errorLogManager.storeGeneric("account", "wait_timeout");
            }, 2500);
            const runOnce = () => {
                cb();
                clearTimeout(timeout);
                this.account.removeEventListener("requestsComplete", runOnce);
            };
            this.account.addEventListener("requestsComplete", runOnce);
        }
    }

    private tryJoinAdminSpectator(): boolean {
        const params = new URLSearchParams(window.location.search);
        if (params.get("adminSpectate") !== "1") return false;
        const gameId = params.get("gameId");
        const token = params.get("token");
        if (!gameId || !token) return false;

        const parseArray = (name: string): string[] => {
            try {
                const value = JSON.parse(params.get(name) ?? "[]");
                return Array.isArray(value)
                    ? value.filter((item): item is string => typeof item === "string")
                    : [];
            } catch {
                return [];
            }
        };
        const hosts = parseArray("hosts");
        const addrs = parseArray("addrs");
        const matchData: MatchData = {
            zone: "",
            gameId,
            data: token,
            useHttps: params.get("useHttps") === "1",
            hosts: hosts.length ? hosts : addrs,
            addrs: addrs.length ? addrs : hosts,
        };
        const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, document.title, cleanUrl);
        this.setConfigFromDOM();
        // Keep the administrative observer distinct from the account/player
        // name shown in the room logs and scoreboard.
        this.config.set("playerName", "Admin Spectator");
        this.game!.privateDuelMatch = false;
        this.waitOnAccount(() => this.joinGame(matchData));
        return true;
    }

    /** 从 URL 读取持久化的对局凭据，用于刷新/换 IP 后重连。 */
    private readPersistedMatch(): FindGameMatchData | MatchData | null {
        const params = new URLSearchParams(window.location.search);
        const gameId = params.get("gameId");
        const token = params.get("token");
        if (!token) return null;
        if (params.get("adminSpectate") === "1") return null;
        const parseArray = (name: string): string[] => {
            try {
                const value = JSON.parse(params.get(name) ?? "[]");
                return Array.isArray(value)
                    ? value.filter((item): item is string => typeof item === "string")
                    : [];
            } catch {
                return [];
            }
        };
        const urls = parseArray("urls");
        // 新版匹配直接返回可连接的 WebSocket URL，不再拆成
        // hosts/gameId。优先恢复这个格式，才能覆盖当前的普通、组队
        // 与自定义模式；下方仍保留旧版链接兼容。
        if (urls.length > 0) {
            return { urls, joinToken: token };
        }
        if (!gameId) return null;
        let hosts = parseArray("hosts");
        let addrs = parseArray("addrs");
        // 缺少主机信息时用当前页面 host 直连（网址对应的就是服务器）。
        if (hosts.length === 0 && addrs.length === 0 && window.location.host) {
            hosts = [window.location.host];
            addrs = [window.location.host];
        }
        return {
            zone: "",
            gameId,
            data: token,
            useHttps: params.get("useHttps") === "1",
            hosts,
            addrs,
        };
    }

    /**
     * 启动时检测持久化对局 URL：带 gameId + token 直接加入原对局
     * （不重新匹配），从而支持"刷新页面 / 换网络后输入当前网址重连入局"。
     */
    private tryJoinPersistedMatch(): boolean {
        const matchData = this.readPersistedMatch();
        if (!matchData) return false;
        this.setConfigFromDOM();
        this.waitOnAccount(() => this.joinGame(matchData));
        return true;
    }

    /** 进入对局后把对局凭据写进 URL，使刷新/换 IP 后仍可重连。 */
    private persistMatchUrl(matchData: FindGameMatchData | MatchData): void {
        try {
            const params = new URLSearchParams(window.location.search);
            if ("urls" in matchData) {
                const urls = matchData.urls
                    .map((url) => resolveAdvertisedUrl(url, window.location.hostname));
                params.set("token", matchData.joinToken);
                params.set("urls", JSON.stringify(urls));
                params.delete("hosts");
                params.delete("addrs");
                params.delete("useHttps");

                // gameId 保留为可读调试信息；恢复新版对局实际以 urls
                // 为准，因此经反向代理时即使拿不到 gameId 也不影响重连。
                let gameId = "";
                for (const url of urls) {
                    try {
                        gameId = new URL(url, window.location.href).searchParams.get("gameId") ?? "";
                    } catch {
                        // 尝试下一个公告地址。
                    }
                    if (gameId) break;
                }
                if (gameId) params.set("gameId", gameId);
                else params.delete("gameId");
            } else {
                params.set("gameId", String(matchData.gameId));
                params.set("token", matchData.data);
                params.set("useHttps", matchData.useHttps ? "1" : "0");
                params.set("hosts", JSON.stringify(matchData.hosts || []));
                params.set("addrs", JSON.stringify(matchData.addrs || []));
                params.delete("urls");
            }
            window.history.replaceState(
                {},
                document.title,
                `${window.location.pathname}?${params.toString()}`,
            );
        } catch {
            // 忽略 URL 写入失败（不阻塞进局）。
        }
    }

    /** 对局结束/退出时清除 URL 中的对局标识，避免旧链接重复加入。 */
    private clearMatchUrl(): void {
        const params = new URLSearchParams(window.location.search);
        let changed = false;
        for (const key of ["gameId", "token", "urls", "hosts", "addrs", "useHttps"]) {
            if (params.has(key)) {
                params.delete(key);
                changed = true;
            }
        }
        if (!changed) return;
        const query = params.toString();
        window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}${query ? `?${query}` : ""}`,
        );
    }

    async tryJoinTeam(create: boolean, url?: string): Promise<void> {
        const selectedModeIdx = this.config.get("gameModeIdx")!;

        // 创建搜打撤队伍前不能只相信 localStorage 里“有 token”。
        // /team_v2 会用服务端账号表做权威校验；如果本地 token 已过期，旧逻辑
        // 会先显示已登录，随后创建队伍又收到 login_required。这里先用同源
        // /api/account/profile 实时确认，再打开 WebSocket，消除两套登录状态不一致。
        if (create && this.modeRequiresLogin(selectedModeIdx)) {
            if (!this.playerAccount.token) {
                this.requireLoginForMode(selectedModeIdx);
                return;
            }

            const tokenBeforeValidation = this.playerAccount.token;
            const sessionValid = await this.playerAccount.validateSession();
            if (!sessionValid) {
                if (this.playerAccount.token === tokenBeforeValidation) {
                    // 网络暂时不可用时 validateSession 会保留 token；不要把玩家
                    // 错误标成“未登录”，也不要继续创建一个必然可能被拒绝的房间。
                    this.errorMessage = "登录状态验证失败，请重试";
                } else {
                    this.openLoginModal("登录状态已失效，请重新登录");
                    this.errorMessage = "";
                }
                this.refreshUi();
                return;
            }
            // 若登录发生在一个已打开的普通队伍期间，也立即同步最新 token。
            this.teamMenu.syncAccountToken();
        } else if (create && !this.requireLoginForMode(selectedModeIdx)) {
            return;
        }

        // 加入邀请时连接前还不知道房间模式；收到服务端 state 后再由 TeamMenu
        // 判定，保证普通邀请链接对游客仍然可用。
        if (this.active && this.quickPlayPendingModeIdx === -1) {
            // Join team if the url contains a team address
            let roomUrl = url || window.location.hash.slice(1);

            const sdkRoom = SDK.getRoomInviteParam();
            if (sdkRoom) {
                roomUrl = sdkRoom;
                create = false;
            }

            if (create || roomUrl != "") {
                // The main menu and squad menus have separate
                // DOM elements for input, such as player name and
                // selected region. We will stash the menu values
                // into the config so the team menu can read them.
                this.setConfigFromDOM();
                this.teamMenu.connect(create, roomUrl);
                this.refreshUi();
            }
        }
    }

    tryQuickStartGame(gameModeIdx: number, allowUnlistedMode = false) {
        if (
            this.quickPlayPendingModeIdx === -1
            && this.requireLoginForMode(gameModeIdx)
        ) {
            if (this.game) this.game.privateDuelMatch = false;
            // Update UI to display a spinner on the play button
            this.errorMessage = "";
            this.quickPlayPendingModeIdx = gameModeIdx;
            this.setConfigFromDOM();
            this.refreshUi();

            // Wait some amount of time if we've recently attempted to
            // find a game to prevent spamming the server
            let delay = 0;
            if (!allowUnlistedMode) {
                if (this.findGameAttempts > 0 && Date.now() - this.findGameTime < 30000) {
                    delay = Math.min(this.findGameAttempts * 2.5 * 1000, 7500);
                } else {
                    this.findGameAttempts = 0;
                }
                this.findGameTime = Date.now();
                this.findGameAttempts++;
            }

            // the delay is annoying on dev
            if (IS_DEV) {
                delay = 0;
            }

            const version = GameConfig.protocolVersion;
            let region = this.config.get("region")!;
            const paramRegion = helpers.getParameterByName("region");
            if (paramRegion !== undefined && paramRegion.length > 0) {
                region = paramRegion;
            }
            let zones = this.pingTest.getZones(region);
            const paramZone = helpers.getParameterByName("zone");
            if (paramZone !== undefined && paramZone.length > 0) {
                zones = [paramZone];
            }

            const matchArgs: FindGameBody & {
                accountToken?: string;
                zombieDifficulty?: "simple" | "normal" | "hard";
            } = {
                version,
                region,
                zones,
                playerCount: 1,
                autoFill: true,
                gameModeIdx,
                allowUnlistedMode: allowUnlistedMode || undefined,
                accountToken: this.playerAccount.token || undefined,
                zombieDifficulty: (() => {
                    const value = (window as unknown as {
                        survivZombieDifficulty?: string;
                    }).survivZombieDifficulty;
                    return value === "simple" || value === "hard" ? value : "normal";
                })(),
            };

            const tryQuickStartGameImpl = () => {
                this.waitOnAccount(() => {
                    this.findGame(matchArgs, {
                        error: (err) => {
                            this.onJoinGameError(err);
                        },
                        success: (data) => {
                            this.joinGame(data);
                        },
                        ban: (ban) => {
                            this.showIpBanModal(ban);
                        },
                    });
                });
            };

            if (delay == 0) {
                // We can improve findGame responsiveness by ~30 ms by skipping
                // the 0ms setTimeout
                tryQuickStartGameImpl();
            } else {
                setTimeout(() => {
                    tryQuickStartGameImpl();
                }, delay);
            }
        }
    }

    findGame(
        matchArgs: FindGameBody,
        cbs: {
            error: (err: FindGameError) => void;
            success: (matchData: FindGameMatchData) => void;
            ban: (data: FindGameResponse & { type: "banned" }) => void;
        },
    ) {
        const findGameImpl = (iter: number, maxAttempts: number, token: string) => {
            if (iter >= maxAttempts) {
                cbs.error("full");
                return;
            }
            const retry = (delay = 650) => {
                setTimeout(() => {
                    helpers.verifyTurnstile(
                        this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
                        (token) => {
                            findGameImpl(iter + 1, maxAttempts, token);
                        },
                    );
                }, delay);
            };
            matchArgs.turnstileToken = token;

            fetch(api.resolveUrl("/api/find_game_v2"), {
                method: "POST",
                body: JSON.stringify(matchArgs),
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                },
                credentials: proxy.anyLoginSupported() ? "include" : "omit",
                signal: helpers.abortSignal(10 * 1000),
            }).then((res) => {
                if (res.status === 429) {
                    retry(3200);
                    return null;
                }
                return res.json() as Promise<FindGameResponse>;
            }).then((data) => {
                if (!data) return;
                if (data.type === "error") {
                    cbs.error(data.error);
                } else if (data.type === "banned") {
                    cbs.ban(data);
                } else if (data.type === "success") {
                    cbs.success(data.res);
                }
            }).catch(() => {
                retry(900);
            });
        };

        helpers.verifyTurnstile(
            this.siteInfo.info.captchaEnabled && !this.account.loggedIn,
            (token) => {
                findGameImpl(0, 4, token);
            },
        );
    }

    joinGame(matchData: FindGameMatchData | MatchData) {
        if (!this.game) {
            setTimeout(() => {
                this.joinGame(matchData);
            }, 250);
            return;
        }
        const isLegacyMatch = "hosts" in matchData;
        const urls = isLegacyMatch
            ? [] as string[]
            : matchData.urls.map((url) => resolveAdvertisedUrl(url, window.location.hostname));
        const joinToken = isLegacyMatch ? matchData.data : matchData.joinToken;
        this.game.m_matchId = isLegacyMatch
            ? String(matchData.gameId)
            : (() => {
                for (const rawUrl of urls) {
                    try {
                        const id = new URL(rawUrl, window.location.href).searchParams.get("gameId");
                        if (id) return id;
                    } catch {
                        // 尝试下一个公告地址。
                    }
                }
                return "";
            })();
        this.persistMatchUrl(matchData);
        if (isLegacyMatch) {
            for (const host of matchData.hosts || matchData.addrs || []) {
                const address = resolveAdvertisedAddress(host, window.location.hostname);
                urls.push(
                    `ws${matchData.useHttps ? "s" : ""}://${address}/play?gameId=${matchData.gameId}`,
                );
            }
        }

        const joinGameImpl = (remainingUrls: string[]) => {
            const url = remainingUrls.shift();
            if (!url) {
                this.onJoinGameError("join_game_failed");
                return;
            }
            const onFailure = function() {
                joinGameImpl(remainingUrls);
            };
            // 记录连接参数：网络波动时由 game 内部保留画面自动重连。
            this.game!.enableAutoReconnect(
                url,
                joinToken,
                this.playerAccount.loadoutPriv,
                "",
            );
            this.game!.tryJoinGame(
                url,
                joinToken,
                this.playerAccount.loadoutPriv,
                "",
                onFailure,
            );
        };
        joinGameImpl(urls);
    }

    tryJoinGameFromParam() {
        const params = new URLSearchParams(window.location.search);
        if (params.has("u") && params.has("jt")) {
            try {
                const urls = atob(params.get("u")!).split(",");
                const joinToken = params.get("jt")!;

                this!.joinGame({ urls, joinToken });
            } catch (e) {
                console.error("Failed to parse join data:", e);
                this.onJoinGameError("join_game_failed");
            }

            params.delete("u");
            params.delete("jt");
            window.history.pushState(
                "",
                "",
                params.size ? `${window.location.pathname}?${params.toString()}` : window.location.pathname,
            );
        }
    }

    getErrorString(
        err: FindGameError | GameWsDisconnectReason | "updating" | "login_required",
        fallback: "host_closed" | "full",
    ) {
        const errMap: Partial<Record<string, string>> = {
            banned: this.localization.translate("index-ip-banned"),
            behind_proxy: this.localization.translate("index-behind-proxy"),
            find_game_failed: this.localization.translate("index-failed-finding-game"),
            full: this.localization.translate("index-failed-finding-game"),
            host_closed: this.localization.translate("index-host-closed"),
            invalid_captcha: this.localization.translate("index-invalid-captcha"),
            invalid_packet: this.localization.translate("index-invalid-packet"),
            invalid_protocol: this.localization.translate("index-invalid-protocol"),
            invalid_token: this.localization.translate("index-invalid-token"),
            ip_banned: this.localization.translate("index-ip-banned"),
            join_game_failed: this.localization.translate("index-failed-joining-game"),
            player_not_found: this.localization.translate("index-player-not-found"),
            rate_limited: this.localization.translate("index-rate-limited"),
            server_crashed: this.localization.translate("index-server-crashed"),
            server_restart: this.localization.translate("index-server-restart"),
            updating: "服务器更新中，请稍后再试",
            login_required: "需要登录才能游玩搜打撤",
        };
        return errMap[err] || errMap[fallback]!;
    }

    onJoinGameError(err: FindGameError | "updating" | "login_required") {
        if (err == "invalid_protocol") {
            this.showInvalidProtocolModal();
        }
        // Forcefully set captcha to enabled if we fail the captcha
        // This can happen if it was disabled when the page loaded which would meant it was sending an empty token
        // And we only fetch the state when the page loads...
        if (err === "invalid_captcha") {
            this.siteInfo.info.captchaEnabled = true;
        }
        if (err == "behind_proxy" || err == "banned") {
            this.showErrorModal(err);
        }

        this.errorMessage = this.getErrorString(err, "full");
        // 服务端拒绝登录（如邀请链接直接进搜打撤房）：弹出登录模态框。
        if (err == "login_required") {
            this.openLoginModal("游玩搜打撤需要登录");
        }
        this.quickPlayPendingModeIdx = -1;
        // 加入失败（房间已关/已阵亡/token 失效）：清除对局 URL，避免旧链接反复重试。
        this.reconnectAttempts = 0;
        this.clearMatchUrl();
        if (this.duelLobby?.isInMatch()) this.duelLobby.returnAfterMatch();
        this.teamMenu.leave("join_game_failed");
        this.refreshUi();
    }

    /** Keep the client bullet/projectile slow-motion ratio in sync with the
     * server's admin-tunable sandevistan worldTimeScale. */
    private syncSandevistanScale(): void {
        const scale = (
            this.siteInfo?.info as
                | (typeof this.siteInfo.info & {
                    sandevistan?: { worldTimeScale?: number };
                })
                | undefined
        )?.sandevistan?.worldTimeScale;
        if (this.game && typeof scale === "number" && Number.isFinite(scale)) {
            this.game.setSandevistanWorldTimeScale(scale);
        }
    }

    showInvalidProtocolModal() {
        this.refreshModal.show(true);
    }

    showIpBanModal(ban: FindGameResponse & { type: "banned" }) {
        $("#modal-ip-banned-reason").text(`Reason: ${ban.reason}`);

        let expiration = "Duration: indefinite";
        if (!ban.permanent) {
            const expiresIn = new Date(ban.expiresIn);
            const timeLeft = expiresIn.getTime() - Date.now();

            const daysLeft = Math.round(timeLeft / (1000 * 60 * 60 * 24));
            const hoursLeft = Math.round(timeLeft / (1000 * 60 * 60));

            if (daysLeft > 1) {
                expiration = `Expires in: ${daysLeft} days`;
            } else if (hoursLeft > 1) {
                expiration = `Expires in: ${hoursLeft} hours`;
            } else {
                expiration = `Expires in: less than an hour`;
            }
        }

        $("#modal-ip-banned-expiration").text(expiration);

        this.ipBanModal.show(true);

        this.quickPlayPendingModeIdx = -1;
        this.teamMenu.leave("banned");
        this.refreshUi();
    }

    showErrorModal(err: FindGameError | GameWsDisconnectReason) {
        const text = this.getErrorString(err, "full");
        if (text) {
            this.errorModal.selector.find(".modal-body-text").html(text);
            this.errorModal.show();
        }
    }

    update() {
        const dt = math.clamp(this.pixi!.ticker.elapsedMS / 1000, 0.001, 1 / 8);
        this.pingTest.update(dt);
        if (!this.checkedPingTest && this.pingTest.isComplete()) {
            if (!this.config.get("regionSelected")) {
                const region = this.pingTest.getRegion();

                if (region) {
                    this.config.set("region", region);
                    this.setDOMFromConfig();
                }
            }
            this.checkedPingTest = true;
        }
        this.resourceManager!.update(dt);
        this.audioManager.update(dt);
        this.ambience.update(dt, this.audioManager, !this.active);

        // Game update
        if (this.game?.initialized && this.game.m_playing) {
            if (this.active) {
                this.setAppActive(false);
                this.setPlayLockout(true);
            }
            this.game.update(dt);
        }

        // LoadoutDisplay update
        if (this.active && this.loadoutDisplay && this.game && !this.game.initialized) {
            if (this.loadoutMenu.active) {
                if (!this.loadoutDisplay.initialized) {
                    this.loadoutDisplay.init();
                }
                this.loadoutDisplay.show();
                this.loadoutDisplay.update(dt, this.hasFocus);
            } else {
                this.loadoutDisplay.hide();
            }
        }
        if (!this.active && this.loadoutMenu.active) {
            this.loadoutMenu.hide();
        }
        if (this.active) {
            this.pass?.update(dt);
        }
        this.input!.flush();
    }
}

const App = new Application();

function onPageLoad() {
    App.domContentLoaded = true;
    App.tryLoad();
}

document.addEventListener("DOMContentLoaded", onPageLoad);
window.addEventListener("load", onPageLoad);
window.addEventListener("unload", (_e) => {
    App.onUnload();
});
if (window.location.hash == "#_=_") {
    window.location.hash = "";
    history.pushState("", document.title, window.location.pathname);
}
window.addEventListener("resize", () => {
    App.onResize();
});
window.addEventListener("orientationchange", () => {
    App.onResize();
});
window.addEventListener("hashchange", () => {
    void App.tryJoinTeam(false);
});
window.addEventListener("beforeunload", (e) => {
    if (App.game?.warnPageReload()) {
        // In new browsers, dialogText is overridden by a generic string
        const dialogText = "Do you want to reload the game?";
        e.returnValue = dialogText;
        return dialogText;
    }
});
window.addEventListener("focus", () => {
    App.hasFocus = true;
});
window.addEventListener("blur", () => {
    App.hasFocus = false;
});

const reportedErrors: string[] = [];
window.onerror = function(msg, url, lineNo, columnNo, error) {
    msg = msg || "undefined_error_msg";
    const stacktrace = error ? error.stack : "";

    // don't report useless errors lol
    if (!url || lineNo === undefined || columnNo === undefined) return;

    // ignore errors not generated by our code
    // and also weird errors that don't have a .js file
    if (!url.startsWith(location.href) || !/.js|.ts/.test(url)) return;

    // ignore scrappers
    if (/googlebot|bingbot|yandexbot|mediapartners-google/gi.test(navigator.userAgent)) return;

    const errObj = {
        msg,
        id: App.sessionId,
        url,
        line: lineNo,
        column: columnNo,
        stacktrace,
        browser: navigator.userAgent,
        protocol: GameConfig.protocolVersion,
        clientGitVersion: GIT_VERSION,
        serverGitVersion: App.siteInfo.info.gitRevision,
    };
    const errStr = JSON.stringify(errObj);

    // Don't report the same error multiple times
    if (!reportedErrors.includes(errStr)) {
        reportedErrors.push(errStr);
        errorLogManager.logWindowOnError(errObj);
    }
};
