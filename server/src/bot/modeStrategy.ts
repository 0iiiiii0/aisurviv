import { MapDefs } from "../../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { createModeAiSystem, type ModeAiSystem } from "./modeSystems/index.ts";

export type BotModeKind = "duel" | "solo" | "duo" | "squad" | "faction";
export type BotModeFamily =
    | "normal"
    | "seasonal"
    | "desert"
    | "woods"
    | "savannah"
    | "potato"
    | "cobalt"
    | "turkey"
    | "halloween"
    | "snow"
    | "faction"
    | "duel"
    | "custom";

export interface ModeStrategyProfile {
    mapName: string;
    kind: BotModeKind;
    family: BotModeFamily;
    teamMode: TeamMode;
    maxPlayers: number;
    factionMode: boolean;
    perkMode: boolean;
    sniperMode: boolean;
    potatoMode: boolean;
    woodsMode: boolean;
    desertMode: boolean;
    turkeyMode: boolean;
    lootEnabled: boolean;
    crateLootEnabled: boolean;
    reviveEnabled: boolean;
    squadCoordination: boolean;
    formationMultiplier: number;
    cohesionMultiplier: number;
    rescueMultiplier: number;
    aggressionMultiplier: number;
    retreatHealthDelta: number;
    combatScanMultiplier: number;
    lootRangeMultiplier: number;
    crateRangeMultiplier: number;
    ammoReserveMultiplier: number;
    gasEdgePreference: number;
    openingLootSeconds: number;
    specialTags: string[];
}

export interface ModeTargetContext {
    distance: number;
    downed: boolean;
    enemyRole: string;
    phase: "early" | "mid" | "late" | "final";
    currentTarget: boolean;
    /** True when the bot is safe enough to finish a downed enemy (no direct threat). */
    finishDowned?: boolean;
}

export interface ModeLootContext {
    itemType: string;
    defType: string;
    inventoryCount: number;
    health: number;
    phase: "early" | "mid" | "late" | "final";
}

export interface ModeWeaponContext {
    weaponType: string;
    defType: string;
    range: number;
    distance: number;
    explosive: boolean;
    phase: "early" | "mid" | "late" | "final";
    targetBehindCover: boolean;
}

const normalize = (value: string): string =>
    String(value || "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

function familyForMap(mapName: string): BotModeFamily {
    const name = normalize(mapName);
    if (name === "duel" || name === "duel_ai" || /(?:^|_)1v1(?:_|$)/.test(name)) return "duel";
    if (name === "faction" || /50v50|faction/.test(name)) return "faction";
    if (name.startsWith("potato")) return "potato";
    if (name.startsWith("woods")) return "woods";
    if (name === "desert") return "desert";
    if (name === "savannah") return "savannah";
    if (name === "cobalt") return "cobalt";
    if (name === "turkey") return "turkey";
    if (name === "halloween") return "halloween";
    if (name === "snow") return "snow";
    if (name === "main_spring" || name === "main_summer") return "seasonal";
    if (name === "main" || name === "sandevistan") return "normal";
    return "custom";
}

function kindFor(teamMode: TeamMode, factionMode: boolean, family: BotModeFamily): BotModeKind {
    if (family === "duel") return "duel";
    if (factionMode || family === "faction") return "faction";
    if (teamMode === TeamMode.Duo) return "duo";
    if (teamMode === TeamMode.Squad) return "squad";
    return "solo";
}

function baseTeamProfile(kind: BotModeKind): Pick<
    ModeStrategyProfile,
    | "lootEnabled"
    | "crateLootEnabled"
    | "reviveEnabled"
    | "squadCoordination"
    | "formationMultiplier"
    | "cohesionMultiplier"
    | "rescueMultiplier"
    | "aggressionMultiplier"
    | "retreatHealthDelta"
    | "combatScanMultiplier"
    | "lootRangeMultiplier"
    | "crateRangeMultiplier"
    | "ammoReserveMultiplier"
    | "gasEdgePreference"
    | "openingLootSeconds"
> {
    switch (kind) {
        case "duel":
            return {
                lootEnabled: false,
                crateLootEnabled: false,
                reviveEnabled: false,
                squadCoordination: false,
                formationMultiplier: 1,
                cohesionMultiplier: 1,
                rescueMultiplier: 0,
                aggressionMultiplier: 1.16,
                retreatHealthDelta: 4,
                combatScanMultiplier: 0.9,
                lootRangeMultiplier: 0,
                crateRangeMultiplier: 0,
                ammoReserveMultiplier: 0,
                gasEdgePreference: 1.2,
                openingLootSeconds: 0,
            };
        case "solo":
            return {
                lootEnabled: true,
                crateLootEnabled: true,
                reviveEnabled: false,
                squadCoordination: false,
                formationMultiplier: 1.15,
                cohesionMultiplier: 1.2,
                rescueMultiplier: 0,
                aggressionMultiplier: 1.05,
                retreatHealthDelta: 2,
                combatScanMultiplier: 1,
                lootRangeMultiplier: 1.06,
                crateRangeMultiplier: 1.05,
                ammoReserveMultiplier: 1,
                gasEdgePreference: 1.08,
                openingLootSeconds: 72,
            };
        case "duo":
            return {
                lootEnabled: true,
                crateLootEnabled: true,
                reviveEnabled: true,
                squadCoordination: true,
                formationMultiplier: 0.84,
                cohesionMultiplier: 0.86,
                rescueMultiplier: 1.28,
                aggressionMultiplier: 1.02,
                retreatHealthDelta: 4,
                combatScanMultiplier: 1.04,
                lootRangeMultiplier: 0.98,
                crateRangeMultiplier: 0.96,
                ammoReserveMultiplier: 1.08,
                gasEdgePreference: 0.96,
                openingLootSeconds: 64,
            };
        case "squad":
            return {
                lootEnabled: true,
                crateLootEnabled: true,
                reviveEnabled: true,
                squadCoordination: true,
                formationMultiplier: 0.78,
                cohesionMultiplier: 0.8,
                rescueMultiplier: 1.2,
                aggressionMultiplier: 1.06,
                retreatHealthDelta: 5,
                combatScanMultiplier: 1.08,
                lootRangeMultiplier: 0.94,
                crateRangeMultiplier: 0.92,
                ammoReserveMultiplier: 1.15,
                gasEdgePreference: 0.9,
                openingLootSeconds: 58,
            };
        case "faction":
            return {
                lootEnabled: true,
                crateLootEnabled: true,
                reviveEnabled: true,
                squadCoordination: true,
                formationMultiplier: 0.7,
                cohesionMultiplier: 0.74,
                rescueMultiplier: 1.35,
                aggressionMultiplier: 1.12,
                retreatHealthDelta: 2,
                combatScanMultiplier: 1.18,
                lootRangeMultiplier: 0.9,
                crateRangeMultiplier: 0.88,
                ammoReserveMultiplier: 1.28,
                gasEdgePreference: 0.82,
                openingLootSeconds: 46,
            };
    }
}

export function resolveModeStrategy(
    mapNameValue: string,
    teamModeValue: TeamMode | number,
): ModeStrategyProfile {
    const mapName = normalize(mapNameValue);
    const mapDef = (MapDefs as Record<string, any>)[mapName];
    const gameMode = mapDef?.gameMode ?? {};
    const family = familyForMap(mapName);
    const teamMode = teamModeValue === TeamMode.Duo || teamModeValue === TeamMode.Squad
        ? teamModeValue
        : TeamMode.Solo;
    const kind = kindFor(teamMode, Boolean(gameMode.factionMode), family);
    const team = baseTeamProfile(kind);
    // 绝密搜打撤 AI 自带满配双套装备，禁止搜刮/搜索（不捡地面、不开箱、
    // 不做开场物资扫荡），只负责追杀真人并撤离。
    const secretExtraction = Boolean(gameMode.extractionSecretMode);

    let aggression = team.aggressionMultiplier;
    let scan = team.combatScanMultiplier;
    let lootRange = team.lootRangeMultiplier;
    let crateRange = team.crateRangeMultiplier;
    let ammo = team.ammoReserveMultiplier;
    let gasEdge = team.gasEdgePreference;
    const tags: string[] = [kind, family];

    switch (family) {
        case "desert":
        case "savannah":
            scan *= 1.18;
            aggression *= 0.96;
            ammo *= 1.16;
            gasEdge *= 0.9;
            tags.push("long-range", "early-rotation");
            break;
        case "woods":
            scan *= 0.82;
            aggression *= 1.08;
            crateRange *= 1.08;
            tags.push("close-range", "vegetation");
            break;
        case "potato":
            lootRange *= 1.18;
            crateRange *= 1.24;
            aggression *= 1.12;
            ammo *= 1.22;
            tags.push("weapon-turnover", "potato");
            break;
        case "cobalt":
            lootRange *= 1.08;
            ammo *= 1.1;
            tags.push("perk-mode", "class-role");
            break;
        case "turkey":
            lootRange *= 1.12;
            crateRange *= 1.16;
            tags.push("event-loot", "turkey");
            break;
        case "halloween":
            scan *= 0.9;
            aggression *= 1.1;
            crateRange *= 1.12;
            tags.push("ambush", "event-loot");
            break;
        case "snow":
            scan *= 1.1;
            ammo *= 1.08;
            gasEdge *= 0.94;
            tags.push("snowball", "open-ground");
            break;
        case "faction":
            tags.push("bridge-control", "roles", "airdrop");
            break;
        case "duel":
            tags.push("sandbag", "fixed-loadout");
            break;
        case "seasonal":
            tags.push("seasonal", "balanced");
            break;
        default:
            break;
    }

    return {
        mapName,
        kind,
        family,
        teamMode,
        maxPlayers: Number(gameMode.maxPlayers ?? (kind === "duel" ? 2 : 80)),
        factionMode: Boolean(gameMode.factionMode || family === "faction"),
        perkMode: Boolean(gameMode.perkMode || family === "cobalt"),
        sniperMode: Boolean(gameMode.sniperMode || family === "savannah"),
        potatoMode: Boolean(gameMode.potatoMode || family === "potato"),
        woodsMode: Boolean(gameMode.woodsMode || family === "woods"),
        desertMode: Boolean(gameMode.desertMode || family === "desert"),
        turkeyMode: Boolean(gameMode.turkeyMode || family === "turkey"),
        ...team,
        lootEnabled: secretExtraction ? false : team.lootEnabled,
        crateLootEnabled: secretExtraction ? false : team.crateLootEnabled,
        openingLootSeconds: secretExtraction ? 0 : team.openingLootSeconds,
        aggressionMultiplier: aggression,
        combatScanMultiplier: scan,
        lootRangeMultiplier: secretExtraction ? 0 : lootRange,
        crateRangeMultiplier: secretExtraction ? 0 : crateRange,
        ammoReserveMultiplier: ammo,
        gasEdgePreference: gasEdge,
        specialTags: [...new Set(tags)],
    };
}

export class ModeStrategy {
    profile: ModeStrategyProfile = resolveModeStrategy("unknown", TeamMode.Solo);
    system: ModeAiSystem = createModeAiSystem(this.profile);

    load(mapName: string, teamMode: TeamMode | number): ModeStrategyProfile {
        this.profile = resolveModeStrategy(mapName, teamMode);
        this.system = createModeAiSystem(this.profile);
        return this.profile;
    }

    targetScoreModifier(context: ModeTargetContext): number {
        const role = normalize(context.enemyRole);
        let value = 0;
        if (this.profile.sniperMode && role === "kill_leader") value += 58;
        if (this.profile.perkMode && role && role !== "none") value += 18;
        if (this.profile.factionMode && /leader|medic|bugler|grenadier/.test(role)) value += 22;
        if (context.downed) {
            // Finishing a downed enemy denies a revive/self-revive: when the bot
            // is safe (no direct threat), downed enemies rank higher instead of
            // being ignored.
            value += context.finishDowned
                ? 22
                : this.profile.kind === "solo"
                ? -34
                : this.profile.kind === "faction"
                ? -8
                : -18;
        }
        if (this.profile.potatoMode && context.distance < 26) value += 10;
        if (this.profile.family === "woods" && context.distance < 24) value += 14;
        if ((this.profile.family === "desert" || this.profile.family === "savannah") && context.distance > 42) {
            value += 15;
        }
        if (context.phase === "final") value += context.currentTarget ? 15 : 5;
        return value;
    }

    lootScoreModifier(context: ModeLootContext): number {
        if (!this.profile.lootEnabled) return -10000;
        const item = normalize(context.itemType);
        const def = normalize(context.defType);
        let value = 0;
        // Potato matches are defined by weapon turnover. A bot still needs an
        // initial firearm before it can deliberately reroll a weak gun on a
        // potato obstacle, so ground guns receive a strong opening priority.
        if (this.profile.potatoMode && def === "gun") value += 96;
        if (this.profile.sniperMode && /sniper|dmr|mosin|sv98|awm|scout|mk12|m39|garand/.test(item)) value += 34;
        if (this.profile.family === "woods" && /shotgun|smg|m870|mp220|saiga|vector|mac10|spas/.test(item)) value += 28;
        if (this.profile.desertMode && /8x|15x|sniper|dmr|mosin|sv98|awm|scout|mk12|m39/.test(item)) value += 30;
        if (this.profile.perkMode && def === "perk") value += 42;
        if (this.profile.turkeyMode && /xp|turkey|feather|pumpkin/.test(item)) value += 32;
        if (this.profile.family === "snow" && /snowball/.test(item)) value += 15;
        if (this.profile.family === "halloween" && /katana|perk|pumpkin|event/.test(item)) value += 20;
        if (
            (context.phase === "late" || context.phase === "final") && /heal|boost/.test(def)
            && context.inventoryCount < 2
        ) value += 20;
        if (context.health < 55 && /heal|boost/.test(def)) value += 18;
        return value;
    }

    weaponScoreModifier(context: ModeWeaponContext): number {
        const weapon = normalize(context.weaponType);
        let value = 0;
        if (this.profile.sniperMode && context.range >= 70) value += 34;
        if (this.profile.desertMode && context.range >= 65) value += 24;
        if (this.profile.family === "woods" && context.range <= 52) value += 22;
        if (this.profile.family === "woods" && context.range > 80) value -= 18;
        if (this.profile.potatoMode) value += 5;
        if (this.profile.family === "snow" && /snowball/.test(weapon)) value += context.distance < 22 ? 14 : -12;
        if (this.profile.family === "halloween" && /katana|shotgun|smg/.test(weapon)) value += 13;
        if (this.profile.factionMode && /m249|pkp|qbb|dp28|lmg/.test(weapon)) value += 16;
        if (context.targetBehindCover && context.explosive) value += 16;
        if (context.phase === "final" && context.distance < 30 && context.range <= 58) value += 10;
        return value;
    }

    crateScoreModifier(typeValue: string): number {
        if (!this.profile.crateLootEnabled) return -10000;
        const type = normalize(typeValue);
        let value = 0;
        if (this.profile.potatoMode) value += /potato/.test(type) ? 86 : 30;
        if (this.profile.perkMode && /pod|class|perk/.test(type)) value += 48;
        if (this.profile.factionMode && /military|airdrop|role/.test(type)) value += 38;
        if (this.profile.desertMode && /gold|airdrop/.test(type)) value += 42;
        if (this.profile.turkeyMode && /turkey|pumpkin|event/.test(type)) value += 25;
        if (this.profile.family === "halloween" && /chrysanthemum|pumpkin|event/.test(type)) value += 28;
        if (this.profile.family === "snow" && /airdrop|gift|snow/.test(type)) value += 18;
        return value;
    }

    aggressionMultiplier(phase: "early" | "mid" | "late" | "final", aliveCount: number): number {
        let value = this.profile.aggressionMultiplier;
        if (phase === "late") value *= 1.06;
        if (phase === "final") value *= aliveCount <= 8 ? 1.2 : 1.1;
        if (this.profile.kind === "solo" && aliveCount <= 4) value *= 1.08;
        if (this.profile.kind === "duo" || this.profile.kind === "squad") value *= 0.98;
        return value;
    }

    retreatHealth(base: number, phase: "early" | "mid" | "late" | "final"): number {
        let value = base + this.profile.retreatHealthDelta;
        if (phase === "final") value -= this.profile.kind === "solo" || this.profile.kind === "duel" ? 5 : 2;
        return Math.max(20, Math.min(65, value));
    }
}
