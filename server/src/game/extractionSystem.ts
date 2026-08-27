import {
    EXTRACTION_HOLD_SECONDS,
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
    EXTRACTION_SECRET_OPEN_SECONDS,
    EXTRACTION_ZONE_RADIUS,
    generateExtractionPoints,
    insideExtractionZone,
} from "../../../shared/defs/extractionDefs.ts";
import { GameConfig, TeamMode } from "../../../shared/gameConfig.ts";
import * as net from "../../../shared/net/net.ts";
import { collider } from "../../../shared/utils/collider.ts";
import type { Vec2 } from "../../../shared/utils/v2.ts";
import {
    ExtractionBattleCommander,
    type ExtractionCommanderEntry,
    type ExtractionCommanderObstacle,
} from "../bot/extractionBattleCommander.ts";
import { Config } from "../config.ts";
import { stashManager } from "../stash/stashManager.ts";
import type { Game } from "./game.ts";
import type { Player } from "./objects/player.ts";

/**
 * 搜打撤 extraction rules:
 * - The map auto-plans several extraction points (deterministic, shared with
 *   the client so markers need no extra network state).
 * - Each player (or squad) is assigned ONE fixed point at spawn, based on the
 *   farthest point from their spawn position. It never changes, so the zone is
 *   reachable. The server keeps the authoritative hold progress and syncs it.
 * - Standing inside the active zone for EXTRACTION_HOLD_SECONDS extracts the
 *   player: carried loot is banked in the stash, then the player leaves.
 */
export class ExtractionSystem {
    readonly points: Vec2[];
    private readonly holdSeconds = new Map<number, number>();
    private readonly pointIdxByPlayer = new Map<number, number>();
    private readonly pointIdxByGroup = new Map<number, number>();
    private readonly extracted = new Set<number>();
    /** 中央计划先锋 AI id，按加入顺序，数量受旧追猎配置上限。 */
    private hunterBotIds: number[] = [];
    private readonly battleCommander = new ExtractionBattleCommander(false);
    private battleOrders: net.ExtractionBattleOrder[] = [];
    private timeUpDone = false;
    private syncTicker = 0;
    private humanHintTicker = 0;

    constructor(private readonly game: Game) {
        this.points = generateExtractionPoints(
            game.mapName,
            game.map.width,
            game.map.height,
        );
    }

    /** 固定撤离点索引（组队共享；首次按出生点最远分配）。 */
    pointIndexFor(player: Player): number {
        if (player.groupId !== 0 && player.groupId !== undefined) {
            let idx = this.pointIdxByGroup.get(player.groupId);
            if (idx === undefined) {
                idx = this.pickFarthestIndex(player.pos);
                this.pointIdxByGroup.set(player.groupId, idx);
            }
            return idx;
        }
        let idx = this.pointIdxByPlayer.get(player.__id);
        if (idx === undefined) {
            idx = this.pickFarthestIndex(player.pos);
            this.pointIdxByPlayer.set(player.__id, idx);
        }
        return idx;
    }

    private pickFarthestIndex(pos: Vec2): number {
        let best = 0;
        let bestDistSq = -1;
        for (let i = 0; i < this.points.length; i++) {
            const dx = this.points[i].x - pos.x;
            const dy = this.points[i].y - pos.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > bestDistSq) {
                bestDistSq = distSq;
                best = i;
            }
        }
        return best;
    }

    /** 固定撤离点位置（对玩家恒定）。 */
    activePointFor(player: Player): Vec2 {
        return this.points[this.pointIndexFor(player)];
    }

    private syncProgress(player: Player, target: Player = player): void {
        const msg = new net.ExtractionPointMsg();
        msg.pointIndex = this.pointIndexFor(target);
        msg.holdSeconds = this.holdSeconds.get(target.__id) ?? 0;
        player.client.sendMsg(net.MsgType.ExtractionPoint, msg);
    }

    update(dt: number): void {
        if (!this.game.map.mapDef.gameMode.extractionMode) return;
        // 每秒向机器人广播一次存活真人的大概位置，让 AI 前往追杀/合围，
        // 而不是整局捡物资。浏览器玩家不接收该消息，无协议对齐风险。
        this.humanHintTicker += dt;
        if (this.humanHintTicker >= 1) {
            this.humanHintTicker = 0;
            this.refreshHunters();
            this.refreshBattleOrders();
            this.broadcastHumanHints();
        }
        // 整局限时 10 分钟：时间到默认全部阵亡，对局结束。
        if (
            this.game.started
            && this.game.startedTime >= EXTRACTION_MATCH_TIME_LIMIT_SECONDS
            && !this.timeUpDone
        ) {
            this.timeUpDone = true;
            this.game.logger.log("Extraction match time limit reached (10 min); eliminating all contestants");
            for (const player of this.game.playerBarn.livingPlayers.slice()) {
                player.kill({
                    amount: 0,
                    damageType: GameConfig.DamageType.TimeUp,
                    dir: { x: 0, y: 0 },
                    source: undefined,
                });
            }
            return;
        }
        for (const player of this.game.playerBarn.livingPlayers.slice()) {
            if (player.serverBot || player.spectatorOnly) continue;
            // 未开局 / 倒地 / 断线：不累计撤离进度。
            if (!this.game.started) continue;
            // 绝密模式：撤离点前 5 分钟关闭，站进撤离点也不累计进度。
            if (
                this.game.extractionSecretEnabled
                && this.game.startedTime < EXTRACTION_SECRET_OPEN_SECONDS
            ) {
                this.holdSeconds.delete(player.__id);
                continue;
            }
            if (player.downed) continue;
            if (player.disconnected) continue;
            if (this.extracted.has(player.__id)) continue;
            const active = this.activePointFor(player);
            if (!insideExtractionZone(active, player.pos, EXTRACTION_ZONE_RADIUS)) {
                this.holdSeconds.delete(player.__id);
                continue;
            }
            const held = (this.holdSeconds.get(player.__id) ?? 0) + dt;
            this.holdSeconds.set(player.__id, held);
            if (held >= EXTRACTION_HOLD_SECONDS) {
                this.extract(player);
            }
        }
        // 权威进度同步（约 5 次/秒）。
        this.syncTicker += dt;
        if (this.syncTicker >= 0.2) {
            this.syncTicker = 0;
            for (const player of this.game.playerBarn.players) {
                if (player.serverBot || player.internalTrainingTarget) continue;
                // 观战者（含死亡观战/外部观战）：同步**被观战者**的撤离点索引，
                // 否则客户端小地图会退化成"当前位置最远点"，观战标记错误。
                const target = player.spectating && player.spectating !== player
                    ? player.spectating
                    : player;
                if (target.serverBot || target.spectatorOnly) continue;
                this.syncProgress(player, target);
            }
        }
    }

    private extract(player: Player): void {
        this.extracted.add(player.__id);
        this.holdSeconds.delete(player.__id);

        const weapons: string[] = [];
        for (const slot of [GameConfig.WeaponSlot.Primary, GameConfig.WeaponSlot.Secondary]) {
            const type = String(player.weapons[slot]?.type ?? "");
            // 自动配发的喇叭（Inspiration 技能）是系统发放、不占仓库库存，
            // 撤离时不带回，避免每场对局仓库多累积一个喇叭。
            if (type && type !== "fists" && type !== "bugle") weapons.push(type);
        }
        const meleeType = String(
            player.weapons[GameConfig.WeaponSlot.Melee]?.type ?? "",
        );
        // 技能（无限子弹 / 投掷物补充）产生的弹药与投掷物不会回到仓库。
        const inventory = player.carryOutInventory();
        try {
            stashManager.collectCarriedLoot(player.stashName || player.name, {
                weapons,
                melee: meleeType,
                inventory,
                perks: player.perksToCarryOut(),
                helmet: player.helmet,
                chest: player.chest,
                backpack: player.backpack,
                scope: player.scope,
            }, {
                matchId: this.game.id,
                teammateNames: this.game.playerBarn.players
                    .filter(
                        (candidate) =>
                            candidate !== player
                            && !candidate.serverBot
                            && !candidate.spectatorOnly
                            && candidate.groupId !== 0
                            && candidate.groupId === player.groupId,
                    )
                    .map((candidate) => candidate.stashName || candidate.name),
            });
            // 撤离成功：已入库，清除崩溃恢复用的待结算配装。
            stashManager.clearPendingGrant(player.stashName || player.name);
        } catch (error) {
            // stash 异常（锁竞争/数据损坏）不能阻止撤离：玩家照常离开，
            // 待结算配装残留会在服务器重启时由 recoverPendingGrants 归还。
            this.game.logger.warn(
                `[stash] collectCarriedLoot failed for ${player.name}:`,
            );
            console.error(error);
        }
        this.game.logger.log(
            `"${player.name}" extracted through their assigned extraction point (stash updated)`,
        );
        // 独立撤离生命周期：不触发死亡掉落/尸体/殉爆等副作用，
        // 已入库物资不会被复制到地面。
        player.extractFromMatch();
    }

    /** 广播存活真人坐标给本局所有 serverBot（低频、轻量）。 */
    private broadcastHumanHints(): void {
        const humans = this.game.playerBarn.players.filter(
            (player) =>
                !player.serverBot
                && !player.spectatorOnly
                && !player.dead
                && !player.disconnected
                && !player.extracted,
        );
        if (humans.length === 0) return;
        const msg = new net.ExtractionHumanHintMsg();
        msg.humans = humans.map((human) => ({
            id: human.__id,
            x: human.pos.x,
            y: human.pos.y,
            layer: human.layer,
        }));
        msg.hunterBotIds = [...this.hunterBotIds];
        msg.battleOrders = this.game.extractionSecretEnabled
            ? this.battleOrders.map((order) => ({ ...order }))
            : [];
        for (const bot of this.game.playerBarn.players) {
            if (
                !bot.serverBot
                || bot.spectatorOnly
                || bot.isBoss
                || bot.bossMinion
            ) {
                continue;
            }
            if (bot.dead || bot.disconnected) continue;
            bot.client.sendMsg(net.MsgType.ExtractionHumanHint, msg);
        }
    }

    /** Build one authoritative plan for every independent bot worker. */
    private refreshBattleOrders(): void {
        if (!this.game.extractionSecretEnabled) {
            this.battleOrders = [];
            return;
        }
        const humans = this.game.playerBarn.players.filter(
            (player) =>
                !player.serverBot
                && !player.spectatorOnly
                && !player.dead
                && !player.disconnected
                && !player.extracted,
        );
        const bots = this.game.playerBarn.players.filter(
            (player) =>
                player.serverBot
                && !player.isBoss
                && !player.bossMinion
                && !player.spectatorOnly
                && !player.dead
                && !player.disconnected,
        );
        if (humans.length === 0 || bots.length === 0) {
            this.battleOrders = [];
            return;
        }

        const entries: ExtractionCommanderEntry[] = [];
        for (const structure of this.game.map.structures) {
            for (let stairIndex = 0; stairIndex < structure.stairs.length; stairIndex++) {
                const stair = structure.stairs[stairIndex];
                if (stair.lootOnly) continue;
                entries.push({
                    kind: "stair",
                    id: structure.__id * 16 + stairIndex,
                    pos: { ...stair.center },
                    downDir: { ...stair.downDir },
                    structureId: structure.__id,
                    stairIndex,
                    layer: structure.layer,
                });
            }
        }
        for (const obstacle of this.game.map.obstacles) {
            if (
                !obstacle.isDoor
                || obstacle.dead
                || !obstacle.door?.canUse
                || obstacle.door.locked
            ) continue;
            entries.push({
                kind: "door",
                id: obstacle.__id,
                pos: { ...obstacle.pos },
                structureId: 0,
                stairIndex: 255,
                layer: obstacle.layer,
            });
        }

        const obstacles: ExtractionCommanderObstacle[] = this.game.map.obstacles
            .filter((obstacle) => obstacle.collidable)
            .map((obstacle) => ({
                id: obstacle.__id,
                type: obstacle.type,
                pos: { ...obstacle.pos },
                layer: obstacle.layer,
                dead: obstacle.dead,
                destructible: obstacle.destructible,
                openableDoor: Boolean(
                    obstacle.isDoor
                        && obstacle.door?.canUse
                        && !obstacle.door.locked,
                ),
                collision: obstacle.collider.type === collider.Type.Circle
                    ? {
                        type: 0 as const,
                        pos: { ...obstacle.collider.pos },
                        rad: obstacle.collider.rad,
                    }
                    : {
                        type: 1 as const,
                        min: { ...obstacle.collider.min },
                        max: { ...obstacle.collider.max },
                    },
            }));
        this.battleOrders = this.battleCommander.update({
            timestamp: this.game.startedTime * 1000,
            bots: bots.map((bot) => ({
                id: bot.__id,
                pos: { ...bot.pos },
                layer: bot.layer,
                health: bot.health,
                hasGun: [GameConfig.WeaponSlot.Primary, GameConfig.WeaponSlot.Secondary]
                    .some((slot) => Boolean(bot.weapons[slot]?.type)),
            })),
            humans: humans.map((human) => ({
                id: human.__id,
                pos: { ...human.pos },
                layer: human.layer,
            })),
            assaultBotIds: new Set(this.hunterBotIds),
            entries,
            obstacles,
            mapWidth: this.game.map.width,
            mapHeight: this.game.map.height,
        });
    }

    /** Armor-plated route blockers may only be damaged by their assigned clearer. */
    isBattleClearAuthorized(botId: number, obstacleId: number): boolean {
        return this.game.extractionSecretEnabled
            && this.battleOrders.some((order) =>
                order.active
                && order.botId === botId
                && order.clearObstacleId === obstacleId
            );
    }

    /**
     * 维护“追杀玩家”的 AI 名额：每局按模式配置上限（普通/绝密分别设置）。
     * 已有 hunter 死亡/断线后，空位在下次刷新时补给下一个存活的 AI，
     * 实现“AI 死亡后空出来给下一个 AI”。
     */
    private refreshHunters(): void {
        const secret = this.game.extractionSecretEnabled;
        const cfg = secret
            ? Config.extractionHunters.secret
            : Config.extractionHunters.normal;
        const modeKey = this.game.teamMode === TeamMode.Solo
            ? "solo"
            : this.game.teamMode === TeamMode.Duo
            ? "duo"
            : "squad";
        const cap = Math.max(0, Math.floor(Number(cfg[modeKey]) || 0));
        const aliveBots = this.game.playerBarn.players.filter(
            (player) =>
                player.serverBot
                && !player.isBoss
                && !player.bossMinion
                && !player.spectatorOnly
                && !player.dead
                && !player.disconnected,
        );
        const next: number[] = [];
        // 保留仍存活的 hunter，按加入顺序补满名额。
        for (const id of this.hunterBotIds) {
            if (next.length >= cap) break;
            if (aliveBots.some((bot) => bot.__id === id)) next.push(id);
        }
        for (const bot of aliveBots) {
            if (next.length >= cap) break;
            if (!next.includes(bot.__id)) next.push(bot.__id);
        }
        this.hunterBotIds = next;
    }
}
