import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { BaseModeAiSystem } from "./base.ts";
import type { ResourceCommitmentKind } from "./types.ts";

export class DuelModeAiSystem extends BaseModeAiSystem {
    readonly policy;
    constructor(profile: ModeStrategyProfile) {
        super(profile);
        this.policy = {
            id: "duel",
            kind: profile.kind,
            family: profile.family,
            ammoSharing: false,
            humanAmmoPriority: false,
            ammoRequestMemoryMs: 0,
            ammoShareTravelRange: 0,
            resourceCrowdLimit: 0,
            repeatedRecoveryLimit: 1,
            resourceCommitmentMs: (_kind: ResourceCommitmentKind, _urgent: boolean) => 0,
            resourceProgressTimeoutMs: (_kind: ResourceCommitmentKind, _urgent: boolean) => 0,
            formationSlot: () => 0,
        };
    }
}
