import {
    type ExtractionBattleOrder,
    ExtractionBattlePhase,
    ExtractionBattleRole,
} from "../../../shared/net/extractionHumanHintMsg.ts";
import type { Vec2 } from "../../../shared/utils/v2.ts";
import { FullMapPathPlanner } from "./fullMapPathPlanner.ts";

export interface ExtractionCommanderBot {
    id: number;
    pos: Vec2;
    layer: number;
    health: number;
    hasGun: boolean;
}

export interface ExtractionCommanderHuman {
    id: number;
    pos: Vec2;
    layer: number;
}

export interface ExtractionCommanderEntry {
    kind: "stair" | "door" | "radial";
    id: number;
    pos: Vec2;
    downDir?: Vec2;
    structureId: number;
    stairIndex: number;
    layer: number;
}

export type ExtractionCommanderCollision =
    | { type: 0; pos: Vec2; rad: number }
    | { type: 1; min: Vec2; max: Vec2 };

export interface ExtractionCommanderObstacle {
    id: number;
    type: string;
    pos: Vec2;
    layer: number;
    dead: boolean;
    destructible: boolean;
    openableDoor?: boolean;
    collision: ExtractionCommanderCollision;
}

export interface ExtractionCommanderFrame {
    timestamp: number;
    bots: readonly ExtractionCommanderBot[];
    humans: readonly ExtractionCommanderHuman[];
    assaultBotIds: ReadonlySet<number>;
    entries: readonly ExtractionCommanderEntry[];
    obstacles: readonly ExtractionCommanderObstacle[];
    mapWidth: number;
    mapHeight: number;
}

interface WarzoneState {
    phase: ExtractionBattlePhase;
    phaseStartedAt: number;
    cycle: number;
    targetPos: Vec2;
    targetLayer: number;
}

interface EntryGeometry {
    entry: ExtractionCommanderEntry;
    stage: Vec2;
    inside: Vec2;
    stageLayer: number;
    insideLayer: number;
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const length = Math.hypot(value.x, value.y);
    return length > 0.0001
        ? { x: value.x / length, y: value.y / length }
        : fallback;
};
const perpendicular = (value: Vec2): Vec2 => ({ x: -value.y, y: value.x });
const baseLayer = (layer: number): number => Number(layer) & 0x1;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const segmentPointDistance = (from: Vec2, to: Vec2, point: Vec2): number => {
    const segment = sub(to, from);
    const lengthSq = segment.x * segment.x + segment.y * segment.y;
    if (lengthSq <= 0.0001) return distance(from, point);
    const relative = sub(point, from);
    const along = clamp(
        (relative.x * segment.x + relative.y * segment.y) / lengthSq,
        0,
        1,
    );
    return distance(add(from, mul(segment, along)), point);
};

const collisionRadius = (collision: ExtractionCommanderCollision): number =>
    collision.type === 0
        ? collision.rad
        : Math.hypot(
            collision.max.x - collision.min.x,
            collision.max.y - collision.min.y,
        ) * 0.5;

const isSafeClearable = (obstacle: ExtractionCommanderObstacle): boolean =>
    obstacle.destructible
    && !obstacle.dead
    && /ammo_crate|crate|box|case|locker|barrel|sandbag|wood|plank/i.test(obstacle.type)
    && !/airdrop|explosive|propane|fuel|button|door/i.test(obstacle.type);

const phaseName = (phase: ExtractionBattlePhase): string => ExtractionBattlePhase[phase] ?? String(phase);

/**
 * Server-authoritative match commander for secret extraction. Every worker
 * receives its own role/entry/phase, so independently running bot processes
 * execute one shared plan instead of converging on the same closest doorway.
 */
export class ExtractionBattleCommander {
    private readonly warzones = new Map<number, WarzoneState>();
    private readonly previousHealth = new Map<number, number>();
    private readonly underFireUntil = new Map<number, number>();
    private readonly botTargets = new Map<number, number>();
    private lastSummary = "";

    constructor(private readonly debug = false) {}

    update(frame: ExtractionCommanderFrame): ExtractionBattleOrder[] {
        const humansById = new Map(frame.humans.map((human) => [human.id, human]));
        for (const targetId of this.warzones.keys()) {
            if (!humansById.has(targetId)) this.warzones.delete(targetId);
        }
        for (const [botId, targetId] of this.botTargets) {
            if (!humansById.has(targetId) || !frame.bots.some((bot) => bot.id === botId)) {
                this.botTargets.delete(botId);
            }
        }
        this.observeDamage(frame.bots, frame.timestamp);
        if (frame.bots.length === 0 || frame.humans.length === 0) return [];

        const groups = this.allocateWarzones(frame.bots, frame.humans);
        const orders: ExtractionBattleOrder[] = [];
        const claimedClearObstacles = new Set<number>();
        const topologyPlanner = this.createTopologyPlanner(frame);
        for (const human of frame.humans) {
            const bots = groups.get(human.id) ?? [];
            if (bots.length === 0) continue;
            orders.push(...this.ordersForWarzone(
                frame,
                human,
                bots,
                claimedClearObstacles,
                topologyPlanner,
            ));
        }
        if (this.debug) this.debugSummary(orders);
        return orders;
    }

    private observeDamage(bots: readonly ExtractionCommanderBot[], timestamp: number): void {
        const alive = new Set<number>();
        for (const bot of bots) {
            alive.add(bot.id);
            const previous = this.previousHealth.get(bot.id);
            if (previous !== undefined && bot.health < previous - 0.1) {
                this.underFireUntil.set(bot.id, timestamp + 3_500);
            }
            this.previousHealth.set(bot.id, bot.health);
        }
        for (const botId of this.previousHealth.keys()) {
            if (!alive.has(botId)) {
                this.previousHealth.delete(botId);
                this.underFireUntil.delete(botId);
            }
        }
    }

    private allocateWarzones(
        bots: readonly ExtractionCommanderBot[],
        humans: readonly ExtractionCommanderHuman[],
    ): Map<number, ExtractionCommanderBot[]> {
        const groups = new Map<number, ExtractionCommanderBot[]>(
            humans.map((human) => [human.id, []]),
        );
        const sortedBots = [...bots].sort((a, b) => a.id - b.id);
        for (const bot of sortedBots) {
            const retained = this.botTargets.get(bot.id);
            const retainedHuman = humans.find((human) => human.id === retained);
            let target = retainedHuman;
            if (!target) {
                target = [...humans].sort((a, b) => {
                    const aLoad = groups.get(a.id)?.length ?? 0;
                    const bLoad = groups.get(b.id)?.length ?? 0;
                    return distance(bot.pos, a.pos) + aLoad * 48
                        - distance(bot.pos, b.pos) - bLoad * 48;
                })[0];
                this.botTargets.set(bot.id, target.id);
            }
            groups.get(target.id)!.push(bot);
        }
        return groups;
    }

    private ordersForWarzone(
        frame: ExtractionCommanderFrame,
        human: ExtractionCommanderHuman,
        bots: readonly ExtractionCommanderBot[],
        claimedClearObstacles: Set<number>,
        topologyPlanner: FullMapPathPlanner,
    ): ExtractionBattleOrder[] {
        let state = this.warzones.get(human.id);
        if (!state) {
            state = {
                phase: ExtractionBattlePhase.Assemble,
                phaseStartedAt: frame.timestamp,
                cycle: 0,
                targetPos: { ...human.pos },
                targetLayer: human.layer,
            };
            this.warzones.set(human.id, state);
        }
        const targetMoved = distance(state.targetPos, human.pos);
        const targetChangedFloor = baseLayer(state.targetLayer) !== baseLayer(human.layer);
        if (targetChangedFloor || targetMoved > 24) {
            state.phase = ExtractionBattlePhase.Assemble;
            state.phaseStartedAt = frame.timestamp;
            state.cycle++;
        }
        state.targetPos = { ...human.pos };
        state.targetLayer = human.layer;

        const entries = this.entryGeometries(frame, human, topologyPlanner);
        const roles = this.assignRoles(bots, frame.assaultBotIds);
        const assignedEntries = this.assignEntries(bots, roles, entries, human);
        this.advancePhase(frame, state, human, bots, roles, assignedEntries);

        const orders: ExtractionBattleOrder[] = [];
        for (let index = 0; index < bots.length; index++) {
            const bot = bots[index];
            const role = roles.get(bot.id) ?? ExtractionBattleRole.Reserve;
            let geometry = assignedEntries.get(bot.id) ?? entries[index % entries.length];
            const underFireResponse = (this.underFireUntil.get(bot.id) ?? 0) > frame.timestamp;
            let clearObstacleId = 0;
            if (role === ExtractionBattleRole.Clearer) {
                let blocker = this.firstCorridorBlocker(
                    geometry,
                    human,
                    frame.obstacles,
                    claimedClearObstacles,
                );
                if (!blocker) {
                    for (const candidate of entries) {
                        blocker = this.firstCorridorBlocker(
                            candidate,
                            human,
                            frame.obstacles,
                            claimedClearObstacles,
                        );
                        if (!blocker) continue;
                        geometry = candidate;
                        break;
                    }
                }
                if (blocker) {
                    clearObstacleId = blocker.id;
                    claimedClearObstacles.add(blocker.id);
                }
            }
            const command = this.commandPoint(
                frame,
                state,
                human,
                bot,
                role,
                geometry,
                index,
                clearObstacleId,
            );
            orders.push({
                botId: bot.id,
                targetHumanId: human.id,
                role,
                phase: state.phase,
                active: true,
                blindFire: command.blindFire,
                underFireResponse,
                targetLayer: human.layer,
                objectiveLayer: command.layer,
                objectiveX: command.point.x,
                objectiveY: command.point.y,
                fireX: command.firePoint.x,
                fireY: command.firePoint.y,
                entryStructureId: geometry.entry.structureId,
                entryStairIndex: geometry.entry.stairIndex,
                clearObstacleId,
                cycle: state.cycle,
            });
        }
        return orders;
    }

    private entryGeometries(
        frame: ExtractionCommanderFrame,
        human: ExtractionCommanderHuman,
        topologyPlanner: FullMapPathPlanner,
    ): EntryGeometry[] {
        const targetBase = baseLayer(human.layer);
        let candidates = frame.entries.filter((entry) => {
            if (targetBase === 1) return entry.kind === "stair";
            return entry.kind === "door"
                && baseLayer(entry.layer) === targetBase
                && distance(entry.pos, human.pos) <= 62;
        });
        candidates = [...candidates]
            .sort((a, b) => distance(a.pos, human.pos) - distance(b.pos, human.pos))
            .filter(
                (entry, index, all) => all.findIndex((candidate) => distance(candidate.pos, entry.pos) < 5.5) === index,
            )
            .slice(0, 18);
        if (candidates.length === 0) {
            const radii = [18, 22, 18, 22];
            candidates = radii.map((radius, index) => {
                const angle = index * Math.PI * 0.5 + human.id * 0.37;
                return {
                    kind: "radial" as const,
                    id: 60_000 + index,
                    pos: this.constrain(
                        add(human.pos, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }),
                        frame,
                    ),
                    structureId: 0,
                    stairIndex: 255,
                    layer: human.layer,
                };
            });
        }
        const preliminary = candidates.map((entry) => this.entryGeometry(entry, human));
        if (preliminary.length <= 1) return preliminary;

        // "Underground" is one network layer but not one connected room. Use
        // the complete static map to reject stairs leading into another sealed
        // bunker. Safe command-clearable boxes are omitted from this topology
        // probe because the assigned clearer can deliberately remove them.
        const reachable = topologyPlanner.reachableTargets(
            human.pos,
            preliminary.map((geometry) => geometry.inside),
            targetBase,
            90_000,
        );
        const connected = preliminary.filter((_, index) => reachable[index]);
        return (connected.length > 0 ? connected : preliminary).slice(0, 5);
    }

    private createTopologyPlanner(frame: ExtractionCommanderFrame): FullMapPathPlanner {
        return new FullMapPathPlanner({
            width: frame.mapWidth,
            height: frame.mapHeight,
            cellSize: 2.5,
            clearance: 1.58,
            obstacles: frame.obstacles
                .filter((obstacle) => !isSafeClearable(obstacle))
                .map((obstacle) => ({
                    id: obstacle.id,
                    layer: obstacle.layer,
                    collision: obstacle.collision,
                    openableDoor: obstacle.openableDoor,
                })),
        });
    }

    private entryGeometry(
        entry: ExtractionCommanderEntry,
        human: ExtractionCommanderHuman,
    ): EntryGeometry {
        if (entry.kind === "stair") {
            const down = normalize(entry.downDir ?? { x: 0, y: 1 });
            const descending = baseLayer(human.layer) === 1;
            const travel = descending ? down : mul(down, -1);
            return {
                entry,
                stage: add(entry.pos, mul(travel, -7.2)),
                inside: add(entry.pos, mul(travel, 7.2)),
                stageLayer: descending ? 0 : 1,
                insideLayer: baseLayer(human.layer),
            };
        }
        const towardTarget = normalize(sub(human.pos, entry.pos), { x: 1, y: 0 });
        return {
            entry,
            stage: add(entry.pos, mul(towardTarget, -5.2)),
            inside: add(entry.pos, mul(towardTarget, 5.2)),
            stageLayer: baseLayer(human.layer),
            insideLayer: baseLayer(human.layer),
        };
    }

    private assignRoles(
        bots: readonly ExtractionCommanderBot[],
        assaultBotIds: ReadonlySet<number>,
    ): Map<number, ExtractionBattleRole> {
        const roles = new Map<number, ExtractionBattleRole>();
        // The configured hunter list marks the vanguard, not the only bots
        // allowed to participate. Secret extraction AI is one faction, so
        // every living member receives a tactical role in the same plan.
        const active = [...bots].sort((a, b) =>
            Number(assaultBotIds.has(b.id)) - Number(assaultBotIds.has(a.id))
            || Number(b.hasGun) - Number(a.hasGun)
            || b.health - a.health
            || a.id - b.id
        );
        for (const bot of bots) roles.set(bot.id, ExtractionBattleRole.Reserve);
        const pattern = [
            ExtractionBattleRole.Breacher,
            ExtractionBattleRole.Suppressor,
            ExtractionBattleRole.Flanker,
            ExtractionBattleRole.Clearer,
            ExtractionBattleRole.RearCutoff,
            ExtractionBattleRole.Suppressor,
            ExtractionBattleRole.Breacher,
            ExtractionBattleRole.Flanker,
            ExtractionBattleRole.Reserve,
        ];
        for (let index = 0; index < active.length; index++) {
            const bot = active[index];
            let role = pattern[index % pattern.length];
            if (!bot.hasGun && role === ExtractionBattleRole.Suppressor) {
                role = ExtractionBattleRole.Clearer;
            }
            if (bot.health < 34 && role === ExtractionBattleRole.Breacher) {
                role = ExtractionBattleRole.Reserve;
            }
            roles.set(bot.id, role);
        }
        return roles;
    }

    private assignEntries(
        bots: readonly ExtractionCommanderBot[],
        roles: ReadonlyMap<number, ExtractionBattleRole>,
        entries: readonly EntryGeometry[],
        human: ExtractionCommanderHuman,
    ): Map<number, EntryGeometry> {
        const result = new Map<number, EntryGeometry>();
        const loads = new Map<number, number>();
        const sorted = [...bots].sort((a, b) => a.id - b.id);
        for (const bot of sorted) {
            const role = roles.get(bot.id) ?? ExtractionBattleRole.Reserve;
            const preferredIndex = role === ExtractionBattleRole.Flanker
                ? 1
                : role === ExtractionBattleRole.RearCutoff
                ? Math.max(0, entries.length - 1)
                : role === ExtractionBattleRole.Reserve
                ? (bot.id + 2) % entries.length
                : 0;
            const ranked = entries.map((entry, index) => ({
                entry,
                score: distance(bot.pos, entry.stage)
                    + distance(entry.inside, human.pos) * 0.18
                    + (loads.get(entry.entry.id) ?? 0) * 16
                    + (index === preferredIndex ? -34 : 0),
            })).sort((a, b) => a.score - b.score);
            const selected = ranked[0].entry;
            result.set(bot.id, selected);
            loads.set(selected.entry.id, (loads.get(selected.entry.id) ?? 0) + 1);
        }
        return result;
    }

    private advancePhase(
        frame: ExtractionCommanderFrame,
        state: WarzoneState,
        human: ExtractionCommanderHuman,
        bots: readonly ExtractionCommanderBot[],
        roles: ReadonlyMap<number, ExtractionBattleRole>,
        entries: ReadonlyMap<number, EntryGeometry>,
    ): void {
        const elapsed = frame.timestamp - state.phaseStartedAt;
        const frontline = bots.filter(
            (bot) => (roles.get(bot.id) ?? ExtractionBattleRole.Reserve) !== ExtractionBattleRole.Reserve,
        );
        const assembled = frontline.filter((bot) => {
            const entry = entries.get(bot.id);
            return entry
                && baseLayer(bot.layer) === entry.stageLayer
                && distance(bot.pos, entry.stage) <= 11;
        }).length;
        const targetFloor = frontline.filter((bot) => {
            const entry = entries.get(bot.id);
            if (!entry || baseLayer(bot.layer) !== baseLayer(human.layer)) return false;
            // Cross-floor assaults prove progress by actually changing floor.
            // Same-floor buildings instead require reaching the far side of a
            // door; otherwise every surface bot would instantly complete the
            // breach phase while still standing outside.
            return entry.stageLayer !== entry.insideLayer
                || distance(bot.pos, entry.inside) <= 13
                || distance(bot.pos, human.pos) <= 34;
        }).length;
        const readiness = assembled / Math.max(1, frontline.length);
        const breachProgress = targetFloor / Math.max(1, frontline.length);
        // Damage telemetry is match-wide: one faction member being farmed is
        // enough for central command to abandon passive staging everywhere.
        const groupUnderFire = frame.bots.some(
            (bot) => (this.underFireUntil.get(bot.id) ?? 0) > frame.timestamp,
        );
        let next = state.phase;
        if (state.phase === ExtractionBattlePhase.Assemble) {
            if ((readiness >= 0.58 && elapsed >= 900) || elapsed >= 6_500) {
                next = ExtractionBattlePhase.Suppress;
            }
            if (groupUnderFire && elapsed >= 1_200) next = ExtractionBattlePhase.Breach;
        } else if (state.phase === ExtractionBattlePhase.Suppress) {
            if (elapsed >= 1_800 || (groupUnderFire && elapsed >= 450)) {
                next = ExtractionBattlePhase.Breach;
            }
        } else if (state.phase === ExtractionBattlePhase.Breach) {
            if (breachProgress >= 0.48 || elapsed >= 5_800) next = ExtractionBattlePhase.Sweep;
        } else if (state.phase === ExtractionBattlePhase.Sweep && elapsed >= 8_500) {
            next = ExtractionBattlePhase.Assemble;
            state.cycle++;
        }
        if (next !== state.phase) {
            state.phase = next;
            state.phaseStartedAt = frame.timestamp;
        }
    }

    private commandPoint(
        frame: ExtractionCommanderFrame,
        state: WarzoneState,
        human: ExtractionCommanderHuman,
        bot: ExtractionCommanderBot,
        role: ExtractionBattleRole,
        geometry: EntryGeometry,
        index: number,
        clearObstacleId: number,
    ): { point: Vec2; layer: number; firePoint: Vec2; blindFire: boolean } {
        const stageAxis = perpendicular(normalize(sub(geometry.inside, geometry.stage)));
        const spread = ((index % 5) - 2) * 2.4;
        const staged = this.constrain(add(geometry.stage, mul(stageAxis, spread)), frame);
        const inside = this.constrain(add(geometry.inside, mul(stageAxis, spread * 0.55)), frame);
        const surroundAngle = (index / Math.max(1, frame.bots.length)) * Math.PI * 2
            + state.cycle * 0.71;
        const surroundRadius = role === ExtractionBattleRole.Suppressor
            ? 18
            : role === ExtractionBattleRole.RearCutoff
            ? 14
            : role === ExtractionBattleRole.Reserve
            ? 23
            : 8.5;
        const surround = this.constrain(
            add(human.pos, {
                x: Math.cos(surroundAngle) * surroundRadius,
                y: Math.sin(surroundAngle) * surroundRadius,
            }),
            frame,
        );
        let point = staged;
        let layer = geometry.stageLayer;
        let blindFire = false;
        if (clearObstacleId) {
            const obstacle = frame.obstacles.find((candidate) => candidate.id === clearObstacleId);
            if (obstacle) {
                point = { ...obstacle.pos };
                layer = baseLayer(obstacle.layer);
            }
        } else if (state.phase === ExtractionBattlePhase.Suppress) {
            if (role === ExtractionBattleRole.Suppressor || role === ExtractionBattleRole.Clearer) {
                point = inside;
                layer = geometry.insideLayer;
                blindFire = baseLayer(bot.layer) === baseLayer(human.layer) && bot.hasGun;
            }
        } else if (state.phase === ExtractionBattlePhase.Breach) {
            if (role === ExtractionBattleRole.Suppressor) {
                point = inside;
                layer = geometry.insideLayer;
                blindFire = baseLayer(bot.layer) === baseLayer(human.layer) && bot.hasGun;
            } else if (role !== ExtractionBattleRole.Reserve) {
                point = role === ExtractionBattleRole.RearCutoff ? inside : surround;
                layer = baseLayer(human.layer);
            }
        } else if (state.phase === ExtractionBattlePhase.Sweep) {
            point = surround;
            layer = baseLayer(human.layer);
            blindFire = role === ExtractionBattleRole.Suppressor
                && baseLayer(bot.layer) === baseLayer(human.layer)
                && bot.hasGun;
        }
        const corridorDirection = normalize(sub(human.pos, inside));
        const corridorFirePoint = add(
            inside,
            mul(corridorDirection, Math.min(11, distance(inside, human.pos))),
        );
        return {
            point,
            layer,
            // During the synchronized suppression window, fire through the
            // known entrance into the first clear stretch of corridor. A
            // curved tunnel may hide the live player behind a later wall; aim
            // at the corridor probe so local line safety allows genuine blind
            // suppression instead of refusing every shot at the hidden body.
            firePoint: blindFire ? corridorFirePoint : { ...human.pos },
            blindFire,
        };
    }

    private firstCorridorBlocker(
        geometry: EntryGeometry,
        human: ExtractionCommanderHuman,
        obstacles: readonly ExtractionCommanderObstacle[],
        excluded: ReadonlySet<number>,
    ): ExtractionCommanderObstacle | null {
        const legs = [
            { from: geometry.stage, to: geometry.inside, layer: geometry.stageLayer },
            { from: geometry.inside, to: human.pos, layer: geometry.insideLayer },
        ];
        let best: ExtractionCommanderObstacle | null = null;
        let bestProgress = Infinity;
        for (const obstacle of obstacles) {
            if (
                excluded.has(obstacle.id)
                || !isSafeClearable(obstacle)
            ) continue;
            for (const leg of legs) {
                if (baseLayer(obstacle.layer) !== baseLayer(leg.layer)) continue;
                const clearance = collisionRadius(obstacle.collision) + 1.25;
                if (segmentPointDistance(leg.from, leg.to, obstacle.pos) > clearance) continue;
                const progress = distance(leg.from, obstacle.pos);
                if (progress < bestProgress) {
                    bestProgress = progress;
                    best = obstacle;
                }
            }
        }
        return best;
    }

    private constrain(point: Vec2, frame: ExtractionCommanderFrame): Vec2 {
        return {
            x: clamp(point.x, 2, Math.max(2, frame.mapWidth - 2)),
            y: clamp(point.y, 2, Math.max(2, frame.mapHeight - 2)),
        };
    }

    private debugSummary(orders: readonly ExtractionBattleOrder[]): void {
        const summary = [
            ...new Set(orders.map((order) => `h${order.targetHumanId}:${phaseName(order.phase)}:c${order.cycle}`)),
        ].join(" ");
        if (summary === this.lastSummary) return;
        this.lastSummary = summary;
        console.log(`[extraction-command] ${summary}; orders=${orders.length}`);
    }
}
