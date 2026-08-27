import type { ModeStrategyProfile } from "../modeStrategy.ts";
import type { ModeAiPolicy, ModeAiSystem, ResourceCommitmentKind } from "./types.ts";

export class EventModeAiSystem implements ModeAiSystem {
    readonly policy: ModeAiPolicy;
    constructor(readonly profile: ModeStrategyProfile, base: ModeAiSystem) {
        const lootFactor = profile.potatoMode ? 1.25 : profile.family === "woods" ? 0.9 : 1;
        const crateFactor = profile.potatoMode ? 1.35 : profile.family === "halloween" || profile.turkeyMode ? 1.15 : 1;
        this.policy = {
            ...base.policy,
            id: `${base.policy.kind}:event:${profile.family}`,
            resourceCommitmentMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                Math.round(
                    base.policy.resourceCommitmentMs(kind, urgent) * (kind === "loot" ? lootFactor : crateFactor),
                ),
            resourceProgressTimeoutMs: (kind: ResourceCommitmentKind, urgent: boolean) =>
                Math.round(base.policy.resourceProgressTimeoutMs(kind, urgent) * (profile.potatoMode ? 1.15 : 1)),
        };
    }
}
