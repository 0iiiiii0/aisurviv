import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { BaseModeAiSystem } from "./base.ts";
import type { ResourceCommitmentKind } from "./types.ts";

export class SquadModeAiSystem extends BaseModeAiSystem {
    readonly policy;
    constructor(profile: ModeStrategyProfile) {
        super(profile);
        this.policy = {
            id: `squad:${profile.family}`,
            kind: profile.kind,
            family: profile.family,
            ammoSharing: true,
            humanAmmoPriority: true,
            ammoRequestMemoryMs: 18_000,
            ammoShareTravelRange: 50,
            resourceCrowdLimit: 1,
            repeatedRecoveryLimit: 2,
            resourceCommitmentMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.commitment(kind, urgent, 8_500, 11_000),
            resourceProgressTimeoutMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.progress(kind, urgent, 2_500, 3_200),
            formationSlot: (botId: number) => botId % 4,
        };
    }
}
