export const AchievementIds = {
    ZombieNuclearHard: "zombie_nuclear_hard",
    DuelDomination: "duel_domination",
} as const;

export type AchievementId = (typeof AchievementIds)[keyof typeof AchievementIds];

export interface AchievementDef {
    id: AchievementId;
    name: string;
    description: string;
    icon: string;
}

export const AchievementDefs: Record<AchievementId, AchievementDef> = {
    [AchievementIds.ZombieNuclearHard]: {
        id: AchievementIds.ZombieNuclearHard,
        name: "核爆",
        description: "在单人困难僵尸模式中完成核爆任务并成功躲入地堡",
        icon: "/img/emotes/surviv.svg",
    },
    [AchievementIds.DuelDomination]: {
        id: AchievementIds.DuelDomination,
        name: "主宰",
        description: "使用默认配装在 1v1 中以 5:0 击败 LEGIT 或 HACKER",
        icon: "/img/achievements/domination.png",
    },
};

export function isAchievementId(value: unknown): value is AchievementId {
    return (
        typeof value === "string"
        && Object.prototype.hasOwnProperty.call(AchievementDefs, value)
    );
}

export function normalizeAchievementIds(value: unknown): AchievementId[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(isAchievementId))];
}
