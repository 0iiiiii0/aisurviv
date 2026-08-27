import type { EmoteDef } from "../../../shared/defs/gameObjects/emoteDefs.ts";
import { GameObjectDefs } from "../../../shared/defs/register.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import * as net from "../../../shared/net/net.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { SpectateAction } from "../../../shared/net/spectateMsg.ts";
import type { Airstrike, Emote, GroupStatus } from "../../../shared/net/updateMsg.ts";
import type { GameWsDisconnectReason } from "../../../shared/types/api.ts";
import { coldet } from "../../../shared/utils/coldet.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { math } from "../../../shared/utils/math.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2 } from "../../../shared/utils/v2.ts";
import { aimTrainingSpeedBonusPercent } from "../aimTraining.ts";
import { Config } from "../config.ts";
import { validateUserName } from "../utils/badWords.ts";

import type { Game, JoinTokenData, SpectateTokenData } from "./game.ts";
import type { GameObject } from "./objects/gameObject.ts";
import type { MapIndicator } from "./objects/mapIndicator.ts";
import type { Player } from "./objects/player.ts";
import { predictStrobeAirstrikeWarning } from "./objects/projectile.ts";
import type { ClientSocket } from "./socket.ts";

export class ClientBarn {
    clients: Client[] = [];

    /** One immutable generated-map catalogue shared by every bot Client. */
    private serverBotFullMapObjects: readonly GameObject[] | undefined;
    private serverBotMapKnowledgeIds: ReadonlySet<number> | undefined;

    /** Expensive plane/projectile warning scan, rebuilt once per net-sync. */
    private serverBotAirstrikeWarnings: readonly Airstrike[] = [];

    /**
     * Successful join credentials retained for the lifetime of their Player.
     * Matchmaking tokens are intentionally short-lived/one-use, while the
     * corresponding contestant has a substantially longer reconnect window.
     */
    private reconnectJoinData = new Map<string, JoinTokenData>();

    /**
     * All msgs created this tick that will be sent to all players
     * cached in a single stream
     */
    msgsToSend = new net.MsgStream(new ArrayBuffer(4096));

    game: Game;
    constructor(game: Game) {
        this.game = game;
    }

    update(dt: number) {
        for (let i = 0; i < this.clients.length; i++) {
            this.clients[i].update(dt);
        }
    }

    getServerBotFullMapObjects(): readonly GameObject[] {
        if (!this.serverBotFullMapObjects) {
            const objects: GameObject[] = [];
            const ids = new Set<number>();
            for (const collection of [this.game.map.obstacles, this.game.map.structures]) {
                for (const object of collection) {
                    if (object.__id <= 0 || ids.has(object.__id)) continue;
                    ids.add(object.__id);
                    objects.push(object);
                }
            }
            this.serverBotFullMapObjects = objects;
            this.serverBotMapKnowledgeIds = ids;
        }
        return this.serverBotFullMapObjects;
    }

    isServerBotMapKnowledgeId(id: number): boolean {
        if (!this.serverBotMapKnowledgeIds) this.getServerBotFullMapObjects();
        return this.serverBotMapKnowledgeIds?.has(id) === true;
    }

    private rebuildServerBotAirstrikeWarnings(): void {
        if (!this.clients.some((client) => client.player?.serverBot && !client.socket.closed())) {
            this.serverBotAirstrikeWarnings = [];
            return;
        }
        const warnings: Airstrike[] = [];
        for (const plane of this.game.planeBarn.planes) {
            if (plane.action !== GameConfig.Plane.Airstrike || plane.actionComplete) continue;
            const impactIn = Math.max(
                0,
                (v2.distance(plane.pos, plane.targetPos) - 10) / GameConfig.airstrike.planeVel,
            );
            warnings.push({
                pos: v2.copy(plane.targetPos),
                rad: 18,
                duration: Math.min(net.Constants.AirstrikeZoneMaxDuration, impactIn + 2.8),
            });
        }
        for (const projectile of this.game.projectileBarn.projectiles) {
            if (projectile.dead || projectile.destroyed || projectile.type !== "strobe") continue;
            const source = this.game.objectRegister.getById(projectile.playerId);
            const hasBrokenArrow = source?.__type === ObjectType.Player
                && source.hasPerk("broken_arrow");
            const warning = predictStrobeAirstrikeWarning(
                projectile,
                hasBrokenArrow,
                this.game.map.width,
                this.game.map.height,
            );
            if (!warning) continue;
            warnings.push({
                pos: warning.pos,
                rad: warning.rad,
                duration: Math.min(
                    net.Constants.AirstrikeZoneMaxDuration,
                    warning.duration,
                ),
            });
        }
        this.serverBotAirstrikeWarnings = warnings;
    }

    getServerBotAirstrikeWarnings(): readonly Airstrike[] {
        return this.serverBotAirstrikeWarnings;
    }

    sendMsgs() {
        this.rebuildServerBotAirstrikeWarnings();
        for (let i = 0; i < this.clients.length; i++) {
            const client = this.clients[i];
            if (client.socket.closed()) continue;
            if (client.deferNetworkFrameIfBackpressured()) continue;
            client.sendMsgs();
        }
    }

    flush() {
        this.msgsToSend.stream.index = 0;
    }

    addClientWithPlayer(
        socket: ClientSocket<Client>,
        joinData: JoinTokenData,
        joinMsg: net.JoinMsg,
        joinToken: string,
    ) {
        // Smart-bot workers for a room intentionally share an address. Their
        // credentials are minted by the parent process, so applying the normal
        // per-IP/account client cap here prevents legitimate room auto-fill.
        if (Config.rateLimitsEnabled && !joinData.serverBot) {
            const count = this.clients.filter(
                (c) => {
                    if (
                        !c.player
                        || c.player.serverBot
                        || c.player.spectatorOnly
                    ) {
                        return false;
                    }
                    return c.ip === socket.ip()
                        || c.findGameIp == joinData.findGameIp
                        || (joinData.userId !== null && c.userId === joinData.userId);
                },
            );
            if (count.length >= 5) {
                socket.close("rate_limited");
                return;
            }
        }

        const extractionMode = this.game.map.mapDef.gameMode.extractionMode;
        const spectatorOnly = joinData.spectatorOnly ?? false;
        if (extractionMode && !joinData.serverBot && !spectatorOnly) {
            if (this.game.extractionSecretEnabled) {
                const stashIdentity = joinMsg.loadoutPriv.trim()
                    || validateUserName(joinMsg.name).validName;
                const playerBarn = this.game.playerBarn as unknown as {
                    hasSecretEligibleLoadout: (stashKey: string) => boolean;
                };
                if (!playerBarn.hasSecretEligibleLoadout(stashIdentity)) {
                    this.game.logger.info(
                        `Player "${joinMsg.name}" rejected from secret extraction: no eligible brought-in weapon`,
                    );
                    socket.close("invalid_token");
                    return;
                }
            }
            if (!this.game.canAcceptExtractionHuman()) {
                socket.close("full");
                return;
            }
            // 普通搜打撤的 AI 是填充目标，不是硬房间人数。真人在加入
            // 窗口内直接追加，既不踢 AI，也不因当前 AI 数达到目标而拒绝。
        }

        const gameWasStarted = this.game.started;
        const knownPlayers = new Set(this.game.playerBarn.players);
        const client = new Client(this.game, socket, joinData.userId, joinData.findGameIp);
        client.joinToken = joinToken;
        this.clients.push(client);

        let player: Player;
        try {
            player = this.game.playerBarn.addPlayer(client, joinMsg, joinData);
            client.player = player;

            // Player construction is upstream-owned, but these credential
            // fields are authoritative custom server state and must not be
            // inferred from the untrusted JoinMsg.
            player.matchPriv = joinToken;
            player.serverBot = joinData.serverBot ?? joinMsg.bot;
            client.serverBotMapOwner = joinData.serverBot === true && joinMsg.botMapOwner;
            player.spectatorOnly = spectatorOnly;
            player.trainingTarget = joinData.trainingTarget ?? false;
            player.duelLoadoutIndex = joinData.duelLoadoutIndex;
            const authoritativeStashIdentity = joinData.stashName?.trim() ?? "";
            const legacyClientIdentity = joinMsg.loadoutPriv.trim();
            const stashIdentity = authoritativeStashIdentity || legacyClientIdentity;
            player.accountAuthenticated = authoritativeStashIdentity !== ""
                || legacyClientIdentity !== ""
                || client.userId !== null;
            player.stashName = stashIdentity || client.userId || player.name;

            const forcedTeamId = player.serverBot && this.game.map.factionMode
                ? joinData.serverBotTeamIds?.[0]
                : undefined;
            if (forcedTeamId !== undefined) {
                const forcedTeam = this.game.playerBarn.teams[forcedTeamId - 1];
                if (forcedTeam && player.team !== forcedTeam) {
                    const oldTeam = player.team;
                    const oldGroup = player.group;
                    const mixedGroup = oldGroup?.players.some(
                        (candidate) => candidate !== player && candidate.teamId !== forcedTeamId,
                    );
                    oldTeam?.removePlayer(player);
                    forcedTeam.addPlayer(player);

                    // A group cannot span faction teams. If upstream auto-fill
                    // selected a group on another faction, split this bot into
                    // a compatible group while retaining its forced team.
                    if (oldGroup && mixedGroup) {
                        oldGroup.removePlayer(player);
                        const replacement = this.game.playerBarn.addGroup(
                            joinData.groupData.autoFill,
                        );
                        replacement.addPlayer(player);
                        joinData.groupData.groupHashToJoin = replacement.hash;
                    }
                    player.playerStatusDirty = true;
                    this.game.playerBarn.livingPlayers.sort((a, b) => a.teamId - b.teamId);
                }
            }

            if (player.spectatorOnly) {
                // Legacy observer tokens create a Player so they can use the
                // existing spectator chat/free-camera APIs, but they must not
                // occupy a living/team slot or affect match end conditions.
                player.dead = true;
                player.health = 0;
                util.removeFrom(this.game.playerBarn.livingPlayers, player);
                player.group?.removePlayer(player);
                player.team?.removePlayer(player);
                player.group = undefined;
                player.team = undefined;
                this.game.playerBarn.aliveCountDirty = true;
                client.spectating = this.game.playerBarn.livingPlayers.find(
                    (candidate) => !candidate.disconnected && !candidate.spectatorOnly,
                );
                player.setDirty();
            }

            // duelLoadoutIndex is assigned after Player construction in the
            // compatibility layer. Re-apply the arena loadout once so the
            // contestant receives the token-selected weapon pair.
            if (joinData.duelLoadoutIndex !== undefined) {
                const arenaPlayer = player as unknown as {
                    applyArenaStartingLoadout?: () => void;
                };
                arenaPlayer.applyArenaStartingLoadout?.();
            }

            if (
                this.game.mapName === "aim_training"
                && !player.serverBot
                && !player.spectatorOnly
            ) {
                player.applyAimTrainingLoadout(this.game.aimTrainingSettings);
            }

            if (extractionMode && !player.spectatorOnly) {
                this.game.applyExtractionSpawnLoadout(player);
                if (socket.closed()) {
                    throw new Error("Extraction loadout validation rejected the player");
                }
            }

            if (!player.serverBot) {
                if (!player.spectatorOnly) {
                    // Latch immediately: a short-lived human may connect and leave
                    // between game ticks.
                    this.game.hadConnectedHuman = true;
                    this.game.botOnlySince = 0;
                }
                if (
                    extractionMode
                    && gameWasStarted
                    && !knownPlayers.has(player)
                    && !player.spectatorOnly
                ) {
                    player.grantLateJoinProtection();
                    this.game.logger.info(
                        `[spawn-protect] granted 5s protection to late joiner "${player.name}"`,
                    );
                }
            }

            // An observer is allowed to arrive before the first contestant.
            // Bind every unbound observer when a valid target becomes available.
            if (!player.spectatorOnly) {
                for (const observer of this.game.playerBarn.players) {
                    if (
                        observer.spectatorOnly
                        && !observer.disconnected
                        && observer.spectating === undefined
                    ) {
                        observer.spectating = player;
                    }
                }
            }
        } catch (error) {
            this.game.logger.warn("Failed to initialize joined player; rejecting connection:", error);
            if (client.player && this.game.playerBarn.players.includes(client.player)) {
                this.game.playerBarn.removePlayer(client.player);
            }
            client.player = undefined;
            util.removeFrom(this.clients, client);
            socket.close("invalid_token");
            return;
        }

        if (!player.spectatorOnly && !knownPlayers.has(player)) {
            this.game.noteContestantAdmission();
        }

        // Consume the faction assignment only after every join validation and
        // loadout grant has succeeded. A rejected attempt may safely retry.
        if (joinData.serverBot && this.game.map.factionMode) {
            joinData.serverBotTeamIds?.shift();
        }
        this.reconnectJoinData.set(joinToken, joinData);
        this.game.updateData();

        return client;
    }

    /**
     * Rebind a disconnected contestant to a fresh upstream Client. Token
     * validation deliberately happens after this lookup: legacy tokens expire
     * shortly after matchmaking, while their player may remain reconnectable
     * for minutes (or for the whole extraction match).
     */
    tryReconnectClient(
        socket: ClientSocket<Client>,
        joinToken: string,
        joinMsg: net.JoinMsg,
        joinData?: JoinTokenData,
        remainingUses?: number,
    ): boolean {
        const name = validateUserName(joinMsg.name).validName;
        const stashIdentity = joinMsg.loadoutPriv.trim();
        const serverBot = joinData?.serverBot ?? joinMsg.bot;
        const candidates = this.game.playerBarn.players.filter((candidate) => {
            if (candidate.matchPriv !== joinToken || candidate.internalTrainingTarget) return false;
            if (joinData?.userId !== null && joinData?.userId !== undefined) {
                return candidate.userId === joinData.userId;
            }
            if (candidate.serverBot !== serverBot) return false;
            if (!serverBot && stashIdentity !== "") {
                return candidate.stashName === stashIdentity;
            }
            return candidate.name === name;
        });
        if (candidates.length === 0) return false;

        // A shared legacy token can have several clients with the same bot
        // name (and anonymous teammates can share a display name). Until the
        // batch is fully admitted, only an account/stash identity is precise
        // enough to distinguish a reconnect from the next new member.
        const spectatorReconnect = joinData?.spectatorOnly === true;
        const sharedTokenHasUnusedSlots = remainingUses !== undefined
            && remainingUses > 0
            && !spectatorReconnect;
        const hasStableIdentity = joinData?.userId !== null
                && joinData?.userId !== undefined
            || spectatorReconnect
            || (!serverBot && stashIdentity !== "");
        const reconnectable = sharedTokenHasUnusedSlots && !hasStableIdentity
            ? undefined
            : candidates.find(
                (candidate) => candidate.disconnected && (!candidate.dead || candidate.spectatorOnly),
            );
        const player = reconnectable
            ?? (sharedTokenHasUnusedSlots && !hasStableIdentity ? undefined : candidates[0]);
        if (!player) return false;
        if (player.dead && !player.spectatorOnly) {
            socket.close("invalid_token");
            return true;
        }

        const oldClient = player.client;
        const oldSpectating = oldClient.spectating;
        const userId = oldClient.userId;
        const findGameIp = oldClient.findGameIp;

        // Detach before closing so the delayed close callback from the stale
        // socket cannot mark the newly rebound player disconnected.
        oldClient.player = undefined;
        oldClient.spectating = undefined;
        oldClient.disconnected = true;
        util.removeFrom(this.clients, oldClient);
        if (!oldClient.socket.closed()) oldClient.disconnect("invalid_token");

        const client = new Client(this.game, socket, userId, findGameIp);
        client.joinToken = joinToken;
        client.serverBotMapOwner = joinData?.serverBot === true && joinMsg.botMapOwner;
        client.player = player;
        this.clients.push(client);
        player.client = client;
        player.disconnectAt = 0;
        player.matchPriv = joinToken;
        const spectating = oldSpectating && !oldSpectating.dead && !oldSpectating.disconnected
            ? oldSpectating
            : player.spectatorOnly
            ? this.game.playerBarn.livingPlayers.find(
                (candidate) => !candidate.disconnected && !candidate.spectatorOnly,
            )
            : undefined;
        if (spectating) {
            client.spectating = spectating;
        }
        player.group?.checkPlayers();
        player.setGroupStatuses();
        player.setPartDirty();
        if (!player.serverBot) {
            this.game.hadConnectedHuman = true;
            this.game.botOnlySince = 0;
        }
        this.game.logger.info(`Player ${player.name} reconnected`);
        this.game.updateData();
        return true;
    }

    addSpectatorClient(socket: ClientSocket<Client>, specData: SpectateTokenData) {
        const player = this.game.objectRegister.getById(specData.playerId);

        if (!player || player.__type !== ObjectType.Player || player.dead) {
            socket.close("player_not_found");
            return;
        }

        const client = new Client(this.game, socket, null, "");
        this.clients.push(client);

        client.specAnon = specData.specAnon;
        client.noSpecCooldown = specData.noSpecCooldown;
        client.spectating = player;

        return client;
    }

    deserializeMsg(buff: ArrayBuffer): {
        type: net.MsgType;
        msg: net.AbstractMsg | undefined;
        error?: GameWsDisconnectReason;
    } {
        const msgStream = new net.MsgStream(buff);
        const stream = msgStream.stream;

        const type = msgStream.deserializeMsgType();

        let msg:
            | net.JoinMsg
            | net.InputMsg
            | net.EmoteMsg
            | net.DropItemMsg
            | net.SpectateMsg
            | net.SpectatorChatMsg
            | net.PerkModeRoleSelectMsg
            | net.AimTrainingSettingsMsg
            | net.EditMsg
            | undefined = undefined;

        switch (type) {
            case net.MsgType.Join: {
                // read protocol version outside of JoinMsg
                // reason: if theres a protocol change in JoinMsg it will fail to deserialize the entire msg
                // and won't give the proper invalid-protocol error
                // so we read it before deserializing the msg to avoid it throwing and giving the wrong error

                const oldIdx = stream.index;
                const protocol = stream.readUint32();

                if (protocol !== GameConfig.protocolVersion) {
                    return {
                        type: net.MsgType.Join,
                        msg: undefined,
                        error: "invalid_protocol",
                    };
                }
                stream.index = oldIdx;

                msg = new net.JoinMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.Input: {
                msg = new net.InputMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.Emote:
                msg = new net.EmoteMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.DropItem:
                msg = new net.DropItemMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.Spectate:
                msg = new net.SpectateMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.SpectatorChat:
                msg = new net.SpectatorChatMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.PerkModeRoleSelect:
                msg = new net.PerkModeRoleSelectMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.AimTrainingSettings:
                msg = new net.AimTrainingSettingsMsg();
                msg.deserialize(stream);
                break;
            case net.MsgType.Edit:
                if (!Config.debug.allowEditMsg) break;
                msg = new net.EditMsg();
                msg.deserialize(stream);
                break;
        }

        return {
            type,
            msg,
        };
    }

    handleMsg(buff: ArrayBuffer | Buffer, socket: ClientSocket<Client>) {
        if (!(buff instanceof ArrayBuffer)) return;

        let client = socket.getUserData();

        let msg: net.AbstractMsg | undefined = undefined;
        let type = net.MsgType.None;
        let error: GameWsDisconnectReason | undefined;

        try {
            const deserialized = this.deserializeMsg(buff);
            msg = deserialized.msg;
            type = deserialized.type;
            error = deserialized.error;
        } catch (err) {
            this.game.logger.error(
                "Failed to deserialize msg: ",
                err,
                "msg buffer: ",
                // JSON.stringify doesn't work on buffers, so need to convert to an Uint8Array first
                // and then to a regular array... 😭
                // the slice is to make sure it doesn't overflow the error webhook
                JSON.stringify([...new Uint8Array(buff.slice(0, 255))]),
            );
            socket.close("invalid_packet");
            return;
        }

        if (error) {
            this.game.logger.warn("Disconnecting socket because of packet error:", error);
            socket.close(error);
            return;
        }

        if (!msg) return;

        if (type === net.MsgType.Join && !client) {
            const joinMsg = msg as net.JoinMsg;

            const joinData = this.game.joinTokens.get(joinMsg.joinToken);
            const reconnectData = joinData?.type === "join"
                ? joinData.data
                : this.reconnectJoinData.get(joinMsg.joinToken);
            const remainingUses = joinData?.type === "join" ? joinData.remainingUses : undefined;
            if (
                this.tryReconnectClient(
                    socket,
                    joinMsg.joinToken,
                    joinMsg,
                    reconnectData,
                    remainingUses,
                )
            ) {
                return;
            }

            if (
                !joinData
                || joinData.expiresAt < Date.now()
                || (joinData.type === "join" && (joinData.remainingUses ?? 1) <= 0)
            ) {
                this.game.logger.warn("Client tried to join without or with expired join token");
                socket.close("invalid_token");
                if (joinData) {
                    this.game.joinTokens.delete(joinMsg.joinToken);
                }
                return;
            }

            if (joinData.type === "join") {
                client = this.game.clientBarn.addClientWithPlayer(
                    socket,
                    joinData.data,
                    joinMsg,
                    joinMsg.joinToken,
                );
                if (!client) return;

                // Spectator tokens stay reusable until they expire so a browser
                // refresh can reconnect with the token persisted in the URL.
                if (joinData.remainingUses !== undefined) {
                    if (!joinData.data.spectatorOnly) joinData.remainingUses--;
                }
                if (
                    joinData.remainingUses === undefined
                    || (joinData.remainingUses <= 0 && !joinData.data.spectatorOnly)
                ) {
                    this.game.joinTokens.delete(joinMsg.joinToken);
                }
            } else {
                client = this.game.clientBarn.addSpectatorClient(socket, joinData.data);
                if (!client) return;
                this.game.joinTokens.delete(joinMsg.joinToken);
            }
            this.game.updateData();

            return;
        }

        if (!client) {
            this.game.logger.warn("No client found and we didn't receive a JoinMsg, closing socket");
            socket.close("invalid_packet");
            return;
        }

        if (socket.closed()) {
            return;
        }
        client.handleMsg(type, msg);
    }

    handleSocketClose(socket: ClientSocket<Client>) {
        const client = socket.getUserData();
        if (!client) return;
        client.spectating = undefined;
        client.disconnected = true;
        util.removeFrom(this.clients, client);

        if (!client.player) return;
        const player = client.player;
        if (player.client !== client) return;
        this.game.logger.info(`"${player.name}" left`);
        player.disconnectAt = Date.now();
        player.reassignSpectators();

        // reset direction and movement
        player.dirNew = v2.create(1, 0);
        player.moveLeft = false;
        player.moveRight = false;
        player.moveUp = false;
        player.moveDown = false;
        player.shootHold = false;
        player.touchMoveActive = false;

        player.setPartDirty();
        player.group?.checkPlayers();
        player.setGroupStatuses();
        player.questManager.flushProgress();

        // Credential-backed players are retained for the reconnect window. The
        // upstream early-despawn rule would otherwise destroy a player whose
        // network drops immediately after joining.
        if (player.canDespawn() && !player.matchPriv) {
            player.game.playerBarn.removePlayer(player);
        } else {
            this.game.updateData();
        }
    }

    broadcastMsg(type: net.MsgType, msg: net.Msg) {
        this.msgsToSend.serializeMsg(type, msg);
    }
}

export class Client {
    game: Game;
    socket: ClientSocket<Client>;

    disconnected = false;

    userId: string | null = null;
    ip: string;
    // see comment on server/src/api/schema.ts
    // about logging find_game IP's
    findGameIp: string;

    lastPlayerId = 0;
    player?: Player = undefined;
    /** Credential used for initial join and subsequent connection rebinds. */
    joinToken = "";

    /** true when player starts spectating new player, only stays true for that given tick */
    startedSpectating: boolean = false;

    private _spectating?: Player;

    get spectating(): Player | undefined {
        return this._spectating;
    }

    set spectating(player: Player | undefined) {
        if (player && player === this.player) {
            throw new Error(
                `Player ${player.name} tried spectate themselves (how tf did this happen?)`,
            );
        }
        if (this._spectating === player) return;

        if (this._spectating) {
            this._spectating.spectators.delete(this);
            this._spectating.recalculateSpectatorCount();
        }
        if (player) {
            player.spectators.add(this);
            player.recalculateSpectatorCount();
        }

        this._spectating = player;
        this.startedSpectating = true;
    }

    private _specCooldown = 0;
    private _specAction = SpectateAction.None;
    private _lastSpectatorChatAt = 0;
    specAnon = false;
    noSpecCooldown = false;

    spectateNewPlayerTicker = 0;

    private _firstUpdate = true;
    private _forceFullUpdate = false;
    visibleObjects = new Set<GameObject>();
    /** Only one socket per smart-bot coordinator needs the complete topology. */
    serverBotMapOwner = false;
    visibleMapIndicators = new Set<MapIndicator>();

    // zoom used for the area in which the server will send objects to the client
    private _cullingZoom = GameConfig.scopeZoomRadius.desktop["1xscope"];

    portrait = false;
    private _cullingPortrait = false;
    private _cullingPortraitTicker = 0;

    msgStream = new net.MsgStream(new ArrayBuffer(65536));
    msgsToSend: Array<{ type: number; msg: net.Msg }> = [];

    ack = 0;

    /** Drop obsolete snapshots for a slow peer and send one current full snapshot after recovery. */
    deferNetworkFrameIfBackpressured(): boolean {
        if (this._firstUpdate) return false;
        const buffered = Math.max(0, this.socket.bufferedAmount());
        const threshold = Math.max(
            64 * 1024,
            Number(Config.serverNetworkBackpressureBytes) || 512 * 1024,
        );
        if (buffered < threshold) return false;
        this._forceFullUpdate = true;
        this.msgsToSend.length = 0;
        return true;
    }

    constructor(
        game: Game,
        socket: ClientSocket<Client>,
        userId: string | null,
        findGameIp: string,
    ) {
        this.userId = userId;
        this.ip = socket.ip();
        this.findGameIp = findGameIp;
        this.game = game;
        socket.setUserData(this);
        this.socket = socket as ClientSocket<Client>;
    }

    sendMsg(type: net.MsgType, msg: net.AbstractMsg): void {
        this.msgsToSend.push({ type, msg });
    }

    sendInstantMsg(type: net.MsgType, msg: net.AbstractMsg, bytes = 128): void {
        const stream = new net.MsgStream(new ArrayBuffer(bytes));
        stream.serializeMsg(type, msg);
        this.sendData(stream.getBuffer());
    }

    sendData(buffer: Uint8Array<ArrayBuffer>): void {
        this.socket.send(buffer);
    }

    disconnect(reason?: GameWsDisconnectReason) {
        this.socket.close(reason);
    }

    update(dt: number) {
        // Aim-training humans always own their local player camera. A stale
        // spectating target from an observer flow or a transient target disconnect
        // must never turn the training client into a pseudo-spectator.
        if (
            this.game.mapName === "aim_training"
            && this.player
            && !this.player.spectatorOnly
            && !this.player.serverBot
            && !this.player.trainingTarget
        ) {
            this.spectating = undefined;
            this.startedSpectating = false;
            this.player.freeCameraActive = false;
        }

        if (this.spectating) {
            let newPlayerToSpectate: Player | undefined = undefined;

            // switch to a new spectator after 2 seconds if the player we are spectating has died
            if (this.spectating.dead) {
                this.spectateNewPlayerTicker += dt;
                if (this.spectateNewPlayerTicker > 2) {
                    newPlayerToSpectate = this.getNewPlayerToSpectate();
                    this.spectateNewPlayerTicker = 0;
                }
            } else {
                this.spectateNewPlayerTicker = 0;
            }

            // spectate prev/next keybind logic
            this._specCooldown -= dt;
            if (this._specCooldown <= 0 && this._specAction !== SpectateAction.None) {
                const nextOrPrev = this._specAction === SpectateAction.Next ? +1 : -1;
                const spectatablePlayers = this.getSpectablePlayers(true);

                newPlayerToSpectate = util.wrappedArrayIndex(
                    spectatablePlayers,
                    spectatablePlayers.indexOf(this.spectating!) + nextOrPrev,
                );

                // when spectating teammates we can have a lower cooldown
                // since it cant be abused to know players positions
                this._specCooldown = this.getSpectateCooldown();
                this._specAction = SpectateAction.None;
            }

            if (newPlayerToSpectate) {
                this.spectating = newPlayerToSpectate;
            }
        }

        const targetZoom = this.player?.freeCameraActive
            ? this.player.freeCameraViewRadius
            : this.spectating?.zoom ?? this.player?.zoom ?? 1;

        // lerp towards the target zoom
        if (math.eqAbs(this._cullingZoom, targetZoom, 0.1)) {
            this._cullingZoom = targetZoom;
        } else {
            this._cullingZoom = math.lerp(dt * 4, this._cullingZoom, targetZoom);
        }

        if (this.portrait !== this._cullingPortrait) {
            this._cullingPortraitTicker -= dt;
            if (this._cullingPortraitTicker <= 0) {
                this._cullingPortrait = this.portrait;
            }
        }
    }

    sendMsgs(): void {
        // A complete generated map can contain several thousand serialized
        // obstacles. Only bot connections need the larger one-time packet.
        if (
            this._firstUpdate
            && this.player?.serverBot
            && this.serverBotMapOwner
            && this.msgStream.arrayBuf.byteLength < 512 * 1024
        ) {
            this.msgStream = new net.MsgStream(new ArrayBuffer(512 * 1024));
        }
        const msgStream = this.msgStream;
        const game = this.game;
        const playerBarn = game.playerBarn;
        msgStream.stream.index = 0;

        const player = this.spectating ?? this.player;
        if (!player) return;

        if (this._firstUpdate) {
            const joinedMsg = new net.JoinedMsg();
            joinedMsg.teamMode = this.game.teamMode;
            joinedMsg.playerId = this.player?.__id ?? 0;
            joinedMsg.started = game.started;
            joinedMsg.teamMode = game.teamMode;
            joinedMsg.spectatorOnly = this.player?.spectatorOnly ?? this.player === undefined;
            joinedMsg.trainingTarget = this.player?.trainingTarget ?? false;
            if (this.player) {
                joinedMsg.emotes = this.player.loadout.emotes;
            }
            msgStream.serializeMsg(net.MsgType.Joined, joinedMsg);

            const mapStream = game.map.mapStream.stream;

            msgStream.stream.writeBytes(mapStream, 0, mapStream.byteIndex);
        }

        if (playerBarn.aliveCountDirty || this._firstUpdate) {
            const aliveMsg = new net.AliveCountsMsg();
            this.game.modeManager.updateAliveCounts(aliveMsg.teamAliveCounts);
            msgStream.serializeMsg(net.MsgType.AliveCounts, aliveMsg);
        }

        const updateMsg = new net.UpdateMsg();
        updateMsg.ack = this.ack;

        if (game.gas.dirty || this._firstUpdate) {
            updateMsg.gasDirty = true;
            updateMsg.gasData = game.gas;
        }

        if (game.gas.timeDirty || this._firstUpdate) {
            updateMsg.gasTDirty = true;
            updateMsg.gasT = game.gas.gasT;
        }

        const radius = this._cullingZoom + 4;
        let width = this._cullingZoom + 4;
        // client zoom tries to keep a 16/9 aspect ratio, mirror it here
        let height = width / (16 / 9);
        if (this._cullingPortrait) {
            let tmp = width;
            width = height;
            height = tmp;
        }
        const cullingCenter = this.player?.freeCameraActive
            ? this.player.freeCameraPos
            : player.pos;
        const rect = collider.createAabbExtents(cullingCenter, v2.create(width, height));

        const newVisibleObjects = game.grid.intersectAABBSet(rect);
        // client crashes if active player is not visible
        // so make sure its always added to visible objects
        newVisibleObjects.add(player);

        // Only the one-time full-map frame needs a de-duplication set. Creating
        // an empty Set for every client at 20Hz caused avoidable GC churn in
        // large AI rooms.
        let alreadyFull: Set<number> | undefined;
        if (this._firstUpdate && this.player?.serverBot && this.serverBotMapOwner) {
            alreadyFull = new Set<number>();
            // MapMsg only contains top-level display objects. The authoritative
            // arrays below include every randomized wall, door, crate and
            // structure generated for this match, which is what path planning
            // needs in order to know the complete map.
            for (const obj of game.clientBarn.getServerBotFullMapObjects()) {
                alreadyFull.add(obj.__id);
                updateMsg.fullObjects.push(obj);
            }
        }

        for (const obj of this.visibleObjects) {
            if (
                !newVisibleObjects.has(obj)
                && !(this.player?.serverBot
                    && game.clientBarn.isServerBotMapKnowledgeId(obj.__id))
            ) {
                updateMsg.delObjIds.push(obj.__id);
            }
        }

        for (const obj of newVisibleObjects) {
            if (
                (this._forceFullUpdate || !this.visibleObjects.has(obj))
                || game.objectRegister.dirtyFull[obj.__id]
            ) {
                if (!alreadyFull?.has(obj.__id)) updateMsg.fullObjects.push(obj);
            } else if (game.objectRegister.dirtyPart[obj.__id]) {
                updateMsg.partObjects.push(obj);
            }
        }

        this.visibleObjects = newVisibleObjects;

        updateMsg.activePlayerId = player.__id;
        if (this.startedSpectating) {
            updateMsg.activePlayerIdDirty = true;

            // build the active player data object manually
            // To avoid setting the spectating player fields to dirty
            updateMsg.activePlayerData = {
                healthDirty: true,
                health: player.health,
                boostDirty: true,
                boost: player.boost,
                zoomDirty: true,
                zoom: player.zoom,
                indoors: player.indoors,
                actionDirty: true,
                action: player.action,
                inventoryDirty: true,
                inventory: player.inventory,
                scope: player.scope,
                weapsDirty: true,
                curWeapIdx: player.curWeapIdx,
                weapons: player.weapons,
                spectatorCountDirty: true,
                spectatorCount: player.spectatorCount,
                sandevistanActive: player.sandevistanActive,
                sandevistanRemaining: player.sandevistanRemaining,
                sandevistanCooldown: player.sandevistanCooldown,
            };
            this.startedSpectating = false;
        } else {
            updateMsg.activePlayerIdDirty = player.__id !== this.lastPlayerId;
            updateMsg.activePlayerData = player;
        }
        this.lastPlayerId = player.__id;

        updateMsg.playerInfos = this._firstUpdate
            ? playerBarn.players
            : playerBarn.newPlayers;

        updateMsg.deletedPlayerIds = playerBarn.deletedPlayers;

        if (playerBarn.playerStatusTicker > playerBarn.playerStatusRate) {
            let statuses = player.getPlayerStatus();
            updateMsg.playerStatus = statuses;
            updateMsg.playerStatusDirty = true;
        }

        if (player.groupStatusDirty) {
            const teamPlayers = player.group!.players;

            let statuses: GroupStatus[] = [];
            for (const p of teamPlayers) {
                statuses.push({
                    health: p.health,
                    disconnected: p.disconnected,
                });
            }
            updateMsg.groupStatus = statuses;
            updateMsg.groupStatusDirty = true;
        }

        const shouldSendEmote = (emote: Emote) => {
            const emotePlayer = game.objectRegister.getById(emote.playerId) as
                | Player
                | undefined;

            const emoteDef = GameObjectDefs.typeToDef(emote.type);

            if (emotePlayer) {
                if (!emote.isPing && !this.visibleObjects.has(emotePlayer)) {
                    return false;
                }

                // regular emotes: always send if visible
                if (!emote.isPing && !(emoteDef as EmoteDef).teamOnly) {
                    return true;
                }

                // part of the same group
                if (emotePlayer?.groupId === player.groupId) {
                    return true;
                }

                // part of the same team
                if (emotePlayer?.teamId === player.teamId && !emote.isPing) {
                    return true;
                }

                // faction team leader
                if (
                    (emotePlayer.role === "leader"
                        || emotePlayer.role === "captain"
                        || emotePlayer.role === "last_man")
                    && emotePlayer.teamId === player.teamId
                ) {
                    return true;
                }
            }

            // always send map events pings
            if (emote.isPing && emoteDef.type === "ping" && emoteDef.mapEvent) {
                return true;
            }

            return false;
        };

        for (let i = 0; i < playerBarn.emotes.length; i++) {
            const emote = playerBarn.emotes[i];
            if (shouldSendEmote(emote)) {
                updateMsg.emotes.push(emote);
            }
        }

        const extendedRadius = 1.1 * radius;
        const radiusSquared = extendedRadius * extendedRadius;

        const bullets = game.bulletBarn.newBullets;
        for (let i = 0; i < bullets.length; i++) {
            const bullet = bullets[i];
            if (
                v2.lengthSqr(v2.sub(bullet.pos, player.pos)) < radiusSquared
                || v2.lengthSqr(v2.sub(bullet.clientEndPos, player.pos)) < radiusSquared
                || coldet.intersectSegmentCircle(
                    bullet.pos,
                    bullet.clientEndPos,
                    player.pos,
                    extendedRadius,
                )
            ) {
                updateMsg.bullets.push(bullet);
            }
        }

        for (let i = 0; i < game.explosionBarn.newExplosions.length; i++) {
            const explosion = game.explosionBarn.newExplosions[i];
            const rad = explosion.rad + extendedRadius;
            if (v2.lengthSqr(v2.sub(explosion.pos, player.pos)) < rad * rad) {
                updateMsg.explosions.push(explosion);
            }
        }

        const planes = this.game.planeBarn.planes;
        for (let i = 0; i < planes.length; i++) {
            const plane = planes[i];
            if (
                coldet.testCircleAabb(plane.pos, plane.rad, rect.min, rect.max)
                && coldet.testPointAabb(
                    plane.pos,
                    this.game.planeBarn.planeBounds.min,
                    this.game.planeBarn.planeBounds.max,
                )
            ) {
                updateMsg.planes.push(plane);
            }
        }
        const newAirstrikeZones = this.game.planeBarn.newAirstrikeZones;
        for (let i = 0; i < newAirstrikeZones.length; i++) {
            const zone = newAirstrikeZones[i];
            updateMsg.airstrikeZones.push(zone);
        }

        // Server-controlled players need authoritative advance warning for
        // both map-scheduled strikes and thrown strobes. Human clients learn
        // about these through the ordinary visible plane/strobe flow.
        if (this.player?.serverBot) {
            updateMsg.airstrikeZones.push(...game.clientBarn.getServerBotAirstrikeWarnings());
        }

        const indicators = this.game.mapIndicatorBarn.mapIndicators;
        for (let i = 0; i < indicators.length; i++) {
            const indicator = indicators[i];
            if (indicator.dirty || !this.visibleMapIndicators.has(indicator)) {
                updateMsg.mapIndicators.push(indicator);
                this.visibleMapIndicators.add(indicator);
            }
            if (indicator.dead) {
                this.visibleMapIndicators.delete(indicator);
            }
        }

        if (playerBarn.killLeaderDirty || this._firstUpdate) {
            updateMsg.killLeaderDirty = true;
            updateMsg.killLeaderId = playerBarn.killLeader?.__id ?? 0;
            updateMsg.killLeaderKills = playerBarn.killLeader?.kills ?? 0;
        }

        msgStream.serializeMsg(net.MsgType.Update, updateMsg);

        const connectionPlayer = this.player;
        if (connectionPlayer?.spectatorOnly) {
            const overlay = new net.SpectatorOverlayMsg();
            overlay.players = playerBarn.players
                .filter((candidate) => !candidate.spectatorOnly && !candidate.disconnected)
                .map((candidate) => ({
                    playerId: candidate.__id,
                    pos: v2.copy(candidate.pos),
                    health: candidate.health,
                    weapon: candidate.activeWeapon || "fists",
                    layer: candidate.layer,
                    dead: candidate.dead,
                    downed: candidate.downed,
                }));
            msgStream.serializeMsg(net.MsgType.SpectatorOverlay, overlay);
        }

        if (
            game.mapName === "aim_training"
            && connectionPlayer
            && !connectionPlayer.serverBot
            && !connectionPlayer.spectatorOnly
            && (connectionPlayer.trainingStatsDirty || this._firstUpdate)
        ) {
            const settings = game.aimTrainingSettings;
            const trainingStats = new net.AimTrainingStatsMsg();
            trainingStats.shotsFired = connectionPlayer.trainingShotsFired;
            trainingStats.hits = connectionPlayer.trainingHits;
            trainingStats.damageDealt = connectionPlayer.trainingDamageDealt;
            trainingStats.distance = settings.distance;
            trainingStats.targetBoost = settings.targetBoost;
            trainingStats.speedBonus = aimTrainingSpeedBonusPercent(settings.targetBoost);
            trainingStats.infiniteMagazine = settings.infiniteMagazine;
            trainingStats.weapon0 = settings.weapon0;
            trainingStats.weapon1 = settings.weapon1;
            trainingStats.throwable = settings.throwable;
            trainingStats.helmetLevel = settings.helmetLevel;
            trainingStats.chestLevel = settings.chestLevel;
            trainingStats.normalHealth = settings.normalHealth;
            trainingStats.verticalRandomMovement = settings.verticalRandomMovement;
            trainingStats.omnidirectionalRandomMovement = settings.omnidirectionalRandomMovement;
            trainingStats.dodgeBullets = settings.dodgeBullets;
            trainingStats.targetReady = playerBarn.players.some(
                (candidate) => candidate.trainingTarget && !candidate.disconnected && !candidate.dead,
            );
            msgStream.serializeMsg(net.MsgType.AimTrainingStats, trainingStats);
            connectionPlayer.trainingStatsDirty = false;
        }

        for (let i = 0; i < this.msgsToSend.length; i++) {
            const msg = this.msgsToSend[i];
            msgStream.serializeMsg(msg.type, msg.msg);
        }

        this.msgsToSend.length = 0;

        const globalMsgStream = this.game.clientBarn.msgsToSend.stream;
        msgStream.stream.writeBytes(globalMsgStream, 0, globalMsgStream.byteIndex);

        this.sendData(msgStream.getBuffer());
        this._firstUpdate = false;
        this._forceFullUpdate = false;
        if (this.player?.serverBot && this.msgStream.arrayBuf.byteLength > 64 * 1024) {
            this.msgStream = new net.MsgStream(new ArrayBuffer(64 * 1024));
        }
    }

    handleMsg(type: net.MsgType, msg: net.Msg) {
        const player = this.player;
        if (
            player
            && (type === net.MsgType.DropItem
                || type === net.MsgType.Emote
                || type === net.MsgType.PerkModeRoleSelect)
        ) {
            player.cancelSpawnProtection();
        }
        switch (type) {
            case net.MsgType.Input: {
                const imsg = msg as net.InputMsg;
                if (this.portrait != imsg.portrait) {
                    this._cullingPortraitTicker = 0.5;
                }
                this.portrait = imsg.portrait;

                this.ack = imsg.seq;

                if (!player) break;
                player.handleInput(imsg);
                break;
            }
            case net.MsgType.Emote: {
                if (!player) break;

                player.emoteFromMsg(msg as net.EmoteMsg);
                break;
            }
            case net.MsgType.DropItem: {
                if (!player) break;

                player.dropItem(msg as net.DropItemMsg);
                break;
            }
            case net.MsgType.Spectate: {
                this.handleSpectateMsg(msg as net.SpectateMsg);
                break;
            }
            case net.MsgType.SpectatorChat: {
                this.handleSpectatorChatMsg(msg as net.SpectatorChatMsg);
                break;
            }
            case net.MsgType.PerkModeRoleSelect: {
                if (!player) break;
                player.roleSelect((msg as net.PerkModeRoleSelectMsg).role);
                break;
            }
            case net.MsgType.Edit: {
                if (!player) break;
                player.processEditMsg(msg as net.EditMsg);
                break;
            }
            case net.MsgType.AimTrainingSettings: {
                if (!player) break;
                this.game.applyAimTrainingSettings(msg as net.AimTrainingSettingsMsg, player);
                break;
            }
        }
    }

    getSpectateCooldown() {
        if (this.noSpecCooldown) return 0;

        return this.shouldSpectateTeam() ? 0.1 : 1;
    }

    shouldSpectateTeam() {
        if (!this.player) return false;

        const team = this.player.team || this.player.group;
        if (!team) return false;

        return !team.allDeadOrDisconnected;
    }

    getSpectablePlayers(includeCurrent = false): Player[] {
        // we want to include the player we are currently spectating
        // even if they are dead, we only switch to a new player after 2 seconds
        // and not including it in the list will mess up the index for prev/next keybinds
        const shouldSpectate = (p: Player) => {
            if (includeCurrent && p === this.spectating) return true;
            return !p.dead;
        };

        if (this.shouldSpectateTeam()) {
            const team = this.player!.team ?? this.player!.group!;

            const groupId = this.player!.groupId;
            // put our group first, then sort others by their own group
            // so on faction mode we start spectating our own group first
            return team.players.filter(shouldSpectate).toSorted((a, b) => {
                if (a.groupId === b.groupId) {
                    return a.matchDataId - b.matchDataId;
                }

                if (a.groupId === groupId) return -Infinity;
                if (b.groupId === groupId) return Infinity;

                return a.groupId - b.groupId;
            });
        } else if (!this.game.isTeamMode) {
            return this.game.playerBarn.players.filter(shouldSpectate).toSorted((a, b) => {
                if (a.groupId === b.groupId) {
                    return a.matchDataId - b.matchDataId;
                }
                return a.groupId - b.groupId;
            });
        } else {
            return this.game.playerBarn.players.filter(shouldSpectate);
        }
    }

    getNewPlayerToSpectate(): Player {
        const spectateTeam = this.shouldSpectateTeam();
        let killer: Player | undefined = undefined;
        if (this.player && !spectateTeam) {
            killer = this.player.getAliveKiller();
        }
        if (killer) return killer;
        return this.getSpectablePlayers()[0];
    }

    handleSpectateMsg(spectateMsg: net.SpectateMsg): void {
        if (this.player && !this.player.dead) return;

        // Player-backed spectators carry the custom free-camera, layer and
        // players-only state. Dedicated upstream spectators have no Player and
        // continue to use the rate-limited Client implementation below.
        if (this.player) {
            this.player.spectate(spectateMsg);
            return;
        }

        switch (spectateMsg.action) {
            case SpectateAction.Begin:
                if (this.spectating) break;
                this.spectating = this.getNewPlayerToSpectate();
                break;
            case SpectateAction.Next:
            case SpectateAction.Prev:
                this._specAction = spectateMsg.action;
                break;
        }
    }

    handleSpectatorChatMsg(msg: net.SpectatorChatMsg): void {
        if (this.player) {
            this.player.sendSpectatorChat(msg);
            return;
        }
        if (msg.delivered || !this.spectating || this.spectating.disconnected) return;

        const now = Date.now();
        if (now - this._lastSpectatorChatAt < 900) return;
        this._lastSpectatorChatAt = now;

        const text = [...msg.text]
            .map((character) => {
                const code = character.charCodeAt(0);
                return code <= 0x1f || code === 0x7f ? " " : character;
            })
            .join("")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
        if (!text) return;

        const delivered = new net.SpectatorChatMsg();
        delivered.delivered = true;
        delivered.sender = "观众";
        delivered.text = text;
        this.spectating.sendMsg(net.MsgType.SpectatorChat, delivered, 512);
        this.sendInstantMsg(net.MsgType.SpectatorChat, delivered, 512);
    }
}
