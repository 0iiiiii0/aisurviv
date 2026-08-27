import type { ModeStrategyProfile } from "../modeStrategy.ts";
import { DuelModeAiSystem } from "./duel.ts";
import { DuoModeAiSystem } from "./duo.ts";
import { EventModeAiSystem } from "./event.ts";
import { FactionModeAiSystem } from "./faction.ts";
import { SoloModeAiSystem } from "./solo.ts";
import { SquadModeAiSystem } from "./squad.ts";
import type { ModeAiSystem } from "./types.ts";

const EVENT_FAMILIES = new Set([
    "desert",
    "woods",
    "savannah",
    "potato",
    "cobalt",
    "turkey",
    "halloween",
    "snow",
    "seasonal",
]);

export function createModeAiSystem(profile: ModeStrategyProfile): ModeAiSystem {
    let base: ModeAiSystem;
    switch (profile.kind) {
        case "duel":
            base = new DuelModeAiSystem(profile);
            break;
        case "duo":
            base = new DuoModeAiSystem(profile);
            break;
        case "squad":
            base = new SquadModeAiSystem(profile);
            break;
        case "faction":
            base = new FactionModeAiSystem(profile);
            break;
        default:
            base = new SoloModeAiSystem(profile);
            break;
    }
    return EVENT_FAMILIES.has(profile.family) ? new EventModeAiSystem(profile, base) : base;
}
export type { ModeAiPolicy, ModeAiSystem, ResourceCommitmentKind } from "./types.ts";
