import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { BaseModeAiSystem } from "./base.ts";
import type { ResourceCommitmentKind } from "./types.ts";

export class FactionModeAiSystem extends BaseModeAiSystem {
    readonly policy;
    constructor(profile: ModeStrategyProfile) {
        super(profile);
        this.policy = {
            id: `faction:${profile.family}`,
            kind: profile.kind,
            family: profile.family,
            ammoSharing: true,
            humanAmmoPriority: true,
            ammoRequestMemoryMs: 22_000,
            ammoShareTravelRange: 58,
            resourceCrowdLimit: 1,
            repeatedRecoveryLimit: 2,
            resourceCommitmentMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.commitment(kind, urgent, 6_500, 9_000),
            resourceProgressTimeoutMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                this.progress(kind, urgent, 2_100, 2_800),
            formationSlot: (botId: number, teamId: number) => ((botId * 7 + teamId * 3) % 20),
        };
    }
}
