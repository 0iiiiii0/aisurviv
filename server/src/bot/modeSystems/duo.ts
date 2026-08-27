import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { BaseModeAiSystem } from "./base.ts";
import type { ResourceCommitmentKind } from "./types.ts";

export class DuoModeAiSystem extends BaseModeAiSystem {
    readonly policy;
    constructor(profile: ModeStrategyProfile) {
        super(profile);
        this.policy = {
            id: `duo:${profile.family}`,
            kind: profile.kind,
            family: profile.family,
            ammoSharing: true,
            humanAmmoPriority: true,
            ammoRequestMemoryMs: 18_000,
            ammoShareTravelRange: 48,
            resourceCrowdLimit: 1,
            repeatedRecoveryLimit: 2,
            resourceCommitmentMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.commitment(kind, urgent, 10_000, 13_000),
            resourceProgressTimeoutMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.progress(kind, urgent, 2_800, 3_500),
            formationSlot: (botId: number) => botId % 2,
        };
    }
}
