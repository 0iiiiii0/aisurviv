import { GameObjectDefs } from "../defs/register.ts";
import { GameConfig } from "../gameConfig.ts";

/**
 * 背包容量查询。
 *
 * 搜打撤（普通 + 绝密）模式下，仅**三级包**的弹药携带量翻倍（×2）；
 * 无背包 / 1 级包 / 2 级包保持原容量，其他物品（药品/投掷物/倍镜）与
 * 其他模式均不变。
 *
 * 必须与服务器端实际容量一致：客户端仅用于展示/配装上限提示，
 * 服务器端 stash 发放、局内拾取/装弹都使用同一函数，避免出现
 * "配装能带 2 倍、进局却被截断"或"客户端显示 2 倍、服务端只收 1 倍"的偏差。
 */
export function getBagCapacity(
    type: string,
    backpackLevel: number,
    extractionMode = false,
    sizesOverride?: Record<string, readonly number[]>,
): number {
    const sizes = sizesOverride?.[type]
        ?? GameConfig.bagSizes[type as keyof typeof GameConfig.bagSizes];
    const base = sizes?.[backpackLevel]
        ?? sizes?.[sizes.length - 1]
        ?? 0;
    if (!extractionMode || !sizes) return base;
    const def = GameObjectDefs.typeToDefSafe(type) as { type?: string } | undefined;
    // 库存协议已升级到 12-bit（哨兵 4095），翻倍后的三级包容量（最大 840）
    // 远低于协议上限，无需再截断。
    return def?.type === "ammo" && backpackLevel >= 3 ? base * 2 : base;
}
