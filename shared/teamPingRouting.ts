export type TeamPingWorldRoute = "group" | "faction" | "none";

export function resolveTeamPingWorldRoute(input: {
    factionMode: boolean;
    activeGroupId: number;
    senderGroupId: number;
    activeTeamId: number;
    senderTeamId: number;
}): TeamPingWorldRoute {
    if (input.activeGroupId > 0 && input.activeGroupId === input.senderGroupId) {
        return "group";
    }
    if (
        input.factionMode
        && input.activeTeamId > 0
        && input.activeTeamId === input.senderTeamId
    ) {
        return "faction";
    }
    return "none";
}
