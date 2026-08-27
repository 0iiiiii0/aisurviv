import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { BaseModeAiSystem } from "./base.ts";
import type { ResourceCommitmentKind } from "./types.ts";

export class SoloModeAiSystem extends BaseModeAiSystem {
    readonly policy;
    constructor(profile: ModeStrategyProfile) {
        super(profile);
        this.policy = {
            id: `solo:${profile.family}`,
            kind: profile.kind,
            family: profile.family,
            ammoSharing: false,
            humanAmmoPriority: false,
            ammoRequestMemoryMs: 0,
            ammoShareTravelRange: 0,
            resourceCrowdLimit: 1,
            repeatedRecoveryLimit: 2,
            resourceCommitmentMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.commitment(kind, urgent, 9_000, 12_000),
            resourceProgressTimeoutMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.progress(kind, urgent, 2_600, 3_300),
            formationSlot: (botId: number) => botId % 8,
        };
    }
}
