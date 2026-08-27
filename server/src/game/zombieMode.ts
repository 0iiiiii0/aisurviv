import { AchievementIds } from "../../../shared/defs/achievementDefs.ts";
import {
    ZOMBIE_ATTACK_COOLDOWN_MS,
    ZOMBIE_ATTACK_RANGE,
    ZOMBIE_DIFFICULTY_PRESETS,
    ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC,
    ZOMBIE_MISSION_ELEMENT_COUNT,
    ZOMBIE_MISSION_INTERACT_RADIUS,
    ZOMBIE_NORMAL_WAVES,
    ZOMBIE_RUSH_RANGE,
} from "../../../shared/defs/zombieDefs.ts";
import { GameConfig, TeamMode } from "../../../shared/gameConfig.ts";
import * as net from "../../../shared/net/net.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2 } from "../../../shared/utils/v2.ts";
import { Config } from "../config.ts";
import { stashManager } from "../stash/stashManager.ts";
import type { Game } from "./game.ts";
import type { Player } from "./objects/player.ts";

interface MissionElement {
    pos: { x: number; y: number };
    originalPos: { x: number; y: number };
    carrierId: number;
    placed: boolean;
}

/** 僵尸统一装备的小刀。 */
const ZOMBIE_MELEE = "bayonet";

/**
 * The nuclear achievement is intentionally exclusive to the solo hard
 * playlist. Difficulty and team size are both authoritative room snapshots,
 * so a duo/squad client cannot claim it by altering local UI state.
 */
export function qualifiesForZombieNuclearAchievement(
    difficulty: "simple" | "normal" | "hard",
    teamMode: TeamMode,
): boolean {
    return difficulty === "hard" && teamMode === TeamMode.Solo;
}

/**
 * Zombie mode: large numbers of low-cost melee zombies chase players.
 * - Spawns initialCount zombies on start; replenishes replenishCount every
 *   replenishIntervalSec;
 * - Zombies only hold a random melee weapon, green outfit, never loot or shoot;
 *   they run straight at the nearest player;
 * - Each hit grants the player one trick_drain (max 4);
 * - 5% spawn as self-destruct variants (same look): final_bugle + martyrdom,
 *   rush at 1.5x speed when close and explode on contact;
 * - Players win by surviving winTimeSec (all zombies cleared, match ends).
 */
export class ZombieModeSystem {
    private readonly zombies: Player[] = [];
    private spawnSeq = 0;
    private spawnedInitial = false;
    private nextReplenishAt = 0;
    private winHandled = false;
    private waveIndex = 0;
    private targetCacheUntil = 0;
    private cachedTargets = new Map<number, Player>();

    readonly missionElements: MissionElement[] = [];
    missionDevicePos: { x: number; y: number } = v2.create(0, 0);
    missionPhase = net.ZombieMissionPhase.Collecting;
    private shelterCountdownEndsAt = 0;
    private nextMissionSyncAt = 0;
    private nukeSequence = 0;
    private nukeKills = 0;
    detonating = false;
    private readonly missionReachableCells = new Set<string>();
    private readonly missionReachabilityStep = 5;

    constructor(private readonly game: Game) {
        const points = this.createMissionPoints();
        this.missionDevicePos = points.device;
        this.buildMissionReachability(points.device);
        for (const pos of points.elements) {
            this.missionElements.push({
                pos: v2.copy(pos),
                originalPos: v2.copy(pos),
                carrierId: 0,
                placed: false,
            });
        }
        this.game.logger.log(
            `[zombie-mission] seed=${this.game.map.seed} device=(${points.device.x.toFixed(1)},${
                points.device.y.toFixed(1)
            }) elements=${points.elements.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(",")}`,
        );
    }

    get active(): boolean {
        return Boolean(this.game.map.mapDef.gameMode.zombieMode);
    }

    private difficultyName(): "simple" | "normal" | "hard" {
        return (
            (this.game.config as { zombieDifficulty?: "simple" | "normal" | "hard" })
                .zombieDifficulty ?? "normal"
        );
    }

    /** 当前房间的难度参数（建房间快照；默认普通）。 */
    private params(): (typeof ZOMBIE_DIFFICULTY_PRESETS)["normal"] {
        return (
            ZOMBIE_DIFFICULTY_PRESETS[this.difficultyName()]
                ?? ZOMBIE_DIFFICULTY_PRESETS.normal
        );
    }

    /** 标准（普通）与困难难度使用同一波次表；简单使用预设参数。 */
    private get waves(): typeof ZOMBIE_NORMAL_WAVES | null {
        const diff = this.difficultyName();
        return diff === "normal" || diff === "hard" ? ZOMBIE_NORMAL_WAVES : null;
    }

    get zombieCount(): number {
        return this.zombies.filter((z) => !z.dead && !z.disconnected).length;
    }

    /** Nuclear success is authoritative even if an unrelated server bot leaked in. */
    get missionCompleted(): boolean {
        return this.missionPhase === net.ZombieMissionPhase.Detonated;
    }

    /** The authoritative match clock freezes once all three elements are placed. */
    get matchTimerPaused(): boolean {
        return this.missionPhase >= net.ZombieMissionPhase.Armed;
    }

    get missionSnapshot(): {
        phase: net.ZombieMissionPhase;
        devicePos: { x: number; y: number };
        elements: ReadonlyArray<MissionElement>;
        nukeKills: number;
    } {
        return {
            phase: this.missionPhase,
            devicePos: v2.copy(this.missionDevicePos),
            elements: this.missionElements,
            nukeKills: this.nukeKills,
        };
    }

    isMissionPointReachable(pos: { x: number; y: number }): boolean {
        const step = this.missionReachabilityStep;
        const baseX = Math.round((pos.x - this.missionDevicePos.x) / step);
        const baseY = Math.round((pos.y - this.missionDevicePos.y) / step);
        for (let x = baseX - 1; x <= baseX + 1; x++) {
            for (let y = baseY - 1; y <= baseY + 1; y++) {
                if (!this.missionReachableCells.has(`${x},${y}`)) continue;
                const cellPos = v2.create(
                    this.missionDevicePos.x + x * step,
                    this.missionDevicePos.y + y * step,
                );
                if (
                    v2.distance(cellPos, pos) <= step * 1.5
                    && this.game.map.hasPlayerWalkPath(cellPos, pos, 0, 0.72)
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    /** A bunker is the odd (underground) gameplay layer; stair layer 3 counts inside. */
    isPlayerInBunker(player: Player): boolean {
        return (player.layer & 1) === 1;
    }

    /**
     * 自爆僵尸直线可达检查：玩家与僵尸之间无墙/障碍阻挡才返回 true。
     * 结果缓存 150ms（每 tick 全量僵尸循环下避免路径采样开销）。
     */
    private hasClearLos(zombie: Player, target: Player, now: number): boolean {
        if (now >= zombie.zombieLosUntil) {
            zombie.zombieLosUntil = now + 150;
            zombie.zombieHasLos = this.game.map.hasPlayerWalkPath(
                zombie.pos,
                target.pos,
                zombie.layer,
                0.72,
            );
        }
        return zombie.zombieHasLos;
    }

    /**
     * Committed self-destruct rush steering. Once a bomber has acquired a clear
     * charge lane, a brief LOS loss must not cancel the charge and strand it
     * against the first tree/door frame. Probe a handful of short tangent lanes
     * and keep the direction that still makes progress toward the target.
     */
    private selfDestructRushDirection(
        zombie: Player,
        target: Player,
        direct: { x: number; y: number },
        clearLos: boolean,
    ): { x: number; y: number } {
        if (clearLos) return direct;

        const probeDistance = 2.8;
        const preferredSign = (zombie.__id & 1) === 0 ? 1 : -1;
        const angleCandidates = [
            35,
            -35,
            65,
            -65,
            95,
            -95,
            125,
            -125,
        ].map((degrees) => (degrees * Math.PI) / 180 * preferredSign);
        let best = direct;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const angle of angleCandidates) {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const candidate = v2.create(
                direct.x * cos - direct.y * sin,
                direct.x * sin + direct.y * cos,
            );
            const probe = v2.create(
                zombie.pos.x + candidate.x * probeDistance,
                zombie.pos.y + candidate.y * probeDistance,
            );
            if (!this.game.map.isPlayerWalkableAt(probe, zombie.layer, 0.72)) continue;
            if (!this.game.map.hasPlayerWalkPath(zombie.pos, probe, zombie.layer, 0.72)) {
                continue;
            }

            const progress = v2.distance(probe, target.pos);
            const turnPenalty = Math.abs(angle) * 0.18;
            const score = progress + turnPenalty;
            if (score < bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        return best;
    }

    /** Handle the normal interact key when it is aimed at a mission object. */
    tryInteractMission(player: Player): boolean {
        if (
            !this.active
            || !this.game.started
            || player.serverBot
            || player.spectatorOnly
            || player.dead
            || player.disconnected
            || this.missionPhase !== net.ZombieMissionPhase.Collecting
            || player.layer !== 0
        ) {
            return false;
        }

        if (player.zombieMissionCarriedElement >= 0) {
            if (
                v2.distance(player.pos, this.missionDevicePos)
                    <= ZOMBIE_MISSION_INTERACT_RADIUS
            ) {
                const index = player.zombieMissionCarriedElement;
                const element = this.missionElements[index];
                if (element && !element.placed && element.carrierId === player.__id) {
                    element.carrierId = 0;
                    element.placed = true;
                    element.pos = v2.copy(this.missionDevicePos);
                    player.zombieMissionCarriedElement = -1;
                    player.recalculateSpeed();
                    this.nextMissionSyncAt = 0;
                    if (this.missionElements.every((entry) => entry.placed)) {
                        this.armMission();
                    }
                }
                return true;
            }

            // Do not let an element carrier accidentally pick up a second one.
            return this.missionElements.some(
                (element) =>
                    !element.placed
                    && element.carrierId === 0
                    && v2.distance(player.pos, element.pos)
                        <= ZOMBIE_MISSION_INTERACT_RADIUS,
            );
        }

        let closestIndex = -1;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < this.missionElements.length; i++) {
            const element = this.missionElements[i];
            if (element.placed || element.carrierId !== 0) continue;
            const distance = v2.distance(player.pos, element.pos);
            if (
                distance <= ZOMBIE_MISSION_INTERACT_RADIUS
                && distance < closestDistance
            ) {
                closestIndex = i;
                closestDistance = distance;
            }
        }
        if (closestIndex < 0) return false;

        this.missionElements[closestIndex].carrierId = player.__id;
        player.zombieMissionCarriedElement = closestIndex;
        player.recalculateSpeed();
        this.nextMissionSyncAt = 0;
        return true;
    }

    update(dt: number): void {
        if (!this.active || !this.game.started) return;

        const waveTable = this.waves;
        if (!this.spawnedInitial) {
            this.spawnedInitial = true;
            if (waveTable) {
                // 标准波次制：第一波（开局 40 个，无自爆僵尸）。
                const firstWave = waveTable[0];
                for (let i = 0; i < firstWave.count; i++) {
                    this.spawnZombie(firstWave.selfDestructChance);
                }
                this.waveIndex = 0;
                this.nextReplenishAt = 0; // 波次制不用定时补充
                this.game.logger.log(
                    `[zombie] wave 0: ${firstWave.count} zombies (0% self-destruct)`,
                );
            } else {
                const count = Math.max(
                    1,
                    Math.floor(Number(this.params().initialCount) || 40),
                );
                for (let i = 0; i < count; i++) {
                    this.spawnZombie(this.params().selfDestructChance);
                }
                this.nextReplenishAt = Date.now()
                    + Math.max(30, Number(Config.zombie.replenishIntervalSec) || 120) * 1000;
                this.game.logger.log(`[zombie] spawned ${count} zombies`);
            }
        }

        // 标准波次制：按对局时间触发后续波次。
        if (waveTable) {
            for (let w = this.waveIndex + 1; w < waveTable.length; w++) {
                const wave = waveTable[w];
                if (this.game.startedTime >= wave.atSec) {
                    this.waveIndex = w;
                    for (let i = 0; i < wave.count; i++) {
                        this.spawnZombie(wave.selfDestructChance);
                    }
                    this.game.logger.log(
                        `[zombie] wave ${w}: +${wave.count} zombies (${
                            Math.round(wave.selfDestructChance * 100)
                        }% self-destruct) at ${wave.atSec}s`,
                    );
                }
            }
        }

        const now = Date.now();
        this.updateMission(now);
        // Detonation is the terminal success state. Do not run zombie movement,
        // wave scheduling or the simple-mode replenish timer during the short
        // game-over grace period.
        if (this.missionCompleted) return;
        // Target cache: recompute nearest player every 0.4s (low cost).
        if (now >= this.targetCacheUntil) {
            this.targetCacheUntil = now + 400;
            this.cachedTargets.clear();
            for (const player of this.game.playerBarn.players) {
                if (
                    player.serverBot
                    || player.spectatorOnly
                    || player.dead
                    || player.disconnected
                ) {
                    continue;
                }
                for (const zombie of this.zombies) {
                    if (zombie.dead || zombie.disconnected) continue;
                    // 只追同层玩家（楼梯层互通）：防止僵尸跨楼层追踪/啃食。
                    if (!util.sameLayer(zombie.layer, player.layer)) continue;
                    const current = this.cachedTargets.get(zombie.__id);
                    if (
                        !current
                        || v2.distance(zombie.pos, player.pos)
                            < v2.distance(zombie.pos, current.pos)
                    ) {
                        this.cachedTargets.set(zombie.__id, player);
                    }
                }
            }
        }

        for (const zombie of this.zombies) {
            if (zombie.dead || zombie.disconnected) continue;
            const target = this.cachedTargets.get(zombie.__id);
            if (!target || target.dead || target.disconnected) continue;

            const dx = target.pos.x - zombie.pos.x;
            const dy = target.pos.y - zombie.pos.y;
            const dist = Math.hypot(dx, dy);
            const dirX = dist > 0.001 ? dx / dist : 1;
            const dirY = dist > 0.001 ? dy / dist : 0;

            // Self-destruct variant: the clear lane is required to *start* a
            // rush, but once committed a one-frame LOS flicker must not cancel
            // it. The bomber keeps charging until the target escapes well beyond
            // the trigger range. Contact detonation still requires clear LOS, so
            // walls cannot be exploded through.
            const selfDestruct = zombie.zombieSelfDestruct;
            const clearLos = selfDestruct && this.hasClearLos(zombie, target, now);
            if (
                selfDestruct
                && !zombie.zombieRushing
                && dist < ZOMBIE_RUSH_RANGE
                && clearLos
            ) {
                zombie.zombieRushing = true;
            } else if (
                zombie.zombieRushing
                && dist > ZOMBIE_RUSH_RANGE * 1.5
            ) {
                zombie.zombieRushing = false;
            }
            if (zombie.zombieRushing) {
                // Networked marker for client rush sound/particles. Movement speed
                // itself is authoritative in Player.recalculateSpeed().
                zombie.giveHaste(GameConfig.HasteType.Windwalk, 0.6);
            }

            const moveDir = selfDestruct && zombie.zombieRushing
                ? this.selfDestructRushDirection(
                    zombie,
                    target,
                    v2.create(dirX, dirY),
                    clearLos,
                )
                : v2.create(dirX, dirY);

            // A bomber that is geometrically close but separated by cover must
            // keep moving around the blocker instead of stopping at attack range.
            const shouldAdvance = dist >= ZOMBIE_ATTACK_RANGE
                || (selfDestruct && zombie.zombieRushing && !clearLos);
            if (shouldAdvance) {
                zombie.moveLeft = moveDir.x < -0.2;
                zombie.moveRight = moveDir.x > 0.2;
                zombie.moveUp = moveDir.y > 0.2;
                zombie.moveDown = moveDir.y < -0.2;
            } else {
                zombie.moveLeft = false;
                zombie.moveRight = false;
                zombie.moveUp = false;
                zombie.moveDown = false;
            }
            if (!v2.eq(zombie.dir, moveDir)) zombie.setPartDirty();
            zombie.dir = v2.copy(moveDir);
            // Player.update() treats dirNew as the authoritative input and runs
            // immediately after this system. Zombies have no real InputMsg, so
            // keep both directions in sync or the model snaps back to its spawn
            // facing every tick even while its movement changes direction.
            zombie.dirNew = v2.copy(moveDir);
            // 每 tick 重置攻击输入，仅在攻击瞬间置 true（触发一次挥击）。
            zombie.shootStart = false;
            zombie.shootHold = false;

            // 僵尸进门：每 0.5s 尝试交互身边的门（自动开门），
            // 否则玩家躲进建筑后僵尸会被门永久挡住。
            if (now >= zombie.zombieDoorInteractUntil) {
                zombie.zombieDoorInteractUntil = now + 500;
                for (const obstacle of zombie.getInteractableObstacles()) {
                    if (
                        obstacle.isDoor
                        && !obstacle.door?.open
                    ) {
                        zombie.interactWith(obstacle);
                        break;
                    }
                }
            }

            // Self-destruct contact is not a normal melee swing: once a bomber
            // reaches a clear target it detonates immediately, even if a prior
            // blocked melee attempt left the ordinary 900ms attack cooldown active.
            if (
                dist < ZOMBIE_ATTACK_RANGE
                && zombie.zombieSelfDestruct
                && this.hasClearLos(zombie, target, now)
            ) {
                this.game.explosionBarn.addExplosion(
                    "explosion_frag",
                    v2.copy(zombie.pos),
                    zombie.layer,
                    {
                        gameSourceType: "martyr_nade",
                        damageType: GameConfig.DamageType.Player,
                        source: zombie,
                    },
                );
                zombie.kill({
                    amount: 0,
                    damageType: GameConfig.DamageType.Player,
                    dir: v2.create(dirX, dirY),
                    source: zombie,
                });
            } else if (
                dist < ZOMBIE_ATTACK_RANGE
                && now >= zombie.zombieAttackCooldownUntil
            ) {
                zombie.zombieAttackCooldownUntil = now + ZOMBIE_ATTACK_COOLDOWN_MS;
                // 挥动近战武器：meleeUpdate 触发动画与真实命中判定，
                // 命中时由 meleeDamage 叠加 trick_drain（上限 4）。
                zombie.shootStart = true;
            }
        }

        // 非波次制（简单/困难）：每 replenishIntervalSec 补充一批。
        if (!waveTable && now >= this.nextReplenishAt) {
            const intervalMs = Math.max(30, Number(Config.zombie.replenishIntervalSec) || 120) * 1000;
            this.nextReplenishAt = now + intervalMs;
            const replenish = Math.max(
                1,
                Math.floor(Number(this.params().replenishCount) || 20),
            );
            for (let i = 0; i < replenish; i++) {
                this.spawnZombie(this.params().selfDestructChance);
            }
            this.game.logger.log(`[zombie] replenished ${replenish} zombies`);
        }

        // The mission must be completed before the old survival timer expires.
        // Placing all elements freezes this clock while players seek shelter.
        const winTime = Math.max(60, Number(Config.zombie.winTimeSec) || 360);
        if (
            !this.winHandled
            && this.missionPhase === net.ZombieMissionPhase.Collecting
            && this.game.startedTime >= winTime
        ) {
            this.winHandled = true;
            this.game.logger.log(
                `[zombie-mission] objective timed out at ${winTime}s; eliminating survivors`,
            );
            for (const player of this.livingHumans()) {
                player.kill({
                    amount: 99999,
                    damageType: GameConfig.DamageType.TimeUp,
                    dir: v2.create(0, 1),
                    source: undefined,
                });
            }
        }
    }

    private livingHumans(): Player[] {
        return this.game.playerBarn.livingPlayers.filter(
            (player) =>
                !player.serverBot
                && !player.spectatorOnly
                && !player.dead
                && !player.disconnected,
        );
    }

    private armMission(): void {
        this.missionPhase = net.ZombieMissionPhase.Countdown;
        this.shelterCountdownEndsAt = Date.now() + ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC * 1000;
        this.nextMissionSyncAt = 0;
        this.game.logger.log(
            `[zombie-mission] all elements placed at ${
                this.game.startedTime.toFixed(1)
            }s; nuclear blast in ${ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC}s`,
        );
    }

    private updateMission(now: number): void {
        // A dead/disconnected carrier drops the element back onto nearby safe land.
        for (let i = 0; i < this.missionElements.length; i++) {
            const element = this.missionElements[i];
            if (!element.carrierId || element.placed) continue;
            const carrier = this.game.objectRegister.getById(element.carrierId);
            if (
                carrier?.__type === ObjectType.Player
                && !carrier.dead
                && !carrier.disconnected
                && carrier.zombieMissionCarriedElement === i
            ) {
                continue;
            }
            const dropCenter = carrier?.pos ?? element.originalPos;
            element.pos = this.game.map.findSpawnableNear("boss_totem", dropCenter, 28, 0)
                ?? v2.copy(element.originalPos);
            if (carrier?.__type === ObjectType.Player) {
                carrier.zombieMissionCarriedElement = -1;
                carrier.recalculateSpeed();
            }
            element.carrierId = 0;
            this.nextMissionSyncAt = 0;
        }

        if (
            this.missionPhase === net.ZombieMissionPhase.Countdown
            && now >= this.shelterCountdownEndsAt
        ) {
            this.detonateNuke();
        }

        if (now >= this.nextMissionSyncAt) {
            this.nextMissionSyncAt = now + 250;
            this.sendMissionSnapshots(now);
        }
    }

    private sendMissionSnapshots(now: number): void {
        let placedMask = 0;
        let groundMask = 0;
        for (let i = 0; i < this.missionElements.length; i++) {
            const element = this.missionElements[i];
            if (element.placed) placedMask |= 1 << i;
            else if (!element.carrierId) groundMask |= 1 << i;
        }
        const countdownMs = this.missionPhase === net.ZombieMissionPhase.Countdown
            ? Math.max(0, Math.ceil(this.shelterCountdownEndsAt - now))
            : 0;
        for (const recipient of this.game.playerBarn.players) {
            if (recipient.serverBot || recipient.internalTrainingTarget) continue;
            const observed = recipient.spectating ?? recipient;
            const msg = new net.ZombieMissionMsg();
            msg.phase = this.missionPhase;
            msg.placedMask = placedMask;
            msg.groundMask = groundMask;
            msg.carriedElement = observed.zombieMissionCarriedElement >= 0
                ? observed.zombieMissionCarriedElement
                : 0xff;
            msg.devicePos = v2.copy(this.missionDevicePos);
            msg.elementPositions = this.missionElements.map((element) => v2.copy(element.pos));
            msg.countdownMs = countdownMs;
            msg.inBunker = this.isPlayerInBunker(observed);
            msg.nukeSequence = this.nukeSequence;
            msg.nukeKills = this.nukeKills;
            recipient.sendMsg(net.MsgType.ZombieMission, msg, 96);
        }
    }

    private detonateNuke(): void {
        if (this.missionPhase === net.ZombieMissionPhase.Detonated) return;
        this.detonating = true;
        const humans = this.livingHumans();
        const protectedHumans = humans.filter((player) => this.isPlayerInBunker(player));
        const outsideHumans = humans.filter((player) => !this.isPlayerInBunker(player));
        const killCredit = protectedHumans[0];
        const livingZombies = this.zombies.filter(
            (zombie) => !zombie.dead && !zombie.disconnected,
        );
        this.nukeKills = livingZombies.length;

        for (const player of outsideHumans) {
            player.kill({
                amount: 99999,
                damageType: GameConfig.DamageType.Nuclear,
                dir: v2.normalize(v2.sub(player.pos, this.missionDevicePos)),
                source: undefined,
            });
        }
        for (let i = 0; i < livingZombies.length; i++) {
            const source = protectedHumans.length
                ? protectedHumans[i % protectedHumans.length]
                : killCredit;
            livingZombies[i].kill({
                amount: 99999,
                damageType: GameConfig.DamageType.Nuclear,
                dir: v2.normalize(v2.sub(livingZombies[i].pos, this.missionDevicePos)),
                source,
            });
        }

        // The nuclear wave razes every destructible ground obstacle. Work on a
        // snapshot because obstacle destruction can create/remove map objects.
        // Suppress loot so thousands of destroyed props cannot turn one blast
        // into a loot storm or a long server stall.
        let destroyedGroundObjects = 0;
        for (const object of Array.from(this.game.objectRegister.objects)) {
            if (
                !object
                || object.__type !== ObjectType.Obstacle
                || object.dead
                || !object.destructible
                || (object.layer & 1) !== 0
            ) {
                continue;
            }
            object.suppressLoot = true;
            object.kill({
                amount: 99999,
                damageType: GameConfig.DamageType.Nuclear,
                dir: v2.normalize(v2.sub(object.pos, this.missionDevicePos)),
                source: killCredit,
                isExplosion: true,
            });
            destroyedGroundObjects++;
        }

        // A normal networked explosion supplies a world flash/decal in addition
        // to the mission's full-screen nuclear effect; the mission kills above
        // remain authoritative and ignore walls.
        this.game.explosionBarn.addExplosion(
            "explosion_bomb_iron",
            v2.copy(this.missionDevicePos),
            0,
            {
                damageType: GameConfig.DamageType.Nuclear,
                source: killCredit,
            },
        );
        this.missionPhase = net.ZombieMissionPhase.Detonated;
        this.nukeSequence = (this.nukeSequence + 1) & 0xff;
        this.nextMissionSyncAt = 0;
        this.detonating = false;
        this.sendMissionSnapshots(Date.now());
        if (
            qualifiesForZombieNuclearAchievement(
                this.difficultyName(),
                this.game.teamMode,
            )
        ) {
            for (const player of protectedHumans) {
                if (!player.accountAuthenticated || player.serverBot) continue;
                try {
                    const achievement = stashManager.grantAchievement(
                        player.stashName,
                        AchievementIds.ZombieNuclearHard,
                    );
                    if (achievement.awarded) {
                        const unlocked = new net.AchievementUnlockedMsg();
                        unlocked.achievementId = AchievementIds.ZombieNuclearHard;
                        player.sendMsg(net.MsgType.AchievementUnlocked, unlocked, 128);
                        this.game.logger.log(
                            `[achievement] ${player.stashName} unlocked zombie_nuclear_hard`,
                        );
                    }
                } catch (error) {
                    this.game.logger.warn(
                        `[achievement] failed to award zombie_nuclear_hard to ${player.stashName}: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                }
            }
        }
        this.game.logger.log(
            `[zombie-mission] nuclear detonation: ${this.nukeKills} zombies and ${destroyedGroundObjects} ground objects destroyed, ${protectedHumans.length} humans sheltered, ${outsideHumans.length} humans exposed`,
        );
        this.game.checkGameOver();
    }

    private createMissionPoints(): {
        device: { x: number; y: number };
        elements: Array<{ x: number; y: number }>;
    } {
        const rand = util.seededRand((this.game.map.seed ^ 0x5a17c9e3) >>> 0);
        const minDimension = Math.min(this.game.map.width, this.game.map.height);
        const baseAngle = rand(0, Math.PI * 2);
        let device: { x: number; y: number } | null = null;
        // Select a central safe point whose outdoor component is large enough
        // to host the three distributed elements. This avoids rare seeds where
        // the nominal center happens to be an enclosed compound.
        for (let attempt = 0; attempt < 12; attempt++) {
            const angle = baseAngle + (attempt * Math.PI * 2) / 12;
            const radius = attempt === 0 ? rand(8, 22) : rand(18, 90);
            const target = v2.create(
                this.game.map.center.x + Math.cos(angle) * radius,
                this.game.map.center.y + Math.sin(angle) * radius,
            );
            const candidate = this.findMissionWalkableNear(target, 90, angle);
            if (!candidate) continue;
            this.missionDevicePos = v2.copy(candidate);
            this.buildMissionReachability(candidate);
            let farthest = 0;
            for (const key of this.missionReachableCells) {
                const [x, y] = key.split(",").map(Number);
                farthest = Math.max(
                    farthest,
                    Math.hypot(x, y) * this.missionReachabilityStep,
                );
            }
            if (
                this.missionReachableCells.size >= 180
                && farthest >= minDimension * 0.22
            ) {
                device = candidate;
                break;
            }
        }
        device ??= this.findMissionWalkableNear(this.game.map.center, 180, baseAngle)
            ?? v2.copy(this.game.map.center);

        // Flood fill once from the final device. Candidate elements are
        // accepted only if they belong to this same walking component.
        this.missionDevicePos = v2.copy(device);
        this.buildMissionReachability(device);
        const elements: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < ZOMBIE_MISSION_ELEMENT_COUNT; i++) {
            let selected: { x: number; y: number } | null = null;
            for (let attempt = 0; attempt < 18; attempt++) {
                const angle = baseAngle
                    + (i * Math.PI * 2) / ZOMBIE_MISSION_ELEMENT_COUNT
                    + rand(-0.42, 0.42);
                const radius = rand(minDimension * 0.22, minDimension * 0.4);
                const target = v2.create(
                    this.game.map.center.x + Math.cos(angle) * radius,
                    this.game.map.center.y + Math.sin(angle) * radius,
                );
                const point = this.findMissionWalkableNear(target, 84, angle);
                if (!point || v2.distance(point, device) < 36) continue;
                if (!this.isMissionPointReachable(point)) continue;
                if (elements.some((other) => v2.distance(point, other) < 48)) continue;
                selected = point;
                break;
            }
            if (!selected) {
                // Deterministic fallback: choose a distant already-proven
                // reachable flood-fill cell in this element's angular sector.
                const wantedAngle = baseAngle + (i * Math.PI * 2) / 3;
                let bestScore = Number.POSITIVE_INFINITY;
                for (const key of this.missionReachableCells) {
                    const [cellX, cellY] = key.split(",").map(Number);
                    const point = v2.create(
                        device.x + cellX * this.missionReachabilityStep,
                        device.y + cellY * this.missionReachabilityStep,
                    );
                    const distance = v2.distance(device, point);
                    if (distance < minDimension * 0.18) continue;
                    if (elements.some((other) => v2.distance(point, other) < 48)) continue;
                    const angle = Math.atan2(point.y - device.y, point.x - device.x);
                    const delta = Math.atan2(
                        Math.sin(angle - wantedAngle),
                        Math.cos(angle - wantedAngle),
                    );
                    const score = Math.abs(delta) * 1000 - distance;
                    if (score < bestScore) {
                        bestScore = score;
                        selected = point;
                    }
                }
            }
            // The component check above guarantees this fallback has candidates
            // on normal maps. Keep a visibly separated reachable fallback for a
            // severely damaged/custom map instead of stacking at the device.
            if (!selected) {
                const fallbackAngle = baseAngle + (i * Math.PI * 2) / 3;
                selected = this.findMissionWalkableNear(
                    v2.create(
                        device.x + Math.cos(fallbackAngle) * 48,
                        device.y + Math.sin(fallbackAngle) * 48,
                    ),
                    120,
                    fallbackAngle,
                );
            }
            selected ??= v2.create(
                device.x + Math.cos(baseAngle + (i * Math.PI * 2) / 3) * 8,
                device.y + Math.sin(baseAngle + (i * Math.PI * 2) / 3) * 8,
            );
            elements.push(v2.copy(selected));
        }
        return { device: v2.copy(device), elements };
    }

    private buildMissionReachability(device: { x: number; y: number }): void {
        this.missionReachableCells.clear();
        const step = this.missionReachabilityStep;
        const queue: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
        this.missionReachableCells.add("0,0");
        for (let cursor = 0; cursor < queue.length && cursor < 50_000; cursor++) {
            const current = queue[cursor];
            for (
                const [dx, dy] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ] as const
            ) {
                const x = current.x + dx;
                const y = current.y + dy;
                const key = `${x},${y}`;
                if (this.missionReachableCells.has(key)) continue;
                const pos = v2.create(device.x + x * step, device.y + y * step);
                if (!this.game.map.isPlayerWalkableAt(pos, 0, 0.72)) continue;
                const mid = v2.create(
                    device.x + (current.x + dx * 0.5) * step,
                    device.y + (current.y + dy * 0.5) * step,
                );
                if (!this.game.map.isPlayerWalkableAt(mid, 0, 0.72)) continue;
                this.missionReachableCells.add(key);
                queue.push({ x, y });
            }
        }
    }

    private findMissionWalkableNear(
        center: { x: number; y: number },
        maxRadius: number,
        angleOffset = 0,
    ): { x: number; y: number } | null {
        for (let radius = 0; radius <= maxRadius; radius += 3) {
            const samples = radius === 0 ? 1 : Math.max(10, Math.ceil(radius * 1.8));
            for (let sample = 0; sample < samples; sample++) {
                const angle = angleOffset + (sample / samples) * Math.PI * 2;
                const pos = v2.create(
                    Math.max(
                        3,
                        Math.min(this.game.map.width - 3, center.x + Math.cos(angle) * radius),
                    ),
                    Math.max(
                        3,
                        Math.min(this.game.map.height - 3, center.y + Math.sin(angle) * radius),
                    ),
                );
                if (this.game.map.isPlayerWalkableAt(pos, 0, 0.8)) return pos;
            }
        }
        return null;
    }

    /** Spawn one zombie (random spot, random melee, green outfit; chance = self-destruct). */
    private spawnZombie(selfDestructChance: number): void {
        try {
            const seq = ++this.spawnSeq;
            const pos = this.pickZombieSpawn();
            const zombie = this.game.playerBarn.addTestPlayer({
                name: `Zombie${seq}`,
                ...(pos ? { pos } : {}),
            });
            zombie.serverBot = true;
            zombie.layer = 0;
            zombie.aimLayer = 0;

            // Green outfit + full adrenaline (keeps up with players).
            zombie.outfit = "outfitVerde";
            zombie.boost = 100;

            // 统一装备小刀。
            const meleeType = ZOMBIE_MELEE;
            zombie.weaponManager.setWeapon(GameConfig.WeaponSlot.Melee, meleeType, 0);
            zombie.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);

            // 自爆变种概率由波次/难度参数传入。
            // 简单难度是严格“无自爆”规则：即使未来某个波次/调用方
            // 误传了非零概率，也在最终生成点强制归零，避免规则回归。
            const chance = this.difficultyName() === "simple"
                ? 0
                : Math.min(
                    1,
                    Math.max(0, Number(selfDestructChance) || 0),
                );
            if (Math.random() < chance) {
                zombie.zombieSelfDestruct = true;
                zombie.addPerk("final_bugle", false);
                zombie.addPerk("martyrdom", false);
            }

            this.zombies.push(zombie);
        } catch (error) {
            this.game.logger.warn(
                `[zombie] spawn failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /** Random spawn point, away from living players. */
    private pickZombieSpawn(): { x: number; y: number } | null {
        const humans = this.game.playerBarn.players.filter(
            (p) => !p.serverBot && !p.spectatorOnly && !p.dead && !p.disconnected,
        );
        for (let attempt = 0; attempt < 8; attempt++) {
            const point = this.game.map.findSpawnableNear(
                "boss_totem",
                v2.create(
                    Math.random() * this.game.map.width,
                    Math.random() * this.game.map.height,
                ),
                80,
                0,
            );
            if (!point) continue;
            let tooClose = false;
            for (const human of humans) {
                if (v2.distance(point, human.pos) < 26) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) return { x: point.x, y: point.y };
        }
        return this.game.map.findSpawnableNear(
            "boss_totem",
            v2.create(this.game.map.width / 2, this.game.map.height / 2),
            100,
            0,
        );
    }

    /** Clear references when the match ends. */
    clear(): void {
        for (const player of this.game.playerBarn.players) {
            if (player.zombieMissionCarriedElement >= 0) {
                player.zombieMissionCarriedElement = -1;
                player.recalculateSpeed();
            }
        }
        this.zombies.length = 0;
        this.cachedTargets.clear();
    }
}
