export const DuelMapNames = ["duel", "duel_ai"] as const;
export type DuelMapName = (typeof DuelMapNames)[number];

export function isDuelMapName(value: string): value is DuelMapName {
    return value === "duel" || value === "duel_ai";
}
