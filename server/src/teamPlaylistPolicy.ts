import { TeamMode } from "../../shared/gameConfig.ts";
import type { ModeConfig } from "./config.ts";

/** Modes that may be hosted by the invite-code party screen. Faction/50v50
 * uses four-player parties even though the match later joins a large faction. */
export function isTeamModePlaylist(
    mode: Pick<ModeConfig, "teamMode" | "mapName">,
): boolean {
    if (mode.teamMode === TeamMode.Solo) return false;
    if (mode.mapName === "sandevistan" || mode.mapName === "aim_training") return false;
    return true;
}
