/**
 * 僵尸模式（Zombie Mode）共享常量：服务端与客户端共用。
 *
 * 流程：
 * - 玩家进入后开始刷新大批量僵尸（初始 40 个），全部僵尸知道玩家位置并赶过去；
 * - 僵尸只拿随机近战武器、绿色皮肤、不搜刮不用枪，直线追逐玩家；
 * - 玩家每被僵尸攻击一次获得一个 trick_drain（持续掉血），上限 4 个；
 * - 自爆变种按难度/波次刷新；简单难度强制 0%，不会出现自爆僵尸；
 *   自爆僵尸携带 final_bugle + martyrdom，接近玩家后以 1.5 倍速度突进，贴脸直接自爆；
 * - 每 2 分钟补充 20 个僵尸；玩家撑到 6 分钟即获胜。
 */

/** 开局初始僵尸数量。 */
export const ZOMBIE_INITIAL_COUNT = 40;
/** 每次补充的僵尸数量。 */
export const ZOMBIE_REPLENISH_COUNT = 20;
/** 补充间隔（秒）。 */
export const ZOMBIE_REPLENISH_INTERVAL_SEC = 120;
/** 胜利所需坚持时长（秒）。 */
export const ZOMBIE_WIN_TIME_SEC = 360;
/** 自爆变种僵尸概率。 */
export const ZOMBIE_SELF_DESTRUCT_CHANCE = 0.05;
/** 自爆僵尸进入突进态的距离（距玩家）。 */
export const ZOMBIE_RUSH_RANGE = 16;
/** 自爆僵尸进入 committed rush 后的移动速度倍率。 */
export const ZOMBIE_RUSH_SPEED_MULT = 1.5;
/** 僵尸近战攻击距离。 */
export const ZOMBIE_ATTACK_RANGE = 2.4;
/** 僵尸近战攻击冷却（ms）。 */
export const ZOMBIE_ATTACK_COOLDOWN_MS = 900;
/** 僵尸近战单次伤害。 */
export const ZOMBIE_ATTACK_DAMAGE = 12;
/** 玩家 trick_drain 叠加上限。 */
export const ZOMBIE_TRICK_DRAIN_MAX = 4;

/** 僵尸模式难度预设：简单 / 普通 / 困难。 */
export const ZOMBIE_DIFFICULTY_PRESETS: Record<
    "simple" | "normal" | "hard",
    {
        initialCount: number;
        replenishCount: number;
        speedMult: number;
        selfDestructChance: number;
    }
> = {
    simple: {
        initialCount: 30,
        replenishCount: 15,
        speedMult: 0.6,
        selfDestructChance: 0,
    },
    normal: {
        initialCount: 40,
        replenishCount: 20,
        speedMult: 0.7,
        selfDestructChance: 0.05,
    },
    hard: {
        initialCount: 50,
        replenishCount: 25,
        speedMult: 0.9,
        selfDestructChance: 0.08,
    },
};

/** 僵尸房间难度的统一中文显示名。 */
export const ZOMBIE_DIFFICULTY_LABELS = {
    simple: "简单",
    normal: "普通",
    hard: "困难",
} as const;

export type ZombieDifficulty = keyof typeof ZOMBIE_DIFFICULTY_LABELS;

/** 非法/缺失难度统一按普通处理，保证房间名与匹配回退规则一致。 */
export function normalizeZombieDifficulty(value: unknown): ZombieDifficulty {
    return value === "simple" || value === "hard" ? value : "normal";
}

/** 活跃僵尸房间显示名：例如“【简单】僵尸模式 四人”。 */
export function formatZombieRoomDisplayName(
    baseName: string,
    difficulty: unknown,
): string {
    const normalized = normalizeZombieDifficulty(difficulty);
    return `【${ZOMBIE_DIFFICULTY_LABELS[normalized]}】${baseName}`;
}

/**
 * 标准（普通）僵尸模式波次表：
 * - 第一波：开局 40 个，无自爆僵尸；
 * - 2 分钟：补充 30 个，10% 自爆；
 * - 4 分钟：补充 40 个，20% 自爆；
 * - 6 分钟：幸存获胜。
 */
export const ZOMBIE_NORMAL_WAVES: ReadonlyArray<{
    atSec: number;
    count: number;
    selfDestructChance: number;
}> = [
    { atSec: 0, count: 40, selfDestructChance: 0 },
    { atSec: 120, count: 30, selfDestructChance: 0.1 },
    { atSec: 240, count: 40, selfDestructChance: 0.2 },
];
/** 临时测试：冻结追击速度；恢复值为 0.92。 */
export const ZOMBIE_CHASE_SPEED_MULT = 0;
/** 临时测试：冻结兼容路径速度；恢复值为 0.7。 */
export const ZOMBIE_SPEED_MULT = 0;

/** Nuclear objective tuning shared by the server and the HUD. */
export const ZOMBIE_MISSION_ELEMENT_COUNT = 3;
/** 三种核爆任务元素的固定名称，索引与任务消息中的元素索引一致。 */
export const ZOMBIE_MISSION_ELEMENT_NAMES = ["铀", "钚", "氚"] as const;
export const ZOMBIE_MISSION_INTERACT_RADIUS = 3.5;
export const ZOMBIE_MISSION_CARRY_SPEED_MULT = 0.85;
/** 元素全部放置后，无条件触发核爆的倒计时。 */
export const ZOMBIE_MISSION_DETONATION_COUNTDOWN_SEC = 45;
