import $ from "jquery";
import * as PIXI from "pixi.js-legacy";
import { AchievementDefs, isAchievementId } from "../../shared/defs/achievementDefs.ts";
import {
    EXTRACTION_HOLD_SECONDS,
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
    EXTRACTION_SECRET_OPEN_SECONDS,
    EXTRACTION_TIME_WARNING_SECONDS,
    EXTRACTION_ZONE_RADIUS,
    farthestExtractionPoint,
    generateExtractionPoints,
    insideExtractionZone,
} from "../../shared/defs/extractionDefs.ts";
import { ZOMBIE_MISSION_ELEMENT_NAMES, ZOMBIE_RUSH_RANGE, ZOMBIE_WIN_TIME_SEC } from "../../shared/defs/zombieDefs.ts";
import { GameConfig, Input, TeamMode, WeaponSlot } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { math } from "../../shared/utils/math.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { getZombieMissionInteractionTarget } from "../../shared/zombieMissionInteraction.ts";
import type { Ambiance } from "./ambiance.ts";
import type { AudioManager } from "./audioManager.ts";
import { Camera } from "./camera.ts";
import type { ConfigManager, DebugRenderOpts } from "./config.ts";
import { DebugHUD } from "./debug/debugHUD.ts";
import { debugLines } from "./debug/debugLines.ts";

/* STRIP_FROM_PROD_CLIENT:START */
import { Editor } from "./debug/editor.ts";
/* STRIP_FROM_PROD_CLIENT:END */

import { GameObjectDefs } from "../../shared/defs/register.ts";
import { SpectateAction } from "../../shared/net/spectateMsg.ts";
import type { GameWsDisconnectReason } from "../../shared/types/api.ts";
import { device } from "./device.ts";
import { EmoteBarn } from "./emote.ts";
import { errorLogManager } from "./errorLogs.ts";
import { extractionMarkerState } from "./extractionMarker.ts";
import { Gas } from "./gas.ts";
import { helpers } from "./helpers.ts";
import { type InputHandler, Key, MouseButton, MouseWheel } from "./input.ts";
import type { InputBinds, InputBindUi } from "./inputBinds.ts";
import type { SoundHandle } from "./lib/createJS.ts";
import { Map } from "./map.ts";
import { AirdropBarn } from "./objects/airdrop.ts";
import { BulletBarn, createBullet } from "./objects/bullet.ts";
import { DeadBodyBarn } from "./objects/deadBody.ts";
import { DecalBarn } from "./objects/decal.ts";
import { ExplosionBarn } from "./objects/explosion.ts";
import { FlareBarn } from "./objects/flare.ts";
import { LootBarn } from "./objects/loot.ts";
import { Creator } from "./objects/objectPool.ts";
import { ParticleBarn } from "./objects/particles.ts";
import { PlaneBarn } from "./objects/plane.ts";
import { type Player, PlayerBarn } from "./objects/player.ts";
import { ProjectileBarn } from "./objects/projectile.ts";
import { SandevistanFx } from "./objects/sandevistanFx.ts";
import { SandevistanPostFilter } from "./objects/sandevistanPostFilter.ts";
import { ShotBarn } from "./objects/shot.ts";
import { SmokeBarn } from "./objects/smoke.ts";
import { Renderer } from "./renderer.ts";
import type { ResourceManager } from "./resources.ts";
import { SDK } from "./sdk/sdk.ts";
import type { Localization } from "./ui/localization.ts";
import { Touch } from "./ui/touch.ts";
import { UiManager } from "./ui/ui.ts";
import { UiManager2 } from "./ui/ui2.ts";

export interface Ctx {
    audioManager: AudioManager;
    renderer: Renderer;
    particleBarn: ParticleBarn;
    map: Map;
    smokeBarn: SmokeBarn;
    decalBarn: DecalBarn;
}

const ZOMBIE_MISSION_ELEMENT_ICON_PATHS = [
    "/img/zombie-mission/uranium.png",
    "/img/zombie-mission/plutonium.png",
    "/img/zombie-mission/tritium.png",
] as const;
const ZOMBIE_MISSION_DEVICE_ICON_PATH = "/img/zombie-mission/nuclear-console.png";
const ZOMBIE_NUKE_SHAKE_DURATION_MS = 2600;
const ZOMBIE_NUKE_SHAKE_CONTINUOUS_INTENSITY = 12;
const ZOMBIE_NUKE_SHAKE_IMPACT_INTENSITY = 16;
const ZOMBIE_GEIGER_DETECTION_RANGE = 55;
const ZOMBIE_GEIGER_NEAR_INTERVAL_MS = 190;
const ZOMBIE_GEIGER_FAR_INTERVAL_MS = 1200;

export class Game {
    privateDuelMatch = false;
    /** True for a public share-code observer, enabling full-map overlays/chat. */
    sharedSpectator = false;
    /** Server-declared connection role; never infer this from the camera target. */
    joinedSpectatorOnly = false;
    joinedTrainingTarget = false;
    initialized = false;
    teamMode: TeamMode = TeamMode.Solo;

    victoryMusic: SoundHandle | null = null;
    m_ws: WebSocket | null = null;
    connecting = false;
    connected = false;

    m_touch!: Touch;
    m_camera!: Camera;
    m_renderer!: Renderer;
    m_particleBarn!: ParticleBarn;
    m_decalBarn!: DecalBarn;
    m_map!: Map;
    m_playerBarn!: PlayerBarn;
    m_bulletBarn!: BulletBarn;
    m_flareBarn!: FlareBarn;
    m_projectileBarn!: ProjectileBarn;
    m_explosionBarn!: ExplosionBarn;
    m_planeBarn!: PlaneBarn;
    m_airdropBarn!: AirdropBarn;
    m_smokeBarn!: SmokeBarn;
    m_deadBodyBarn!: DeadBodyBarn;
    m_lootBarn!: LootBarn;
    m_gas!: Gas;
    m_uiManager!: UiManager;
    m_ui2Manager!: UiManager2;
    m_emoteBarn!: EmoteBarn;
    m_shotBarn!: ShotBarn;
    m_objectCreator!: Creator;

    m_debugDisplay!: PIXI.Graphics;
    m_canvasMode!: boolean;

    m_updatePass!: boolean;
    m_updatePassDelay!: number;
    m_playing!: boolean;
    m_gameOver!: boolean;
    m_spectating!: boolean;
    m_inputMsgTimeout!: number;
    m_prevInputMsg!: net.InputMsg;
    m_playingTicker!: number;
    m_updateRecvCount!: number;
    m_localId!: number;
    /** 当前实际加入的服务端对局 ID；新版匹配不会把它写进网页 URL。 */
    m_matchId = "";
    m_activeId!: number;
    m_activePlayer!: Player;
    m_validateAlpha!: boolean;
    m_targetZoom!: number;
    m_debugZoom!: number;
    m_useDebugZoom!: boolean;

    editor!: Editor;
    debugHUD!: DebugHUD;

    // ---- 网络波动自动重连（保留画面，不退出对局） ----
    private autoReconnectUrl = "";
    private autoReconnectJoinToken = "";
    private autoReconnectLoadoutPriv = "";
    private autoReconnectQuestPriv = "";
    private autoReconnectEnabled = false;
    private autoReconnectAttempts = 0;
    private autoReconnectTimer: number | null = null;
    private autoReconnectInProgress = false;
    /** 最大重连尝试次数（约 4 分钟递增退避；超过则回大厅并保留对局 URL）。 */
    private readonly autoReconnectMaxAttempts = 20;

    extractionDisplay!: PIXI.Graphics;
    zombieMissionDisplay!: PIXI.Graphics;
    private zombieMissionDeviceSprite: PIXI.Sprite | null = null;
    private zombieMissionElementSprites: PIXI.Sprite[] = [];
    disconnectMsg: GameWsDisconnectReason | "" = "";
    freeSpectating = false;
    freeCameraPos = v2.create(0, 0);
    freeCameraZoom = 1;
    freeCameraLastMouse = v2.create(0, 0);
    freeCameraNetAt = 0;
    /** Server-authoritative elapsed match time (seconds) for time-limited modes. */
    matchStartedTime = -1;
    /** 服务端同步的固定撤离点索引与权威停留进度。 */
    extractionPointIndex = -1;
    extractionHoldServer = 0;
    /** 本局是否已处理过"撤离成功"（防止重复触发返回仓库）。 */
    private extractionSuccessShown = false;
    freeCameraDirty = false;
    freeCameraLayer = 0;
    private liveAnnouncementTimer = 0;
    private liveAnnouncementGeneration = 0;
    sandevistanFx!: SandevistanFx;
    sandevistanPostFilter!: SandevistanPostFilter | null;
    /** Live worldTimeScale from the server (site_info), 0 = use shared default. */
    private sandevistanWorldTimeScaleOverride = 0;
    /** Throttle for polling the live sandevistan config while in the mode. */
    private sandevistanConfigRefreshAt = 0;

    seq!: number;
    seqInFlight!: boolean;
    seqSendTime!: number;
    pings!: number[];
    debugPingTime!: number;
    lastUpdateTime!: number;
    updateIntervals!: number[];

    constructor(
        public m_pixi: PIXI.Application,
        public m_audioManager: AudioManager,
        public m_localization: Localization,
        public m_config: ConfigManager,
        public m_input: InputHandler,
        public m_inputBinds: InputBinds,
        public m_inputBindUi: InputBindUi,
        public m_ambience: Ambiance,
        public m_resourceManager: ResourceManager,
        public onJoin: () => void,
        public onQuit: (err?: GameWsDisconnectReason) => void,
    ) {
        if (IS_DEV) {
            this.editor = new Editor(this.m_config);
        }
    }

    /**
     * 记录当前对局的连接参数，网络波动导致 ws 断开时自动重连（保留画面）。
     * 由 main.ts 每次 joinGame 时调用。
     */
    enableAutoReconnect(
        url: string,
        joinToken: string,
        loadoutPriv: string,
        questPriv: string,
    ) {
        this.autoReconnectUrl = url;
        this.autoReconnectJoinToken = joinToken;
        this.autoReconnectLoadoutPriv = loadoutPriv;
        this.autoReconnectQuestPriv = questPriv;
        this.autoReconnectEnabled = true;
        this.autoReconnectAttempts = 0;
        this.autoReconnectInProgress = false;
    }

    /** 停止自动重连（对局结束 / 主动退出时调用）。 */
    stopAutoReconnect(): void {
        this.autoReconnectEnabled = false;
        if (this.autoReconnectTimer !== null) {
            window.clearTimeout(this.autoReconnectTimer);
            this.autoReconnectTimer = null;
        }
        this.autoReconnectInProgress = false;
        this.hideReconnectNotice();
    }

    /** 网络波动后定时重连（递增退避）。 */
    private scheduleAutoReconnect(): void {
        if (this.m_gameOver || this.disconnectMsg || !this.autoReconnectEnabled) return;
        if (this.autoReconnectTimer !== null) return;
        if (this.autoReconnectAttempts >= this.autoReconnectMaxAttempts) {
            this.stopAutoReconnect();
            this.onQuit("host_closed");
            return;
        }
        this.autoReconnectAttempts += 1;
        const delay = Math.min(
            1000 * 2 ** Math.min(this.autoReconnectAttempts - 1, 3),
            8000,
        );
        this.showReconnectNotice(this.autoReconnectAttempts);
        this.autoReconnectTimer = window.setTimeout(() => {
            this.autoReconnectTimer = null;
            if (this.m_gameOver || this.disconnectMsg || !this.autoReconnectEnabled) {
                this.hideReconnectNotice();
                return;
            }
            this.openAutoReconnectSocket();
        }, delay);
    }

    /** 建立重连 socket 并发送 Join（复用同一 match token）。 */
    private openAutoReconnectSocket(): void {
        if (this.connecting || this.connected || this.autoReconnectInProgress) return;
        if (!this.autoReconnectUrl) return;
        this.autoReconnectInProgress = true;
        this.connecting = true;
        try {
            const ws = new WebSocket(this.autoReconnectUrl);
            ws.binaryType = "arraybuffer";
            this.m_ws = ws;
            ws.onopen = () => {
                this.connecting = false;
                this.autoReconnectInProgress = false;
                this.connected = true;
                this.autoReconnectAttempts = 0;
                const joinMessage = new net.JoinMsg();
                joinMessage.protocol = GameConfig.protocolVersion;
                joinMessage.joinToken = this.autoReconnectJoinToken;
                joinMessage.loadoutPriv = this.autoReconnectLoadoutPriv;
                joinMessage.questPriv = this.autoReconnectQuestPriv;
                joinMessage.name = this.m_config.get("playerName")!;
                joinMessage.useTouch = device.touch;
                joinMessage.isMobile = device.mobile || window.mobile!;
                joinMessage.bot = false;
                joinMessage.loadout = this.m_config.get("loadout")!;
                this.m_sendMessage(net.MsgType.Join, joinMessage, 8192);
            };
            ws.onerror = () => ws.close();
            ws.onmessage = (e) => {
                const msgStream = new net.MsgStream(e.data);
                while (true) {
                    const type = msgStream.deserializeMsgType();
                    if (type === net.MsgType.None) break;
                    this.m_onMsg(type, msgStream.getStream());
                    msgStream.stream.readAlignToNextByte();
                }
                this.debugHUD?.netInGraph.addEntry(msgStream.stream.buffer.byteLength);
            };
            ws.onclose = (event) => {
                this.autoReconnectInProgress = false;
                this.connecting = false;
                this.connected = false;
                const displayingStats = this.m_uiManager?.displayingStats;
                const explicitReason = (this.disconnectMsg || event.reason) as
                    | GameWsDisconnectReason
                    | "";
                if (this.m_gameOver || displayingStats) return;
                if (explicitReason) {
                    this.stopAutoReconnect();
                    this.onQuit(explicitReason);
                } else if (this.autoReconnectEnabled) {
                    this.scheduleAutoReconnect();
                }
            };
        } catch (error) {
            console.error(error);
            this.autoReconnectInProgress = false;
            this.connecting = false;
            this.connected = false;
            if (!this.m_gameOver && !this.disconnectMsg && this.autoReconnectEnabled) {
                this.scheduleAutoReconnect();
            }
        }
    }

    private showReconnectNotice(attempt: number): void {
        // 自动重连照常进行，但不弹出任何提示（按需求去掉“网络波动，正在自动重连”）。
        void attempt;
    }

    private hideReconnectNotice(): void {
        const el = document.getElementById("reconnect-notice");
        if (el) el.style.display = "none";
    }

    tryJoinGame(
        url: string,
        joinToken: string,
        loadoutPriv: string,
        questPriv: string,
        onConnectFail: () => void,
    ) {
        if (!this.connecting && !this.connected && !this.initialized) {
            if (this.m_ws) {
                this.m_ws.onerror = function() {};
                this.m_ws.onopen = function() {};
                this.m_ws.onmessage = function() {};
                this.m_ws.onclose = function() {};
                this.m_ws.close();
                this.m_ws = null;
            }
            this.connecting = true;
            this.connected = false;
            try {
                this.m_ws = new WebSocket(url);
                this.m_ws.binaryType = "arraybuffer";
                this.m_ws.onerror = (_err) => {
                    this.m_ws?.close();
                };
                this.m_ws.onopen = () => {
                    this.connecting = false;
                    this.connected = true;
                    const name = this.m_config.get("playerName")!;
                    const joinMessage = new net.JoinMsg();
                    joinMessage.protocol = GameConfig.protocolVersion;
                    joinMessage.joinToken = joinToken;
                    joinMessage.loadoutPriv = loadoutPriv;
                    joinMessage.questPriv = questPriv;
                    joinMessage.name = name;
                    joinMessage.useTouch = device.touch;
                    joinMessage.isMobile = device.mobile || window.mobile!;
                    joinMessage.bot = false;
                    joinMessage.loadout = this.m_config.get("loadout")!;
                    this.m_sendMessage(net.MsgType.Join, joinMessage, 8192);
                };
                this.m_ws.onmessage = (e) => {
                    const msgStream = new net.MsgStream(e.data);
                    while (true) {
                        const type = msgStream.deserializeMsgType();
                        if (type == net.MsgType.None) {
                            break;
                        }
                        this.m_onMsg(type, msgStream.getStream());
                        msgStream.stream.readAlignToNextByte();
                    }
                    this.debugHUD?.netInGraph.addEntry(
                        msgStream.stream.buffer.byteLength,
                    );
                };
                this.m_ws.onclose = (e) => {
                    const displayingStats = this.m_uiManager?.displayingStats;
                    const connecting = this.connecting;
                    const connected = this.connected;
                    this.connecting = false;
                    this.connected = false;
                    if (connecting) {
                        onConnectFail();
                    } else if (connected && !this.m_gameOver && !displayingStats) {
                        const explicitReason = (this.disconnectMsg || e.reason) as
                            | GameWsDisconnectReason
                            | "";
                        if (
                            this.autoReconnectEnabled
                            && this.autoReconnectUrl
                            && !explicitReason
                        ) {
                            // 网络波动（服务器未主动断开）：保留画面自动重连。
                            this.scheduleAutoReconnect();
                        } else {
                            this.onQuit(explicitReason || "host_closed");
                        }
                    }
                };
            } catch (err) {
                console.error(err);
                this.connecting = false;
                this.connected = false;
                onConnectFail();
            }
        }
    }

    init() {
        this.m_canvasMode = this.m_pixi.renderer.type == PIXI.RENDERER_TYPE.CANVAS;

        // Modules
        this.m_touch = new Touch(this.m_input, this.m_config);
        this.m_camera = new Camera();
        this.m_renderer = new Renderer(this, this.m_canvasMode);
        this.m_particleBarn = new ParticleBarn(this.m_renderer);
        this.m_decalBarn = new DecalBarn();
        this.m_map = new Map(this.m_decalBarn);
        this.m_playerBarn = new PlayerBarn();
        this.m_bulletBarn = new BulletBarn();
        this.m_flareBarn = new FlareBarn();
        this.m_projectileBarn = new ProjectileBarn();
        this.m_explosionBarn = new ExplosionBarn();
        this.m_planeBarn = new PlaneBarn(this.m_audioManager);
        this.m_airdropBarn = new AirdropBarn();
        this.m_smokeBarn = new SmokeBarn();
        this.m_deadBodyBarn = new DeadBodyBarn();
        this.m_lootBarn = new LootBarn();
        this.m_gas = new Gas(this.m_canvasMode);
        this.m_uiManager = new UiManager(
            this,
            this.m_audioManager,
            this.m_particleBarn,
            this.m_planeBarn,
            this.m_localization,
            this.m_canvasMode,
            this.m_touch,
            this.m_inputBinds,
            this.m_inputBindUi,
        );
        this.m_ui2Manager = new UiManager2(this.m_localization, this.m_inputBinds);

        this.sandevistanPostFilter = null;
        if (
            GameConfig.player.sandevistan.qualityLevel > 0
            && this.m_pixi.renderer.type === PIXI.RENDERER_TYPE.WEBGL
        ) {
            try {
                this.sandevistanPostFilter = new SandevistanPostFilter();
                this.sandevistanPostFilter.resolution = 1;
                this.sandevistanPostFilter.multisample = 0;
            } catch (error) {
                console.error("Sandevistan post filter disabled:", error);
                this.sandevistanPostFilter = null;
            }
        }
        this.sandevistanFx = new SandevistanFx(
            this.sandevistanPostFilter,
            this.m_pixi.stage,
            this.m_pixi.screen,
        );
        this.m_emoteBarn = new EmoteBarn(
            this.m_audioManager,
            this.m_uiManager,
            this.m_playerBarn,
            this.m_camera,
            this.m_map,
        );
        this.m_shotBarn = new ShotBarn();
        this.debugHUD = new DebugHUD(this.m_config);

        // this.m_particleBarn,
        // this.m_audioManager,
        // this.m_uiManager

        // Register types
        const TypeToPool = {
            [ObjectType.Player]: this.m_playerBarn.playerPool,
            [ObjectType.Obstacle]: this.m_map.m_obstaclePool,
            [ObjectType.Loot]: this.m_lootBarn.lootPool,
            [ObjectType.DeadBody]: this.m_deadBodyBarn.deadBodyPool,
            [ObjectType.Building]: this.m_map.m_buildingPool,
            [ObjectType.Structure]: this.m_map.m_structurePool,
            [ObjectType.Decal]: this.m_decalBarn.decalPool,
            [ObjectType.Projectile]: this.m_projectileBarn.projectilePool,
            [ObjectType.Smoke]: this.m_smokeBarn.m_smokePool,
            [ObjectType.Airdrop]: this.m_airdropBarn.airdropPool,
        };

        this.m_objectCreator = new Creator();
        for (const type in TypeToPool) {
            if (TypeToPool.hasOwnProperty(type)) {
                this.m_objectCreator.m_registerType(
                    type,
                    TypeToPool[type as unknown as keyof typeof TypeToPool],
                );
            }
        }
        // Render ordering
        this.m_debugDisplay = new PIXI.Graphics();
        this.extractionDisplay = new PIXI.Graphics();
        this.zombieMissionDisplay = new PIXI.Graphics();
        this.zombieMissionDeviceSprite = null;
        this.zombieMissionElementSprites = [];
        this.m_renderer.layers[1].addChildAt(this.sandevistanFx.afterimageContainer, 0);
        const pixiContainers = [
            this.m_map.display.ground,
            this.m_renderer.layers[0],
            this.m_renderer.ground,
            this.m_renderer.layers[1],
            this.m_renderer.layers[2],
            this.m_renderer.layers[3],
            this.extractionDisplay,
            this.zombieMissionDisplay,
            this.m_debugDisplay,
            this.m_gas.gasRenderer.display,
            this.sandevistanFx.overlayContainer,
            this.m_touch.container,
            this.m_emoteBarn.container,
            this.m_uiManager.container,
            this.m_uiManager.m_pieTimer.container,
            this.m_emoteBarn.indContainer,
            this.debugHUD.container,
        ];
        for (let i = 0; i < pixiContainers.length; i++) {
            const container = pixiContainers[i];
            if (container) {
                container.interactiveChildren = false;
                this.m_pixi.stage.addChild(container);
            }
        }
        // Local vars
        this.m_playing = false;
        this.m_gameOver = false;
        this.m_spectating = false;
        this.m_inputMsgTimeout = 0;
        this.m_prevInputMsg = new net.InputMsg();
        this.m_playingTicker = 0;
        this.m_updateRecvCount = 0;
        this.m_updatePass = false;
        this.m_updatePassDelay = 0;
        this.m_localId = 0;
        this.m_activeId = 0;
        this.m_activePlayer = null as unknown as Player;
        this.m_validateAlpha = false;
        this.m_targetZoom = 1;
        this.m_debugZoom = 1;
        this.m_useDebugZoom = false;
        this.disconnectMsg = "";
        this.sharedSpectator = false;
        this.joinedSpectatorOnly = false;
        this.joinedTrainingTarget = false;
        this.freeSpectating = false;
        this.freeCameraPos = v2.create(0, 0);
        this.freeCameraZoom = 1;
        this.freeCameraLastMouse = v2.copy(this.m_input.mousePos);
        this.freeCameraNetAt = 0;
        this.freeCameraDirty = false;
        this.freeCameraLayer = 0;
        // Extraction / match-timer state is reset here because the Game
        // instance is reused across matches; otherwise the countdown, hold
        // progress and the 2:30 reminder leak into the next game.
        this.matchStartedTime = -1;
        this.extractionPointIndex = -1;
        this.extractionHoldServer = 0;
        this.extractionHoldClient = 0;
        this.zombieMissionMsg = null;
        this.zombieMissionPrevPlacedMask = 0;
        this.zombieMissionPrevCarriedElement = 0xff;
        this.zombieMissionLastNukeSequence = -1;
        this.zombieNukeShakeUntil = 0;
        this.zombieMissionSnapshotReceived = false;
        this.zombieMissionCountdownDeadline = 0;
        this.zombieGeigerNextClickAt = 0;
        if (this.zombieMissionAlarm) {
            this.m_audioManager.stopSound(this.zombieMissionAlarm);
            this.zombieMissionAlarm = null;
        }
        if (this.zombieMissionEvacuationSiren) {
            this.m_audioManager.stopSound(this.zombieMissionEvacuationSiren);
            this.zombieMissionEvacuationSiren = null;
        }
        this.matchTimeReminderShown = false;
        this.extractionSuccessShown = false;

        // Latency determination

        this.seq = 0;
        this.seqInFlight = false;
        this.seqSendTime = 0;
        this.pings = [];
        this.updateIntervals = [];
        this.lastUpdateTime = 0;
        this.debugPingTime = 0;

        // Process config
        this.m_camera.m_setShakeEnabled(this.m_config.get("screenShake")!);
        this.m_camera.m_setInterpEnabled(this.m_config.get("interpolation")!);
        this.m_camera.m_setRotationEnabled(this.m_config.get("localRotation")!);
        this.m_playerBarn.anonPlayerNames = this.m_config.get("anonPlayerNames")!;
        this.initialized = true;
        this.startLiveAnnouncementPolling();
    }

    free(keepWs = false) {
        this.stopLiveAnnouncementPolling();
        if (!keepWs) {
            this.stopAutoReconnect();
            if (this.m_ws) {
                this.m_ws.onmessage = function() {};
                this.m_ws.close();
                this.m_ws = null;
            }
        }
        this.connecting = false;
        this.connected = false;
        if (this.initialized) {
            this.initialized = false;
            this.m_updatePass = false;
            this.m_updatePassDelay = 0;
            this.m_emoteBarn.m_free();
            this.m_ui2Manager.m_free();
            this.m_uiManager.m_free();
            this.m_gas.m_free();
            this.m_airdropBarn.m_free();
            this.m_planeBarn.m_free();
            this.m_map.m_free();
            this.m_particleBarn.m_free();
            this.m_renderer.m_free();
            this.m_input.m_free();
            this.m_audioManager.stopAll();
            this.sandevistanFx?.reset();
            if (this.m_pixi.stage.filters) this.m_pixi.stage.filters = null;
            while (this.m_pixi.stage.children.length > 0) {
                const c = this.m_pixi.stage.children[0];
                this.m_pixi.stage.removeChild(c);
                c.destroy({
                    children: true,
                });
            }
        }
    }

    private startLiveAnnouncementPolling() {
        this.stopLiveAnnouncementPolling();
        const generation = ++this.liveAnnouncementGeneration;
        void this.pollLiveAnnouncement(generation);
        this.liveAnnouncementTimer = window.setInterval(() => {
            void this.pollLiveAnnouncement(generation);
        }, 2000);
    }

    private stopLiveAnnouncementPolling() {
        this.liveAnnouncementGeneration++;
        if (this.liveAnnouncementTimer) {
            window.clearInterval(this.liveAnnouncementTimer);
            this.liveAnnouncementTimer = 0;
        }
        this.m_uiManager?.displayLiveAnnouncement("");
    }

    private async pollLiveAnnouncement(generation: number) {
        try {
            const response = await fetch(
                `/api/live-announcement?_=${Date.now()}`,
                { cache: "no-store" },
            );
            if (!response.ok) return;
            const announcement = (await response.json()) as {
                active?: boolean;
                message?: string;
                expiresAt?: string;
            };
            if (
                generation !== this.liveAnnouncementGeneration
                || !this.initialized
            ) {
                return;
            }
            const expiresAt = Date.parse(announcement.expiresAt ?? "");
            const active = announcement.active === true
                && typeof announcement.message === "string"
                && announcement.message.length > 0
                && Number.isFinite(expiresAt)
                && expiresAt > Date.now();
            this.m_uiManager.displayLiveAnnouncement(
                active ? announcement.message! : "",
            );
        } catch {
            // A temporary status request failure must not affect the game session.
        }
    }

    warnPageReload() {
        return (
            import.meta.env.PROD
            && this.initialized
            && this.m_playing
            && !this.m_spectating
            && !this.m_uiManager.displayingStats
        );
    }

    private updateFreeSpectateCamera(dt: number) {
        const left = this.m_input.keyDown(Key.A) || this.m_input.keyDown(Key.Left);
        const right = this.m_input.keyDown(Key.D) || this.m_input.keyDown(Key.Right);
        const up = this.m_input.keyDown(Key.W) || this.m_input.keyDown(Key.Up);
        const down = this.m_input.keyDown(Key.S) || this.m_input.keyDown(Key.Down);
        let move = v2.create(Number(right) - Number(left), Number(up) - Number(down));
        const moveLen = v2.length(move);
        if (moveLen > 0) {
            move = v2.mul(move, 1 / moveLen);
            const fast = this.m_input.keyDown(Key.Shift) ? 1.9 : 1;
            const speed = (42 * fast) / math.clamp(this.freeCameraZoom, 0.45, 2.8);
            this.freeCameraPos = v2.add(this.freeCameraPos, v2.mul(move, dt * speed));
            this.freeCameraDirty = true;
        }

        const dragging = this.m_input.mouseDown(MouseButton.Middle)
            || this.m_input.mouseDown(MouseButton.Right);
        if (dragging) {
            const delta = v2.sub(this.m_input.mousePos, this.freeCameraLastMouse);
            if (Math.abs(delta.x) + Math.abs(delta.y) > 0) {
                this.freeCameraPos.x -= delta.x / this.m_camera.m_z();
                this.freeCameraPos.y += delta.y / this.m_camera.m_z();
                this.freeCameraDirty = true;
            }
        }
        this.freeCameraLastMouse = v2.copy(this.m_input.mousePos);

        const wheel = this.m_input.mouseWheel();
        const zoomIn = wheel === MouseWheel.Up || this.m_input.keyPressed(Key.Plus);
        const zoomOut = wheel === MouseWheel.Down || this.m_input.keyPressed(Key.Minus);
        if (zoomIn || zoomOut) {
            this.freeCameraZoom = math.clamp(
                this.freeCameraZoom * (zoomIn ? 1.16 : 1 / 1.16),
                0.42,
                3.2,
            );
            this.freeCameraDirty = true;
        }

        this.freeCameraPos.x = math.clamp(this.freeCameraPos.x, 0, this.m_map.width);
        this.freeCameraPos.y = math.clamp(this.freeCameraPos.y, 0, this.m_map.height);
        this.m_camera.m_pos = v2.copy(this.freeCameraPos);
        this.m_camera.m_targetZoom = this.freeCameraZoom;
        this.m_camera.m_zoom = math.lerp(
            math.clamp(dt * 8, 0, 1),
            this.m_camera.m_zoom,
            this.m_camera.m_targetZoom,
        );
    }

    private freeCameraViewRadius(): number {
        const z = Math.max(0.1, this.m_camera.m_z());
        const halfWidth = this.m_camera.m_screenWidth * 0.5 / z;
        const halfHeight = this.m_camera.m_screenHeight * 0.5 / z;
        return math.clamp(Math.hypot(halfWidth, halfHeight) + 10, 12, 180);
    }

    /**
     * World time dilation for the client-side simulation. The server advances
     * bullets / throwables / flares at worldTimeScale while the implant is
     * active, but this client simulates those tracers locally at 60fps, so the
     * same scale must be applied here or they visibly keep full speed.
     */
    private sandevistanWorldTimeScale(): number {
        if (!this.m_map?.mapDef?.gameMode?.sandevistanMode) return 1;
        if (!this.m_activePlayer?.localData?.sandevistanActive) return 1;
        const scale = this.sandevistanWorldTimeScaleOverride > 0
            ? this.sandevistanWorldTimeScaleOverride
            : Number(GameConfig.player.sandevistan.worldTimeScale);
        return Number.isFinite(scale) && scale > 0 && scale < 1 ? scale : 1;
    }

    /** Sync the live server worldTimeScale (admin-tunable) into client sims. */
    setSandevistanWorldTimeScale(scale: number): void {
        if (Number.isFinite(scale) && scale > 0) {
            this.sandevistanWorldTimeScaleOverride = scale;
        }
    }

    /** Pull the admin-tunable sandevistan scale from the server (throttled).
     * Runs only while a sandevistan map is loaded so the dashboard's
     * "对局速度" slider takes effect in-game without a page reload. */
    private refreshSandevistanConfig(): void {
        if (!this.m_map?.mapDef?.gameMode?.sandevistanMode) return;
        const now = Date.now();
        if (now < this.sandevistanConfigRefreshAt) return;
        this.sandevistanConfigRefreshAt = now + 5000;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        fetch("/api/sandevistan/config", { signal: controller.signal })
            .then((response) => response.json() as Promise<{ worldTimeScale?: number }>)
            .then((data) => {
                if (typeof data.worldTimeScale === "number") {
                    this.setSandevistanWorldTimeScale(data.worldTimeScale);
                }
            })
            .catch(() => {})
            .finally(() => window.clearTimeout(timeout));
    }

    private extractionHudEl: HTMLElement | null = null;
    private matchTimerEl: HTMLElement | null = null;
    private extractionHoldClient = 0;
    private matchTimeReminderShown = false;
    private zombieWinAnnounced = false;
    private zombieMissionMsg: net.ZombieMissionMsg | null = null;
    private zombieMissionPrevPlacedMask = 0;
    private zombieMissionPrevCarriedElement = 0xff;
    private zombieMissionLastNukeSequence = -1;
    private zombieMissionAlarm: SoundHandle | null = null;
    private zombieMissionEvacuationSiren: SoundHandle | null = null;
    private zombieNukeShakeUntil = 0;
    private zombieMissionSnapshotReceived = false;
    /** Monotonic local deadline derived from authoritative server snapshots. */
    private zombieMissionCountdownDeadline = 0;
    private zombieGeigerNextClickAt = 0;

    private updateExtraction(dt: number): void {
        const extractionMode = Boolean(this.m_map?.mapDef?.gameMode?.extractionMode);
        const hudEl = this.extractionHudEl
            ?? (this.extractionHudEl = document.getElementById("extraction-hud"));
        const matchTimerEl = this.matchTimerEl
            ?? (this.matchTimerEl = document.getElementById("ui-match-timer"));
        if (!extractionMode || !this.m_playing) {
            this.extractionDisplay?.clear();
            if (hudEl) hudEl.style.display = "none";
            if (matchTimerEl) matchTimerEl.style.display = "none";
            return;
        }

        // Match time limit countdown (10 minutes for extraction).
        if (matchTimerEl) {
            if (this.matchStartedTime < 0) {
                this.matchTimeReminderShown = false;
                matchTimerEl.style.display = "none";
            } else {
                const remain = Math.max(
                    0,
                    EXTRACTION_MATCH_TIME_LIMIT_SECONDS - Math.floor(this.matchStartedTime),
                );
                if (
                    !this.m_spectating
                    && !this.matchTimeReminderShown
                    && remain <= EXTRACTION_TIME_WARNING_SECONDS
                ) {
                    this.matchTimeReminderShown = true;
                    this.m_uiManager.displayAnnouncement(
                        "对局剩余 2 分 30 秒，请尽快撤离！",
                    );
                }
                const minutes = Math.floor(remain / 60);
                const seconds = remain % 60;
                matchTimerEl.textContent = `${minutes}:${`0${seconds}`.slice(-2)}`;
                matchTimerEl.classList.toggle("urgent", remain <= 60);
                matchTimerEl.style.display = "block";
            }
        }

        // 撤离点标记状态：非对局/绝密未开放 → 隐藏；否则（含观战者）
        // 绘制撤离点圈。观战者不隐藏：服务端已按 0.2s 间隔同步被观战者
        // 的撤离点索引，继续绘制其撤离点圈；仅隐藏 HUD 进度文字。
        if (this.m_spectating && hudEl) {
            hudEl.style.display = "none";
        }

        // 绝密模式：撤离点前 5 分钟关闭，隐藏撤离标记并提示。
        // 由当前房间地图决定（绝密搜打撤为独立播放列表，与普通搜打撤同时运行）。
        const secretMode = Boolean(
            this.m_map?.mapDef?.gameMode?.extractionSecretMode,
        );
        const marker = extractionMarkerState({
            playing: this.m_playing,
            secretMode,
            matchStartedTime: this.matchStartedTime,
        });
        if (marker.kind === "hidden-secret-closed") {
            this.extractionDisplay?.clear();
            if (hudEl) {
                const minutes = Math.floor(
                    (marker.remainForOpen - EXTRACTION_SECRET_OPEN_SECONDS) / 60,
                );
                const seconds = (marker.remainForOpen - EXTRACTION_SECRET_OPEN_SECONDS) % 60;
                hudEl.textContent = `撤离点未开放 · ${minutes}:${
                    `0${seconds}`.slice(
                        -2,
                    )
                } 后开放`;
                hudEl.style.display = "block";
                hudEl.style.color = "#ffb84d";
            }
            return;
        }
        if (hudEl) {
            hudEl.textContent = "";
        }

        const points = generateExtractionPoints(
            this.m_map.mapName,
            this.m_map.width,
            this.m_map.height,
        );
        const pos = this.m_activePlayer.m_pos;
        const active = this.extractionPointIndex >= 0
                && this.extractionPointIndex < points.length
            ? points[this.extractionPointIndex]
            : farthestExtractionPoint(points, pos);

        // World beacon: same camera transform as the terrain layer.
        const p0 = this.m_camera.m_pointToScreen(v2.create(0, 0));
        const p1 = this.m_camera.m_pointToScreen(v2.create(1, 1));
        const s = v2.sub(p1, p0);
        this.extractionDisplay.position.set(p0.x, p0.y);
        this.extractionDisplay.scale.set(s.x, s.y);
        this.extractionDisplay.clear();
        const pulse = 3 + Math.sin(performance.now() / 280) * 1.4;
        this.extractionDisplay.lineStyle(3, 0x22dd55, 0.95);
        this.extractionDisplay.drawCircle(
            active.x,
            active.y,
            EXTRACTION_ZONE_RADIUS + pulse,
        );
        this.extractionDisplay.lineStyle(1.5, 0x22dd55, 0.5);
        this.extractionDisplay.drawCircle(active.x, active.y, EXTRACTION_ZONE_RADIUS + 7);

        if (!hudEl) return;
        if (insideExtractionZone(active, pos)) {
            // 权威进度由服务端同步（0.2s 间隔）。
            const remain = Math.max(
                0,
                EXTRACTION_HOLD_SECONDS - this.extractionHoldServer,
            );
            hudEl.style.display = "block";
            hudEl.textContent = `撤离中 ${remain.toFixed(1)}s`;
        } else {
            this.extractionHoldClient = 0;
            // 撤离点距离提示已按要求移除；开启点仍由世界中的绿色光柱标记。
            hudEl.style.display = "none";
        }
    }

    /** 僵尸模式：6 分钟倒计时 + 胜利公告（纯客户端展示，权威在服务端）。 */
    private zombieRushSoundUntil = 0;
    /** 已播放过冲刺音效的自爆僵尸 ID（每个自爆步兵最多响一次）。 */
    private zombieRushSoundPlayedIds = new Set<number>();

    /** 僵尸任务素材只在僵尸房间加载，避免其它模式下载大图。 */
    private initializeZombieMissionIcons(): void {
        const createIcon = (path: string): PIXI.Sprite => {
            const sprite = PIXI.Sprite.from(path);
            sprite.anchor.set(0.5, 0.5);
            sprite.visible = false;
            sprite.alpha = 0.98;
            this.zombieMissionDisplay.addChild(sprite);
            return sprite;
        };
        this.zombieMissionDeviceSprite = createIcon(
            ZOMBIE_MISSION_DEVICE_ICON_PATH,
        );
        this.zombieMissionElementSprites = ZOMBIE_MISSION_ELEMENT_ICON_PATHS.map(createIcon);
    }

    private updateZombie(_dt: number): void {
        const zombieMode = Boolean(this.m_map?.mapDef?.gameMode?.zombieMode);
        const matchTimerEl = this.matchTimerEl
            ?? (this.matchTimerEl = document.getElementById("ui-match-timer"));
        if (!zombieMode || !this.m_playing) {
            this.m_ui2Manager.zombieMissionInteractionText = null;
            this.zombieGeigerNextClickAt = 0;
            this.zombieMissionDisplay?.clear();
            if (this.zombieMissionDisplay) {
                this.zombieMissionDisplay.visible = false;
            }
            const missionHud = document.getElementById("zombie-mission-hud");
            if (missionHud) missionHud.style.display = "none";
            if (this.zombieMissionAlarm) {
                this.m_audioManager.stopSound(this.zombieMissionAlarm);
                this.zombieMissionAlarm = null;
            }
            if (this.zombieMissionEvacuationSiren) {
                this.m_audioManager.stopSound(this.zombieMissionEvacuationSiren);
                this.zombieMissionEvacuationSiren = null;
            }
            if (matchTimerEl && !this.m_map?.mapDef?.gameMode?.extractionMode) {
                matchTimerEl.style.display = "none";
            }
            return;
        }
        if (matchTimerEl) {
            if (this.matchStartedTime < 0) {
                this.zombieWinAnnounced = false;
                matchTimerEl.style.display = "none";
            } else {
                const remain = Math.max(
                    0,
                    ZOMBIE_WIN_TIME_SEC - Math.floor(this.matchStartedTime),
                );
                const minutes = Math.floor(remain / 60);
                const seconds = remain % 60;
                matchTimerEl.textContent = `僵尸 ${minutes}:${`0${seconds}`.slice(-2)}`;
                matchTimerEl.classList.toggle("urgent", remain <= 60);
                matchTimerEl.style.display = "block";
            }
        }
        this.updateZombieMissionUi();
        this.updateZombieGeigerCounter();
        // 自爆变种冲刺音效：僵尸进入冲刺（Windwalk haste）且接近玩家时播放。
        // 每个自爆步兵最多只播放一次（按僵尸 ID 追踪），全局 1.5s 节流防刷屏。
        const now = performance.now();
        if (now >= this.zombieRushSoundUntil && this.m_activePlayer) {
            const myPos = this.m_activePlayer.m_pos;
            const pool = this.m_playerBarn.playerPool.m_getPool();
            for (const player of pool) {
                const info = this.m_playerBarn.getPlayerInfo(player.__id);
                if (!info.isBot || player.m_netData.m_dead) continue;
                if (this.zombieRushSoundPlayedIds.has(player.__id)) continue;
                if (!player.m_netData.m_hasteType) continue; // 未冲刺
                const dist = Math.hypot(
                    player.m_pos.x - myPos.x,
                    player.m_pos.y - myPos.y,
                );
                if (dist < ZOMBIE_RUSH_RANGE + 10) {
                    this.m_audioManager.playSound("zombie_rush", {
                        channel: "sfx",
                    });
                    this.zombieRushSoundPlayedIds.add(player.__id);
                    this.zombieRushSoundUntil = now + 1500;
                    break;
                }
            }
            // 清理已死亡/离场僵尸的记录，避免集合无限增长。
            if (this.zombieRushSoundPlayedIds.size > 128) {
                for (const id of this.zombieRushSoundPlayedIds) {
                    const p = this.m_playerBarn.getPlayerById(id);
                    if (!p || p.m_netData.m_dead) {
                        this.zombieRushSoundPlayedIds.delete(id);
                    }
                }
            }
        }
    }

    /** Play isolated Geiger clicks near mission elements, faster at close range. */
    private updateZombieGeigerCounter(): void {
        const msg = this.zombieMissionMsg;
        const player = this.m_activePlayer;
        if (
            !msg
            || !player
            || this.m_spectating
            || msg.phase !== net.ZombieMissionPhase.Collecting
        ) {
            this.zombieGeigerNextClickAt = 0;
            return;
        }

        let intervalMs: number | null = null;
        if (msg.carriedElement !== 0xff) {
            const cadenceRoll = Math.random();
            if (cadenceRoll < 0.45) {
                // Dense clusters make carried radioactive material sound unstable.
                intervalMs = 55 + Math.random() * 65;
            } else if (cadenceRoll < 0.9) {
                intervalMs = 120 + Math.random() * 110;
            } else {
                // Occasional pause prevents a recognizable repeating rhythm.
                intervalMs = 250 + Math.random() * 170;
            }
        } else {
            let closestDistance = Number.POSITIVE_INFINITY;
            for (let i = 0; i < 3; i++) {
                if ((msg.groundMask & (1 << i)) === 0) continue;
                closestDistance = Math.min(
                    closestDistance,
                    v2.distance(player.m_pos, msg.elementPositions[i]),
                );
            }
            if (closestDistance <= ZOMBIE_GEIGER_DETECTION_RANGE) {
                const distanceRatio = Math.min(
                    1,
                    closestDistance / ZOMBIE_GEIGER_DETECTION_RANGE,
                );
                intervalMs = ZOMBIE_GEIGER_NEAR_INTERVAL_MS
                    + (ZOMBIE_GEIGER_FAR_INTERVAL_MS
                            - ZOMBIE_GEIGER_NEAR_INTERVAL_MS)
                        * distanceRatio
                        * distanceRatio;
                const cadenceRoll = Math.random();
                if (cadenceRoll < 0.25) {
                    intervalMs *= 0.35 + Math.random() * 0.35;
                } else if (cadenceRoll > 0.88) {
                    intervalMs *= 1.6 + Math.random();
                } else {
                    intervalMs *= 0.7 + Math.random() * 0.65;
                }
            }
        }

        if (intervalMs === null) {
            this.zombieGeigerNextClickAt = 0;
            return;
        }
        const now = performance.now();
        if (now < this.zombieGeigerNextClickAt) return;
        this.m_audioManager.playSound("zombie_geiger_click", {
            channel: "sfx",
            volumeScale: 0.62 + Math.random() * 0.28,
            detune: -140 + Math.random() * 280,
        });
        this.zombieGeigerNextClickAt = now + intervalMs;
    }

    private updateZombieMissionUi(): void {
        const msg = this.zombieMissionMsg;
        const hud = document.getElementById("zombie-mission-hud");
        // Reset every frame so the mobile interaction button disappears as
        // soon as the player leaves the server-authoritative interaction range.
        this.m_ui2Manager.zombieMissionInteractionText = null;
        if (!msg || !this.m_playing) {
            this.zombieMissionDisplay?.clear();
            if (this.zombieMissionDisplay) {
                this.zombieMissionDisplay.visible = false;
            }
            if (hud) hud.style.display = "none";
            return;
        }

        this.zombieMissionDisplay.visible = true;

        const names = ZOMBIE_MISSION_ELEMENT_NAMES;
        if (this.m_activePlayer?.layer === 0) {
            const target = getZombieMissionInteractionTarget(
                msg,
                this.m_activePlayer.m_pos,
            );
            if (target) {
                const elementName = names[target.elementIndex] ?? "元素";
                this.m_ui2Manager.zombieMissionInteractionText = target.kind === "pickup"
                    ? `拾取 ${elementName}`
                    : `放入中心装置：${elementName}`;
            }
        }
        const placedCount = ((msg.placedMask >> 0) & 1)
            + ((msg.placedMask >> 1) & 1)
            + ((msg.placedMask >> 2) & 1);
        let text: string;
        if (msg.phase === net.ZombieMissionPhase.Collecting) {
            text = `任务：收集铀、钚、氚并放入中心装置 ${placedCount}/3`;
            if (msg.carriedElement !== 0xff) {
                const distance = this.m_activePlayer
                    ? Math.round(v2.distance(this.m_activePlayer.m_pos, msg.devicePos))
                    : 0;
                text += `<br>负重：${names[msg.carriedElement] ?? "元素"} —— 中心距离 ${distance}m`;
            } else {
                let closest = -1;
                let closestDistance = Number.POSITIVE_INFINITY;
                if (this.m_activePlayer) {
                    for (let i = 0; i < 3; i++) {
                        if ((msg.groundMask & (1 << i)) === 0) continue;
                        const distance = v2.distance(
                            this.m_activePlayer.m_pos,
                            msg.elementPositions[i],
                        );
                        if (distance < closestDistance) {
                            closest = i;
                            closestDistance = distance;
                        }
                    }
                }
                text += closest >= 0
                    ? `<br>最近：${names[closest]} ${Math.round(closestDistance)}m，靠近后按互动`
                    : "<br>靠近铀、钚或氚后按互动拾取";
            }
        } else if (msg.phase === net.ZombieMissionPhase.Armed) {
            text = "进入地堡躲避<br>核爆倒计时准备中";
        } else if (msg.phase === net.ZombieMissionPhase.Countdown) {
            const remainingMs = Math.max(
                0,
                this.zombieMissionCountdownDeadline - performance.now(),
            );
            text = `${msg.inBunker ? "已进入地堡，保持隐蔽" : "进入地堡躲避"}<br>核爆倒计时 ${
                (remainingMs / 1000).toFixed(3)
            } 秒`;
        } else {
            // The normal end-of-match screen already confirms completion.
            // Hide the mission HUD after detonation instead of leaving a
            // redundant kill-count banner over the result screen.
            text = "";
        }
        if (hud) {
            hud.innerHTML = text;
            hud.style.display = text ? "block" : "none";
            hud.classList.toggle(
                "danger",
                msg.phase === net.ZombieMissionPhase.Countdown && !msg.inBunker,
            );
        }

        const p0 = this.m_camera.m_pointToScreen(v2.create(0, 0));
        const p1 = this.m_camera.m_pointToScreen(v2.create(1, 1));
        const scale = v2.sub(p1, p0);
        this.zombieMissionDisplay.position.set(p0.x, p0.y);
        this.zombieMissionDisplay.scale.set(scale.x, scale.y);
        this.zombieMissionDisplay.clear();

        const deviceSprite = this.zombieMissionDeviceSprite;
        if (deviceSprite) {
            deviceSprite.visible = msg.phase !== net.ZombieMissionPhase.Detonated;
            deviceSprite.position.set(msg.devicePos.x, msg.devicePos.y);
            const deviceSize = 7.8;
            deviceSprite.width = deviceSize;
            deviceSprite.height = deviceSize;
        }
        for (let i = 0; i < 3; i++) {
            const sprite = this.zombieMissionElementSprites[i];
            if (!sprite) continue;
            sprite.visible = (msg.groundMask & (1 << i)) !== 0;
            if (!sprite.visible) continue;
            const pos = msg.elementPositions[i];
            sprite.position.set(pos.x, pos.y);
            const elementSize = 4.4;
            sprite.width = elementSize;
            sprite.height = elementSize;
        }
        if (performance.now() < this.zombieNukeShakeUntil) {
            this.m_camera.m_addShake(
                v2.copy(this.m_camera.m_pos),
                ZOMBIE_NUKE_SHAKE_CONTINUOUS_INTENSITY,
            );
        }
    }

    private applyZombieMissionMsg(msg: net.ZombieMissionMsg): void {
        const firstSnapshot = !this.zombieMissionSnapshotReceived;
        if (
            !firstSnapshot
            && msg.carriedElement !== this.zombieMissionPrevCarriedElement
            && msg.carriedElement !== 0xff
        ) {
            const elementName = ZOMBIE_MISSION_ELEMENT_NAMES[msg.carriedElement] ?? "元素";
            this.m_uiManager.displayAnnouncement(`已拾取${elementName}，当前负重`);
        }
        if (!firstSnapshot && msg.placedMask !== this.zombieMissionPrevPlacedMask) {
            const newlyPlacedMask = msg.placedMask & ~this.zombieMissionPrevPlacedMask;
            const placedIndex = ZOMBIE_MISSION_ELEMENT_NAMES.findIndex(
                (_name, index) => (newlyPlacedMask & (1 << index)) !== 0,
            );
            const elementName = ZOMBIE_MISSION_ELEMENT_NAMES[placedIndex] ?? "元素";
            this.m_uiManager.displayAnnouncement(`${elementName}已放入中心装置`);
        }
        const oldPhase = this.zombieMissionMsg?.phase ?? net.ZombieMissionPhase.Collecting;
        if (msg.phase === net.ZombieMissionPhase.Countdown) {
            const candidateDeadline = performance.now() + msg.countdownMs;
            // Never let a delayed/out-of-order snapshot make the visible timer
            // count backwards. Entering the phase establishes a fresh deadline;
            // subsequent authoritative snapshots may only correct it earlier.
            this.zombieMissionCountdownDeadline = oldPhase !== net.ZombieMissionPhase.Countdown
                    || this.zombieMissionCountdownDeadline <= 0
                ? candidateDeadline
                : Math.min(this.zombieMissionCountdownDeadline, candidateDeadline);
        } else {
            this.zombieMissionCountdownDeadline = 0;
        }
        if (
            msg.phase >= net.ZombieMissionPhase.Armed
            && (firstSnapshot || oldPhase < net.ZombieMissionPhase.Armed)
        ) {
            this.zombieMissionAlarm = this.m_audioManager.playSound("zombie_nuke_alarm", {
                channel: "sfx",
                loop: true,
                forceStart: true,
            });
            this.zombieMissionEvacuationSiren = this.m_audioManager.playSound(
                "zombie_nuke_evacuation_siren",
                {
                    channel: "sfx",
                    loop: true,
                    forceStart: true,
                },
            );
        }
        if (
            msg.nukeSequence !== this.zombieMissionLastNukeSequence
            && msg.phase === net.ZombieMissionPhase.Detonated
            && msg.nukeSequence !== 0
        ) {
            if (this.zombieMissionAlarm) {
                this.m_audioManager.stopSound(this.zombieMissionAlarm);
                this.zombieMissionAlarm = null;
            }
            if (this.zombieMissionEvacuationSiren) {
                this.m_audioManager.stopSound(this.zombieMissionEvacuationSiren);
                this.zombieMissionEvacuationSiren = null;
            }
            this.m_audioManager.playSound("zombie_nuke_explosion", {
                channel: "sfx",
                forceStart: true,
            });
            this.zombieNukeShakeUntil = performance.now() + ZOMBIE_NUKE_SHAKE_DURATION_MS;
            this.m_camera.m_addShake(
                v2.copy(this.m_camera.m_pos),
                ZOMBIE_NUKE_SHAKE_IMPACT_INTENSITY,
            );
            this.m_uiManager.displayAnnouncement(`核爆已消灭 ${msg.nukeKills} 只僵尸！`);
        }
        this.zombieMissionPrevPlacedMask = msg.placedMask;
        this.zombieMissionPrevCarriedElement = msg.carriedElement;
        this.zombieMissionLastNukeSequence = msg.nukeSequence;
        this.zombieMissionMsg = msg;
        this.zombieMissionSnapshotReceived = true;
    }

    update(dt: number) {
        this.debugHUD.m_update(dt, this);

        if (IS_DEV) {
            if (this.m_input.keyPressed(Key.Tilde)) {
                this.editor.setEnabled(!this.editor.enabled);
            }
            if (this.editor.enabled) {
                this.editor.m_update(this.m_input);
            }
        }

        let debug: DebugRenderOpts;
        if (IS_DEV) {
            debug = this.m_config.get("debugRenderer")!;
            dt *= this.editor.toolParams.gameSpeedEnabled
                ? this.editor.toolParams.gameSpeed
                : 1;
        } else {
            debug = {} as DebugRenderOpts;
        }

        this.refreshSandevistanConfig();
        const worldDt = dt * this.sandevistanWorldTimeScale();

        const smokeParticles = this.m_smokeBarn.m_particles;

        if (this.m_playing) {
            this.m_playingTicker += dt;
        }
        this.m_playerBarn.m_update(
            dt,
            this.m_activeId,
            this.m_renderer,
            this.m_particleBarn,
            this.m_camera,
            this.m_map,
            this.m_inputBinds,
            this.m_audioManager,
            this.m_ui2Manager,
            this.m_emoteBarn.wheelKeyTriggered,
            this.m_uiManager.displayingStats,
            this.m_spectating,
            this.sharedSpectator,
        );
        this.updateAmbience();

        if (this.m_spectating) {
            try {
                this.sandevistanFx.reset();
            } catch (_) {
                // Visual effects must never break the game loop.
            }
        } else {
            try {
                this.sandevistanFx.update(
                    dt,
                    this.m_activePlayer,
                    this.m_playing,
                    Boolean(this.m_map?.mapDef?.gameMode?.sandevistanMode),
                    this.sandevistanWorldTimeScale(),
                );
            } catch (_) {
                try {
                    this.sandevistanFx.reset();
                } catch (_) {
                    // Ignore visual cleanup errors.
                }
            }
        }

        if (this.m_spectating && this.freeSpectating) {
            this.updateFreeSpectateCamera(dt);
        } else {
            this.m_camera.m_pos = v2.copy(this.m_activePlayer.m_visualPos);
            this.m_camera.m_applyShake();
            const zoom = this.m_activePlayer.m_getZoom();
            const minDim = math.min(
                this.m_camera.m_screenWidth,
                this.m_camera.m_screenHeight,
            );
            const maxDim = math.max(
                this.m_camera.m_screenWidth,
                this.m_camera.m_screenHeight,
            );
            const maxScreenDim = math.max(minDim * (16 / 9), maxDim);
            this.m_camera.m_targetZoom = (maxScreenDim * 0.5) / (zoom * this.m_camera.m_ppu);
            const zoomLerpIn = this.m_activePlayer.zoomFast ? 3 : 2;
            const zoomLerpOut = this.m_activePlayer.zoomFast ? 3 : 1.4;
            const zoomLerp = this.m_camera.m_targetZoom > this.m_camera.m_zoom ? zoomLerpIn : zoomLerpOut;
            this.m_camera.m_zoom = math.lerp(
                dt * zoomLerp,
                this.m_camera.m_zoom,
                this.m_camera.m_targetZoom,
            );
        }
        this.m_audioManager.cameraPos = v2.copy(this.m_camera.m_pos);
        if (this.m_input.keyPressed(Key.Escape)) {
            this.m_uiManager.toggleEscMenu();
        }
        this.updateExtraction(dt);
        this.updateZombie(dt);
        // Large Map
        if (
            this.m_inputBinds.isBindPressed(Input.ToggleMap)
            || (this.m_input.keyPressed(Key.G) && !this.m_inputBinds.isKeyBound(Key.G))
        ) {
            this.m_uiManager.displayMapLarge(false);
        }
        // Minimap
        if (this.m_inputBinds.isBindPressed(Input.CycleUIMode)) {
            this.m_uiManager.cycleVisibilityMode();
        }
        // Hide UI
        if (
            this.m_inputBinds.isBindPressed(Input.HideUI)
            || (this.m_input.keyPressed(Key.Escape) && !this.m_uiManager.hudVisible)
        ) {
            this.m_uiManager.cycleHud();
        }
        // Update facing direction
        const playerPos = this.m_activePlayer.m_pos;
        const mousePos = v2.create(
            this.m_activePlayer.m_pos.x
                + (this.m_input.mousePos.x - this.m_camera.m_screenWidth * 0.5)
                    / this.m_camera.m_z(),
            this.m_activePlayer.m_pos.y
                + (this.m_camera.m_screenHeight * 0.5 - this.m_input.mousePos.y)
                    / this.m_camera.m_z(),
        );
        // const mousePos = this.m_camera.m_screenToPoint(this.m_input.mousePos);
        const toMousePos = v2.sub(mousePos, playerPos);
        let toMouseLen = v2.length(toMousePos);
        let toMouseDir = toMouseLen > 0.00001 ? v2.div(toMousePos, toMouseLen) : v2.create(1, 0);

        if (this.m_emoteBarn.wheelDisplayed) {
            toMouseLen = this.m_prevInputMsg.toMouseLen;
            toMouseDir = this.m_prevInputMsg.toMouseDir;
        }

        // Input
        const inputMsg = new net.InputMsg();
        inputMsg.seq = this.seq;
        if (!this.m_spectating) {
            if (device.touch) {
                const touchPlayerMovement = this.m_touch.getTouchMovement(this.m_camera);
                const touchAimMovement = this.m_touch.getAimMovement(
                    this.m_activePlayer,
                    this.m_camera,
                );
                let aimDir = v2.copy(touchAimMovement.aimMovement.toAimDir);
                this.m_touch.turnDirTicker -= dt;
                if (this.m_touch.moveDetected && !touchAimMovement.touched) {
                    // Keep looking in the old aimDir while waiting for the ticker
                    const touchDir = v2.normalizeSafe(
                        touchPlayerMovement.toMoveDir,
                        v2.create(1, 0),
                    );
                    const modifiedAimDir = this.m_touch.turnDirTicker < 0
                        ? touchDir
                        : touchAimMovement.aimMovement.toAimDir;
                    this.m_touch.setAimDir(modifiedAimDir);
                    aimDir = modifiedAimDir;
                }
                if (touchAimMovement.touched) {
                    this.m_touch.turnDirTicker = this.m_touch.turnDirCooldown;
                }
                if (this.m_touch.moveDetected) {
                    inputMsg.touchMoveDir = v2.normalizeSafe(
                        touchPlayerMovement.toMoveDir,
                        v2.create(1, 0),
                    );
                    inputMsg.touchMoveLen = Math.round(
                        math.clamp(touchPlayerMovement.toMoveLen, 0, 1) * 255,
                    );
                } else {
                    inputMsg.touchMoveLen = 0;
                }
                inputMsg.touchMoveActive = true;
                const aimLen = touchAimMovement.aimMovement.toAimLen;
                const toTouchLenAdjusted = math.clamp(aimLen / this.m_touch.padPosRange, 0, 1)
                    * GameConfig.player.throwableMaxMouseDist;
                inputMsg.toMouseLen = toTouchLenAdjusted;
                inputMsg.toMouseDir = aimDir;
            } else {
                // Only use arrow keys if they are unbound
                inputMsg.moveLeft = this.m_inputBinds.isBindDown(Input.MoveLeft)
                    || (this.m_input.keyDown(Key.Left)
                        && !this.m_inputBinds.isKeyBound(Key.Left));
                inputMsg.moveRight = this.m_inputBinds.isBindDown(Input.MoveRight)
                    || (this.m_input.keyDown(Key.Right)
                        && !this.m_inputBinds.isKeyBound(Key.Right));
                inputMsg.moveUp = this.m_inputBinds.isBindDown(Input.MoveUp)
                    || (this.m_input.keyDown(Key.Up)
                        && !this.m_inputBinds.isKeyBound(Key.Up));
                inputMsg.moveDown = this.m_inputBinds.isBindDown(Input.MoveDown)
                    || (this.m_input.keyDown(Key.Down)
                        && !this.m_inputBinds.isKeyBound(Key.Down));
                inputMsg.toMouseDir = v2.copy(toMouseDir);
                inputMsg.toMouseLen = toMouseLen;
            }
            inputMsg.touchMoveDir = v2.normalizeSafe(
                inputMsg.touchMoveDir,
                v2.create(1, 0),
            );
            inputMsg.touchMoveLen = math.clamp(inputMsg.touchMoveLen, 0, 255);
            inputMsg.toMouseDir = v2.normalizeSafe(inputMsg.toMouseDir, v2.create(1, 0));
            inputMsg.toMouseLen = math.clamp(
                inputMsg.toMouseLen,
                0,
                net.Constants.MouseMaxDist,
            );
            inputMsg.shootStart = this.m_inputBinds.isBindPressed(Input.Fire) || this.m_touch.shotDetected;
            inputMsg.shootHold = this.m_inputBinds.isBindDown(Input.Fire) || this.m_touch.shotDetected;
            inputMsg.portrait = this.m_camera.m_screenWidth < this.m_camera.m_screenHeight;
            const checkInputs = [
                Input.Reload,
                Input.Revive,
                Input.Use,
                Input.Loot,
                Input.Cancel,
                Input.EquipPrimary,
                Input.EquipSecondary,
                Input.EquipThrowable,
                Input.EquipMelee,
                Input.EquipNextWeap,
                Input.EquipPrevWeap,
                Input.EquipLastWeap,
                Input.EquipOtherGun,
                Input.EquipPrevScope,
                Input.EquipNextScope,
                Input.StowWeapons,
            ];
            for (let i = 0; i < checkInputs.length; i++) {
                const input = checkInputs[i];
                if (this.m_inputBinds.isBindPressed(input)) {
                    inputMsg.addInput(input);
                }
            }

            // Sandevistan activation: desktop uses the bound key/button, mobile
            // uses the dedicated HUD button (tap queued by ui2Manager).
            if (
                this.m_inputBinds.isBindPressed(Input.Sandevistan)
                || this.m_ui2Manager.sandevistanButtonPressed
            ) {
                inputMsg.addInput(Input.Sandevistan);
                this.m_ui2Manager.sandevistanButtonPressed = false;
            }

            // Handle Interact
            // Interact should not activate Revive, Use, or Loot if those inputs are bound separately.
            if (this.m_inputBinds.isBindPressed(Input.Interact)) {
                const inputs = [];
                const interactBinds = [Input.Revive, Input.Use, Input.Loot];
                for (let i = 0; i < interactBinds.length; i++) {
                    const b = interactBinds[i];
                    if (!this.m_inputBinds.getBind(b)) {
                        inputs.push(b);
                    }
                }
                if (inputs.length == interactBinds.length) {
                    inputMsg.addInput(Input.Interact);
                } else {
                    for (let i = 0; i < inputs.length; i++) {
                        inputMsg.addInput(inputs[i]);
                    }
                }
            }

            // Swap weapon slots
            if (
                this.m_inputBinds.isBindPressed(Input.SwapWeapSlots)
                || this.m_uiManager.swapWeapSlots
            ) {
                inputMsg.addInput(Input.SwapWeapSlots);
                this.m_activePlayer.gunSwitchCooldown = 0;
            }

            // Handle touch inputs
            if (this.m_uiManager.reloadTouched) {
                inputMsg.addInput(Input.Reload);
            }
            if (this.m_uiManager.interactionTouched) {
                inputMsg.addInput(Input.Interact);
                inputMsg.addInput(Input.Cancel);
            }

            // Process 'use' actions trigger from the ui
            for (let i = 0; i < this.m_ui2Manager.uiEvents.length; i++) {
                const e = this.m_ui2Manager.uiEvents[i];
                if (e.action == "use") {
                    if (e.type == "weapon") {
                        const weapIdxToInput = {
                            [WeaponSlot.Primary]: Input.EquipPrimary,
                            [WeaponSlot.Secondary]: Input.EquipSecondary,
                            [WeaponSlot.Melee]: Input.EquipMelee,
                            [WeaponSlot.Throwable]: Input.EquipThrowable,
                        };
                        const input = weapIdxToInput[e.data as keyof typeof weapIdxToInput];
                        if (input) {
                            inputMsg.addInput(input);
                        }
                    } else {
                        inputMsg.useItem = e.data as string;
                    }
                }
            }
            if (this.m_inputBinds.isBindPressed(Input.UseBandage)) {
                inputMsg.useItem = "bandage";
            } else if (this.m_inputBinds.isBindPressed(Input.UseHealthKit)) {
                inputMsg.useItem = "healthkit";
            } else if (this.m_inputBinds.isBindPressed(Input.UseSoda)) {
                inputMsg.useItem = "soda";
            } else if (this.m_inputBinds.isBindPressed(Input.UsePainkiller)) {
                inputMsg.useItem = "painkiller";
            }

            // Process 'drop' actions triggered from the ui
            let playDropSound = false;
            for (let X = 0; X < this.m_ui2Manager.uiEvents.length; X++) {
                const uiEvent = this.m_ui2Manager.uiEvents[X];
                if (uiEvent.action == "drop") {
                    const dropMsg = new net.DropItemMsg();
                    if (uiEvent.type == "weapon") {
                        const eventData = uiEvent.data as number;
                        const Y = this.m_activePlayer.m_localData.m_weapons;
                        dropMsg.item = Y[eventData].type;
                        dropMsg.weapIdx = eventData;
                    } else if (uiEvent.type == "perk") {
                        const eventData = uiEvent.data as number;
                        const J = this.m_activePlayer.m_netData.m_perks;
                        const Q = J.length > eventData ? J[eventData] : null;
                        if (Q?.droppable) {
                            dropMsg.item = Q.type;
                        }
                    } else {
                        const item = uiEvent.data == "helmet"
                            ? this.m_activePlayer.m_netData.m_helmet
                            : uiEvent.data == "chest"
                            ? this.m_activePlayer.m_netData.m_chest
                            : uiEvent.data;
                        dropMsg.item = item as string;
                    }
                    if (dropMsg.item != "") {
                        this.m_sendMessage(net.MsgType.DropItem, dropMsg, 128);
                        if (dropMsg.item != "fists") {
                            playDropSound = true;
                        }
                    }
                }
            }
            if (playDropSound) {
                this.m_audioManager.playSound("loot_drop_01", {
                    channel: "ui",
                });
            }
            if (this.m_uiManager.roleSelected) {
                const roleSelectMessage = new net.PerkModeRoleSelectMsg();
                roleSelectMessage.role = this.m_uiManager.roleSelected;
                this.m_sendMessage(
                    net.MsgType.PerkModeRoleSelect,
                    roleSelectMessage,
                    128,
                );
                this.m_config.set("perkModeRole", roleSelectMessage.role);
            }
        }
        let specAction = this.m_uiManager.specAction;
        if (
            specAction === SpectateAction.None
            && this.m_spectating
            && !this.freeSpectating
        ) {
            if (this.m_input.keyPressed(Key.Right)) {
                specAction = SpectateAction.Next;
            } else if (this.m_input.keyPressed(Key.Left)) {
                specAction = SpectateAction.Prev;
            }
        }
        const specBegin = specAction === SpectateAction.Begin;
        const specNext = specAction === SpectateAction.Next;
        const specPrev = specAction === SpectateAction.Prev;
        const specFreeToggle = this.m_uiManager.specFreeToggle;
        if (specFreeToggle) {
            this.freeSpectating = !this.freeSpectating;
            if (this.freeSpectating) {
                this.freeCameraPos = v2.create(this.m_map.width / 2, this.m_map.height / 2);
                this.freeCameraZoom = this.m_camera.m_zoom;
                this.freeCameraLastMouse = v2.copy(this.m_input.mousePos);
                this.freeCameraDirty = true;
            }
            this.m_uiManager.setFreeSpectating(this.freeSpectating);
        }
        if (
            this.m_spectating
            && this.freeSpectating
            && this.m_uiManager.specLayerRequested !== null
        ) {
            this.freeCameraLayer = math.clamp(this.m_uiManager.specLayerRequested, 0, 3);
            this.freeCameraDirty = true;
            this.m_uiManager.setSpectatorLayer(this.freeCameraLayer);
        }
        if ((specNext || specPrev || specBegin) && this.freeSpectating) {
            this.freeSpectating = false;
            this.m_uiManager.setFreeSpectating(false);
        }
        const nowMs = performance.now();
        const sendFreeCamera = this.m_spectating
            && this.freeSpectating
            && (this.freeCameraDirty || nowMs >= this.freeCameraNetAt);
        if (
            specBegin
            || (this.m_spectating && (specNext || specPrev))
            || specFreeToggle
            || this.m_uiManager.specPlayersOnlyChanged
            || sendFreeCamera
        ) {
            const specMsg = new net.SpectateMsg();
            specMsg.action = specAction;
            specMsg.specBegin = specBegin;
            specMsg.specNext = specNext;
            specMsg.specPrev = specPrev;
            specMsg.specForce = specNext || specPrev;
            specMsg.specFreeToggle = specFreeToggle;
            specMsg.specFreeActive = this.freeSpectating;
            specMsg.specPlayersOnlySet = this.m_uiManager.specPlayersOnlyChanged;
            specMsg.specPlayersOnly = this.m_uiManager.specPlayersOnly;
            if (this.freeSpectating) {
                specMsg.freeCameraPos = v2.copy(this.freeCameraPos);
                specMsg.freeCameraViewRadius = this.freeCameraViewRadius();
                specMsg.freeCameraLayer = this.freeCameraLayer;
                this.freeCameraDirty = false;
                this.freeCameraNetAt = nowMs + 90;
            }
            this.m_sendMessage(net.MsgType.Spectate, specMsg, 128);
        }
        this.m_uiManager.specAction = SpectateAction.None;
        this.m_uiManager.specFreeToggle = false;
        this.m_uiManager.specPlayersOnlyChanged = false;
        this.m_uiManager.specLayerRequested = null;
        if (this.m_spectating && this.m_uiManager.spectatorChatPending) {
            const chat = new net.SpectatorChatMsg();
            chat.text = this.m_uiManager.spectatorChatPending;
            this.m_uiManager.spectatorChatPending = "";
            this.m_sendMessage(net.MsgType.SpectatorChat, chat, 512);
        }
        this.m_uiManager.reloadTouched = false;
        this.m_uiManager.interactionTouched = false;
        this.m_uiManager.swapWeapSlots = false;
        this.m_uiManager.roleSelected = "";

        // Only send a InputMsg if the new data has changed from the previously sent data. For the look direction, we need to determine if the angle difference is large enough.
        let diff = false;
        for (const k in inputMsg) {
            if (inputMsg.hasOwnProperty(k)) {
                if (k == "inputs") {
                    diff = inputMsg[k].length > 0;
                } else if (k == "toMouseDir" || k == "touchMoveDir") {
                    const dot = math.clamp(
                        v2.dot(inputMsg[k], this.m_prevInputMsg[k]),
                        -1,
                        1,
                    );
                    const angle = math.rad2deg(Math.acos(dot));
                    diff = angle > 0.1;
                } else if (k == "toMouseLen") {
                    diff = Math.abs(this.m_prevInputMsg[k] - inputMsg[k]) > 0.5;
                } else if (k == "shootStart") {
                    diff = inputMsg[k] || inputMsg[k] != this.m_prevInputMsg[k];
                } else if (
                    this.m_prevInputMsg[k as keyof typeof this.m_prevInputMsg]
                        != inputMsg[k as keyof typeof inputMsg]
                ) {
                    diff = true;
                }
                if (diff) {
                    break;
                }
            }
        }
        this.m_inputMsgTimeout -= dt;
        if (diff || this.m_inputMsgTimeout < 0) {
            if (!this.seqInFlight) {
                this.seq = (this.seq + 1) % 256;
                this.seqSendTime = Date.now();
                this.seqInFlight = true;
                inputMsg.seq = this.seq;
            }
            this.m_sendMessage(net.MsgType.Input, inputMsg, 128);
            this.m_inputMsgTimeout = 1;
            this.m_prevInputMsg = inputMsg;
        }

        // Clear cached data
        this.m_ui2Manager.flushInput();

        if (IS_DEV && this.editor.enabled && this.editor.sendMsg) {
            var msg = this.editor.getMsg();
            this.m_sendMessage(net.MsgType.Edit, msg);
            this.editor.postSerialization();
        }

        this.m_map.m_update(
            dt,
            this.m_activePlayer,
            this.m_playerBarn,
            this.m_particleBarn,
            this.m_audioManager,
            this.m_ambience,
            this.m_renderer,
            this.m_camera,
            smokeParticles,
            debug,
            // The spectator occluder-transparency toggle must work while
            // following any target (not only free camera), so roofs and walls
            // reveal what the watched player's view would hide.
            this.m_spectating && this.m_uiManager.specTransparentObstacles,
        );
        this.m_lootBarn.m_update(
            dt,
            this.m_activePlayer,
            this.m_map,
            this.m_audioManager,
            this.m_camera,
            debug,
        );
        this.m_bulletBarn.m_update(
            worldDt,
            this.m_playerBarn,
            this.m_map,
            this.m_camera,
            this.m_activePlayer,
            this.m_renderer,
            this.m_particleBarn,
            this.m_audioManager,
        );
        this.m_flareBarn.m_update(
            worldDt,
            this.m_map,
            this.m_activePlayer,
            this.m_renderer,
        );
        this.m_projectileBarn.m_update(
            worldDt,
            this.m_particleBarn,
            this.m_audioManager,
            this.m_activePlayer,
            this.m_map,
            this.m_renderer,
            this.m_camera,
        );
        this.m_explosionBarn.m_update(
            dt,
            this.m_map,
            this.m_playerBarn,
            this.m_camera,
            this.m_particleBarn,
            this.m_audioManager,
            debug,
        );
        this.m_airdropBarn.m_update(
            dt,
            this.m_activePlayer,
            this.m_camera,
            this.m_map,
            this.m_particleBarn,
            this.m_renderer,
            this.m_audioManager,
        );
        this.m_planeBarn.m_update(
            dt,
            this.m_camera,
            this.m_activePlayer,
            this.m_map,
            this.m_renderer,
        );
        this.m_smokeBarn.m_update(
            dt,
            this.m_camera,
            this.m_activePlayer,
            this.m_map,
            this.m_renderer,
        );
        this.m_shotBarn.m_update(
            dt,
            this.m_activeId,
            this.m_playerBarn,
            this.m_particleBarn,
            this.m_audioManager,
        );
        this.m_particleBarn.m_update(dt, this.m_camera);
        this.m_deadBodyBarn.m_update(
            dt,
            this.m_playerBarn,
            this.m_activePlayer,
            this.m_map,
            this.m_camera,
            this.m_renderer,
        );
        this.m_decalBarn.m_update(dt, this.m_camera, this.m_renderer);
        this.m_uiManager.m_update(
            dt,
            this.m_activePlayer,
            this.m_map,
            this.m_gas,
            this.m_playerBarn,
            this.m_camera,
            this.teamMode,
            this.m_map.factionMode,
        );
        this.m_ui2Manager.m_update(
            dt,
            this.m_activePlayer,
            this.m_spectating,
            this.m_playerBarn,
            this.m_lootBarn,
            this.m_map,
            this.m_inputBinds,
        );
        this.m_emoteBarn.m_update(
            dt,
            this.m_localId,
            this.m_activePlayer,
            this.teamMode,
            this.m_deadBodyBarn,
            this.m_map,
            this.m_renderer,
            this.m_input,
            this.m_inputBinds,
            this.m_spectating,
        );
        this.m_touch.m_update(
            dt,
            this.m_activePlayer,
            this.m_map,
            this.m_camera,
            this.m_renderer,
        );
        this.m_renderer.m_update(dt, this.m_camera, this.m_map, debug?.structures?.layerMasks);

        for (let i = 0; i < this.m_emoteBarn.newPings.length; i++) {
            const ping = this.m_emoteBarn.newPings[i];
            const msg = new net.EmoteMsg();
            msg.type = ping.type;
            msg.pos = ping.pos;
            msg.isPing = true;
            this.m_sendMessage(net.MsgType.Emote, msg, 128);
        }
        this.m_emoteBarn.newPings = [];
        for (let i = 0; i < this.m_emoteBarn.newEmotes.length; i++) {
            const emote = this.m_emoteBarn.newEmotes[i];
            const msg = new net.EmoteMsg();
            msg.type = emote.type;
            msg.pos = emote.pos;
            msg.isPing = false;
            this.m_sendMessage(net.MsgType.Emote, msg, 128);
        }
        this.m_emoteBarn.newEmotes = [];

        const now = Date.now();
        if (now > this.debugPingTime) {
            this.debugPingTime = now + 20000;
            function format(str: string, len: number) {
                return (" ".repeat(len) + str).slice(-len);
            }
            const pings = this.pings.sort((a, b) => {
                return a - b;
            });
            const pLen = pings.length;
            if (pLen > 0) {
                const med = pings[Math.floor(pLen * 0.5)];
                const p95 = pings[Math.floor(pLen * 0.95)];
                const max = pings[pLen - 1];
                console.log(
                    "Ping     min:",
                    format(pings[0].toFixed(2), 7),
                    "med:",
                    format(med.toFixed(2), 7),
                    "p95:",
                    format(p95.toFixed(2), 7),
                    "max:",
                    format(max.toFixed(2), 7),
                );
            }
            this.pings = [];

            const intervals = this.updateIntervals.sort((a, b) => {
                return a - b;
            });
            const inteLen = intervals.length;
            if (inteLen > 0) {
                const med = intervals[Math.floor(inteLen * 0.5)];
                const p95 = intervals[Math.floor(inteLen * 0.95)];
                const max = intervals[inteLen - 1];
                console.log(
                    "Interval min:",
                    format(intervals[0].toFixed(2), 7),
                    "med:",
                    format(med.toFixed(2), 7),
                    "p95:",
                    format(p95.toFixed(2), 7),
                    "max:",
                    format(max.toFixed(2), 7),
                );
            }
            this.updateIntervals = [];
        }

        this.m_render(dt, debug);
    }

    m_render(dt: number, debug: DebugRenderOpts) {
        const grassColor = this.m_map.mapLoaded
            ? this.m_map.getMapDef().biome.colors.grass
            : 0x80af49;
        this.m_pixi.renderer.background.color = grassColor;
        // Module rendering
        this.m_playerBarn.m_render(this.m_camera, debug);
        this.m_bulletBarn.m_render(this.m_camera);
        this.m_flareBarn.m_render(this.m_camera);
        this.m_decalBarn.m_render(this.m_camera, debug, this.m_activePlayer.layer);
        this.m_map.m_render(this.m_camera);
        this.m_gas.m_render(dt, this.m_camera);
        this.m_uiManager.m_render(
            this.m_activePlayer.m_pos,
            this.m_gas,
            this.m_map,
            this.m_planeBarn,
        );
        this.m_emoteBarn.m_render(this.m_camera);
        if (IS_DEV) {
            this.m_debugDisplay.clear();
            if (debug.enabled) {
                debugLines.m_render(this.m_camera, this.m_debugDisplay);
            }
            debugLines.flush();
        }
    }

    updateAmbience() {
        const playerPos = this.m_activePlayer.m_pos;
        let wavesWeight = 0;
        let riverWeight = 0;
        let windWeight = 1;
        if (this.m_map.isInOcean(playerPos)) {
            wavesWeight = 1;
            riverWeight = 0;
            windWeight = 0;
        } else {
            const dist = this.m_map.distanceToShore(playerPos);
            wavesWeight = math.delerp(dist, 50, 0);
            riverWeight = 0;
            for (let i = 0; i < this.m_map.terrain!.rivers.length; i++) {
                const river = this.m_map.terrain?.rivers[i]!;
                const closestPointT = river.spline.getClosestTtoPoint(playerPos);
                const closestPoint = river.spline.getPos(closestPointT);
                const distanceToRiver = v2.length(v2.sub(closestPoint, playerPos));
                const riverWidth = river.waterWidth + 2;
                const normalizedDistance = math.delerp(
                    distanceToRiver,
                    30 + riverWidth,
                    riverWidth,
                );
                const riverStrength = math.clamp(river.waterWidth / 8, 0.25, 1);
                riverWeight = math.max(normalizedDistance * riverStrength, riverWeight);
            }
            if (this.m_activePlayer.layer == 1) {
                riverWeight = 0;
            }
            windWeight = 1;
        }
        this.m_ambience.getTrack("wind").weight = windWeight;
        this.m_ambience.getTrack("river").weight = riverWeight;
        this.m_ambience.getTrack("waves").weight = wavesWeight;
    }

    resize() {
        this.m_camera.m_screenWidth = device.screenWidth;
        this.m_camera.m_screenHeight = device.screenHeight;
        this.m_map.resize(this.m_pixi.renderer, this.m_canvasMode);
        this.m_gas.resize();
        this.m_uiManager.resize(this.m_map, this.m_camera);
        this.m_touch.resize();
        this.m_renderer.resize(this.m_map, this.m_camera);
    }

    m_processGameUpdate(msg: net.UpdateMsg) {
        // Latency determination
        // calculate this before the rest of this function
        // so client-side lag caused by the rest of the code wont count
        // on the server latency and update interval measurements
        const now = Date.now();
        this.m_updateRecvCount++;
        if (msg.ack == this.seq && this.seqInFlight) {
            this.seqInFlight = false;
            const ping = now - this.seqSendTime;
            this.debugHUD.pingGraph.addEntry(ping);
            this.pings.push(ping);
        }
        if (this.lastUpdateTime > 0) {
            const interval = now - this.lastUpdateTime;
            this.m_camera.m_interpInterval = interval / 1000;
            this.debugHUD.updateIntervalGraph.addEntry(interval);
            this.updateIntervals.push(interval);
        }
        this.lastUpdateTime = now;

        const ctx: Ctx = {
            audioManager: this.m_audioManager,
            renderer: this.m_renderer,
            particleBarn: this.m_particleBarn,
            map: this.m_map,
            smokeBarn: this.m_smokeBarn,
            decalBarn: this.m_decalBarn,
        };
        // Update active playerId
        if (msg.activePlayerIdDirty) {
            this.m_activeId = msg.activePlayerId;
        }
        // Update player infos
        for (let i = 0; i < msg.playerInfos.length; i++) {
            this.m_playerBarn.setPlayerInfo(msg.playerInfos[i]);
        }
        // Delete player infos
        for (let i = 0; i < msg.deletedPlayerIds.length; i++) {
            const playerId = msg.deletedPlayerIds[i];
            this.m_playerBarn.deletePlayerInfo(playerId);
        }
        if (msg.playerInfos.length > 0 || msg.deletedPlayerIds.length > 0) {
            this.m_playerBarn.recomputeTeamData();
        }
        // Update player status
        if (msg.playerStatusDirty) {
            const teamId = this.m_playerBarn.getPlayerInfo(this.m_activeId).teamId;
            this.m_playerBarn.updatePlayerStatus(
                teamId,
                msg.playerStatus,
                this.m_map.factionMode,
            );
        }

        // Update group status
        if (msg.groupStatusDirty) {
            const groupId = this.m_playerBarn.getPlayerInfo(this.m_activeId).groupId;
            this.m_playerBarn.updateGroupStatus(groupId, msg.groupStatus);
        }

        // Delete objects
        for (let i = 0; i < msg.delObjIds.length; i++) {
            this.m_objectCreator.m_deleteObj(msg.delObjIds[i]);
        }

        // Update full objects
        for (let i = 0; i < msg.fullObjects.length; i++) {
            const obj = msg.fullObjects[i];
            this.m_objectCreator.m_updateObjFull(obj.__type, obj.__id, obj, ctx);
        }

        // Update partial objects
        for (let i = 0; i < msg.partObjects.length; i++) {
            const obj = msg.partObjects[i];

            const clientType = this.m_objectCreator.m_getObjById(obj.__id)?.__type ?? 0;
            if (obj.__type !== clientType) {
                const errString = `updateObjPart: type mismatch, received ${obj.__type}, client has ${clientType};`;
                errorLogManager.logError(errString, {
                    id: obj.__id,
                    ids: Object.keys(this.m_objectCreator.m_idToObj),
                    msg,
                });
                console.error(errString);
                continue;
            }

            this.m_objectCreator.m_updateObjPart(obj.__id, obj, ctx);
        }
        const aimTrainingHuman = this.m_map.mapName === "aim_training"
            && !this.joinedSpectatorOnly
            && !this.joinedTrainingTarget;
        // A previous spectator implementation inferred connection identity from
        // activePlayerId. During target reconnects that can transiently point at
        // the bot and turn the human into an observer. Training humans always
        // own their local player object; camera-target changes are ignored here.
        if (aimTrainingHuman) this.m_activeId = this.m_localId;
        this.m_spectating = this.joinedSpectatorOnly || this.m_activeId != this.m_localId;
        if (!this.m_spectating && this.freeSpectating) {
            this.freeSpectating = false;
            this.m_uiManager.setFreeSpectating(false);
        }
        let activePlayer = this.m_playerBarn.getPlayerById(this.m_activeId);
        if (!activePlayer && aimTrainingHuman) {
            activePlayer = this.m_playerBarn.getPlayerById(this.m_localId);
            this.m_activeId = this.m_localId;
        }
        if (!activePlayer) {
            console.warn(`Missing active player ${this.m_activeId}; local=${this.m_localId}`);
            return;
        }
        this.m_activePlayer = activePlayer;
        this.m_activePlayer.m_setLocalData(msg.activePlayerData);
        if (msg.activePlayerData.weapsDirty) {
            this.m_uiManager.weapsDirty = true;
        }
        if (this.m_spectating) {
            this.m_uiManager.setSpectateTarget(
                this.m_activeId,
                this.m_localId,
                this.teamMode,
                this.m_playerBarn,
            );
            if (this.freeSpectating) {
                this.m_uiManager.setFreeSpectating(true);
            }
            this.m_touch.hideAll();
        }
        const cameraLayer = this.freeSpectating
            ? this.freeCameraLayer
            : this.m_activePlayer.m_netData.m_layer;
        // `layer` is the local rendering layer; `netData.layer` remains the
        // selected player's authoritative layer. Free camera must update this
        // value too so tunnel buildings, loot and effects render correctly.
        this.m_activePlayer.layer = cameraLayer;
        this.m_renderer.setActiveLayer(cameraLayer);
        this.m_audioManager.activeLayer = cameraLayer;
        const underground = cameraLayer > 0 || this.m_activePlayer.isUnderground(this.m_map);
        this.m_renderer.setUnderground(underground);
        this.m_audioManager.underground = underground;

        // Gas data
        if (msg.gasDirty) {
            this.m_gas.setFullState(msg.gasT, msg.gasData, this.m_uiManager);
        }
        if (msg.gasTDirty) {
            this.m_gas.setProgress(msg.gasT);
        }

        // Create bullets
        for (let i = 0; i < msg.bullets.length; i++) {
            const b = msg.bullets[i];
            createBullet(
                b,
                this.m_bulletBarn,
                this.m_flareBarn,
                this.m_playerBarn,
                this.m_renderer,
            );
            if (b.shotFx) {
                this.m_shotBarn.addShot(b);
            }
        }
        // Create explosions
        for (let i = 0; i < msg.explosions.length; i++) {
            const e = msg.explosions[i];
            this.m_explosionBarn.addExplosion(e.type, e.pos, e.layer);
        }

        // Create emotes and pings
        for (let i = 0; i < msg.emotes.length; i++) {
            const e = msg.emotes[i];
            if (e.isPing) {
                this.m_emoteBarn.addPing(e, this.m_map.factionMode);
            } else {
                this.m_emoteBarn.addEmote(e);
            }
        }

        // Update planes
        this.m_planeBarn.updatePlanes(msg.planes, this.m_map);

        // Create airstrike zones
        for (let x = 0; x < msg.airstrikeZones.length; x++) {
            this.m_planeBarn.createAirstrikeZone(msg.airstrikeZones[x]);
        }

        // Update map indicators
        this.m_uiManager.updateMapIndicators(msg.mapIndicators);

        // Update kill leader
        if (msg.killLeaderDirty) {
            // ui.ts 用 .text() 渲染击杀王名字，这里传原始名字即可（不再预转义，
            // 避免 .text() 把实体二次转义显示成 &amp;lt; 等）。
            const leaderNameText = this.m_playerBarn.getPlayerName(
                msg.killLeaderId,
                this.m_activeId,
                true,
            );
            this.m_uiManager.updateKillLeader(
                msg.killLeaderId,
                leaderNameText,
                msg.killLeaderKills,
                this.m_map.getMapDef().gameMode,
            );
        }
    }

    // Socket functions
    m_onMsg(type: net.MsgType, stream: net.BitStream) {
        switch (type) {
            case net.MsgType.Joined: {
                const msg = new net.JoinedMsg();
                msg.deserialize(stream);
                if (!this.initialized) {
                    this.onJoin();
                } else {
                    // 保留画面自动重连成功：服务器重发完整快照（Joined + Map +
                    // 全量 Update），先清空本地世界再重新初始化，避免旧对象残留。
                    this.free(true);
                    this.connected = true;
                    this.onJoin();
                }
                this.teamMode = msg.teamMode;
                this.m_localId = msg.playerId;
                this.joinedSpectatorOnly = msg.spectatorOnly;
                this.joinedTrainingTarget = msg.trainingTarget;
                this.sharedSpectator = msg.spectatorOnly;
                const aimSettingsButton = document.getElementById("aim-training-settings-open");
                if (aimSettingsButton) {
                    aimSettingsButton.hidden = this.m_map.mapName === "aim_training"
                        && (this.joinedSpectatorOnly || this.joinedTrainingTarget);
                }
                this.m_validateAlpha = true;
                this.m_emoteBarn.updateEmoteWheel(msg.emotes);
                // Always apply the authoritative state. Spectators can join an
                // AI duel immediately after both contestants connect, and the
                // UI defaults to the waiting overlay until explicitly cleared.
                this.m_uiManager.setWaitingForPlayers(!msg.started);
                this.m_uiManager.removeAds();
                if (this.victoryMusic) {
                    this.victoryMusic.stop();
                    this.victoryMusic = null;
                }
                // Play a sound if the user in another windows or tab
                if (!document.hasFocus()) {
                    this.m_audioManager.playSound("notification_start_01", {
                        channel: "ui",
                    });
                }
                if (IS_DEV) {
                    if (this.editor.enabled) {
                        this.editor.sendMsg = true;
                    }
                }

                SDK.gamePlayStart();
                break;
            }
            case net.MsgType.Map: {
                const msg = new net.MapMsg();
                msg.deserialize(stream);
                this.m_map.loadMap(
                    msg,
                    this.m_camera,
                    this.m_canvasMode,
                    this.m_particleBarn,
                );
                // Map-specific assets can only be initialized after MapMsg has
                // populated the concrete map definition.
                if (this.m_map.getMapDef().gameMode.zombieMode) {
                    this.initializeZombieMissionIcons();
                }
                this.m_resourceManager.loadMapAssets(this.m_map.mapName);
                this.m_map.renderMap(this.m_pixi.renderer, this.m_canvasMode);
                this.m_renderer.resize(this.m_map, this.m_camera);
                this.m_bulletBarn.onMapLoad(this.m_map);
                this.m_particleBarn.onMapLoad(this.m_map);
                this.m_uiManager.onMapLoad(this.m_map, this.m_camera);

                const aimTraining = this.m_map.mapName === "aim_training";
                document.body.classList.toggle("aim-training-active", aimTraining);
                const aimStats = document.getElementById("ui-aim-training-stats");
                if (aimStats) aimStats.hidden = !aimTraining;
                const aimSettingsButton = document.getElementById("aim-training-settings-open");
                if (aimSettingsButton) {
                    aimSettingsButton.hidden = aimTraining
                        && (this.joinedSpectatorOnly || this.joinedTrainingTarget);
                }
                if (aimTraining) {
                    if (!this.joinedSpectatorOnly && !this.joinedTrainingTarget) {
                        this.sharedSpectator = false;
                        this.freeSpectating = false;
                        this.m_uiManager.setFreeSpectating(false);
                        this.m_uiManager.setSpectating(false, this.teamMode);
                    }
                    this.m_uiManager.setWaitingForPlayers(true);
                    $("#ui-waiting-text").text("正在连接移动标靶…");
                    const duelScore = document.getElementById("ui-duel-score");
                    if (duelScore) duelScore.style.display = "none";
                    $("#aim-training-shots, #aim-training-hits").text("0");
                    $("#aim-training-accuracy").text("0.0%");
                    $("#aim-training-damage").text("0.0");
                    $("#aim-training-meta").text("正在同步训练设置…");
                } else if (!this.m_map.getMapDef().arena?.rounds) {
                    const duelScore = document.getElementById("ui-duel-score");
                    if (duelScore) duelScore.style.display = "none";
                }
                if (this.m_map.perkMode) {
                    const player = this.m_activePlayer as Player | undefined;
                    if (!player?.m_netData.m_role) {
                        const role = this.m_config.get("perkModeRole")!;
                        this.m_uiManager.setRoleMenuOptions(
                            role,
                            this.m_map.getMapDef().gameMode.perkModeRoles!,
                        );
                        this.m_uiManager.setRoleMenuActive(true);
                    }
                } else {
                    this.m_uiManager.setRoleMenuActive(false);
                }

                if (IS_DEV) {
                    this.editor.toolParams.mapSeed = msg.seed;
                    this.editor.pane.refresh();
                }
                break;
            }
            case net.MsgType.Update: {
                const msg = new net.UpdateMsg();
                msg.deserialize(stream, this.m_objectCreator);
                this.m_playing = true;
                this.m_processGameUpdate(msg);
                break;
            }
            case net.MsgType.Kill: {
                const msg = new net.KillMsg();
                msg.deserialize(stream);
                // 搜打撤撤离成功：物资已入库，提示并返回仓库页。
                if (
                    msg.killed
                    && msg.damageType === GameConfig.DamageType.Extraction
                    && msg.targetId === this.m_localId
                    && !this.extractionSuccessShown
                ) {
                    this.extractionSuccessShown = true;
                    this.m_uiManager.displayAnnouncement(
                        "撤离成功，物资已存入仓库",
                    );
                    window.setTimeout(() => {
                        window.location.href = "/storage";
                    }, 1800);
                }
                const sourceType = msg.itemSourceType || msg.mapSourceType;
                const activeTeamId = this.m_playerBarn.getPlayerInfo(
                    this.m_activeId,
                ).teamId;
                const useKillerInfoInFeed = (msg.downed && !msg.killed)
                    || msg.damageType == GameConfig.DamageType.Gas
                    || msg.damageType == GameConfig.DamageType.Bleeding
                    || msg.damageType == GameConfig.DamageType.Airdrop;
                const targetInfo = this.m_playerBarn.getPlayerInfo(msg.targetId);
                const killerInfo = this.m_playerBarn.getPlayerInfo(msg.killCreditId);
                const killfeedKillerInfo = useKillerInfoInFeed
                    ? killerInfo
                    : this.m_playerBarn.getPlayerInfo(msg.killerId);
                let targetName = this.m_playerBarn.getPlayerName(
                    targetInfo.playerId,
                    this.m_activeId,
                    true,
                );
                let killerName = this.m_playerBarn.getPlayerName(
                    killerInfo.playerId,
                    this.m_activeId,
                    true,
                );
                let killfeedKillerName = this.m_playerBarn.getPlayerName(
                    killfeedKillerInfo.playerId,
                    this.m_activeId,
                    true,
                );
                targetName = helpers.htmlEscape(targetName);
                killerName = helpers.htmlEscape(killerName);
                killfeedKillerName = helpers.htmlEscape(killfeedKillerName);
                // Display the kill / downed notification for the active player
                if (msg.killCreditId == this.m_activeId) {
                    const completeKill = msg.killerId == this.m_activeId;
                    const suicide = msg.killCreditId == msg.targetId;
                    const killText = this.m_ui2Manager.getKillText(
                        killerName,
                        targetName,
                        completeKill,
                        msg.downed,
                        msg.killed,
                        suicide,
                        sourceType,
                        msg.damageType,
                        this.m_spectating,
                    );
                    const killCountText = msg.killed && !suicide
                        ? this.m_ui2Manager.getKillCountText(msg.killerKills)
                        : "";
                    this.m_ui2Manager.displayKillMessage(killText, killCountText);
                } else if (msg.targetId == this.m_activeId && msg.downed && !msg.killed) {
                    const downedText = this.m_ui2Manager.getDownedText(
                        killerName,
                        targetName,
                        sourceType,
                        msg.damageType,
                        this.m_spectating,
                    );
                    this.m_ui2Manager.displayKillMessage(downedText, "");
                }

                // Update local kill counter
                if (msg.killCreditId == this.m_localId && msg.killed) {
                    this.m_uiManager.setLocalKills(msg.killerKills);
                }

                // Add killfeed entry for this kill
                const killText = this.m_ui2Manager.getKillFeedText(
                    targetName,
                    killfeedKillerInfo.teamId ? killfeedKillerName : "",
                    sourceType,
                    msg.damageType,
                    msg.downed && !msg.killed,
                );
                const killColor = this.m_ui2Manager.getKillFeedColor(
                    activeTeamId,
                    targetInfo.teamId,
                    killerInfo.teamId,
                    this.m_map.factionMode,
                );
                this.m_ui2Manager.addKillFeedMessage(killText, killColor);
                if (msg.killed) {
                    this.m_playerBarn.addDeathEffect(
                        msg.targetId,
                        msg.killerId,
                        this.m_audioManager,
                        this.m_particleBarn,
                    );
                }

                // Bullets often don't play hit sounds on the frame that a player dies
                if (msg.damageType == GameConfig.DamageType.Player) {
                    this.m_bulletBarn.createBulletHit(
                        this.m_playerBarn,
                        msg.targetId,
                        this.m_audioManager,
                    );
                }

                break;
            }
            case net.MsgType.AimTrainingStats: {
                const msg = new net.AimTrainingStatsMsg();
                msg.deserialize(stream);
                this.m_uiManager.setWaitingForPlayers(!msg.targetReady);
                $("#ui-waiting-text").text(
                    msg.targetReady ? "移动标靶已连接" : "移动标靶正在自动重连…",
                );
                const accuracy = msg.shotsFired > 0 ? msg.hits / msg.shotsFired * 100 : 0;
                $("#aim-training-shots").text(msg.shotsFired.toLocaleString());
                $("#aim-training-hits").text(msg.hits.toLocaleString());
                $("#aim-training-accuracy").text(`${accuracy.toFixed(1)}%`);
                $("#aim-training-damage").text(msg.damageDealt.toFixed(1));
                const movement = msg.omnidirectionalRandomMovement
                    ? "全向随机"
                    : msg.verticalRandomMovement
                    ? "上下随机"
                    : "静止";
                $("#aim-training-meta").text(
                    `${
                        msg.targetReady
                            ? "标靶在线"
                            : "标靶复活中"
                    } · ${msg.weapon0} / ${msg.weapon1} · ${msg.throwable} · AI预估距离 ${msg.distance} · ${
                        msg.targetBoost > 0 ? `激素阶段 ${msg.targetBoost}` : "无激素"
                    } · ${movement} · ${msg.dodgeBullets ? "躲弹开启" : "躲弹关闭"} · ${
                        msg.infiniteMagazine ? "弹匣无限" : "正常换弹"
                    } · 头${msg.helmetLevel}/甲${msg.chestLevel} · ${
                        msg.normalHealth ? "正常生命（自动复活）" : "无限生命"
                    }`,
                );
                window.dispatchEvent(
                    new CustomEvent("aim-training-settings-sync", {
                        detail: {
                            weapon0: msg.weapon0,
                            weapon1: msg.weapon1,
                            throwable: msg.throwable,
                            infiniteMagazine: msg.infiniteMagazine,
                            targetBoost: msg.targetBoost,
                            helmetLevel: msg.helmetLevel,
                            chestLevel: msg.chestLevel,
                            normalHealth: msg.normalHealth,
                            distance: msg.distance,
                            verticalRandomMovement: msg.verticalRandomMovement,
                            omnidirectionalRandomMovement: msg.omnidirectionalRandomMovement,
                            dodgeBullets: msg.dodgeBullets,
                        },
                    }),
                );
                break;
            }
            case net.MsgType.SpectatorOverlay: {
                const msg = new net.SpectatorOverlayMsg();
                msg.deserialize(stream);
                if (
                    this.m_map.mapName === "aim_training"
                    && !this.joinedSpectatorOnly
                ) {
                    break;
                }
                this.sharedSpectator = true;
                this.m_playerBarn.applySpectatorOverlay(msg.players);
                break;
            }
            case net.MsgType.SpectatorChat: {
                const msg = new net.SpectatorChatMsg();
                msg.deserialize(stream);
                if (msg.delivered) {
                    if (this.m_spectating) {
                        this.m_uiManager.appendSpectatorChat(msg.sender, msg.text);
                    } else {
                        this.m_uiManager.showSpectatorMessage(msg.sender, msg.text);
                    }
                }
                break;
            }
            case net.MsgType.ArenaRound: {
                const msg = new net.ArenaRoundMsg();
                msg.deserialize(stream);
                if (this.m_map.mapName !== "aim_training") {
                    this.updateArenaRoundUi(msg);
                }
                break;
            }
            case net.MsgType.RoleAnnouncement: {
                const msg = new net.RoleAnnouncementMsg();
                msg.deserialize(stream);
                const roleDef = GameObjectDefs.typeToDef(msg.role, "role");
                const playerInfo = this.m_playerBarn.getPlayerInfo(msg.playerId);
                const nameText = helpers.htmlEscape(
                    this.m_playerBarn.getPlayerName(msg.playerId, this.m_activeId, true),
                );
                if (msg.assigned) {
                    if (roleDef.sound?.assign) {
                        if (
                            msg.role == "kill_leader"
                            && this.m_map.getMapDef().gameMode.spookyKillSounds
                        ) {
                            // Halloween map has special logic for the kill leader sounds
                            this.m_audioManager.playGroup("kill_leader_assigned", {
                                channel: "ui",
                            });
                        } else if (
                            // The intent here is to not play the role-specific assignment sounds in perkMode unless you're the player selecting a role.
                            msg.role == "kill_leader"
                            || !this.m_map.perkMode
                            || this.m_localId == msg.playerId
                        ) {
                            this.m_audioManager.playSound(roleDef.sound.assign, {
                                channel: "ui",
                            });
                        }
                    }
                    if (this.m_map.perkMode && this.m_localId == msg.playerId) {
                        this.m_uiManager.setRoleMenuActive(false);
                    }
                    if (roleDef.killFeed?.assign) {
                        // In addition to playing a sound, display a notification on the killfeed
                        const killText = this.m_ui2Manager.getRoleAssignedKillFeedText(
                            msg.role,
                            playerInfo.teamId,
                            nameText,
                        );
                        const killColor = this.m_ui2Manager.getRoleKillFeedColor(
                            msg.role,
                            playerInfo.teamId,
                            this.m_playerBarn,
                        );
                        this.m_ui2Manager.addKillFeedMessage(killText, killColor);
                    }
                    // Show an announcement if you've been assigned a role
                    if (roleDef.announce && this.m_localId == msg.playerId) {
                        const assignText = this.m_ui2Manager.getRoleAnnouncementText(
                            msg.role,
                            playerInfo.teamId,
                        );
                        this.m_uiManager.displayAnnouncement(assignText.toUpperCase());
                    }
                } else if (msg.killed) {
                    if (roleDef.killFeed?.dead) {
                        let killerName = helpers.htmlEscape(
                            this.m_playerBarn.getPlayerName(
                                msg.killerId,
                                this.m_activeId,
                                true,
                            ),
                        );

                        if (msg.playerId == msg.killerId) {
                            killerName = "";
                        }
                        const killText = this.m_ui2Manager.getRoleKilledKillFeedText(
                            msg.role,
                            playerInfo.teamId,
                            killerName,
                        );
                        const killColor = this.m_ui2Manager.getRoleKillFeedColor(
                            msg.role,
                            playerInfo.teamId,
                            this.m_playerBarn,
                        );
                        this.m_ui2Manager.addKillFeedMessage(killText, killColor);
                    }
                    if (roleDef.sound?.dead) {
                        if (this.m_map.getMapDef().gameMode.spookyKillSounds) {
                            this.m_audioManager.playGroup("kill_leader_dead", {
                                channel: "ui",
                            });
                        } else {
                            this.m_audioManager.playSound(roleDef.sound.dead, {
                                channel: "ui",
                            });
                        }
                    }
                }
                break;
            }
            case net.MsgType.PlayerStats: {
                const msg = new net.PlayerStatsMsg();
                msg.deserialize(stream);
                this.m_uiManager.setLocalStats(msg.playerStats);
                this.m_uiManager.showTeamAd(msg.playerStats, this.m_ui2Manager);
                break;
            }
            case net.MsgType.Stats: {
                stream.readString();
                break;
            }
            case net.MsgType.GameOver: {
                const msg = new net.GameOverMsg();
                msg.deserialize(stream);
                this.m_gameOver = msg.gameOver;
                const localTeamId = this.m_playerBarn.getPlayerInfo(
                    this.m_localId,
                ).teamId;

                // Set local stats based on final results.
                // This is necessary because the last person on a team to die
                // will not receive a PlayerStats message, they will only receive
                // the GameOver message.
                for (let j = 0; j < msg.playerStats.length; j++) {
                    const stats = msg.playerStats[j];
                    if (stats.playerId == this.m_localId) {
                        this.m_uiManager.setLocalStats(stats);
                        break;
                    }
                }
                this.m_uiManager.showStats(
                    msg.playerStats,
                    msg.teamId,
                    msg.teamRank,
                    msg.winningTeamId,
                    msg.gameOver,
                    localTeamId,
                    this.teamMode,
                    this.m_spectating,
                    this.m_playerBarn,
                    this.m_audioManager,
                    this.m_map,
                    this.m_ui2Manager,
                );
                if (localTeamId == msg.winningTeamId) {
                    this.victoryMusic = this.m_audioManager.playSound("menu_music", {
                        channel: "music",
                        delay: 1300,
                        forceStart: true,
                    });
                }
                this.m_touch.hideAll();
                break;
            }
            case net.MsgType.Pickup: {
                const msg = new net.PickupMsg();
                msg.deserialize(stream);
                if (msg.type == net.PickupMsgType.Success && msg.item) {
                    this.m_activePlayer.playItemPickupSound(
                        msg.item,
                        this.m_audioManager,
                    );
                    const itemDef = GameObjectDefs.typeToDefSafe(msg.item);
                    if (itemDef && itemDef.type == "xp") {
                        this.m_ui2Manager.addRareLootMessage(msg.item, true);
                    }
                } else {
                    this.m_ui2Manager.displayPickupMessage(msg.type);
                }
                break;
            }
            case net.MsgType.UpdatePass: {
                new net.UpdatePassMsg().deserialize(stream);
                this.m_updatePass = true;
                this.m_updatePassDelay = 0;
                break;
            }
            case net.MsgType.AliveCounts: {
                const msg = new net.AliveCountsMsg();
                msg.deserialize(stream);
                if (msg.teamAliveCounts.length == 1) {
                    this.m_uiManager.updatePlayersAlive(msg.teamAliveCounts[0]);
                } else if (msg.teamAliveCounts.length >= 2) {
                    this.m_uiManager.updatePlayersAliveRed(msg.teamAliveCounts[0]);
                    this.m_uiManager.updatePlayersAliveBlue(msg.teamAliveCounts[1]);
                }
                break;
            }
            case net.MsgType.MatchTime: {
                const msg = new net.MatchTimeMsg();
                msg.deserialize(stream);
                this.matchStartedTime = msg.started ? msg.startedTime : -1;
                break;
            }
            case net.MsgType.ZombieMission: {
                const msg = new net.ZombieMissionMsg();
                msg.deserialize(stream);
                this.applyZombieMissionMsg(msg);
                break;
            }
            case net.MsgType.AchievementUnlocked: {
                const msg = new net.AchievementUnlockedMsg();
                msg.deserialize(stream);
                if (isAchievementId(msg.achievementId)) {
                    const achievement = AchievementDefs[msg.achievementId];
                    this.m_uiManager.displayAnnouncement(
                        `成就解锁：${achievement.name}`,
                    );
                }
                break;
            }
            case net.MsgType.ExtractionPoint: {
                const msg = new net.ExtractionPointMsg();
                msg.deserialize(stream);
                this.extractionPointIndex = msg.pointIndex;
                this.extractionHoldServer = msg.holdSeconds;
                if (this.m_activePlayer) {
                    this.m_activePlayer.extractionPointIndex = msg.pointIndex;
                }
                break;
            }
        }
    }

    private updateArenaRoundUi(msg: net.ArenaRoundMsg): void {
        const wrapper = document.getElementById("ui-duel-score")!;
        const playerName = (id: number, fallback: string) =>
            id ? this.m_playerBarn.getPlayerInfo(id).name || fallback : "等待对手";

        const leftName = playerName(msg.playerIds[0], "玩家 1");
        const rightName = playerName(msg.playerIds[1], "玩家 2");
        const winnerName = playerName(msg.winnerId, "");

        document.getElementById("ui-duel-round")!.textContent = `第 ${msg.round} / ${msg.totalRounds} 局`;
        const leftPlayer = document.getElementById("ui-duel-player-left")!;
        const rightPlayer = document.getElementById("ui-duel-player-right")!;
        leftPlayer.textContent = leftName;
        rightPlayer.textContent = rightName;
        leftPlayer.title = leftName;
        rightPlayer.title = rightName;
        document.getElementById("ui-duel-score-left")!.textContent = String(
            msg.scores[0],
        );
        document.getElementById("ui-duel-score-right")!.textContent = String(
            msg.scores[1],
        );

        const status = document.getElementById("ui-duel-status")!;
        switch (msg.state) {
            case net.ArenaRoundState.Waiting:
                this.m_uiManager.setWaitingForPlayers(true);
                status.textContent = "等待对手加入";
                break;
            case net.ArenaRoundState.Playing:
                this.m_uiManager.setWaitingForPlayers(false);
                status.textContent = "";
                break;
            case net.ArenaRoundState.RoundOver:
                status.textContent = `${winnerName} 赢得本局 · 下一局即将开始`;
                break;
            case net.ArenaRoundState.MatchOver:
                status.textContent = `${winnerName} 获得五局总胜利`;
                break;
        }
        wrapper.classList.toggle("has-status", status.textContent.length > 0);
        wrapper.dataset.roundState = String(msg.state);
        wrapper.style.display = "block";
    }

    m_sendMessage(type: net.MsgType, data: net.Msg, maxLen?: number) {
        const bufSz = maxLen || 128;
        const msgStream = new net.MsgStream(new ArrayBuffer(bufSz));
        msgStream.serializeMsg(type, data);
        this.m_sendMessageImpl(msgStream);
    }

    applyAimTrainingSettings(settings: {
        weapon0: string;
        weapon1: string;
        throwable: string;
        infiniteMagazine: boolean;
        targetBoost: number;
        helmetLevel: number;
        chestLevel: number;
        normalHealth: boolean;
        distance: number;
        verticalRandomMovement: boolean;
        omnidirectionalRandomMovement: boolean;
        dodgeBullets: boolean;
        resetStats?: boolean;
    }): void {
        if (this.m_map.mapName !== "aim_training") return;
        const msg = new net.AimTrainingSettingsMsg();
        Object.assign(msg, settings);
        this.m_sendMessage(net.MsgType.AimTrainingSettings, msg, 128);
    }

    m_sendMessageImpl(msgStream: net.MsgStream) {
        // Separate function call so sendMessage can be optimized;
        // v8 won't optimize functions containing a try/catch
        if (this.m_ws && this.m_ws.readyState == this.m_ws.OPEN) {
            try {
                this.m_ws.send(msgStream.getBuffer());
            } catch (e) {
                console.error("sendMessageException", e);
                this.m_ws.close();
            }
        }
    }
}
