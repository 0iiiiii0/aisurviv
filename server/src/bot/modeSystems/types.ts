import type { BotModeFamily, BotModeKind, ModeStrategyProfile } from "../modeStrategy.ts";

export type ResourceCommitmentKind = "loot" | "crate";

export interface ModeAiPolicy {
    readonly id: string;
    readonly kind: BotModeKind;
    readonly family: BotModeFamily;
    readonly ammoSharing: boolean;
    readonly humanAmmoPriority: boolean;
    readonly ammoRequestMemoryMs: number;
    readonly ammoShareTravelRange: number;
    readonly resourceCrowdLimit: number;
    readonly repeatedRecoveryLimit: number;
    resourceCommitmentMs(kind: ResourceCommitmentKind, urgent: boolean): number;
    resourceProgressTimeoutMs(kind: ResourceCommitmentKind, urgent: boolean): number;
    formationSlot(botId: number, teamId: number): number;
}

export interface ModeAiSystem {
    readonly policy: ModeAiPolicy;
    readonly profile: ModeStrategyProfile;
}
