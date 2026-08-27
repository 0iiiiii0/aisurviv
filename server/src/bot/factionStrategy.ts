import type { Vec2 } from "../../../shared/utils/v2.ts";
import type { MapPhase, MapRuntimeSnapshot } from "./mapStrategy.ts";

export type FactionBotRole = "leader" | "assault" | "support" | "scout";
export type FactionDoctrine =
    | "vanguard"
    | "line"
    | "flank-north"
    | "flank-south"
    | "fire-support"
    | "medic"
    | "reserve"
    | "marksman"
    | "grenadier";
export type FactionStance = "attack" | "hold" | "defend" | "withdraw" | "rescue";
export type FactionObjectiveKind =
    | "bridgehead"
    | "frontline"
    | "flank"
    | "strongpoint"
    | "reserve"
    | "rescue"
    | "safe-zone";

export interface FactionCoordinatorOptions {
    enabled: boolean;
    debug: boolean;
    orderRefreshMs: number;
    reportMemoryMs: number;
    frontWidth: number;
    rescueRange: number;
    objectiveHoldRadius: number;
}

export interface FactionBotSnapshot {
    botId: number;
    playerId: number;
    teamId: number;
    squadId: number;
    squadSlot: number;
    role: FactionBotRole;
    doctrine: FactionDoctrine;
    pos: Vec2;
    dir: Vec2;
    health: number;
    boost: number;
    downed: boolean;
    dead: boolean;
    underFire: boolean;
    state: string;
    enemyTargetId: number;
    enemyDistance: number;
    updatedAt: number;
    specialRole?: string;
    perks?: string[];
}

export interface FactionEnemyReport {
    reporterBotId: number;
    reporterTeamId: number;
    targetId: number;
    pos: Vec2;
    score: number;
    distance: number;
    visible: boolean;
    downed: boolean;
    updatedAt: number;
    perks?: string[];
}

export interface FactionDownedReport {
    playerId: number;
    teamId: number;
    pos: Vec2;
    outsideGas: boolean;
    enemyDistance: number;
    updatedAt: number;
    /** True when the downed teammate is a real player; faction rescue prefers them. */
    human: boolean;
}

export interface FactionAmmoNeedReport {
    key: string;
    requesterBotId: number;
    requesterPlayerId: number;
    teamId: number;
    ammoType: string;
    pos: Vec2;
    human: boolean;
    firstObservedAt: number;
    updatedAt: number;
}

export interface FactionAmmoShareAssignment extends FactionAmmoNeedReport {
    distance: number;
}

export interface FactionMedicalNeedReport {
    key: string;
    requesterBotId: number;
    requesterPlayerId: number;
    teamId: number;
    pos: Vec2;
    health: number;
    human: boolean;
    firstObservedAt: number;
    updatedAt: number;
}

export interface FactionMedicalShareAssignment extends FactionMedicalNeedReport {
    distance: number;
}

export interface FactionOrderRequest {
    botId: number;
    teamId: number;
    pos: Vec2;
    health: number;
    phase: MapPhase;
    gasCenter: Vec2 | null;
    gasRadius: number | null;
    timestamp: number;
}

export interface FactionOrder {
    doctrine: FactionDoctrine;
    stance: FactionStance;
    objectiveKind: FactionObjectiveKind;
    objective: Vec2;
    formationAnchor: Vec2;
    focusTargetId: number;
    rescuePlayerId: number;
    holdRadius: number;
    preferredRangeMultiplier: number;
    aggression: number;
    flankSign: -1 | 0 | 1;
    spacing: number;
    allowLoot: boolean;
    allowCrates: boolean;
    prioritizeRevive: boolean;
    suppress: boolean;
    /** Unified assault: the whole faction converges on one front and one focus target. */
    unifiedPush: boolean;
    reason: string;
    expiresAt: number;
}

interface EnemyAggregate {
    targetId: number;
    pos: Vec2;
    score: number;
    visibleReports: number;
    reporters: number;
    downed: boolean;
    updatedAt: number;
}

interface TacticalPoint {
    pos: Vec2;
    kind: "bridge" | "strongpoint" | "place" | "cover";
    label: string;
    score: number;
}

interface TeamState {
    members: Map<number, FactionBotSnapshot>;
    enemies: Map<number, Map<number, FactionEnemyReport>>;
    downed: Map<number, FactionDownedReport>;
    cachedOrders: Map<number, FactionOrder>;
    targetLocks: Map<number, { targetId: number; expiresAt: number }>;
    ammoNeeds: Map<string, FactionAmmoNeedReport>;
    ammoShareReservations: Map<string, { botId: number; expiresAt: number }>;
    medicalNeeds: Map<string, FactionMedicalNeedReport>;
    medicalShareReservations: Map<string, { botId: number; expiresAt: number }>;
    homeAnchor: Vec2 | null;
    homeSamples: number;
    firstSeenAt: number;
    lastPruneAt: number;
    /** Bot ids flagged injured below 45 HP; cleared only after recovery above 55. */
    injuredHigh: Set<number>;
}

const DEFAULT_OPTIONS: FactionCoordinatorOptions = {
    enabled: true,
    debug: false,
    orderRefreshMs: 650,
    reportMemoryMs: 2400,
    frontWidth: 66,
    rescueRange: 82,
    objectiveHoldRadius: 9,
};

const clone = (value: Vec2): Vec2 => ({ x: value.x, y: value.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const lengthSq = (value: Vec2): number => value.x * value.x + value.y * value.y;
const length = (value: Vec2): number => Math.sqrt(lengthSq(value));
const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : fallback;
};
const perpendicular = (value: Vec2): Vec2 => ({ x: -value.y, y: value.x });
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const average = (points: Vec2[], fallback: Vec2): Vec2 => {
    if (points.length === 0) return clone(fallback);
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
};
const hash01 = (value: number): number => {
    const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
};
const segmentPointDistance = (a: Vec2, b: Vec2, point: Vec2): number => {
    const ab = sub(b, a);
    const denom = lengthSq(ab);
    if (denom < 0.0001) return distance(a, point);
    const t = clamp(dot(sub(point, a), ab) / denom, 0, 1);
    return distance(add(a, mul(ab, t)), point);
};

export class FactionCoordinator {
    readonly options: FactionCoordinatorOptions;
    private snapshot: MapRuntimeSnapshot | null = null;
    private tacticalPoints: TacticalPoint[] = [];
    private readonly teams = new Map<number, TeamState>();
    private readonly botTeams = new Map<number, number>();
    private lastDebugAt = 0;

    constructor(options: Partial<FactionCoordinatorOptions> = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    get enabled(): boolean {
        return this.options.enabled;
    }

    loadMap(snapshot: MapRuntimeSnapshot): void {
        if (!this.enabled) return;
        const sameMap = this.snapshot?.mapName === snapshot.mapName
            && this.snapshot?.seed === snapshot.seed
            && this.snapshot?.width === snapshot.width
            && this.snapshot?.height === snapshot.height;
        if (sameMap) return;

        this.snapshot = {
            ...snapshot,
            places: (snapshot.places ?? []).map((place) => ({
                name: String(place.name ?? ""),
                pos: clone(place.pos),
            })),
            objects: (snapshot.objects ?? []).map((object) => ({
                ...object,
                pos: clone(object.pos),
            })),
            rivers: (snapshot.rivers ?? []).map((river) => ({
                ...river,
                points: (river.points ?? []).map(clone),
            })),
            groundPatches: (snapshot.groundPatches ?? []).map((patch) => ({
                ...patch,
                min: clone(patch.min),
                max: clone(patch.max),
            })),
        };
        this.tacticalPoints = this.buildTacticalPoints(this.snapshot);
        for (const team of this.teams.values()) {
            team.cachedOrders.clear();
            team.homeAnchor = null;
            team.homeSamples = 0;
            team.firstSeenAt = 0;
        }
        if (this.options.debug) {
            console.log(
                `[factionAI] loaded map=${snapshot.mapName} points=${this.tacticalPoints.length} `
                    + `bridges=${this.tacticalPoints.filter((point) => point.kind === "bridge").length}`,
            );
        }
    }

    isFactionMap(mapName: string): boolean {
        const normalized = String(mapName ?? "").toLowerCase();
        return normalized === "faction" || normalized === "50v50" || normalized.includes("faction");
    }

    doctrineFor(botId: number, squadId: number, role: FactionBotRole): FactionDoctrine {
        if (role === "support") return squadId % 3 === 0 ? "medic" : "fire-support";
        if (role === "scout") return squadId % 2 === 0 ? "marksman" : "flank-north";
        if (role === "leader" && squadId % 5 === 0) return "reserve";

        const selector = Math.abs((squadId * 11 + botId * 3) % 12);
        if (selector <= 2) return "vanguard";
        if (selector <= 4) return "line";
        if (selector === 5) return "flank-north";
        if (selector === 6) return "flank-south";
        if (selector === 7) return "grenadier";
        if (selector === 8) return "fire-support";
        if (selector === 9) return "marksman";
        if (selector === 10) return "medic";
        return "reserve";
    }

    updateBot(snapshot: FactionBotSnapshot): void {
        if (!this.enabled || snapshot.teamId <= 0) return;
        const previousTeamId = this.botTeams.get(snapshot.botId);
        if (previousTeamId && previousTeamId !== snapshot.teamId) {
            const previousTeam = this.teams.get(previousTeamId);
            previousTeam?.members.delete(snapshot.botId);
            previousTeam?.cachedOrders.delete(snapshot.botId);
            previousTeam?.targetLocks.delete(snapshot.botId);
        }
        this.botTeams.set(snapshot.botId, snapshot.teamId);
        const team = this.getTeam(snapshot.teamId, snapshot.updatedAt);
        team.members.set(snapshot.botId, {
            ...snapshot,
            pos: clone(snapshot.pos),
            dir: clone(snapshot.dir),
            perks: [...(snapshot.perks ?? [])],
        });
        // Health hysteresis: flagged injured below 45 HP, cleared only after
        // recovering above 55, so a boundary value cannot flip the faction stance.
        if (snapshot.dead || snapshot.downed) {
            team.injuredHigh.delete(snapshot.botId);
        } else if (snapshot.health < 45) {
            team.injuredHigh.add(snapshot.botId);
        } else if (snapshot.health > 55) {
            team.injuredHigh.delete(snapshot.botId);
        }

        if (!snapshot.dead && !snapshot.downed) {
            const age = snapshot.updatedAt - team.firstSeenAt;
            if (age <= 45000 || team.homeSamples < 8) {
                const weight = team.homeSamples <= 0 ? 1 : Math.min(0.18, 1 / (team.homeSamples + 1));
                team.homeAnchor = team.homeAnchor
                    ? lerp(team.homeAnchor, snapshot.pos, weight)
                    : clone(snapshot.pos);
                team.homeSamples += 1;
            }
        }
        this.pruneTeam(team, snapshot.updatedAt);
    }

    getHomeAnchor(teamId: number): Vec2 | null {
        const home = this.teams.get(teamId)?.homeAnchor;
        return home ? clone(home) : null;
    }

    removeBot(botId: number): void {
        const teamId = this.botTeams.get(botId);
        this.botTeams.delete(botId);
        const team = teamId ? this.teams.get(teamId) : undefined;
        if (team) {
            team.members.delete(botId);
            team.cachedOrders.delete(botId);
            team.targetLocks.delete(botId);
            team.ammoNeeds.delete(`bot:${botId}`);
            for (const [key, reservation] of team.ammoShareReservations) {
                if (reservation.botId === botId) team.ammoShareReservations.delete(key);
            }
            for (const reports of team.enemies.values()) reports.delete(botId);
            return;
        }
        // Fallback for bots registered before the reverse index was populated.
        for (const candidate of this.teams.values()) {
            candidate.members.delete(botId);
            candidate.cachedOrders.delete(botId);
            candidate.targetLocks.delete(botId);
            candidate.ammoNeeds.delete(`bot:${botId}`);
            candidate.medicalNeeds.delete(`bot:${botId}`);
            for (const [key, reservation] of candidate.ammoShareReservations) {
                if (reservation.botId === botId) candidate.ammoShareReservations.delete(key);
            }
            for (const [key, reservation] of candidate.medicalShareReservations) {
                if (reservation.botId === botId) candidate.medicalShareReservations.delete(key);
            }
            for (const reports of candidate.enemies.values()) reports.delete(botId);
        }
    }

    reportEnemy(report: FactionEnemyReport): void {
        if (!this.enabled || report.reporterTeamId <= 0 || report.targetId <= 0) return;
        const team = this.getTeam(report.reporterTeamId, report.updatedAt);
        let reports = team.enemies.get(report.targetId);
        if (!reports) {
            reports = new Map<number, FactionEnemyReport>();
            team.enemies.set(report.targetId, reports);
        }
        reports.set(report.reporterBotId, {
            ...report,
            pos: clone(report.pos),
            perks: [...(report.perks ?? [])],
        });
        this.pruneTeam(team, report.updatedAt);
    }

    reportAmmoNeed(report: FactionAmmoNeedReport): void {
        if (!this.enabled || report.teamId <= 0) return;
        const team = this.getTeam(report.teamId, report.updatedAt);
        if (!report.ammoType) {
            team.ammoNeeds.delete(report.key);
            team.ammoShareReservations.delete(report.key);
            return;
        }
        const previous = team.ammoNeeds.get(report.key);
        team.ammoNeeds.set(report.key, {
            ...report,
            pos: clone(report.pos),
            firstObservedAt: previous?.firstObservedAt ?? report.firstObservedAt,
        });
        this.pruneTeam(team, report.updatedAt);
    }

    clearAmmoNeed(teamId: number, key: string): void {
        const team = this.teams.get(teamId);
        if (!team) return;
        team.ammoNeeds.delete(key);
        team.ammoShareReservations.delete(key);
    }

    claimAmmoShare(input: {
        teamId: number;
        donorBotId: number;
        donorPos: Vec2;
        availableAmmoTypes: ReadonlySet<string>;
        timestamp: number;
        allowMultipleHumanDonors: boolean;
        maxDistance?: number;
        excludedKeys?: ReadonlySet<string>;
        humanOnly?: boolean;
    }): FactionAmmoShareAssignment | null {
        if (!this.enabled || input.teamId <= 0) return null;
        const team = this.teams.get(input.teamId);
        if (!team) return null;
        this.pruneTeam(team, input.timestamp);
        const excluded = input.excludedKeys ?? new Set<string>();
        let best: FactionAmmoShareAssignment | null = null;
        let bestScore = -Infinity;
        for (const report of team.ammoNeeds.values()) {
            if (input.humanOnly && !report.human) continue;
            if (excluded.has(report.key) || report.requesterBotId === input.donorBotId) continue;
            if (!input.availableAmmoTypes.has(report.ammoType)) continue;
            const dist = distance(input.donorPos, report.pos);
            if (dist > (input.maxDistance ?? 44)) continue;
            const reservation = team.ammoShareReservations.get(report.key);
            const multipleAllowed = report.human && input.allowMultipleHumanDonors;
            if (reservation && reservation.botId !== input.donorBotId && !multipleAllowed) continue;
            const score = (report.human ? 270 : 190)
                - dist * 2.15
                + (input.timestamp - report.updatedAt < 900 ? 35 : 0);
            if (score <= bestScore) continue;
            bestScore = score;
            best = { ...report, pos: clone(report.pos), distance: dist };
        }
        if (best && !(best.human && input.allowMultipleHumanDonors)) {
            team.ammoShareReservations.set(best.key, {
                botId: input.donorBotId,
                expiresAt: input.timestamp + 1800,
            });
        }
        return best;
    }

    releaseAmmoShare(teamId: number, key: string, donorBotId: number): void {
        const team = this.teams.get(teamId);
        if (!team) return;
        if (team.ammoShareReservations.get(key)?.botId === donorBotId) {
            team.ammoShareReservations.delete(key);
        }
    }

    reportMedicalNeed(report: FactionMedicalNeedReport): void {
        if (!this.enabled || report.teamId <= 0) return;
        const team = this.getTeam(report.teamId, report.updatedAt);
        const previous = team.medicalNeeds.get(report.key);
        team.medicalNeeds.set(report.key, {
            ...report,
            pos: clone(report.pos),
            health: Math.max(0, Math.min(100, Number(report.health) || 0)),
            firstObservedAt: previous?.firstObservedAt ?? report.firstObservedAt,
        });
        this.pruneTeam(team, report.updatedAt);
    }

    clearMedicalNeed(teamId: number, key: string): void {
        const team = this.teams.get(teamId);
        if (!team) return;
        team.medicalNeeds.delete(key);
        team.medicalShareReservations.delete(key);
    }

    claimMedicalShare(input: {
        teamId: number;
        donorBotId: number;
        donorPos: Vec2;
        timestamp: number;
        maxDistance?: number;
        excludedKeys?: ReadonlySet<string>;
        humanOnly?: boolean;
    }): FactionMedicalShareAssignment | null {
        if (!this.enabled || input.teamId <= 0) return null;
        const team = this.teams.get(input.teamId);
        if (!team) return null;
        this.pruneTeam(team, input.timestamp);
        const excluded = input.excludedKeys ?? new Set<string>();
        let best: FactionMedicalShareAssignment | null = null;
        let bestScore = -Infinity;
        for (const report of team.medicalNeeds.values()) {
            if (input.humanOnly && !report.human) continue;
            if (excluded.has(report.key) || report.requesterBotId === input.donorBotId) continue;
            const dist = distance(input.donorPos, report.pos);
            if (dist > (input.maxDistance ?? 44)) continue;
            const reservation = team.medicalShareReservations.get(report.key);
            if (reservation && reservation.botId !== input.donorBotId) continue;
            const urgency = Math.max(0, 100 - report.health) * (report.human ? 2.35 : 1.95);
            const score = (report.human ? 300 : 195)
                + urgency
                - dist * 2.15
                + (input.timestamp - report.updatedAt < 900 ? 35 : 0);
            if (score <= bestScore) continue;
            bestScore = score;
            best = { ...report, pos: clone(report.pos), distance: dist };
        }
        if (best) {
            team.medicalShareReservations.set(best.key, {
                botId: input.donorBotId,
                expiresAt: input.timestamp + 2200,
            });
        }
        return best;
    }

    releaseMedicalShare(teamId: number, key: string, donorBotId: number): void {
        const team = this.teams.get(teamId);
        if (!team) return;
        if (team.medicalShareReservations.get(key)?.botId === donorBotId) {
            team.medicalShareReservations.delete(key);
        }
    }

    reportDowned(reports: FactionDownedReport[], timestamp: number): void {
        if (!this.enabled) return;
        const touchedTeams = new Set<TeamState>();
        for (const report of reports) {
            if (report.teamId <= 0) continue;
            const team = this.getTeam(report.teamId, timestamp);
            touchedTeams.add(team);
            team.downed.set(report.playerId, {
                ...report,
                pos: clone(report.pos),
                updatedAt: timestamp,
            });
        }
        for (const team of touchedTeams) this.pruneTeam(team, timestamp);
    }

    getOrder(request: FactionOrderRequest): FactionOrder | null {
        if (!this.enabled || request.teamId <= 0 || !this.snapshot) return null;
        const team = this.getTeam(request.teamId, request.timestamp);
        this.pruneTeam(team, request.timestamp);
        const member = team.members.get(request.botId);
        if (!member) return null;
        const cached = team.cachedOrders.get(request.botId);
        if (cached && cached.expiresAt > request.timestamp) return cached;

        const order = this.computeOrder(team, member, request);
        team.cachedOrders.set(request.botId, order);
        this.maybeDebug(team, request.teamId, order, request.timestamp);
        return order;
    }

    getFocusTargetId(
        teamId: number,
        botId: number,
        squadId: number,
        pos: Vec2,
        timestamp: number,
    ): number {
        if (!this.enabled || teamId <= 0) return 0;
        const team = this.teams.get(teamId);
        if (!team) return 0;
        this.pruneTeam(team, timestamp);

        const locked = team.targetLocks.get(botId);
        if (locked && locked.expiresAt > timestamp && team.enemies.has(locked.targetId)) {
            return locked.targetId;
        }

        const aggregates = this.enemyAggregates(team, timestamp);
        let bestTargetId = 0;
        let bestScore = -Infinity;
        const platoonBucket = Math.abs(squadId % 5);
        for (const enemy of aggregates) {
            const dist = distance(pos, enemy.pos);
            if (dist > 130) continue;
            const targetBucket = Math.abs(enemy.targetId % 5);
            const bucketBonus = targetBucket === platoonBucket ? 26 : 0;
            const overFocusPenalty = Math.max(0, enemy.reporters - 7) * 5;
            const score = enemy.score
                + enemy.visibleReports * 11
                + bucketBonus
                - dist * 0.58
                - overFocusPenalty
                - (enemy.downed ? 34 : 0);
            if (score > bestScore) {
                bestScore = score;
                bestTargetId = enemy.targetId;
            }
        }

        if (bestTargetId) {
            team.targetLocks.set(botId, {
                targetId: bestTargetId,
                expiresAt: timestamp + 900 + hash01(botId * 19 + bestTargetId) * 700,
            });
        }
        return bestTargetId;
    }

    lootScoreModifier(
        doctrine: FactionDoctrine,
        itemType: string,
        definitionType: string,
        health: number,
        inventoryCount: number,
    ): number {
        const item = itemType.toLowerCase();
        const type = definitionType.toLowerCase();
        let bonus = 0;
        if (doctrine === "medic") {
            if (type === "heal" || type === "boost") bonus += 48;
            if (type === "ammo") bonus += 10;
        }
        if (doctrine === "marksman") {
            if (type === "scope") bonus += 44;
            if (type === "gun" && /mosin|sv98|scout|mk12|m39|vss|sniper|dmr/.test(item)) bonus += 46;
            if (type === "gun" && /shotgun|smg|mp5|mac|vector/.test(item)) bonus -= 16;
        }
        if (doctrine === "grenadier") {
            if (type === "throwable") bonus += 48;
            if (type === "backpack") bonus += 18;
        }
        if (doctrine === "vanguard") {
            if (type === "helmet" || type === "chest") bonus += 34;
            if (type === "gun" && /shotgun|smg|ak47|hk416|famas|qbb|dp28/.test(item)) bonus += 24;
        }
        if (doctrine === "fire-support") {
            if (type === "ammo") bonus += Math.max(10, 34 - inventoryCount * 0.05);
            if (type === "gun" && /m249|pkp|dp28|qbb|lmg/.test(item)) bonus += 40;
        }
        if (doctrine === "reserve") {
            if (type === "heal" || type === "boost" || type === "ammo") bonus += 18;
        }
        if (health < 55 && (type === "heal" || type === "boost")) bonus += 26;
        return bonus;
    }

    crateScoreModifier(doctrine: FactionDoctrine, crateType: string): number {
        const type = crateType.toLowerCase();
        let bonus = 0;
        if (/mil|airdrop|supply|ammo|medical|chest_03|cache_07/.test(type)) bonus += 34;
        if (doctrine === "medic" && /med|supply|heal/.test(type)) bonus += 28;
        if (doctrine === "grenadier" && /mil|ammo|grenade/.test(type)) bonus += 22;
        if (doctrine === "fire-support" && /ammo|mil|supply/.test(type)) bonus += 20;
        if (doctrine === "vanguard") bonus -= 8;
        return bonus;
    }

    shouldFollowOrder(order: FactionOrder, pos: Vec2): boolean {
        if (order.stance === "rescue" || order.stance === "withdraw") return true;
        return distance(pos, order.objective) > order.holdRadius;
    }

    getTeamMembers(teamId: number, timestamp: number): FactionBotSnapshot[] {
        if (!this.enabled || teamId <= 0) return [];
        const team = this.teams.get(teamId);
        if (!team) return [];
        this.pruneTeam(team, timestamp);
        return this.activeMembers(team, timestamp).map((member) => ({
            ...member,
            pos: clone(member.pos),
            dir: clone(member.dir),
            perks: [...(member.perks ?? [])],
        }));
    }

    getNearbyMembers(
        teamId: number,
        position: Vec2,
        radius: number,
        timestamp: number,
    ): FactionBotSnapshot[] {
        return this.getTeamMembers(teamId, timestamp).filter(
            (member) => distance(member.pos, position) <= radius,
        );
    }

    getPlayerPerks(teamId: number, playerId: number, timestamp: number): string[] {
        if (!this.enabled || teamId <= 0 || playerId <= 0) return [];
        const member = this.getTeamMembers(teamId, timestamp).find((entry) => entry.playerId === playerId);
        return [...(member?.perks ?? [])];
    }

    getEnemyPerks(teamId: number, targetId: number, timestamp: number): string[] {
        if (!this.enabled || teamId <= 0 || targetId <= 0) return [];
        const team = this.teams.get(teamId);
        if (!team) return [];
        this.pruneTeam(team, timestamp);
        const reports = team.enemies.get(targetId);
        if (!reports) return [];
        const result = new Set<string>();
        for (const report of reports.values()) {
            if (timestamp - report.updatedAt > this.options.reportMemoryMs) continue;
            for (const perk of report.perks ?? []) result.add(perk);
        }
        return [...result];
    }

    summary(teamId: number, timestamp: number): string {
        const team = this.teams.get(teamId);
        if (!team) return `team=${teamId}; members=0`;
        const active = this.activeMembers(team, timestamp);
        const enemies = this.enemyAggregates(team, timestamp);
        return `team=${teamId}; bots=${active.length}; enemies=${enemies.length}; downed=${team.downed.size}`;
    }

    private getTeam(teamId: number, timestamp: number): TeamState {
        let team = this.teams.get(teamId);
        if (!team) {
            team = {
                members: new Map(),
                enemies: new Map(),
                downed: new Map(),
                cachedOrders: new Map(),
                targetLocks: new Map(),
                ammoNeeds: new Map(),
                ammoShareReservations: new Map(),
                medicalNeeds: new Map(),
                medicalShareReservations: new Map(),
                homeAnchor: null,
                homeSamples: 0,
                firstSeenAt: timestamp,
                lastPruneAt: 0,
                injuredHigh: new Set(),
            };
            this.teams.set(teamId, team);
        }
        return team;
    }

    private pruneTeam(team: TeamState, timestamp: number): void {
        if (timestamp - team.lastPruneAt < 300) return;
        team.lastPruneAt = timestamp;
        for (const [botId, member] of team.members) {
            if (timestamp - member.updatedAt > 3500 || member.dead) {
                if (timestamp - member.updatedAt > 9000) {
                    team.members.delete(botId);
                    this.botTeams.delete(botId);
                    team.injuredHigh.delete(botId);
                }
            }
        }
        for (const [targetId, reports] of team.enemies) {
            for (const [reporterId, report] of reports) {
                if (timestamp - report.updatedAt > this.options.reportMemoryMs) reports.delete(reporterId);
            }
            if (reports.size === 0) team.enemies.delete(targetId);
        }
        for (const [playerId, report] of team.downed) {
            if (timestamp - report.updatedAt > 1600) team.downed.delete(playerId);
        }
        for (const [key, report] of team.ammoNeeds) {
            const maxAge = report.human ? 22_000 : 1800;
            if (timestamp - report.updatedAt > maxAge) {
                team.ammoNeeds.delete(key);
                team.ammoShareReservations.delete(key);
            }
        }
        for (const [key, reservation] of team.ammoShareReservations) {
            if (reservation.expiresAt <= timestamp) team.ammoShareReservations.delete(key);
        }
        for (const [key, report] of team.medicalNeeds) {
            const maxAge = report.human ? 22_000 : 1800;
            if (timestamp - report.updatedAt > maxAge) {
                team.medicalNeeds.delete(key);
                team.medicalShareReservations.delete(key);
            }
        }
        for (const [key, reservation] of team.medicalShareReservations) {
            if (reservation.expiresAt <= timestamp) team.medicalShareReservations.delete(key);
        }
        for (const [botId, lock] of team.targetLocks) {
            if (lock.expiresAt <= timestamp) team.targetLocks.delete(botId);
        }
        for (const [botId, order] of team.cachedOrders) {
            if (order.expiresAt <= timestamp - this.options.orderRefreshMs) {
                team.cachedOrders.delete(botId);
            }
        }
    }

    private activeMembers(team: TeamState, timestamp: number): FactionBotSnapshot[] {
        return [...team.members.values()].filter(
            (member) => timestamp - member.updatedAt <= 2200 && !member.dead,
        );
    }

    private enemyAggregates(team: TeamState, timestamp: number): EnemyAggregate[] {
        const result: EnemyAggregate[] = [];
        for (const [targetId, reports] of team.enemies) {
            const active = [...reports.values()].filter(
                (report) => timestamp - report.updatedAt <= this.options.reportMemoryMs,
            );
            if (active.length === 0) continue;
            let bestScore = -Infinity;
            let visible = 0;
            let newest = 0;
            let downed = false;
            const weightedPositions: Vec2[] = [];
            for (const report of active) {
                bestScore = Math.max(bestScore, report.score);
                if (report.visible) visible += 1;
                newest = Math.max(newest, report.updatedAt);
                downed ||= report.downed;
                weightedPositions.push(report.pos);
                if (report.visible) weightedPositions.push(report.pos);
            }
            result.push({
                targetId,
                pos: average(weightedPositions, active[0].pos),
                score: bestScore + Math.min(48, active.length * 7),
                visibleReports: visible,
                reporters: active.length,
                downed,
                updatedAt: newest,
            });
        }
        return result;
    }

    private effectiveDoctrine(member: FactionBotSnapshot): FactionDoctrine {
        switch (member.specialRole) {
            case "leader":
                return "reserve";
            case "lieutenant":
                return "line";
            case "medic":
                return "medic";
            case "marksman":
                return "marksman";
            case "recon":
                return member.botId % 2 === 0 ? "flank-north" : "flank-south";
            case "grenadier":
                return "grenadier";
            case "bugler":
                return "reserve";
            case "last_man":
                return "fire-support";
            default:
                return member.doctrine;
        }
    }

    private computeOrder(
        team: TeamState,
        member: FactionBotSnapshot,
        request: FactionOrderRequest,
    ): FactionOrder {
        const map = this.snapshot!;
        const mapCenter = { x: map.width / 2, y: map.height / 2 };
        const active = this.activeMembers(team, request.timestamp).filter((entry) => !entry.downed);
        const ownCenter = average(active.map((entry) => entry.pos), team.homeAnchor ?? request.pos);
        const home = team.homeAnchor ? clone(team.homeAnchor) : clone(ownCenter);
        const enemies = this.enemyAggregates(team, request.timestamp);
        const enemyCenter = average(
            enemies.filter((entry) => !entry.downed).map((entry) => entry.pos),
            this.mirroredHome(home, mapCenter),
        );
        const forward = normalize(sub(enemyCenter, home), normalize(sub(mapCenter, home)));
        const side = perpendicular(forward);
        const doctrine = this.effectiveDoctrine(member);
        const aliveCount = active.length;
        const underFireCount = active.filter((entry) => entry.underFire).length;
        // injuredHigh is maintained in updateBot with a 45..55 hysteresis band.
        const injuredCount = active.filter(
            (entry) => team.injuredHigh.has(entry.botId),
        ).length;
        const pressure = clamp(
            enemies.filter((enemy) => distance(enemy.pos, ownCenter) < 55).length * 0.18
                + underFireCount / Math.max(1, aliveCount),
            0,
            1.5,
        );
        const casualtyRatio = clamp((injuredCount + team.downed.size * 1.5) / Math.max(1, aliveCount), 0, 1);

        const rescue = this.rescueAssignment(team, member, request.timestamp);
        if (rescue) {
            return {
                doctrine,
                stance: "rescue",
                objectiveKind: "rescue",
                objective: this.constrainToGas(rescue.pos, request.gasCenter, request.gasRadius, request.phase),
                formationAnchor: clone(rescue.pos),
                focusTargetId: this.getFocusTargetId(
                    request.teamId,
                    request.botId,
                    member.squadId,
                    request.pos,
                    request.timestamp,
                ),
                rescuePlayerId: rescue.playerId,
                holdRadius: 3.1,
                preferredRangeMultiplier: doctrine === "medic" ? 1.2 : 1,
                aggression: pressure > 0.75 ? 0.35 : 0.55,
                flankSign: 0,
                spacing: 5.5,
                allowLoot: false,
                allowCrates: false,
                prioritizeRevive: true,
                suppress: true,
                unifiedPush: false,
                reason: `rescue player=${rescue.playerId}`,
                expiresAt: request.timestamp + Math.min(500, this.options.orderRefreshMs),
            };
        }

        const phaseAdvance = request.phase === "early"
            ? 0.48
            : request.phase === "mid"
            ? 0.59
            : request.phase === "late"
            ? 0.68
            : 0.75;
        let frontAnchor = lerp(home, enemyCenter, phaseAdvance);
        const bridge = this.pickBridge(home, enemyCenter, member.squadId, doctrine);
        if (bridge && (request.phase === "early" || request.phase === "mid")) {
            const bridgeWeight = doctrine === "vanguard" || doctrine === "line" ? 0.74 : 0.5;
            frontAnchor = lerp(frontAnchor, bridge.pos, bridgeWeight);
        } else {
            const strongpoint = this.pickStrongpoint(frontAnchor, home, enemyCenter, doctrine);
            if (strongpoint) frontAnchor = lerp(frontAnchor, strongpoint.pos, 0.52);
        }

        const laneIndex = ((member.squadId + request.teamId * 2) % 7) - 3;
        const laneOffset = (laneIndex / 3) * this.options.frontWidth * 0.28;
        let forwardOffset = 0;
        let sideOffset = laneOffset;
        let stance: FactionStance = "attack";
        let kind: FactionObjectiveKind = bridge ? "bridgehead" : "frontline";
        let aggression = 0.68;
        let preferredRangeMultiplier = 1;
        let flankSign: -1 | 0 | 1 = 0;
        let spacing = 6.4;
        let allowLoot = request.phase === "early";
        let allowCrates = request.phase === "early" && pressure < 0.35;
        let suppress = false;

        switch (doctrine) {
            case "vanguard":
                forwardOffset = 17;
                aggression = 0.92;
                preferredRangeMultiplier = 0.84;
                spacing = 7;
                allowLoot = request.phase === "early" && pressure < 0.25;
                allowCrates = false;
                break;
            case "line":
                forwardOffset = 5;
                aggression = 0.74;
                spacing = 7.5;
                break;
            case "flank-north":
                forwardOffset = 10;
                sideOffset += this.options.frontWidth * 0.68;
                aggression = 0.8;
                flankSign = 1;
                kind = "flank";
                spacing = 9;
                break;
            case "flank-south":
                forwardOffset = 10;
                sideOffset -= this.options.frontWidth * 0.68;
                aggression = 0.8;
                flankSign = -1;
                kind = "flank";
                spacing = 9;
                break;
            case "fire-support":
                forwardOffset = -17;
                aggression = 0.58;
                preferredRangeMultiplier = 1.28;
                spacing = 10;
                suppress = true;
                break;
            case "medic":
                forwardOffset = -21;
                aggression = 0.42;
                preferredRangeMultiplier = 1.18;
                spacing = 6;
                allowLoot = request.phase !== "final" && pressure < 0.45;
                allowCrates = false;
                break;
            case "reserve":
                forwardOffset = -38;
                aggression = 0.44;
                stance = pressure > 0.52 || casualtyRatio > 0.34 ? "defend" : "hold";
                kind = "reserve";
                preferredRangeMultiplier = 1.08;
                spacing = 8;
                break;
            case "marksman":
                forwardOffset = -25;
                sideOffset *= 1.3;
                aggression = 0.5;
                preferredRangeMultiplier = 1.48;
                spacing = 11;
                suppress = true;
                break;
            case "grenadier":
                forwardOffset = 2;
                sideOffset *= 0.72;
                aggression = 0.7;
                preferredRangeMultiplier = 1.08;
                spacing = 8;
                suppress = true;
                break;
        }

        const loneSurvivor = String(member.specialRole ?? "").toLowerCase().replace(/[-\s]+/g, "_") === "last_man";
        if (pressure > 0.95 || casualtyRatio > 0.55 || request.health < 23) {
            stance = loneSurvivor && request.phase === "final" ? "attack" : "withdraw";
            forwardOffset -= 24;
            aggression = Math.min(aggression, 0.34);
            allowLoot = false;
            allowCrates = false;
        } else if (
            pressure > 0.58 && doctrine !== "vanguard" && doctrine !== "flank-north" && doctrine !== "flank-south"
        ) {
            stance = "defend";
            forwardOffset -= 9;
            aggression = Math.min(aggression, 0.52);
        }

        if (request.phase === "late") aggression = Math.min(1.05, aggression + 0.1);
        if (request.phase === "final") {
            aggression = Math.min(loneSurvivor ? 1.35 : 1.16, aggression + (loneSurvivor ? 0.42 : 0.18));
            allowLoot = false;
            allowCrates = false;
            if (loneSurvivor) {
                stance = "attack";
                suppress = true;
                preferredRangeMultiplier = Math.max(preferredRangeMultiplier, 1.12);
            }
        }

        // Unified assault: when the faction is healthy and on the attack, every
        // doctrine converges on the same front instead of spreading across far
        // lanes, and the whole force shares one focus target (focus fire).
        const unifiedPush = stance !== "withdraw"
            && pressure < 0.5
            && casualtyRatio < 0.42
            && aliveCount >= 4
            && request.phase !== "final";
        if (unifiedPush) {
            sideOffset *= 0.32;
            if (doctrine === "fire-support") forwardOffset = Math.max(forwardOffset, -7);
            if (doctrine === "marksman") forwardOffset = Math.max(forwardOffset, -11);
            if (doctrine === "reserve") {
                stance = "attack";
                forwardOffset = -14;
                kind = "frontline";
            }
            if (doctrine === "medic") forwardOffset = Math.max(forwardOffset, -9);
            aggression = Math.min(0.92, Math.max(aggression, 0.62));
            spacing *= 0.82;
        }

        let objective = add(frontAnchor, add(mul(forward, forwardOffset), mul(side, sideOffset)));
        if (request.phase === "final" && request.gasCenter) {
            objective = lerp(objective, request.gasCenter, 0.58);
            kind = "safe-zone";
            allowLoot = false;
            allowCrates = false;
        }
        objective = this.constrainToGas(objective, request.gasCenter, request.gasRadius, request.phase);
        objective = this.constrainToMap(objective);

        const formationNoise = (hash01(member.botId * 41 + member.squadId * 17) - 0.5) * spacing * 1.2;
        const row = member.squadSlot === 0 ? 0 : member.squadSlot === 1 ? 1 : member.squadSlot === 2 ? -1 : 0.5;
        const formationAnchor = this.constrainToMap(
            add(objective, add(mul(side, formationNoise + row * spacing), mul(forward, -Math.abs(row) * 1.6))),
        );
        const focusTargetId = this.getFocusTargetId(
            request.teamId,
            request.botId,
            member.squadId,
            request.pos,
            request.timestamp,
        );

        return {
            doctrine,
            stance,
            objectiveKind: kind,
            objective,
            formationAnchor,
            focusTargetId,
            rescuePlayerId: 0,
            holdRadius: stance === "hold" || stance === "defend"
                ? this.options.objectiveHoldRadius + 3
                : this.options.objectiveHoldRadius,
            preferredRangeMultiplier,
            aggression,
            flankSign,
            spacing,
            allowLoot,
            allowCrates,
            prioritizeRevive: doctrine === "medic" || doctrine === "reserve",
            suppress,
            unifiedPush,
            reason: `${doctrine}/${stance}/${kind}; pressure=${pressure.toFixed(2)} casualties=${
                casualtyRatio.toFixed(2)
            }`,
            expiresAt: request.timestamp + this.options.orderRefreshMs + hash01(member.botId) * 180,
        };
    }

    private rescueAssignment(
        team: TeamState,
        member: FactionBotSnapshot,
        timestamp: number,
    ): FactionDownedReport | null {
        if (member.health < 28 || member.downed || member.dead || member.underFire) return null;
        const candidates = [...team.downed.values()]
            .filter(
                (report) =>
                    timestamp - report.updatedAt <= 1500
                    && report.playerId !== member.playerId,
            )
            .sort((a, b) => Number(b.human) - Number(a.human));
        if (candidates.length === 0) return null;

        const medics = this.activeMembers(team, timestamp).filter(
            (entry) =>
                !entry.downed
                && !entry.dead
                && entry.health >= 28
                && (entry.specialRole === "medic"
                    || entry.doctrine === "medic"
                    || entry.doctrine === "reserve"
                    || entry.role === "support"),
        );
        for (const target of candidates) {
            if (target.enemyDistance < 12 && !target.outsideGas) continue;
            const sorted = medics
                .map((candidate) => ({
                    botId: candidate.botId,
                    cost: distance(candidate.pos, target.pos)
                        + (candidate.underFire ? 32 : 0)
                        + (candidate.specialRole === "medic"
                            ? -24
                            : candidate.doctrine === "medic"
                            ? -14
                            : candidate.doctrine === "reserve"
                            ? -7
                            : 0),
                }))
                .sort((a, b) => a.cost - b.cost);
            if (sorted[0]?.botId !== member.botId) continue;
            if (distance(member.pos, target.pos) > this.options.rescueRange) continue;
            return target;
        }
        return null;
    }

    private mirroredHome(home: Vec2, center: Vec2): Vec2 {
        return add(center, sub(center, home));
    }

    private constrainToGas(
        point: Vec2,
        gasCenter: Vec2 | null,
        gasRadius: number | null,
        phase: MapPhase,
    ): Vec2 {
        if (!gasCenter || !gasRadius || !Number.isFinite(gasRadius)) return this.constrainToMap(point);
        const safeRatio = phase === "early" ? 0.92 : phase === "mid" ? 0.84 : phase === "late" ? 0.72 : 0.58;
        const maxDistance = Math.max(6, gasRadius * safeRatio);
        const delta = sub(point, gasCenter);
        const dist = length(delta);
        if (dist <= maxDistance) return this.constrainToMap(point);
        return this.constrainToMap(add(gasCenter, mul(normalize(delta), maxDistance)));
    }

    private constrainToMap(point: Vec2): Vec2 {
        const snapshot = this.snapshot;
        if (!snapshot) return clone(point);
        const margin = Math.max(12, snapshot.shoreInset * 0.55);
        return {
            x: clamp(point.x, margin, Math.max(margin, snapshot.width - margin)),
            y: clamp(point.y, margin, Math.max(margin, snapshot.height - margin)),
        };
    }

    private buildTacticalPoints(snapshot: MapRuntimeSnapshot): TacticalPoint[] {
        const points: TacticalPoint[] = [];
        const center = { x: snapshot.width / 2, y: snapshot.height / 2 };
        for (const place of snapshot.places ?? []) {
            points.push({
                pos: clone(place.pos),
                kind: "place",
                label: String(place.name || "place"),
                score: 55 - distance(place.pos, center) * 0.018,
            });
        }
        for (const object of snapshot.objects ?? []) {
            const type = String(object.type ?? "").toLowerCase();
            if (/bridge|crossing|causeway/.test(type)) {
                points.push({ pos: clone(object.pos), kind: "bridge", label: type, score: 95 });
            } else if (
                /river_town|police|bank|mansion|warehouse_complex|bunker|vault|military|headquarter/.test(type)
            ) {
                points.push({ pos: clone(object.pos), kind: "strongpoint", label: type, score: 82 });
            } else if (/warehouse|house|barn|hut|shack|greenhouse|cache/.test(type)) {
                points.push({ pos: clone(object.pos), kind: "strongpoint", label: type, score: 58 });
            } else if (/stone|rock|tree_08f|hedgehog|container|silo/.test(type)) {
                points.push({ pos: clone(object.pos), kind: "cover", label: type, score: 30 });
            }
        }
        points.push({ pos: center, kind: "place", label: "map-center", score: 50 });
        return this.deduplicatePoints(points);
    }

    private deduplicatePoints(points: TacticalPoint[]): TacticalPoint[] {
        const result: TacticalPoint[] = [];
        for (const point of points.sort((a, b) => b.score - a.score)) {
            if (result.some((existing) => distance(existing.pos, point.pos) < 3.5 && existing.kind === point.kind)) {
                continue;
            }
            result.push(point);
        }
        return result;
    }

    private pickBridge(
        home: Vec2,
        enemy: Vec2,
        squadId: number,
        doctrine: FactionDoctrine,
    ): TacticalPoint | null {
        const bridges = this.tacticalPoints.filter((point) => point.kind === "bridge");
        if (bridges.length === 0) return null;
        const preferredSide = doctrine === "flank-north" ? 1 : doctrine === "flank-south" ? -1 : ((squadId % 3) - 1);
        const route = sub(enemy, home);
        const routeSide = perpendicular(normalize(route));
        let best: TacticalPoint | null = null;
        let bestScore = Infinity;
        for (const bridge of bridges) {
            const routeDistance = segmentPointDistance(home, enemy, bridge.pos);
            const signed = dot(sub(bridge.pos, lerp(home, enemy, 0.5)), routeSide);
            const sidePenalty = Math.abs(signed - preferredSide * this.options.frontWidth * 0.32) * 0.35;
            const score = routeDistance + sidePenalty + distance(home, bridge.pos) * 0.08;
            if (score < bestScore) {
                bestScore = score;
                best = bridge;
            }
        }
        return best;
    }

    private pickStrongpoint(
        front: Vec2,
        home: Vec2,
        enemy: Vec2,
        doctrine: FactionDoctrine,
    ): TacticalPoint | null {
        const candidates = this.tacticalPoints.filter(
            (point) => point.kind === "strongpoint" || point.kind === "place",
        );
        let best: TacticalPoint | null = null;
        let bestScore = Infinity;
        for (const point of candidates) {
            const frontDistance = distance(front, point.pos);
            const routeDistance = segmentPointDistance(home, enemy, point.pos);
            const doctrineBonus = doctrine === "reserve" || doctrine === "medic"
                ? distance(home, point.pos) * 0.05
                : distance(enemy, point.pos) * 0.025;
            const score = frontDistance + routeDistance * 0.35 + doctrineBonus - point.score * 0.12;
            if (score < bestScore) {
                bestScore = score;
                best = point;
            }
        }
        return bestScore < 85 ? best : null;
    }

    private maybeDebug(team: TeamState, teamId: number, order: FactionOrder, timestamp: number): void {
        if (!this.options.debug || timestamp - this.lastDebugAt < 3500) return;
        this.lastDebugAt = timestamp;
        const active = this.activeMembers(team, timestamp);
        console.log(
            `[factionAI] ${this.summary(teamId, timestamp)} order=${order.doctrine}/${order.stance}/`
                + `${order.objectiveKind} target=${order.focusTargetId} reason=${order.reason}`,
        );
        if (active.length >= 40) {
            console.log(`[factionAI] team ${teamId} reached large-force coordination (${active.length} managed bots)`);
        }
    }
}
