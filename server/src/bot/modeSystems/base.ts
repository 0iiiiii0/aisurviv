import type { ModeStrategyProfile } from "../modeStrategy.ts";
import type { ModeAiPolicy, ModeAiSystem, ResourceCommitmentKind } from "./types.ts";

export abstract class BaseModeAiSystem implements ModeAiSystem {
    abstract readonly policy: ModeAiPolicy;
    constructor(readonly profile: ModeStrategyProfile) {}

    protected commitment(kind: ResourceCommitmentKind, urgent: boolean, lootMs: number, crateMs: number): number {
        const base = kind === "loot" ? lootMs : crateMs;
        return Math.round(base * (urgent ? 1.35 : 1));
    }

    protected progress(kind: ResourceCommitmentKind, urgent: boolean, lootMs: number, crateMs: number): number {
        const base = kind === "loot" ? lootMs : crateMs;
        return Math.round(base * (urgent ? 1.25 : 1));
    }
}
