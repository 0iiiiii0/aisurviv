import { GameConfig, TeamMode } from "../../../shared/gameConfig.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2 } from "../../../shared/utils/v2.ts";
import type { Game } from "./game.ts";
import type { DamageParams } from "./objects/gameObject.ts";
import type { Player } from "./objects/player.ts";

enum GameMode {
    /** default solos, any map besides factions */
    Solo,
    /** default duos or squads, any map besides factions */
    Team,
    /** irrelevant to gamemode type, always the mode if faction map is selected */
    Faction,
}

/**
 * PlayerStatus does not serialize player ids, so the server and client must use
 * exactly the same implicit ordering. The client keeps player ids sorted; sort
 * here as well so async multi-worker joins cannot attach one player's map
 * status to another player.
 */
export function orderPlayersForStatus<T extends { __id: number }>(
    players: readonly T[],
): T[] {
    return [...players].sort((a, b) => a.__id - b.__id);
}

export class GameModeManager {
    readonly game: Game;
    readonly mode: GameMode;
    readonly isSolo: boolean;

    constructor(game: Game) {
        this.game = game;

        this.mode = [
            game.teamMode == TeamMode.Solo && !game.map.factionMode,
            game.teamMode != TeamMode.Solo && !game.map.factionMode,
            game.map.factionMode,
        ].findIndex((isMode) => isMode);

        this.isSolo = this.mode === GameMode.Solo;
    }

    aliveCount(): number {
        switch (this.mode) {
            case GameMode.Solo:
                return this.game.playerBarn.livingPlayers.length;
            case GameMode.Team:
                return this.game.playerBarn.getAliveGroups().length;
            case GameMode.Faction:
                return this.game.playerBarn.getAliveTeams().length;
        }
    }

    // so the game doesn't start when there's only 2 players and one can of them can despawn which would end the game
    // instead it will await 10 seconds for the second player to not be able to despawn before starting
    cantDespawnAliveCount(): number {
        switch (this.mode) {
            case GameMode.Solo:
                return this.game.playerBarn.livingPlayers.filter((p) => !p.canDespawn())
                    .length;
            case GameMode.Team:
                return this.game.playerBarn.getAliveGroups().filter((group) => {
                    return group.players.filter((p) => !p.canDespawn()).length > 0;
                }).length;
            case GameMode.Faction:
                return this.game.playerBarn.getAliveTeams().filter((team) => {
                    return team.players.filter((p) => !p.canDespawn()).length;
                }).length;
        }
    }

    // used when saving the game match data
    getPlayersSortedByRank(): Array<{ player: Player; rank: number }> {
        const players = [...this.game.playerBarn.players];

        switch (this.mode) {
            case GameMode.Solo: {
                return players
                    .sort((a, b) => {
                        return b.killedIndex - a.killedIndex;
                    })
                    .map((player, idx) => {
                        return {
                            player,
                            rank: idx + 1,
                        };
                    });
            }
            case GameMode.Team:
            case GameMode.Faction: {
                // the logic is basically the exact same for both
                // just uses team instead of group on faction...

                const key = this.mode === GameMode.Faction ? "teams" : "groups";

                // calculate each group killed index
                // by basing it on the last player to die killed index
                const groups = this.game.playerBarn[key].map((group) => {
                    return {
                        killedIndex: group.players.sort((a, b) => {
                            return b.killedIndex - a.killedIndex;
                        })[0].killedIndex ?? Infinity,
                        players: group.players,
                    };
                });

                groups.sort((a, b) => b.killedIndex - a.killedIndex);

                let data: Array<{ player: Player; rank: number }> = [];

                for (let i = 0; i < groups.length; i++) {
                    for (const player of groups[i].players) {
                        data.push({
                            player,
                            rank: i + 1,
                        });
                    }
                }

                return data;
            }
        }
    }

    /** true if the room should transition to game-over. */
    /** true if game needs to end */
    handleGameEnd(): boolean {
        // Aim training is a persistent practice room. A human may enter before
        // the moving target process is ready, and the room must remain alive
        // even when only one participant is connected.
        if (this.game.mapName === "aim_training") return false;
        const zombieMode = Boolean(this.game.map.mapDef.gameMode.zombieMode);
        // 僵尸模式先走专属判定（僵尸不计入最后幸存）。
        if (zombieMode) {
            if (!this.game.started) return false;
            const humanAlive = this.game.playerBarn.livingPlayers.filter(
                (player) => !player.serverBot && !player.spectatorOnly,
            );
            // Completing the nuclear objective is the zombie-mode win
            // condition. Do not let a leaked generic server bot hold the room
            // open by being mistaken for a surviving zombie.
            if (this.game.zombieMode?.missionCompleted) {
                for (const player of humanAlive) {
                    player.addGameOverMsg(player.teamId);
                }
                return true;
            }
            if (
                humanAlive.length === 0
                && this.game.zombieMode?.detonating !== true
            ) {
                return true;
            }
            const anyZombie = this.game.playerBarn.livingPlayers.some(
                (player) => player.serverBot && !player.spectatorOnly,
            );
            if (!anyZombie && this.game.zombieMode?.detonating !== true) {
                for (const player of humanAlive) {
                    player.addGameOverMsg(player.teamId);
                }
                return true;
            }
            return false;
        }
        if (!this.game.started || this.aliveCount() > 1) return false;
        // Extraction: no last-man-standing victory. Matches end only by
        // extraction or the 10-minute time limit, while replacement AI keeps
        // the arena populated. An empty arena (time-up/extraction of the last
        // contestant) still ends the room lifecycle without a winner banner.
        if (this.game.map.mapDef.gameMode.extractionMode) {
            return this.aliveCount() === 0;
        }
        // Every contestant is dead or has been removed. There is no winner to
        // declare, but the room lifecycle must still close the empty match;
        // otherwise a started room where everyone died (and stayed connected
        // to spectate) never ends and leaks in the manager forever.
        if (this.aliveCount() === 0) return true;
        return this.aliveCount() === 1;
    }

    sendGameOverMsgs() {
        switch (this.mode) {
            case GameMode.Solo: {
                const winner = this.game.playerBarn.livingPlayers[0];
                winner.addGameOverMsg(winner.teamId);
                break;
            }
            case GameMode.Team: {
                const winner = this.game.playerBarn.getAliveGroups()[0];
                for (const player of winner.players) {
                    if (!player.disconnected && !player.dead) {
                        player.addGameOverMsg(winner.id);
                    }
                }
                break;
            }
            case GameMode.Faction: {
                const winner = this.game.playerBarn.getAliveTeams()[0];
                for (const player of winner.livingPlayers) {
                    player.addGameOverMsg(winner.id);
                }
                break;
            }
        }
    }

    isGameStarted(): boolean {
        if (this.game.mapName === "aim_training") {
            return this.game.playerBarn.livingPlayers.some(
                (player) => !player.serverBot && !player.spectatorOnly && !player.disconnected,
            );
        }
        // 僵尸模式：有存活真人即开始（僵尸由房间系统自行刷新）。
        if (this.game.map.mapDef.gameMode.zombieMode) {
            return this.game.playerBarn.livingPlayers.some(
                (player) => !player.serverBot && !player.spectatorOnly && !player.disconnected,
            );
        }
        // 绝密房间会在 init 阶段先生成 Boss/护卫；这些原生 NPC 不能在
        // 真人进房前启动对局计时。普通搜打撤也统一以首个真人入场为开局。
        if (this.game.map.mapDef.gameMode.extractionMode) {
            return this.game.playerBarn.livingPlayers.some(
                (player) => !player.serverBot && !player.spectatorOnly && !player.disconnected,
            );
        }
        // Arena players are deliberately frozen until every contestant has
        // joined. While frozen, Player.update() does not advance timeAlive, so
        // the normal canDespawn() grace-period gate below can never complete.
        // Use the authoritative connected contestant count for arenas instead.
        if (this.game.map.mapDef.arena?.lockPlayersUntilFull) {
            return this.game.connectedCount >= this.game.roomMaxPlayers;
        }
        return this.cantDespawnAliveCount() > 1;
    }

    updateAliveCounts(aliveCounts: number[]): void {
        switch (this.mode) {
            case GameMode.Solo:
            case GameMode.Team:
                aliveCounts.push(this.game.aliveCount);
                break;
            case GameMode.Faction:
                const numFactions = this.game.map.mapDef.gameMode.factions!;
                for (let i = 0; i < numFactions; i++) {
                    aliveCounts.push(this.game.playerBarn.teams[i].livingPlayers.length);
                }
                break;
        }
    }

    /**
     * Solos: all living players in game wrapped in outer array
     *
     * Duos/Squads: 2D array of living players in each group
     *
     * Factions: 2D array of living players on each team
     */
    getAlivePlayersContext(): Player[][] {
        switch (this.mode) {
            case GameMode.Solo:
                return [this.game.playerBarn.livingPlayers];
            case GameMode.Team:
                return this.game.playerBarn.groups.map((g) => g.livingPlayers);
            case GameMode.Faction:
                return this.game.playerBarn.teams.map((t) => t.livingPlayers);
        }
    }

    getSpectatablePlayers(player: Player): Player[] {
        const livingPlayers = this.game.playerBarn.livingPlayers
            .filter(
                (candidate) =>
                    candidate !== player
                    && !candidate.dead
                    && !candidate.disconnected
                    && !candidate.spectatorOnly,
            )
            // Spectators should see real players first. Preserve the existing
            // player-barn order inside each class so next/previous remains stable.
            .sort((a, b) => Number(a.serverBot) - Number(b.serverBot));
        if (player.spectatorOnly) return livingPlayers;

        let playerFilter: (p: Player) => boolean;
        if (this.getPlayerAlivePlayersContext(player).length != 0) {
            playerFilter = (p: Player) => p.teamId == player.teamId;
        } else {
            playerFilter = () => true;
        }
        // livingPlayers is used here instead of a more "efficient" option because its sorted while other options are not
        return livingPlayers.filter(playerFilter);
    }

    getPlayerStatusPlayers(player: Player): Player[] {
        switch (this.mode) {
            case GameMode.Solo:
                return [];
            case GameMode.Team:
                // 观战者没有加入队伍/分组：直接返回空，避免 netSync 崩溃。
                return player.group
                    ? orderPlayersForStatus(player.group.players)
                    : [];
            case GameMode.Faction:
                return orderPlayersForStatus(this.game.playerBarn.players);
        }
    }

    getPlayerAlivePlayersContext(player: Player): Player[] {
        if (player.spectatorOnly) return [];
        switch (this.mode) {
            case GameMode.Solo:
                return !player.dead ? [player] : [];
            case GameMode.Team:
                return player.group?.livingPlayers ?? [];
            case GameMode.Faction:
                return player.team?.livingPlayers ?? [];
        }
    }

    /** includes passed in player */
    getNearbyAlivePlayersContext(player: Player, range: number): Player[] {
        const alivePlayersContext = this.getPlayerAlivePlayersContext(player);

        // probably more efficient when there's 4 or less players in the context (untested)
        if (alivePlayersContext.length <= 4) {
            return alivePlayersContext.filter(
                (p) =>
                    !!util.sameLayer(player.layer, p.layer)
                    && v2.lengthSqr(v2.sub(player.pos, p.pos)) <= range * range,
            );
        }

        return this.game.grid
            .intersectCollider(collider.createCircle(player.pos, range))
            .filter(
                (obj): obj is Player =>
                    obj.__type == ObjectType.Player
                    && player.teamId === obj.teamId
                    && !obj.dead // necessary since player isnt deleted from grid on death
                    && !!util.sameLayer(player.layer, obj.layer)
                    && v2.lengthSqr(v2.sub(player.pos, obj.pos)) <= range * range,
            );
    }

    showStatsMsg(player: Player): boolean {
        switch (this.mode) {
            case GameMode.Solo:
                return false;
            case GameMode.Team:
                return !player.group!.allDeadOrDisconnected && this.aliveCount() > 1;
            case GameMode.Faction:
                return this.aliveCount() > 1;
        }
    }

    getGameoverPlayers(player: Player): Player[] {
        switch (this.mode) {
            case GameMode.Solo:
                return [player];
            case GameMode.Team:
                return player.group!.players;
            case GameMode.Faction:
                const redLeader = this.game.playerBarn.teams[GameConfig.FactionTeam.Red - 1].leader;
                const blueLeader = this.game.playerBarn.teams[GameConfig.FactionTeam.Blue - 1].leader;
                const highestKiller = this.game.playerBarn.players.reduce(
                    (highestKiller, p) => {
                        if (highestKiller.kills === p.kills) {
                            return highestKiller.damageDealt > p.damageDealt
                                ? highestKiller
                                : p;
                        }

                        return highestKiller.kills > p.kills ? highestKiller : p;
                    },
                );

                // if game ends before leaders are promoted, just show the player by himself
                return !redLeader || !blueLeader
                    ? [player]
                    : [player, redLeader, blueLeader, highestKiller];
        }
    }

    handlePlayerDeath(player: Player, params: DamageParams): void {
        if (this.isSolo) {
            player.kill(params);
        } else {
            const group = this.mode === GameMode.Faction ? player.team! : player.group!;

            const playerSource = params.source?.__type === ObjectType.Player
                ? (params.source as Player)
                : undefined;
            if (player.downed) {
                const finishedByTeammate = player.downedBy
                    && playerSource
                    && player.downedBy.teamId === playerSource.teamId;

                const nonPlayerKill = player.downedBy && params.damageType != GameConfig.DamageType.Player;

                const teammateStoleKill = player.downedBy
                    && playerSource
                    && player.downedBy.__type === ObjectType.Player
                    && player.downedBy.teamId !== playerSource.teamId
                    && player.teamId === playerSource.teamId;
                // give kill credit to the person that downed the player if it was killed by:
                // a teammate, bleeding or non player source (airstrike, gas etc)
                if (finishedByTeammate || nonPlayerKill || teammateStoleKill) {
                    params.killCreditSource = player.downedBy;
                }

                player.kill(params);
                // special case that only happens when the player has self_revive since the teammates wouldnt have previously been finished off
                if (group.checkAllDowned(player) && !group.checkSelfRevive()) {
                    // don't kill teammates if any one has self revive
                    group.killAllDowned();
                }
                return;
            }

            const allDeadOrDisconnected = group.checkAllDeadOrDisconnected(player);
            const allDowned = group.checkAllDowned(player);
            const groupHasSelfRevive = group.checkSelfRevive();

            if (!groupHasSelfRevive && (allDeadOrDisconnected || allDowned)) {
                group.allDeadOrDisconnected = true; // must set before any kill() calls so the gameovermsgs are accurate
                player.kill(params);
                if (allDowned) {
                    group.killAllDowned();
                }
            } else {
                player.down(params);
            }
        }
    }
}
