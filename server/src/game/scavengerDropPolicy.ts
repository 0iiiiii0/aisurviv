/**
 * 拾荒者（scavenger/scavenger_adv）在普通搜打撤中的额外掉落触发率：
 * 两者相同 5%。绝密搜打撤与非搜打撤模式保持原始 100% 触发率不变。
 */
export const EXTRACTION_SCAVENGER_DROP_CHANCE = 0.05;

export function scavengerBonusDropChance(
    extractionMode: boolean,
    extractionSecretMode: boolean,
): number {
    if (!extractionMode || extractionSecretMode) return 1;
    return EXTRACTION_SCAVENGER_DROP_CHANCE;
}

export function shouldSpawnScavengerBonus(
    extractionMode: boolean,
    extractionSecretMode: boolean,
    random: () => number = Math.random,
): boolean {
    const chance = scavengerBonusDropChance(extractionMode, extractionSecretMode);
    return chance >= 1 || random() < chance;
}
