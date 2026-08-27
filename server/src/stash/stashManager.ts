import fs from "node:fs";
import path from "node:path";
import { type AchievementId, isAchievementId, normalizeAchievementIds } from "../../../shared/defs/achievementDefs.ts";
import { PERK_BRING_IN_MAX, perkCarryOutCap } from "../../../shared/defs/extractionDefs.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";
import { baseGunOf, dualGunOf } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import { getBagCapacity } from "../../../shared/utils/bagCapacity.ts";
import { getServerDataFilePath, migrateServerDataFile, PersistenceError } from "../config.ts";

/** CPU 友好的同步等待：挂起线程让出 CPU，避免忙等占满一个核心。 */
function sleepSync(ms: number): void {
    if (typeof Atomics !== "undefined" && typeof SharedArrayBuffer !== "undefined") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } else {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            // fallback
        }
    }
}

/**
 * 搜打撤 player stash: guns / ammo / consumables / armor are stored in
 * separate categories and the same type always stacks. The stash is persisted
 * to survivio-stash.json next to the server config and keyed by player name.
 */

export type StashCategory =
    | "guns"
    | "melee"
    | "ammo"
    | "consumables"
    | "helmets"
    | "chests"
    | "backpacks"
    | "scopes"
    | "throwables"
    | "perks";

export interface StashData {
    guns: Record<string, number>;
    melee: Record<string, number>;
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    helmets: Record<string, number>;
    chests: Record<string, number>;
    backpacks: Record<string, number>;
    scopes: Record<string, number>;
    throwables: Record<string, number>;
    perks: Record<string, number>;
}

export interface BringInLoadout {
    guns: string[];
    melee?: string;
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    throwables?: Record<string, number>;
    /** 携带的能力（perk）类型列表，去重，每类最多 1 个。 */
    perks?: string[];
    /** 从一次性能力库存中手动选中的带入项，与 perks 合计最多 4 个。 */
    oneTimePerks?: string[];
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
}

export interface PlayerStash {
    items: StashData;
    loadout: BringInLoadout;
    /** 经济系统货币（商店购买/出售）。 */
    coins: number;
    /** 一次性能力的独立仓库库存；只有 loadout 手动选中的项目才会在进局时消耗。 */
    oneTimePerks?: string[];
    /** 已永久解锁的成就。未知/废弃 ID 会在读取时自动忽略。 */
    achievements?: AchievementId[];
}

interface StashFile {
    players: Record<string, PlayerStash>;
    /** 崩溃恢复：进局已扣仓但对局尚未结算（死亡/撤离/断线）的配装清单。 */
    pendingGrants?: Record<string, PendingGrant>;
    /** 搜打撤失败后可由玩家提交、管理员审批的带入装备返还申请。 */
    returnRequests?: Record<string, EquipmentReturnRequest>;
}

/** 进局发放时从仓库扣掉的装备快照，用于服务器崩溃后自动归还。 */
export interface PendingGrant {
    grantedAt: number;
    guns: Record<string, number>;
    melee?: string;
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    throwables: Record<string, number>;
    perks?: string[];
    /** 已从一次性库存扣除的项目；崩溃恢复时归还到独立库存。 */
    oneTimePerks?: string[];
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
}

export interface GrantedLoadout {
    weapons: Array<{ type: string; ammo?: number }>;
    melee?: string;
    backpack?: string;
    helmet?: string;
    chest?: string;
    scope?: string;
    inventory?: Record<string, number>;
    /** 进局直接发放的能力（perk）类型。 */
    perks?: string[];
    /** 一次性技能（仅限一局）：进局生效、不参与带出槽位、撤离/死亡不带回。 */
    oneTimePerks?: string[];
    /** 进局时锁定的能力带出槽位数（由带入能力数决定，局内丢弃不增减）。 */
    perkCarryOutCap?: number;
}

export type EquipmentReturnRequestStatus =
    | "eligible"
    | "pending"
    | "approved"
    | "rejected"
    | "auto-refunded";

export interface EquipmentReturnRequest {
    id: string;
    playerName: string;
    matchId: string;
    mapName: string;
    status: EquipmentReturnRequestStatus;
    reason: string;
    createdAt: number;
    submittedAt?: number;
    reviewedAt?: number;
    /** 后台审批时给玩家的可选留言。旧记录没有该字段时保持兼容。 */
    adminNote?: string;
    /** 玩家已在主界面看到“装备已返还”提示的时间；未设置表示仍需提示。 */
    notifiedAt?: number;
    /** 原始带入快照只用于审批返还，不包含玩家在局内拾取的战利品。 */
    grant: PendingGrant;
    /** 已由同队玩家成功带出的原带入装备；审批时这些项目不会再次返还。 */
    teammateCarriedItems?: Record<string, number>;
    /** 实际带出上述装备的队友账号，供后台审计。 */
    teammateCarriers?: string[];
}

export interface EquipmentReturnNotification {
    id: string;
    matchId: string;
    mapName: string;
    status: "approved" | "auto-refunded";
    returnedAt: number;
    /** 后台批准返还时留下的可选留言。 */
    adminNote?: string;
}

export function stashCategoryFor(type: string): StashCategory | null {
    const def = GameObjectDefs[type];
    if (!def) return null;
    switch (def.type) {
        case "gun":
            return "guns";
        case "melee":
            return "melee";
        case "ammo":
            return "ammo";
        case "heal":
        case "boost":
            return "consumables";
        case "helmet":
            return "helmets";
        case "chest":
            return "chests";
        case "backpack":
            return "backpacks";
        case "scope":
            return "scopes";
        case "throwable":
            return "throwables";
        case "perk":
            return "perks";
        default:
            return null;
    }
}

/**
 * 仓库完整物品目录（后台用）：遍历全部 GameObjectDefs，按仓库类别分组，
 * 并附带局内 loot 图片。确保后台仓库调整能看到全部物品（含所有能力，
 * 如 lifeline/Indomitable 等），不再依赖客户端写死的残缺列表。
 */
export function getStashCatalog(): Array<{
    category: StashCategory;
    items: Array<{ type: string; image: string }>;
}> {
    const byCategory = new Map<StashCategory, Array<{ type: string; image: string }>>();
    for (const [type, def] of Object.entries(GameObjectDefs)) {
        const category = stashCategoryFor(type);
        if (!category) continue;
        const lootImg = (def as { lootImg?: { sprite?: string } }).lootImg;
        let image = lootImg?.sprite
            ? `/img/loot/${lootImg.sprite.replace(/\.img$/, ".svg")}`
            : "";
        if (!image && category === "ammo") {
            image = `/img/emotes/ammo-${type}.svg`;
        }
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category)!.push({ type, image });
    }
    for (const items of byCategory.values()) {
        items.sort((a, b) => a.type.localeCompare(b.type));
    }
    return [...byCategory.entries()].map(([category, items]) => ({
        category,
        items,
    }));
}

/**
 * 正式版新手包（仅在首次创建玩家仓库时发放）：
 * - ak47 ×2，762mm 弹药 200 发
 * - 2 倍镜 ×2
 * - 1 级护甲两套（头盔 / 胸甲 / 背包 各 ×2）
 * - 医疗用品：绷带 10 / 医疗包 2 / 汽水 4
 * 默认装备（fists 拳头、1xscope 默认派发倍镜）不进仓库。
 */
let starterItemsCache: StashData | null = null;
export function buildStarterItems(): StashData {
    return {
        guns: { ak47: 2 },
        melee: {},
        ammo: { "762mm": 200 },
        consumables: { bandage: 10, healthkit: 2, soda: 4 },
        helmets: { helmet01: 2 },
        chests: { chest01: 2 },
        backpacks: { backpack01: 2 },
        scopes: { "2xscope": 2 },
        throwables: {},
        perks: {},
    };
}

function getStarterItems(): StashData {
    starterItemsCache ??= buildStarterItems();
    return starterItemsCache;
}

/** 仓库弹药存储上限：仓库是独立存储（服务端 JSON），不受局内协议
 *  9-bit/510 限制；进局发放时仍按背包容量和协议上限截断，
 *  因此提升仓库上限不影响其他模式的网络协议。 */
const STASH_AMMO_CAP = 99999;
/** 仓库医疗用品（药品/增益）存储上限。 */
const STASH_MEDICAL_CAP = 999;

export function stackCap(type: string): number {
    const def = GameObjectDefs[type];
    if (!def) return 99;
    // 弹药：仓库上限 99999；药品/增益：999（独立存储，进局携带仍受背包限制）。
    if (def.type === "ammo") {
        return STASH_AMMO_CAP;
    }
    if (def.type === "heal" || def.type === "boost") {
        return STASH_MEDICAL_CAP;
    }
    // 枪械/护甲/倍镜：99。
    if (
        def.type === "gun"
        || def.type === "helmet"
        || def.type === "chest"
        || def.type === "backpack"
        || def.type === "scope"
    ) {
        return 99;
    }
    // 近战/投掷物等：510（仍按局内协议上限）。
    return 510;
}

export class StashManager {
    private readonly filePath: string;
    private readonly lockPath: string;
    private data: StashFile;
    /** 进程内锁标志：嵌套调用（grant→remove 等）不重复加锁/重载。 */
    private locked = false;
    /** 数据文件损坏且无有效备份时进入只读维护：拒绝写操作，避免清空玩家数据。 */
    private corrupt = false;
    /** 上次持久化失败：下次任何写操作自动重试。 */
    private persistFailed = false;

    constructor(fileName = "survivio-stash.json") {
        // 玩家仓库数据放在独立数据目录（server-data/），全量更新项目
        // 根目录时不会把玩家数据一起覆盖/删除；旧位置文件自动迁移。
        migrateServerDataFile(fileName);
        this.filePath = getServerDataFilePath(fileName);
        this.lockPath = `${this.filePath}.lock`;
        this.data = this.load();
    }

    private load(): StashFile {
        if (fs.existsSync(this.filePath)) {
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
            } catch {
                parsed = null;
            }
            if (parsed && typeof parsed === "object" && (parsed as StashFile).players) {
                this.corrupt = false;
                return parsed as StashFile;
            }
            // JSON 损坏或结构非法：不再自动回退空仓库（避免后续写操作清空玩家数据）。
            if (!this.corrupt) {
                this.corrupt = true;
                const corruptCopy = `${this.filePath}.corrupt-${Date.now()}`;
                try {
                    fs.copyFileSync(this.filePath, corruptCopy);
                } catch {
                    // ignore
                }
                // 尝试用最近的 .bak 恢复（不再把损坏文件覆盖成 .bak）。
                const bak = `${this.filePath}.bak`;
                if (fs.existsSync(bak)) {
                    try {
                        const bakParsed = JSON.parse(fs.readFileSync(bak, "utf8"));
                        if (
                            bakParsed
                            && typeof bakParsed === "object"
                            && (bakParsed as StashFile).players
                        ) {
                            this.corrupt = false;
                            console.warn(
                                `[stash] ${this.filePath} 损坏，已保存损坏副本 ${corruptCopy} 并从备份恢复。`,
                            );
                            return bakParsed as StashFile;
                        }
                    } catch {
                        // 备份也无效
                    }
                }
                console.error(
                    `[stash] ${this.filePath} 损坏且无有效备份，进入只读维护（损坏副本 ${corruptCopy}）。`
                        + "写操作将被拒绝，请人工恢复数据文件。",
                );
            }
            return { players: {} };
        }
        this.corrupt = false;
        return { players: {} };
    }

    /**
     * 原子持久化：唯一临时文件（pid+时间戳）避免多进程 .tmp 竞争，
     * rename 保证要么完整写入要么不写；失败保留标志，下次操作自动重试。
     */
    private persistNow(): void {
        if (this.corrupt) {
            throw new PersistenceError(
                `[stash] 仓库只读维护中，拒绝写入：${this.filePath}`,
            );
        }
        const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            // 紧凑 JSON（无缩进）减小文件体积约 40%，显著缩短多进程锁竞争
            // 时的持锁写盘时间（原缩进格式在玩家多时每次写 100ms+）。
            fs.writeFileSync(tmp, JSON.stringify(this.data), "utf8");
            fs.renameSync(tmp, this.filePath);
            this.persistFailed = false;
        } catch (error) {
            this.persistFailed = true;
            try {
                fs.rmSync(tmp, { force: true });
            } catch {
                // ignore
            }
            console.error("[stash] failed to persist stash:", error);
            throw new PersistenceError(
                `[stash] 数据保存失败：${this.filePath}（${error instanceof Error ? error.message : String(error)}）`,
            );
        }
    }

    /**
     * 跨进程互斥锁：原子 mkdir 锁目录；锁拥有者 PID 已死（崩溃残留）立即接管，
     * 存活锁则 CPU 友好等待。总上限 20s（写操作本身 <100ms，5s 超时在多房间 +
     * AI 补员并发写仓库时仍会撞上排队窗口导致进程 fault 炸房；20s 大幅降低
     * 超时概率，同时超时前输出诊断信息便于定位卡死的持锁进程）。
     */
    private acquireLock(): void {
        const deadline = Date.now() + 20000;
        let waited = 0;
        while (Date.now() < deadline) {
            try {
                fs.mkdirSync(this.lockPath);
                fs.writeFileSync(
                    path.join(this.lockPath, "owner"),
                    `${process.pid} ${Date.now()}`,
                    "utf8",
                );
                return;
            } catch {
                // 锁被占用：先判断锁拥有者进程是否已崩溃（残留锁），已死立即接管。
                // 修复旧逻辑“重试窗口(2s) < stale 阈值(5s)”导致残留锁永远清不掉、
                // 每次访问仓库都重试满 2s 后抛异常炸服的问题。
                if (this.tryReclaimDeadLock()) continue;
                // 真实并发（其它进程正在写入）：CPU 友好等待后重试。
                waited += 10;
                if (waited % 1000 === 0) {
                    console.warn(
                        `[stash] 等待仓库锁 ${(waited / 1000).toFixed(0)}s：${this.filePath}`,
                    );
                    try {
                        const ownerRaw = fs.readFileSync(
                            path.join(this.lockPath, "owner"),
                            "utf8",
                        );
                        const st = fs.statSync(this.lockPath);
                        console.warn(
                            `[stash] 锁持有者=${ownerRaw.trim() || "未知"} 锁目录年龄=${
                                (
                                    (Date.now() - st.mtimeMs)
                                    / 1000
                                ).toFixed(1)
                            }s`,
                        );
                    } catch {
                        // 锁目录刚被释放/接管，忽略。
                    }
                }
                sleepSync(10);
            }
        }
        console.error(
            `[stash] 等待仓库锁超时（20s）：${this.filePath}，放弃本次操作`,
        );
        throw new Error(`[stash] could not acquire lock: ${this.filePath}`);
    }

    /**
     * 锁目录已存在时，判断锁拥有者 PID 是否已死；已死（崩溃残留）则删除并返回 true。
     * 拥有者仍存活（或锁目录刚创建还没来得及写 owner）时不抢占，避免误删正常写入进程。
     */
    private tryReclaimDeadLock(): boolean {
        try {
            const ownerRaw = fs.readFileSync(
                path.join(this.lockPath, "owner"),
                "utf8",
            );
            const pid = Number(ownerRaw.split(/\s+/)[0]);
            if (Number.isInteger(pid) && pid > 0) {
                try {
                    process.kill(pid, 0);
                    // PID 仍存活（可能是同进程另一个写入或正常进程）→ 不能抢占。
                    return false;
                } catch {
                    // PID 不存在 → 崩溃残留，接管。
                }
            } else {
                // owner 文件缺失/非法：锁目录可能是刚创建还没写 owner，短时间不抢占。
                const st = fs.statSync(this.lockPath);
                if (Date.now() - st.mtimeMs < 1000) return false;
            }
            fs.rmSync(this.lockPath, { recursive: true, force: true });
            return true;
        } catch {
            // 锁目录刚被删除（其它进程已接管/释放）→ 下一轮重试即可。
            return true;
        }
    }

    private releaseLock(): void {
        try {
            fs.rmSync(this.lockPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }

    /**
     * 独占执行：加锁 → 可选从磁盘重载最新 → fn → 可选原子持久化 → 解锁。
     * 嵌套调用（grant→remove 等）跳过加锁与重载，避免覆盖外层未落盘修改。
     */
    private withLockSync<T>(
        fn: () => T,
        opts: { reload?: boolean; persist?: boolean } = {
            reload: true,
            persist: true,
        },
    ): T {
        const nested = this.locked;
        if (!nested) {
            this.acquireLock();
            this.locked = true;
        }
        try {
            if (opts.reload && !nested) {
                // 每次操作前读取磁盘最新（多进程下 API 保存的配装立即可见）。
                this.data = this.load();
            }
            const needRollback = opts.persist && !nested;
            const beforeSnapshot = needRollback
                ? JSON.parse(JSON.stringify(this.data))
                : null;
            const result = fn();
            if (needRollback) {
                try {
                    this.persistNow();
                } catch (error) {
                    // 持久化失败：回滚内存到操作前状态，杜绝“内存成功、磁盘失败”。
                    this.data = beforeSnapshot;
                    throw error;
                }
            }
            return result;
        } finally {
            if (!nested) {
                this.locked = false;
                this.releaseLock();
            }
        }
    }

    /** 只读查询：锁内重载最新数据。 */
    private readLatest<T>(fn: () => T): T {
        return this.withLockSync(fn, { reload: true, persist: false });
    }

    /** 写操作：锁内重载 + 原子持久化。 */
    private writeExclusive<T>(fn: () => T): T {
        if (this.corrupt) {
            throw new PersistenceError(
                `[stash] 仓库处于只读维护状态（数据文件损坏），写操作已拒绝：${this.filePath}`,
            );
        }
        return this.withLockSync(fn, { reload: true, persist: true });
    }

    private entry(name: string): PlayerStash {
        const key = String(name ?? "").trim();
        if (!key) throw new PersistenceError("[stash] empty player identity; cannot resolve stash entry");
        let entry = this.data.players[key];
        if (!entry) {
            entry = {
                coins: 0,
                items: {
                    guns: {},
                    melee: {},
                    ammo: {},
                    consumables: {},
                    helmets: {},
                    chests: {},
                    backpacks: {},
                    scopes: {},
                    throwables: {},
                    perks: {},
                },
                loadout: {
                    guns: [],
                    ammo: {},
                    consumables: {},
                    armor: {},
                },
            };
            // 测试阶段新手包：仅在首次创建该玩家的仓库时给予。
            const starter = getStarterItems();
            for (const category of Object.keys(starter) as StashCategory[]) {
                Object.assign(entry.items[category], starter[category]);
            }
            this.data.players[key] = entry;
        }
        // 防御性归一化：旧版数据或从备份恢复的数据可能缺少部分字段，
        // 补全后再进入迁移/读取逻辑，避免后续 Object.entries 崩溃。
        if (typeof entry.coins !== "number" || !Number.isFinite(entry.coins)) {
            entry.coins = 0;
        }
        if (!entry.items || typeof entry.items !== "object") {
            entry.items = {} as StashData;
        }
        for (
            const category of [
                "guns",
                "melee",
                "ammo",
                "consumables",
                "helmets",
                "chests",
                "backpacks",
                "scopes",
                "throwables",
                "perks",
            ] as const
        ) {
            if (
                !entry.items[category]
                || typeof entry.items[category] !== "object"
            ) {
                entry.items[category] = {};
            }
        }
        if (!entry.loadout || typeof entry.loadout !== "object") {
            entry.loadout = {
                guns: [],
                ammo: {},
                consumables: {},
                armor: {},
            };
        }
        if (!Array.isArray(entry.loadout.guns)) entry.loadout.guns = [];
        if (!entry.loadout.ammo || typeof entry.loadout.ammo !== "object") {
            entry.loadout.ammo = {};
        }
        if (
            !entry.loadout.consumables
            || typeof entry.loadout.consumables !== "object"
        ) {
            entry.loadout.consumables = {};
        }
        if (!entry.loadout.armor || typeof entry.loadout.armor !== "object") {
            entry.loadout.armor = {};
        }
        if (!Array.isArray(entry.loadout.oneTimePerks)) {
            entry.loadout.oneTimePerks = [];
        }
        if (entry.oneTimePerks !== undefined && !Array.isArray(entry.oneTimePerks)) {
            delete entry.oneTimePerks;
        }
        entry.achievements = normalizeAchievementIds(entry.achievements);
        return entry;
    }

    /** 原子、幂等地发放永久成就。重复达成不会重复写入。 */
    grantAchievement(
        name: string,
        achievementId: AchievementId,
    ): { ok: boolean; awarded: boolean; achievements: AchievementId[] } {
        if (!isAchievementId(achievementId)) {
            return { ok: false, awarded: false, achievements: [] };
        }
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            const achievements = normalizeAchievementIds(entry.achievements);
            if (achievements.includes(achievementId)) {
                return { ok: true, awarded: false, achievements: [...achievements] };
            }
            achievements.push(achievementId);
            entry.achievements = achievements;
            return { ok: true, awarded: true, achievements: [...achievements] };
        });
    }

    hasAchievement(name: string, achievementId: AchievementId): boolean {
        return this.readLatest(() => {
            const key = String(name ?? "").trim();
            const entry = this.data.players[key];
            return Boolean(
                entry && normalizeAchievementIds(entry.achievements).includes(achievementId),
            );
        });
    }

    getStash(name: string): PlayerStash {
        return this.readLatest(() => {
            const entry = this.entry(name);
            // 迁移旧版双枪条目：双枪折算为两把单枪存放。
            let migrated = false;
            for (const [type, count] of Object.entries(entry.items.guns)) {
                const dualBase = baseGunOf(type);
                if (dualBase) {
                    delete entry.items.guns[type];
                    entry.items.guns[dualBase] = Number(entry.items.guns[dualBase] ?? 0) + count * 2;
                    migrated = true;
                }
            }
            // 迁移旧版配装：按槽位归一化（空槽为空串）。
            // 双枪形态（"_dual"）保留；两个单持槽可放两把同型枪。
            const legacyGuns = Array.isArray(entry.loadout?.guns)
                ? entry.loadout.guns
                : [];
            const normalizedGuns: string[] = [];
            for (let slot = 0; slot < 2; slot++) {
                const rawType = legacyGuns[slot];
                if (!rawType || stashCategoryFor(rawType) !== "guns") continue;
                const dualBase = baseGunOf(rawType);
                if (dualBase) {
                    // 双枪形态：必须是真实存在的双枪。
                    if (dualGunOf(dualBase)) normalizedGuns[slot] = rawType;
                } else {
                    normalizedGuns[slot] = rawType;
                }
            }
            while (normalizedGuns.length < 2) normalizedGuns.push("");
            for (let slot = 0; slot < 2; slot++) {
                if (normalizedGuns[slot] === undefined) normalizedGuns[slot] = "";
            }
            // 同一把可双持武器的两个单持槽 → 合并为 1 号位双持。
            if (
                normalizedGuns[0]
                && normalizedGuns[0] === normalizedGuns[1]
                && !normalizedGuns[0].endsWith("_dual")
                && dualGunOf(normalizedGuns[0])
            ) {
                normalizedGuns[0] = dualGunOf(normalizedGuns[0])!;
                normalizedGuns[1] = "";
            }
            // 清理“幽灵武器”：配装里引用了但仓库中已不存在（数量不足）的枪。
            // 否则绝密入口检查会误判“已带合格武器”，进局却因仓库无枪而空手。
            // 双枪形态按 2 把基准枪计算。
            // 注意：进局已扣、尚未结算的 pending.guns 视为仍可携带（与弹药/
            // 药品/能力一致），否则进局后查看仓库会把配装枪误删。
            const pendingGuns = this.data.pendingGrants?.[name]?.guns ?? {};
            for (let slot = 0; slot < 2; slot++) {
                const t = normalizedGuns[slot];
                if (!t) continue;
                const dualBase = baseGunOf(t);
                const base = dualBase ?? t;
                const need = dualBase ? 2 : 1;
                const owned = Number(entry.items.guns[base] ?? 0)
                    + Number(pendingGuns[base] ?? 0);
                if (!base || owned < need) {
                    normalizedGuns[slot] = "";
                }
            }
            if (
                normalizedGuns.length !== legacyGuns.length
                || normalizedGuns.some((t, i) => t !== legacyGuns[i])
            ) {
                entry.loadout.guns = normalizedGuns;
                migrated = true;
            }
            // 清理"幽灵能力"：配装里引用了但仓库中已不存在、且无待结算配装
            // 覆盖的能力（进局时能力被扣到 0 但 pendingGrant 还在，不能清理）。
            const pendingPerks = new Set(
                this.data.pendingGrants?.[name]?.perks ?? [],
            );
            const legacyPerks = entry.loadout.perks ?? [];
            const cleanedPerks: string[] = [];
            for (const type of legacyPerks) {
                if (GameObjectDefs[type]?.type !== "perk") continue;
                if (cleanedPerks.includes(type)) continue;
                if (cleanedPerks.length >= PERK_BRING_IN_MAX) break;
                if ((entry.items.perks[type] ?? 0) < 1 && !pendingPerks.has(type)) {
                    continue;
                }
                cleanedPerks.push(type);
            }
            if (
                cleanedPerks.length !== legacyPerks.length
                || cleanedPerks.some((type, index) => type !== legacyPerks[index])
            ) {
                entry.loadout.perks = cleanedPerks;
                migrated = true;
            }
            // 一次性能力是独立库存：旧版数据中未手动选中的库存
            // 绝不能自动进入配装。配装项只保留仓库（或待恢复账本）
            // 真实拥有的有效能力，并且与普通能力合计最多 4 个。
            // 库存允许重复项（可购买多个同类型，每局消耗 1 个）。
            const normalizedOneTimeStock = Array.isArray(entry.oneTimePerks)
                ? entry.oneTimePerks.filter(
                    (type) => GameObjectDefs[type]?.type === "perk",
                )
                : [];
            if (
                normalizedOneTimeStock.length !== (entry.oneTimePerks?.length ?? 0)
            ) {
                entry.oneTimePerks = normalizedOneTimeStock;
                migrated = true;
            }
            const pendingOneTime = new Set(
                this.data.pendingGrants?.[name]?.oneTimePerks ?? [],
            );
            const oneTimeOwned = new Set(normalizedOneTimeStock);
            const legacyOneTime = entry.loadout.oneTimePerks ?? [];
            const cleanedOneTime: string[] = [];
            for (const type of legacyOneTime) {
                if (cleanedPerks.includes(type) || cleanedOneTime.includes(type)) continue;
                if (GameObjectDefs[type]?.type !== "perk") continue;
                if (!oneTimeOwned.has(type) && !pendingOneTime.has(type)) continue;
                if (cleanedPerks.length + cleanedOneTime.length >= PERK_BRING_IN_MAX) break;
                cleanedOneTime.push(type);
            }
            if (
                cleanedOneTime.length !== legacyOneTime.length
                || cleanedOneTime.some((type, index) => type !== legacyOneTime[index])
            ) {
                entry.loadout.oneTimePerks = cleanedOneTime;
                migrated = true;
            }
            // 清理"幽灵弹药/药品/投掷物"：配装携带量超过仓库实际库存时钳制到
            // 实际库存（与 setLoadout 保存时的校验一致）。注意 pendingGrant
            // 覆盖的数量（进局已扣、未结算）应视为仍可携带，不能钳制。
            const pending = this.data.pendingGrants?.[name];
            for (const cat of ["ammo", "consumables", "throwables"] as const) {
                const carried = entry.loadout[cat] ?? {};
                let changed = false;
                for (const [type, count] of Object.entries(carried)) {
                    const stock = Number(entry.items[cat][type] ?? 0)
                        + Number(pending?.[cat]?.[type] ?? 0);
                    const clamped = Math.min(
                        Math.max(0, Math.floor(Number(count) || 0)),
                        Math.max(0, stock),
                    );
                    if (clamped !== Number(count)) {
                        if (clamped > 0) carried[type] = clamped;
                        else delete carried[type];
                        changed = true;
                    }
                }
                if (changed) {
                    entry.loadout[cat] = carried;
                    migrated = true;
                }
            }
            // 清理"幽灵装备"：配装引用了但仓库中已不存在的近战/护甲。
            if (
                entry.loadout.melee
                && (entry.items.melee[entry.loadout.melee] ?? 0) < 1
            ) {
                delete entry.loadout.melee;
                migrated = true;
            }
            for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
                const type = entry.loadout.armor?.[key];
                if (!type) continue;
                const stock = key === "scope"
                    ? Number(entry.items.scopes[type] ?? 0)
                    : key === "helmet"
                    ? Number(entry.items.helmets[type] ?? 0)
                    : key === "chest"
                    ? Number(entry.items.chests[type] ?? 0)
                    : Number(entry.items.backpacks[type] ?? 0);
                if (stock < 1) {
                    delete entry.loadout.armor[key];
                    migrated = true;
                }
            }
            // 迁移旧版 armor 字段（头盔/胸甲/背包混存）到独立类别。
            const legacy = (entry.items as unknown as {
                armor?: Record<string, number>;
            }).armor;
            if (legacy && Object.keys(legacy).length > 0) {
                migrated = true;
                for (const [type, count] of Object.entries(legacy)) {
                    const category = stashCategoryFor(type);
                    if (
                        category === "helmets"
                        || category === "chests"
                        || category === "backpacks"
                    ) {
                        entry.items[category][type] = Math.max(
                            Number(entry.items[category][type] ?? 0),
                            count,
                        );
                    }
                }
                delete (entry.items as unknown as { armor?: unknown }).armor;
            }
            if (migrated) this.persistNow();
            return entry;
        });
    }

    addItem(name: string, type: string, count = 1): { ok: boolean; reason?: string } {
        // 双枪与单枪同一物品：双枪按两把单枪折算存放。
        const dualBase = baseGunOf(type);
        if (dualBase) return this.addItem(name, dualBase, count * 2);
        return this.writeExclusive(() => {
            const category = stashCategoryFor(type);
            if (!category) return { ok: false, reason: "invalid-item" };
            const amount = Math.max(1, Math.floor(count));
            const entry = this.entry(name);
            const slot = entry.items[category];
            const cap = stackCap(type);
            const current = Number(slot[type] ?? 0);
            // 不减少已存在的超限库存（如新手包 600），仅限制新增。
            slot[type] = Math.max(current, Math.min(cap, current + amount));
            return { ok: true };
        });
    }

    /** 后台批量：给全体已有玩家仓库添加同一物品。返回实际更新到的玩家数。 */
    addItemToAll(type: string, count = 1): { ok: boolean; reason?: string; updatedCount: number } {
        const dualBase = baseGunOf(type);
        if (dualBase) return this.addItemToAll(dualBase, count * 2);
        const category = stashCategoryFor(type);
        if (!category) return { ok: false, reason: "invalid-item", updatedCount: 0 };
        const amount = Math.max(1, Math.floor(count));
        return this.writeExclusive(() => {
            const cap = stackCap(type);
            let updatedCount = 0;
            for (const [name, entry] of Object.entries(this.data.players)) {
                const slot = entry.items[category];
                const current = Number(slot[type] ?? 0);
                // 不减少已存在的超限库存，仅限制新增（与 addItem 一致）。
                const next = Math.max(current, Math.min(cap, current + amount));
                if (next !== current) {
                    slot[type] = next;
                    updatedCount += 1;
                }
            }
            // 持久化由外层 writeExclusive() 统一完成一次；这里不能再主动
            // persistNow()，否则同一次全体发放会写磁盘两次——若第一次成功、
            // 第二次失败，接口会误报“发放失败”而磁盘已生效，管理员重试会
            // 造成重复补偿。
            return { ok: true, updatedCount };
        });
    }

    removeItem(name: string, type: string, count = 1): { ok: boolean; reason?: string } {
        const dualBase = baseGunOf(type);
        if (dualBase) return this.removeItem(name, dualBase, count * 2);
        return this.writeExclusive(() => {
            const category = stashCategoryFor(type);
            if (!category) return { ok: false, reason: "invalid-item" };
            const amount = Math.max(1, Math.floor(count));
            const entry = this.entry(name);
            const slot = entry.items[category];
            const current = Number(slot[type] ?? 0);
            if (current < amount) return { ok: false, reason: "not-enough" };
            const next = current - amount;
            if (next <= 0) delete slot[type];
            else slot[type] = next;
            return { ok: true };
        });
    }

    /** 后台：删除某玩家的整个仓库条目（用于删除账号时同步清理）。
     *  同时清理该玩家的待结算配装记录，否则残留的 pendingGrants
     *  会让同名新账号无法重新购买同名一次性能力（already-owned）。 */
    removePlayer(name: string): { ok: boolean; reason?: string } {
        return this.writeExclusive(() => {
            const key = String(name ?? "").trim() || "anonymous";
            let removed = false;
            if (this.data.players[key]) {
                delete this.data.players[key];
                removed = true;
            }
            if (this.data.pendingGrants?.[key]) {
                delete this.data.pendingGrants[key];
                removed = true;
            }
            for (
                const [id, request] of Object.entries(
                    this.data.returnRequests ?? {},
                )
            ) {
                if (request.playerName !== key) continue;
                delete this.data.returnRequests?.[id];
                removed = true;
            }
            return removed ? { ok: true } : { ok: false, reason: "not-found" };
        });
    }

    /** 一次性能力的完整“已拥有”集合：仓库现存 + 已扣仓但
     *  对局尚未结算的待恢复项。商店目录必须使用此口径。 */
    ownedOneTimePerks(name: string): string[] {
        return this.readLatest(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            const owned = new Set<string>();
            for (
                const type of [
                    ...(entry.oneTimePerks ?? []),
                    ...(this.data.pendingGrants?.[key]?.oneTimePerks ?? []),
                ]
            ) {
                if (GameObjectDefs[type]?.type === "perk") owned.add(type);
            }
            return [...owned];
        });
    }

    /** 一次性能力在仓库中的数量（允许购买多个同类型：每局消耗 1 个）。 */
    oneTimePerkStock(name: string, type: string): number {
        return this.readLatest(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            return (entry.oneTimePerks ?? []).filter((p) => p === type).length;
        });
    }

    /** 一次性能力的完整持有数量：仓库现存 + 已扣仓但尚未结算的待恢复项。 */
    oneTimePerkOwnedCount(name: string, type: string): number {
        return this.readLatest(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            return [
                ...(entry.oneTimePerks ?? []),
                ...(this.data.pendingGrants?.[key]?.oneTimePerks ?? []),
            ].filter((perkType) => perkType === type).length;
        });
    }

    /** 商店目录使用的完整一次性能力数量快照，只重载一次仓库数据。 */
    oneTimePerkOwnedCounts(name: string): Record<string, number> {
        return this.readLatest(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            const counts: Record<string, number> = {};
            for (
                const type of [
                    ...(entry.oneTimePerks ?? []),
                    ...(this.data.pendingGrants?.[key]?.oneTimePerks ?? []),
                ]
            ) {
                if (GameObjectDefs[type]?.type !== "perk") continue;
                counts[type] = (counts[type] ?? 0) + 1;
            }
            return counts;
        });
    }

    /** 购买一次性能力：原子扣金币 + 写入独立仓库库存，不自动改动配装。
     *  允许购买多个同类型（进局每次消耗 1 个）。返回 { ok, coins, oneTimePerks }；
     *  价格 <= 0 表示不扣钱（测试/后台）。 */
    buyOneTimePerk(
        name: string,
        type: string,
        price = 3000,
    ): { ok: boolean; reason?: string; coins?: number; oneTimePerks?: string[] } {
        return this.writeExclusive(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            const list = Array.isArray(entry.oneTimePerks)
                ? [...entry.oneTimePerks]
                : [];
            const coins = Math.max(0, Math.floor(Number(entry.coins) || 0));
            if (coins < price) {
                return { ok: false, reason: "insufficient-coins" };
            }
            entry.coins = coins - price;
            list.push(type);
            entry.oneTimePerks = list;
            return { ok: true, coins: entry.coins, oneTimePerks: list };
        });
    }

    /**
     * 永久技能合成：在同一个仓库写事务中扣除两份永久技能材料，
     * 再加入一份永久技能产物。一次性技能库存绝不参与此事务。
     *
     * 配装中尚未进局扣仓的永久技能要预留一份；若该技能已进入
     * pendingGrant，说明配装中的那一份已经从库存扣除，不应再次预留。
     */
    fusePermanentPerks(
        name: string,
        materials: readonly [string, string],
        resultPool: readonly string[],
        randomIndex: (length: number) => number,
    ): {
        ok: boolean;
        reason?: string;
        perks?: Record<string, number>;
        resultType?: string;
    } {
        return this.writeExclusive(() => {
            const key = String(name ?? "").trim();
            const entry = this.entry(key);
            const perks = { ...entry.items.perks };
            const required: Record<string, number> = {};
            for (const type of materials) {
                if (stashCategoryFor(type) !== "perks") {
                    return { ok: false, reason: "invalid-materials" };
                }
                required[type] = (required[type] ?? 0) + 1;
            }
            const pendingPerks = new Set(
                this.data.pendingGrants?.[key]?.perks ?? [],
            );
            for (const [type, count] of Object.entries(required)) {
                const owned = Math.max(0, Math.floor(Number(perks[type]) || 0));
                const reserved = (entry.loadout.perks ?? []).includes(type)
                        && !pendingPerks.has(type)
                    ? 1
                    : 0;
                const available = owned - reserved;
                if (available < count) {
                    return {
                        ok: false,
                        reason: reserved > 0 && owned >= count
                            ? "equipped"
                            : "not-enough",
                    };
                }
            }

            // 在同一仓库锁快照内筛掉无法入库的产物并完成随机抽取。这样玩家
            // 不能靠把某些技能堆满、反复提交失败请求来操纵实际随机分布。
            const eligibleResults = [...new Set(resultPool)].filter((type) => {
                if (stashCategoryFor(type) !== "perks") return false;
                const afterMaterials = Math.max(0, Math.floor(Number(perks[type]) || 0))
                    - (required[type] ?? 0);
                return afterMaterials + 1 <= stackCap(type);
            });
            if (eligibleResults.length === 0) {
                return { ok: false, reason: "stack-full" };
            }
            const picked = Math.floor(Number(randomIndex(eligibleResults.length)) || 0);
            if (picked < 0 || picked >= eligibleResults.length) {
                return { ok: false, reason: "invalid-random-index" };
            }
            const resultType = eligibleResults[picked];

            for (const [type, count] of Object.entries(required)) {
                const next = Math.max(0, Math.floor(Number(perks[type]) || 0)) - count;
                if (next <= 0) delete perks[type];
                else perks[type] = next;
            }
            perks[resultType] = Math.max(0, Math.floor(Number(perks[resultType]) || 0)) + 1;
            entry.items.perks = perks;
            return { ok: true, perks: { ...perks }, resultType };
        });
    }

    /** 后台管理：直接把某物品数量设为指定值（0 表示移除）。 */
    setItem(name: string, type: string, count: number): { ok: boolean; reason?: string } {
        const dualBase = baseGunOf(type);
        if (dualBase) return this.setItem(name, dualBase, count * 2);
        return this.writeExclusive(() => {
            const category = stashCategoryFor(type);
            if (!category) return { ok: false, reason: "invalid-item" };
            const amount = Math.max(0, Math.floor(Number(count) || 0));
            const entry = this.entry(name);
            const slot = entry.items[category];
            if (amount <= 0) delete slot[type];
            else slot[type] = Math.min(stackCap(type), amount);
            return { ok: true };
        });
    }

    /** 当前金币余额。 */
    getCoins(name: string): number {
        return this.readLatest(() => this.entry(name).coins);
    }

    /** 直接设置金币（后台用）；返回设置后的余额。 */
    setCoins(name: string, coins: number): { ok: boolean; reason?: string; coins: number } {
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            const next = Math.max(0, Math.floor(Number(coins) || 0));
            entry.coins = next;
            return { ok: true, coins: next };
        });
    }

    /** 增加金币；返回新余额。 */
    addCoins(name: string, coins: number): number {
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            entry.coins = Math.max(0, entry.coins + Math.max(0, Math.floor(Number(coins) || 0)));
            return entry.coins;
        });
    }

    /** 扣除金币；余额不足返回 false。 */
    removeCoins(name: string, coins: number): boolean {
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            const amount = Math.max(0, Math.floor(Number(coins) || 0));
            if (entry.coins < amount) return false;
            entry.coins -= amount;
            return true;
        });
    }

    /**
     * 原子交易：在单次加锁写事务内执行 扣仓 / 加仓 / 金币变动。
     * 任一步校验失败（无货 / 超上限 / 金币不足）则整体不生效，
     * 避免商店买卖拆成多次写导致进程崩溃时"扣了仓没给钱"等不一致。
     * coinsDelta：正数 = 加金币，负数 = 扣金币。
     */
    atomicTrade(
        name: string,
        ops: {
            remove?: Array<{ type: string; count: number }>;
            add?: Array<{ type: string; count: number }>;
            coinsDelta?: number;
        },
    ): { ok: boolean; reason?: string; coins: number } {
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            const resolve = (op: { type: string; count: number }) => {
                const base = baseGunOf(op.type);
                const realType = base ?? op.type;
                const category = stashCategoryFor(realType);
                const amount = Math.max(1, Math.floor(Number(op.count) || 0)) * (base ? 2 : 1);
                return { realType, category, amount };
            };
            const removes = (ops.remove ?? []).map(resolve);
            for (const op of removes) {
                if (!op.category) {
                    return { ok: false, reason: "invalid-item", coins: entry.coins };
                }
                if (Number(entry.items[op.category]?.[op.realType] ?? 0) < op.amount) {
                    return { ok: false, reason: "not-enough", coins: entry.coins };
                }
            }
            const adds = (ops.add ?? []).map(resolve);
            for (const op of adds) {
                if (!op.category) {
                    return { ok: false, reason: "invalid-item", coins: entry.coins };
                }
                const current = Number(entry.items[op.category]?.[op.realType] ?? 0);
                if (current + op.amount > stackCap(op.realType)) {
                    return { ok: false, reason: "stack-full", coins: entry.coins };
                }
            }
            const delta = Math.floor(Number(ops.coinsDelta) || 0);
            if (delta < 0 && entry.coins < -delta) {
                return { ok: false, reason: "not-enough-coins", coins: entry.coins };
            }
            for (const op of removes) {
                const category = op.category!;
                const next = Number(entry.items[category]?.[op.realType] ?? 0) - op.amount;
                if (next <= 0) delete entry.items[category][op.realType];
                else entry.items[category][op.realType] = next;
            }
            for (const op of adds) {
                const category = op.category!;
                const current = Number(entry.items[category]?.[op.realType] ?? 0);
                entry.items[category][op.realType] = Math.min(
                    stackCap(op.realType),
                    current + op.amount,
                );
            }
            entry.coins = Math.max(0, entry.coins + delta);
            return { ok: true, coins: entry.coins };
        });
    }

    setLoadout(name: string, loadout: BringInLoadout): { ok: boolean; reason?: string; loadout?: BringInLoadout } {
        return this.writeExclusive(() => {
            const guns: string[] = [];
            if (Array.isArray(loadout?.guns)) {
                // 武器槽是固定位置：guns[0]=1号位、guns[1]=2号位，空槽为空串。
                // 槽位内容可以是单枪（"m9"）或双枪形态（"m9_dual"，2 把）。
                // 非双枪武器允许两个槽各放一把（共 2 把）。
                for (let slot = 0; slot < 2; slot++) {
                    const rawType = loadout.guns[slot];
                    if (!rawType || stashCategoryFor(rawType) !== "guns") continue;
                    const dualBase = baseGunOf(rawType);
                    if (dualBase) {
                        // 双枪形态：必须是真实存在的双枪。
                        if (dualGunOf(dualBase)) guns[slot] = rawType;
                    } else {
                        guns[slot] = rawType;
                    }
                }
            }
            while (guns.length < 2) guns.push("");
            // 稀疏槽位（如 ["", "groza"]）补为空串，避免序列化成 null。
            for (let slot = 0; slot < 2; slot++) {
                if (guns[slot] === undefined) guns[slot] = "";
            }
            // 同一把可双持武器的两个单持槽 → 合并为 1 号位双持
            // （与"左键连点"的语义一致：2 把 = 1 号位双持）。
            if (
                guns[0]
                && guns[0] === guns[1]
                && !guns[0].endsWith("_dual")
                && dualGunOf(guns[0])
            ) {
                guns[0] = dualGunOf(guns[0])!;
                guns[1] = "";
            }
            // 仓库身份：先取 entry 以便对 melee/armor/弹药/药品/投掷物/能力
            // 全部做库存校验——仓库中没有的物品不允许写进配装，防止"幽灵物品"
            // （配装显示已装备、进局却啥也没有）。
            const entry = this.entry(name);
            const melee = typeof loadout?.melee === "string"
                    && stashCategoryFor(loadout.melee) === "melee"
                    && loadout.melee !== "fists"
                    && (entry.items.melee[loadout.melee] ?? 0) >= 1
                ? loadout.melee
                : undefined;
            const armor: BringInLoadout["armor"] = {};
            for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
                const type = loadout?.armor?.[key];
                const categoryOk = key === "scope"
                    ? stashCategoryFor(type ?? "") === "scopes"
                    : key === "helmet"
                    ? stashCategoryFor(type ?? "") === "helmets"
                    : key === "chest"
                    ? stashCategoryFor(type ?? "") === "chests"
                    : stashCategoryFor(type ?? "") === "backpacks";
                if (type && categoryOk && GameObjectDefs[type]?.type === key) {
                    const stock = key === "scope"
                        ? Number(entry.items.scopes[type] ?? 0)
                        : key === "helmet"
                        ? Number(entry.items.helmets[type] ?? 0)
                        : key === "chest"
                        ? Number(entry.items.chests[type] ?? 0)
                        : Number(entry.items.backpacks[type] ?? 0);
                    if (stock >= 1) armor[key] = type;
                }
            }
            // 携带上限：按配装背包等级，保证保存后不超背包容量。
            const backpackLevel = armor.backpack
                ? Number(
                    (GameObjectDefs[armor.backpack] as { level?: number })
                        ?.level ?? 0,
                )
                : 0;
            const capacityFor = (type: string): number => getBagCapacity(type, backpackLevel, true);
            // 仓库中没有（数量不足）的物品不允许写进配装，防止"幽灵弹药/药品"：
            // 与幽灵能力/幽灵武器同理，否则配装界面显示已携带、进局却啥也没有。
            const ammo: Record<string, number> = {};
            const consumables: Record<string, number> = {};
            // pendingGrant 覆盖的数量（进局已扣、未结算）应视为仍可携带，
            // 与 getStash/cleanupGhostPerks 的钳制口径一致。
            const pending = this.data.pendingGrants?.[name];
            for (const [type, rawCount] of Object.entries(loadout?.ammo ?? {})) {
                if (stashCategoryFor(type) === "ammo") {
                    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
                    if (count > 0) {
                        const clamped = Math.min(
                            stackCap(type),
                            capacityFor(type),
                            count,
                            Number(entry.items.ammo[type] ?? 0)
                                + Number(pending?.ammo?.[type] ?? 0),
                        );
                        if (clamped > 0) ammo[type] = clamped;
                    }
                }
            }
            for (
                const [type, rawCount] of Object.entries(
                    loadout?.consumables ?? {},
                )
            ) {
                if (stashCategoryFor(type) === "consumables") {
                    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
                    if (count > 0) {
                        const clamped = Math.min(
                            stackCap(type),
                            capacityFor(type),
                            count,
                            Number(entry.items.consumables[type] ?? 0)
                                + Number(pending?.consumables?.[type] ?? 0),
                        );
                        if (clamped > 0) consumables[type] = clamped;
                    }
                }
            }
            const throwables: Record<string, number> = {};
            for (
                const [type, rawCount] of Object.entries(
                    loadout?.throwables ?? {},
                )
            ) {
                if (stashCategoryFor(type) === "throwables") {
                    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
                    if (count > 0) {
                        const clamped = Math.min(
                            stackCap(type),
                            capacityFor(type),
                            count,
                            Number(entry.items.throwables[type] ?? 0)
                                + Number(pending?.throwables?.[type] ?? 0),
                        );
                        if (clamped > 0) throwables[type] = clamped;
                    }
                }
            }
            // 携带普通能力：去重、只保留有效 perk。普通与一次性
            // 能力合计不得超过 PERK_BRING_IN_MAX。
            // 仓库中没有的能力不允许写进配装，防止"幽灵能力"。
            // 已发放到 pending 的能力已经从仓库扣除，但在对局结算前仍是
            // 当前配装的一部分；保存其它槽位时不能因此把它误删。
            const pendingPerkTypes = new Set(pending?.perks ?? []);
            const perks: string[] = [];
            if (Array.isArray(loadout?.perks)) {
                for (const raw of loadout.perks) {
                    if (typeof raw !== "string") continue;
                    if (stashCategoryFor(raw) !== "perks") continue;
                    if (perks.includes(raw)) continue;
                    if (perks.length >= PERK_BRING_IN_MAX) break;
                    if (
                        (entry.items.perks[raw] ?? 0) < 1
                        && !pendingPerkTypes.has(raw)
                    ) continue;
                    perks.push(raw);
                }
            }
            // 一次性能力仅从独立库存手动选择；与普通能力
            // 同 type 时优先保留普通能力，防止进局扣除却不生效。
            const oneTimeOwned = new Set(entry.oneTimePerks ?? []);
            const oneTimePerks: string[] = [];
            if (Array.isArray(loadout?.oneTimePerks)) {
                for (const raw of loadout.oneTimePerks) {
                    if (typeof raw !== "string") continue;
                    if (stashCategoryFor(raw) !== "perks") continue;
                    if (perks.includes(raw) || oneTimePerks.includes(raw)) continue;
                    if (perks.length + oneTimePerks.length >= PERK_BRING_IN_MAX) break;
                    if (!oneTimeOwned.has(raw)) continue;
                    oneTimePerks.push(raw);
                }
            }
            // 仓库中没有（数量不足）的枪不允许写进配装，防止“幽灵武器”
            // 导致绝密入口检查误判、进局却空手。双枪形态按 2 把基准枪计算。
            for (let slot = 0; slot < 2; slot++) {
                const t = guns[slot];
                if (!t) continue;
                const dualBase = baseGunOf(t);
                const base = dualBase ?? t;
                const need = dualBase ? 2 : 1;
                if (!base || (entry.items.guns[base] ?? 0) < need) {
                    guns[slot] = "";
                }
            }
            entry.loadout = {
                guns,
                melee,
                ammo,
                consumables,
                throwables,
                perks,
                oneTimePerks,
                armor,
            };
            return { ok: true, loadout: entry.loadout };
        });
    }

    /**
     * Consumes the player's selected bring-in loadout from the stash and
     * returns the arena starting-loadout description. Returns null when the
     * player has no loadout selected.
     */
    grantLoadout(name: string): GrantedLoadout | null {
        return this.writeExclusive(() => {
            const entry = this.entry(name);
            // 上次进局未结算的残留 pending（加入失败/断线异常）：先归还，
            // 否则本次发放会覆盖旧记录，装备凭空少一份。
            const stalePending = this.data.pendingGrants?.[name];
            if (stalePending) {
                this.restorePendingGrant(entry, stalePending);
                if (this.data.pendingGrants) delete this.data.pendingGrants[name];
                console.warn(
                    `[stash] grantLoadout "${name}": refunded stale pending grant before new grant`,
                );
            }
            const loadout = entry.loadout;
            const hasAny = loadout.guns.some((t) => t)
                || Boolean(loadout.melee)
                || Object.keys(loadout.ammo).length > 0
                || Object.keys(loadout.consumables).length > 0
                || Object.keys(loadout.throwables ?? {}).length > 0
                || (loadout.perks?.length ?? 0) > 0
                || (loadout.oneTimePerks?.length ?? 0) > 0
                || loadout.armor.helmet
                || loadout.armor.chest
                || loadout.armor.backpack
                || loadout.armor.scope;
            if (!hasAny) return null;

            const weapons: Array<{ type: string; ammo?: number }> = [];
            const inventory: Record<string, number> = {};
            // 最终背包容量：按配装背包等级（无背包 level 0）。
            const backpackLevel = loadout.armor.backpack
                ? Number(
                    (GameObjectDefs[loadout.armor.backpack] as {
                        level?: number;
                    })?.level ?? 0,
                )
                : 0;
            const capacityFor = (type: string): number => getBagCapacity(type, backpackLevel, true);
            // 局内库存协议已升级到 12-bit（哨兵 4095），真实库存最大 4094。
            const PROTOCOL_MAX = 4094;
            // 按槽位发放：weapons[slot] 与配装的 1、2 号武器位一一对应，
            // 空槽用 { type: "" } 占位，保证 2 号位武器不会前移到 1 号位。
            // 弹匣按武器自身定义装到满，子弹从"玩家携带量"中扣除；
            // 剩余作为备用弹药（同口径只发一次）。
            const ammoBudget: Record<string, number> = {};
            for (const [type, count] of Object.entries(loadout.ammo ?? {})) {
                ammoBudget[type] = Math.max(0, Math.floor(Number(count) || 0));
            }
            // 待结算清单：记录每种弹药总共从仓库扣了多少（弹匣+备用）。
            const pendingAmmoTotal: Record<string, number> = {};
            const gunAmmoTypes = new Set<string>();
            for (let slot = 0; slot < 2; slot++) {
                const gunType = loadout.guns[slot] ?? "";
                // 双枪槽位按 2 把基准枪扣仓；单枪槽位按 1 把。
                const dualBase = baseGunOf(gunType);
                const baseType = dualBase ?? gunType;
                const need = dualBase ? 2 : 1;
                const def = GameObjectDefs[baseType];
                if (!baseType || def?.type !== "gun") {
                    weapons[slot] = { type: "" };
                    continue;
                }
                if ((entry.items.guns[baseType] ?? 0) < need) {
                    weapons[slot] = { type: "" };
                    // 仓库已无此枪：同步清掉配装里的“幽灵武器”，避免玩家
                    // 下次进入绝密时检查通过却空手进局。
                    if (entry.loadout.guns[slot]) entry.loadout.guns[slot] = "";
                    continue;
                }
                this.removeItem(name, baseType, need);
                // 用武器自身定义取满弹匣（双枪用双枪自己的弹匣）。
                const weaponDef = GameObjectDefs[gunType] as
                    | { maxClip?: number; ammo?: string }
                    | undefined;
                const fullClip = Math.max(
                    1,
                    Math.floor(Number(weaponDef?.maxClip ?? 30)),
                );
                const ammoType = String(weaponDef?.ammo ?? "");
                if (ammoType) {
                    gunAmmoTypes.add(ammoType);
                    const budget = Math.floor(
                        Number(ammoBudget[ammoType] ?? 0),
                    );
                    const intoMag = Math.min(fullClip, budget);
                    weapons[slot] = { type: gunType, ammo: intoMag };
                    ammoBudget[ammoType] = budget - intoMag;
                } else {
                    weapons[slot] = { type: gunType, ammo: fullClip };
                }
            }
            // 弹匣内的子弹来自携带量：优先扣仓（先把枪装满）。
            for (const ammoType of gunAmmoTypes) {
                const carried = Math.floor(
                    Number(loadout.ammo[ammoType] ?? 0),
                );
                const reserve = Math.floor(Number(ammoBudget[ammoType] ?? 0));
                const magUsed = Math.max(0, carried - reserve);
                if (magUsed > 0) {
                    const take = Math.min(
                        magUsed,
                        Number(entry.items.ammo[ammoType] ?? 0),
                    );
                    if (take > 0) this.removeItem(name, ammoType, take);
                    pendingAmmoTotal[ammoType] = Number(pendingAmmoTotal[ammoType] ?? 0) + take;
                }
            }
            // 备用弹药：弹匣填满后的剩余携带量（同口径只发一次）。
            for (const ammoType of gunAmmoTypes) {
                const reserve = Math.floor(Number(ammoBudget[ammoType] ?? 0));
                if (reserve <= 0) continue;
                const grant = Math.min(
                    reserve,
                    Number(entry.items.ammo[ammoType] ?? 0),
                    capacityFor(ammoType),
                    PROTOCOL_MAX,
                );
                if (grant > 0) {
                    inventory[ammoType] = grant;
                    this.removeItem(name, ammoType, grant);
                    pendingAmmoTotal[ammoType] = Number(pendingAmmoTotal[ammoType] ?? 0) + grant;
                }
            }
            let grantedMelee: string | undefined;
            if (loadout.melee && (entry.items.melee[loadout.melee] ?? 0) >= 1) {
                this.removeItem(name, loadout.melee, 1);
                grantedMelee = loadout.melee;
            }
            for (const [type, count] of Object.entries(loadout.ammo)) {
                if (inventory[type] !== undefined || gunAmmoTypes.has(type)) {
                    continue;
                }
                const take = Math.min(
                    count,
                    Number(entry.items.ammo[type] ?? 0),
                    capacityFor(type),
                    PROTOCOL_MAX,
                );
                if (take > 0) {
                    inventory[type] = take;
                    this.removeItem(name, type, take);
                }
            }
            for (const [type, count] of Object.entries(loadout.consumables)) {
                const take = Math.min(
                    count,
                    Number(entry.items.consumables[type] ?? 0),
                    capacityFor(type),
                    PROTOCOL_MAX,
                );
                if (take > 0) {
                    inventory[type] = take;
                    this.removeItem(name, type, take);
                }
            }
            for (
                const [type, count] of Object.entries(
                    loadout.throwables ?? {},
                )
            ) {
                const take = Math.min(
                    count,
                    Number(entry.items.throwables[type] ?? 0),
                    capacityFor(type),
                    PROTOCOL_MAX,
                );
                if (take > 0) {
                    inventory[type] = take;
                    this.removeItem(name, type, take);
                }
            }
            // 携带的能力：每类最多 1 个，从仓库扣 1 后进局发放。
            const grantedPerks: string[] = [];
            const skippedPerks: string[] = [];
            for (const perkType of loadout.perks ?? []) {
                if (
                    !perkType
                    || GameObjectDefs[perkType]?.type !== "perk"
                    || grantedPerks.includes(perkType)
                    || grantedPerks.length >= PERK_BRING_IN_MAX
                ) {
                    continue;
                }
                if ((entry.items.perks[perkType] ?? 0) < 1) {
                    skippedPerks.push(perkType);
                    continue;
                }
                this.removeItem(name, perkType, 1);
                grantedPerks.push(perkType);
            }
            if (skippedPerks.length > 0) {
                console.warn(
                    `[stash] grantLoadout "${name}": skipped perks (not owned): ${skippedPerks.join(", ")}`,
                );
            }
            // 一次性能力只消耗玩家在配装中手动选中且仓库
            // 真实拥有的项目；未选中的购买项始终留在仓库。
            const oneTimeInventory = [...(entry.oneTimePerks ?? [])];
            const grantedOneTimePerks: string[] = [];
            const skippedOneTimePerks: string[] = [];
            for (const perkType of loadout.oneTimePerks ?? []) {
                if (!perkType || GameObjectDefs[perkType]?.type !== "perk") continue;
                if (
                    grantedPerks.includes(perkType)
                    || grantedOneTimePerks.includes(perkType)
                    || grantedPerks.length + grantedOneTimePerks.length
                        >= PERK_BRING_IN_MAX
                ) {
                    continue;
                }
                const stockIndex = oneTimeInventory.indexOf(perkType);
                if (stockIndex < 0) {
                    skippedOneTimePerks.push(perkType);
                    continue;
                }
                oneTimeInventory.splice(stockIndex, 1);
                grantedOneTimePerks.push(perkType);
            }
            if (oneTimeInventory.length > 0) entry.oneTimePerks = oneTimeInventory;
            else delete entry.oneTimePerks;
            // 一次性选择在本次发放后立即清空，不会在下一局
            // 继续自动使用；崩溃恢复只归还库存，不恢复自动选中。
            entry.loadout.oneTimePerks = [];
            if (skippedOneTimePerks.length > 0) {
                console.warn(
                    `[stash] grantLoadout "${name}": skipped one-time perks (not owned): ${
                        skippedOneTimePerks.join(", ")
                    }`,
                );
            }
            const armor: GrantedLoadout = { weapons: [] };
            for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
                const type = loadout.armor[key];
                if (!type) continue;
                const stock = key === "scope"
                    ? (entry.items.scopes[type] ?? 0)
                    : key === "helmet"
                    ? (entry.items.helmets[type] ?? 0)
                    : key === "chest"
                    ? (entry.items.chests[type] ?? 0)
                    : (entry.items.backpacks[type] ?? 0);
                if (stock < 1) continue;
                this.removeItem(name, type, 1);
                armor[key] = type;
            }
            armor.weapons = weapons;
            if (grantedMelee) armor.melee = grantedMelee;
            if (Object.keys(inventory).length > 0) armor.inventory = inventory;
            if (grantedPerks.length > 0) armor.perks = grantedPerks;
            if (grantedOneTimePerks.length > 0) {
                armor.oneTimePerks = grantedOneTimePerks;
            }
            // 普通与一次性能力都是实际带入能力；按实际成功
            // 发放的总数锁定带出槽位（最多带入 4，最多带出 7）。
            armor.perkCarryOutCap = perkCarryOutCap(
                grantedPerks.length + grantedOneTimePerks.length,
            );
            // 记录"待结算"配装：崩溃恢复时据此把已扣物资归还仓库。
            const pending: PendingGrant = {
                grantedAt: Date.now(),
                guns: {},
                ammo: {},
                consumables: {},
                throwables: {},
                // 一次性能力单独记账，避免崩溃恢复时落入
                // 永久 items.perks 库存。
                perks: grantedPerks.length > 0 ? [...grantedPerks] : undefined,
                oneTimePerks: grantedOneTimePerks.length > 0
                    ? [...grantedOneTimePerks]
                    : undefined,
                armor: {
                    helmet: armor.helmet,
                    chest: armor.chest,
                    backpack: armor.backpack,
                    scope: armor.scope,
                },
            };
            if (grantedMelee) pending.melee = grantedMelee;
            for (const w of weapons) {
                if (!w.type) continue;
                const base = baseGunOf(w.type) ?? w.type;
                pending.guns[base] = Number(pending.guns[base] ?? 0)
                    + (w.type.endsWith("_dual") ? 2 : 1);
            }
            for (const [type, count] of Object.entries(inventory)) {
                const cat = stashCategoryFor(type);
                if (cat === "consumables") {
                    pending.consumables[type] = Number(count) || 0;
                } else if (cat === "throwables") {
                    pending.throwables[type] = Number(count) || 0;
                }
            }
            for (const [type, total] of Object.entries(pendingAmmoTotal)) {
                pending.ammo[type] = total;
            }
            (this.data.pendingGrants ??= {})[name] = pending;
            return armor;
        });
    }

    /** 对局正常结算（死亡/撤离/断线/对局结束）后清除待结算配装。 */
    clearPendingGrant(name: string): void {
        if (!this.data.pendingGrants || !this.data.pendingGrants[name]) return;
        this.writeExclusive(() => {
            delete this.data.pendingGrants?.[name];
        });
    }

    /**
     * 撤离失败结算：把本局 pendingGrant 转存为可申请凭证后再清除。
     * 玩家+对局 ID 唯一；重复的死亡/结算事件不会生成第二份可返还装备。
     */
    archivePendingGrantForReturnRequest(
        name: string,
        matchId: string,
        mapName: string,
    ): EquipmentReturnRequest | null {
        let archived: EquipmentReturnRequest | null = null;
        this.writeExclusive(() => {
            const playerName = String(name ?? "").trim();
            const safeMatchId = String(matchId ?? "").trim();
            if (!playerName || !safeMatchId) return;
            const id = `${safeMatchId}:${playerName}`;
            const existing = this.data.returnRequests?.[id];
            if (existing) {
                archived = JSON.parse(JSON.stringify(existing)) as EquipmentReturnRequest;
                delete this.data.pendingGrants?.[playerName];
                return;
            }
            const grant = this.data.pendingGrants?.[playerName];
            if (!grant) return;
            const request: EquipmentReturnRequest = {
                id,
                playerName,
                matchId: safeMatchId,
                mapName: String(mapName ?? ""),
                status: "eligible",
                reason: "",
                createdAt: Date.now(),
                grant: JSON.parse(JSON.stringify(grant)) as PendingGrant,
            };
            (this.data.returnRequests ??= {})[id] = request;
            delete this.data.pendingGrants?.[playerName];
            archived = JSON.parse(JSON.stringify(request)) as EquipmentReturnRequest;
        });
        return archived;
    }

    /** 玩家只能提交属于自己、且尚未处理的真实对局凭证。 */
    submitEquipmentReturnRequest(
        name: string,
        matchId: string,
        reason: string,
    ): { ok: boolean; reason?: string; request?: EquipmentReturnRequest } {
        return this.writeExclusive(() => {
            const playerName = String(name ?? "").trim();
            const id = `${String(matchId ?? "").trim()}:${playerName}`;
            const request = this.data.returnRequests?.[id];
            if (!request || request.playerName !== playerName) {
                return { ok: false, reason: "not-eligible" };
            }
            if (request.status === "auto-refunded") {
                return {
                    ok: false,
                    reason: "server-lag-auto-refunded",
                    request: JSON.parse(JSON.stringify(request)),
                };
            }
            if (request.status === "pending") {
                return {
                    ok: true,
                    reason: "already-pending",
                    request: JSON.parse(JSON.stringify(request)),
                };
            }
            if (request.status !== "eligible") {
                return { ok: false, reason: "already-reviewed" };
            }
            const normalizedReason = String(reason ?? "").trim().slice(0, 300);
            if (!normalizedReason) return { ok: false, reason: "reason-required" };
            request.reason = normalizedReason;
            request.status = "pending";
            request.submittedAt = Date.now();
            return {
                ok: true,
                request: JSON.parse(JSON.stringify(request)),
            };
        });
    }

    getEquipmentReturnRequest(
        name: string,
        matchId: string,
    ): EquipmentReturnRequest | null {
        return this.readLatest(() => {
            const playerName = String(name ?? "").trim();
            const id = `${String(matchId ?? "").trim()}:${playerName}`;
            const request = this.data.returnRequests?.[id];
            return request && request.playerName === playerName
                ? JSON.parse(JSON.stringify(request))
                : null;
        });
    }

    /**
     * 返回该玩家尚未在主界面确认的成功返还通知。
     * 这里只暴露提示所需的安全摘要，避免把原始带入快照发送到主页。
     */
    listEquipmentReturnNotifications(
        name: string,
    ): EquipmentReturnNotification[] {
        return this.readLatest(() => {
            const playerName = String(name ?? "").trim();
            if (!playerName) return [];
            return Object.values(this.data.returnRequests ?? {})
                .filter(
                    (request) =>
                        request.playerName === playerName
                        && !request.notifiedAt
                        && (request.status === "approved"
                            || request.status === "auto-refunded"),
                )
                .map((request) => ({
                    id: request.id,
                    matchId: request.matchId,
                    mapName: request.mapName,
                    status: request.status as "approved" | "auto-refunded",
                    returnedAt: request.reviewedAt ?? request.createdAt,
                    ...(request.adminNote ? { adminNote: request.adminNote } : {}),
                }))
                .sort((a, b) => a.returnedAt - b.returnedAt);
        });
    }

    /**
     * 玩家看到主页提示后确认已读。只允许确认属于自己的成功返还记录，
     * 其它玩家、待审批、拒绝记录都不会被修改。
     */
    acknowledgeEquipmentReturnNotifications(
        name: string,
        ids: string[],
    ): number {
        return this.writeExclusive(() => {
            const playerName = String(name ?? "").trim();
            const requestedIds = new Set(
                (Array.isArray(ids) ? ids : [])
                    .map((id) => String(id ?? "").trim())
                    .filter(Boolean)
                    .slice(0, 100),
            );
            if (!playerName || requestedIds.size === 0) return 0;

            const notifiedAt = Date.now();
            let acknowledged = 0;
            for (const id of requestedIds) {
                const request = this.data.returnRequests?.[id];
                if (
                    !request
                    || request.playerName !== playerName
                    || request.notifiedAt
                    || (request.status !== "approved"
                        && request.status !== "auto-refunded")
                ) {
                    continue;
                }
                request.notifiedAt = notifiedAt;
                acknowledged++;
            }
            return acknowledged;
        });
    }

    listEquipmentReturnRequests(): EquipmentReturnRequest[] {
        return this.readLatest(() =>
            Object.values(this.data.returnRequests ?? {})
                .map((request) => JSON.parse(JSON.stringify(request)) as EquipmentReturnRequest)
                .sort((a, b) => (b.submittedAt ?? b.createdAt) - (a.submittedAt ?? a.createdAt))
        );
    }

    /**
     * 管理员审批。批准时，返仓与状态变化在同一写事务内完成；重复审批
     * 不会再次调用 restorePendingGrant，因此不会复制装备。
     */
    reviewEquipmentReturnRequest(
        id: string,
        decision: "approve" | "reject",
        adminNote = "",
    ): { ok: boolean; reason?: string; request?: EquipmentReturnRequest } {
        return this.writeExclusive(() => {
            const request = this.data.returnRequests?.[String(id ?? "")];
            if (!request) return { ok: false, reason: "not-found" };
            if (request.status !== "pending") {
                return { ok: false, reason: "already-reviewed" };
            }
            if (decision !== "approve" && decision !== "reject") {
                return { ok: false, reason: "invalid-decision" };
            }
            const normalizedAdminNote = String(adminNote ?? "").trim().slice(0, 300);
            if (decision === "approve") {
                const entry = this.entry(request.playerName);
                this.restorePendingGrant(entry, request.grant);
                request.status = "approved";
                // Approval is a new successful-return event. Legacy records or
                // a prior client acknowledgement must never suppress its menu
                // notification after an administrator actually returns items.
                delete request.notifiedAt;
            } else {
                request.status = "rejected";
            }
            if (normalizedAdminNote) request.adminNote = normalizedAdminNote;
            else delete request.adminNote;
            request.reviewedAt = Date.now();
            return {
                ok: true,
                request: JSON.parse(JSON.stringify(request)),
            };
        });
    }

    /** 服务器崩溃后重启：把未结算的配装全部归还仓库，返回归还的玩家数。 */
    recoverPendingGrants(): number {
        let recovered = 0;
        this.writeExclusive(() => {
            for (
                const [name, grant] of Object.entries(
                    this.data.pendingGrants ?? {},
                )
            ) {
                const entry = this.entry(name);
                this.restorePendingGrant(entry, grant);
                delete this.data.pendingGrants![name];
                recovered++;
            }
        });
        return recovered;
    }

    /**
     * 归还单个玩家的待结算配装（服务端卡顿补偿用）：本局检测到服务端
     * 引发的卡顿且玩家阵亡（撤离失败）时，把带入仓库被扣除的装备全部
     * 退回。返回是否真的归还了（该玩家有待结算配装）。仅搜打撤模式调用。
     */
    recoverPendingGrant(name: string): boolean {
        let recovered = false;
        this.writeExclusive(() => {
            const grant = this.data.pendingGrants?.[name];
            if (!grant) return;
            const entry = this.entry(name);
            this.restorePendingGrant(entry, grant);
            delete this.data.pendingGrants![name];
            recovered = true;
        });
        return recovered;
    }

    /**
     * 服务器卡顿补偿：将返仓和“本局已自动返还”凭证在同一写事务内完成。
     * 凭证会在赛后查询接口中返回，客户端因此能明确告知玩家已自动
     * 返还并禁用人工申请。重复调用只返回原凭证，不会再次复制装备。
     */
    recoverPendingGrantForServerLag(
        name: string,
        matchId: string,
        mapName: string,
    ): { refunded: boolean; request?: EquipmentReturnRequest } {
        return this.writeExclusive(() => {
            const playerName = String(name ?? "").trim();
            const safeMatchId = String(matchId ?? "").trim();
            if (!playerName || !safeMatchId) return { refunded: false };

            const id = `${safeMatchId}:${playerName}`;
            const existing = this.data.returnRequests?.[id];
            if (existing?.status === "auto-refunded") {
                return {
                    refunded: false,
                    request: JSON.parse(JSON.stringify(existing)),
                };
            }
            // 正常已批准的历史凭证已经返仓，不得再恢复一次。
            if (existing?.status === "approved") {
                return {
                    refunded: false,
                    request: JSON.parse(JSON.stringify(existing)),
                };
            }

            // 只恢复本局尚未结算的 pendingGrant。已经进入审批/拒绝历史的
            // grant 不得作为备用来源，否则异常的重复结算可能复制装备。
            const grant = this.data.pendingGrants?.[playerName];
            if (!grant) return { refunded: false };
            this.restorePendingGrant(this.entry(playerName), grant);
            delete this.data.pendingGrants?.[playerName];

            const now = Date.now();
            const request: EquipmentReturnRequest = {
                id,
                playerName,
                matchId: safeMatchId,
                mapName: String(mapName ?? ""),
                status: "auto-refunded",
                reason: "本局检测到服务器卡顿，带入装备已自动返回仓库，无需且不能再次申请。",
                createdAt: existing?.createdAt ?? now,
                submittedAt: existing?.submittedAt,
                reviewedAt: now,
                grant: JSON.parse(JSON.stringify(grant)) as PendingGrant,
            };
            (this.data.returnRequests ??= {})[id] = request;
            return {
                refunded: true,
                request: JSON.parse(JSON.stringify(request)),
            };
        });
    }

    private restorePendingGrant(
        entry: PlayerStash,
        grant: PendingGrant,
    ): void {
        for (const [type, count] of Object.entries(grant.guns)) {
            entry.items.guns[type] = Number(entry.items.guns[type] ?? 0) + (Number(count) || 0);
        }
        if (grant.melee) {
            entry.items.melee[grant.melee] = Number(entry.items.melee[grant.melee] ?? 0) + 1;
        }
        for (const [type, count] of Object.entries(grant.ammo)) {
            entry.items.ammo[type] = Number(entry.items.ammo[type] ?? 0) + (Number(count) || 0);
        }
        for (const [type, count] of Object.entries(grant.consumables)) {
            entry.items.consumables[type] = Number(entry.items.consumables[type] ?? 0)
                + (Number(count) || 0);
        }
        for (const [type, count] of Object.entries(grant.throwables)) {
            entry.items.throwables[type] = Number(entry.items.throwables[type] ?? 0)
                + (Number(count) || 0);
        }
        for (const perkType of grant.perks ?? []) {
            entry.items.perks[perkType] = Number(entry.items.perks[perkType] ?? 0) + 1;
        }
        if (Array.isArray(grant.oneTimePerks) && grant.oneTimePerks.length > 0) {
            // 允许购买多个同类型：崩溃恢复按消耗数量原样归还，不去重。
            entry.oneTimePerks = [
                ...(Array.isArray(entry.oneTimePerks) ? entry.oneTimePerks : []),
                ...grant.oneTimePerks,
            ];
        }
        for (const [slot, type] of Object.entries(grant.armor)) {
            if (!type) continue;
            const cat = stashCategoryFor(type);
            if (!cat) continue;
            entry.items[cat][type] = Number(entry.items[cat][type] ?? 0) + 1;
        }
    }

    /**
     * 全玩家清理"幽灵配装"：配装里引用了但仓库中已不存在、且无待结算配装
     * 覆盖的物品（能力/弹药/药品/投掷物/近战/护甲；历史脏数据/后台误操作
     * 导致）。返回被修正的玩家数。
     * 在服务器启动时调用一次，保证仓库界面与进局发放都看不到幽灵物品。
     */
    cleanupGhostPerks(): number {
        return this.writeExclusive(() => {
            let fixed = 0;
            for (const [name, entry] of Object.entries(this.data.players)) {
                let changed = false;
                // 能力：无库存且无 pendingGrant 覆盖的移除。
                const loadoutPerks = entry.loadout?.perks;
                if (Array.isArray(loadoutPerks) && loadoutPerks.length > 0) {
                    const pendingPerks = new Set(
                        this.data.pendingGrants?.[name]?.perks ?? [],
                    );
                    const cleaned = loadoutPerks.filter(
                        (p) => (entry.items.perks[p] ?? 0) >= 1 || pendingPerks.has(p),
                    );
                    if (cleaned.length !== loadoutPerks.length) {
                        entry.loadout.perks = cleaned;
                        changed = true;
                    }
                }
                // 一次性库存与配装保持独立：只去除非法库存。重复项必须保留，
                // 因为每一项都代表玩家单独购买、可在一局中消耗一次的库存。
                // 并清理已不拥有、与普通能力冲突或超过带入上限的选择。
                const rawOneTimeStock = Array.isArray(entry.oneTimePerks)
                    ? entry.oneTimePerks
                    : [];
                const oneTimeStock = rawOneTimeStock.filter(
                    (type) => GameObjectDefs[type]?.type === "perk",
                );
                if (oneTimeStock.length !== rawOneTimeStock.length) {
                    entry.oneTimePerks = oneTimeStock;
                    changed = true;
                }
                const pendingOneTime = new Set(
                    this.data.pendingGrants?.[name]?.oneTimePerks ?? [],
                );
                const selectedOneTime: string[] = [];
                for (const type of entry.loadout?.oneTimePerks ?? []) {
                    if (GameObjectDefs[type]?.type !== "perk") continue;
                    if ((entry.loadout.perks ?? []).includes(type)) continue;
                    if (selectedOneTime.includes(type)) continue;
                    if (!oneTimeStock.includes(type) && !pendingOneTime.has(type)) continue;
                    if (
                        (entry.loadout.perks?.length ?? 0)
                                + selectedOneTime.length
                            >= PERK_BRING_IN_MAX
                    ) {
                        break;
                    }
                    selectedOneTime.push(type);
                }
                const rawSelectedOneTime = entry.loadout?.oneTimePerks ?? [];
                if (
                    selectedOneTime.length !== rawSelectedOneTime.length
                    || selectedOneTime.some(
                        (type, index) => type !== rawSelectedOneTime[index],
                    )
                ) {
                    entry.loadout.oneTimePerks = selectedOneTime;
                    changed = true;
                }
                // 弹药/药品/投掷物：携带量钳制到实际库存（pendingGrant 覆盖的
                // 已扣数量视为仍可携带）。
                const pending = this.data.pendingGrants?.[name];
                for (const cat of ["ammo", "consumables", "throwables"] as const) {
                    const carried = entry.loadout?.[cat] ?? {};
                    for (const [type, count] of Object.entries(carried)) {
                        const stock = Number(entry.items[cat][type] ?? 0)
                            + Number(pending?.[cat]?.[type] ?? 0);
                        const clamped = Math.min(
                            Math.max(0, Math.floor(Number(count) || 0)),
                            Math.max(0, stock),
                        );
                        if (clamped !== Number(count)) {
                            if (clamped > 0) carried[type] = clamped;
                            else delete carried[type];
                            changed = true;
                        }
                    }
                }
                // 近战/护甲：仓库不存在的移除。
                if (
                    entry.loadout?.melee
                    && (entry.items.melee[entry.loadout.melee] ?? 0) < 1
                ) {
                    delete entry.loadout.melee;
                    changed = true;
                }
                for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
                    const type = entry.loadout?.armor?.[key];
                    if (!type) continue;
                    const stock = key === "scope"
                        ? Number(entry.items.scopes[type] ?? 0)
                        : key === "helmet"
                        ? Number(entry.items.helmets[type] ?? 0)
                        : key === "chest"
                        ? Number(entry.items.chests[type] ?? 0)
                        : Number(entry.items.backpacks[type] ?? 0);
                    if (stock < 1) {
                        delete entry.loadout.armor[key];
                        changed = true;
                    }
                }
                if (changed) fixed++;
            }
            if (fixed > 0) this.persistNow();
            return fixed;
        });
    }

    /**
     * Adds a player's carried loot to the stash (called on extraction).
     */
    collectCarriedLoot(
        name: string,
        carried: {
            weapons: string[];
            melee?: string;
            inventory: Record<string, number>;
            perks?: string[];
            helmet?: string;
            chest?: string;
            backpack?: string;
            scope?: string;
        },
        teamContext?: {
            matchId: string;
            teammateNames: string[];
        },
    ): void {
        this.writeExclusive(() => {
            const extractorName = String(name ?? "").trim();
            const equipment = new Map<string, number>();
            const addEquipment = (rawType: string | undefined, count = 1) => {
                if (!rawType || rawType === "fists" || rawType === "1xscope") return;
                const base = baseGunOf(rawType) ?? rawType;
                const amount = baseGunOf(rawType) ? count * 2 : count;
                equipment.set(base, (equipment.get(base) ?? 0) + amount);
            };
            for (const type of carried.weapons) addEquipment(type);
            addEquipment(carried.melee);
            for (const type of carried.perks ?? []) addEquipment(type);
            addEquipment(carried.helmet);
            addEquipment(carried.chest);
            addEquipment(carried.backpack);
            const inventoryScopes = new Set<string>();
            for (const [type, count] of Object.entries(carried.inventory)) {
                if (type === "1xscope" || stashCategoryFor(type) !== "scopes") continue;
                inventoryScopes.add(type);
                addEquipment(type, Math.max(1, Math.floor(Number(count) || 1)));
            }
            // 当前倍镜通常也在 inventory 中，只计算一次；某些旧客户端仅上报 scope。
            if (carried.scope && !inventoryScopes.has(carried.scope)) addEquipment(carried.scope);

            // 先扣除撤离者自己的带入快照，剩余匹配项才可能是阵亡队友的装备。
            const ownGrant = this.data.pendingGrants?.[extractorName];
            const consumeCount = (type: string, count: number) => {
                const available = equipment.get(type) ?? 0;
                const used = Math.min(available, Math.max(0, Math.floor(count)));
                if (used <= 0) return 0;
                if (available === used) equipment.delete(type);
                else equipment.set(type, available - used);
                return used;
            };
            if (ownGrant) {
                for (const [type, count] of Object.entries(ownGrant.guns)) {
                    consumeCount(type, Number(count) || 0);
                }
                if (ownGrant.melee) consumeCount(ownGrant.melee, 1);
                for (const type of ownGrant.perks ?? []) consumeCount(type, 1);
                for (const type of Object.values(ownGrant.armor)) {
                    if (type) consumeCount(type, 1);
                }
            }

            // 如果队友的申请尚未批准，从其返还快照中删去已被带出的匹配装备；
            // 如果此前已经批准/自动返还，则阻止相同装备再次进入撤离者仓库。
            const blockedDeposit = new Map<string, number>();
            const consumeGrantEquipment = (
                grant: PendingGrant,
                type: string,
                requested: number,
            ): number => {
                let remaining = Math.max(0, Math.floor(requested));
                let consumed = 0;
                const gunCount = Math.max(0, Number(grant.guns[type] ?? 0));
                if (gunCount > 0 && remaining > 0) {
                    const used = Math.min(gunCount, remaining);
                    const next = gunCount - used;
                    if (next > 0) grant.guns[type] = next;
                    else delete grant.guns[type];
                    remaining -= used;
                    consumed += used;
                }
                if (grant.melee === type && remaining > 0) {
                    delete grant.melee;
                    remaining--;
                    consumed++;
                }
                while (remaining > 0) {
                    const perkIndex = grant.perks?.indexOf(type) ?? -1;
                    if (perkIndex < 0) break;
                    grant.perks!.splice(perkIndex, 1);
                    remaining--;
                    consumed++;
                }
                for (const slot of ["helmet", "chest", "backpack", "scope"] as const) {
                    if (remaining <= 0) break;
                    if (grant.armor[slot] !== type) continue;
                    delete grant.armor[slot];
                    remaining--;
                    consumed++;
                }
                return consumed;
            };
            const safeMatchId = String(teamContext?.matchId ?? "").trim();
            const teammateNames = new Set(
                (teamContext?.teammateNames ?? [])
                    .map((value) => String(value ?? "").trim())
                    .filter((value) => value && value !== extractorName),
            );
            for (const teammateName of teammateNames) {
                const request = this.data.returnRequests?.[`${safeMatchId}:${teammateName}`];
                if (!request || request.matchId !== safeMatchId) continue;
                for (const [type, available] of [...equipment]) {
                    if (available <= 0) continue;
                    if (request.status === "approved" || request.status === "auto-refunded") {
                        const duplicated = consumeGrantEquipment(
                            JSON.parse(JSON.stringify(request.grant)) as PendingGrant,
                            type,
                            available,
                        );
                        if (duplicated > 0) {
                            blockedDeposit.set(type, (blockedDeposit.get(type) ?? 0) + duplicated);
                            consumeCount(type, duplicated);
                        }
                        continue;
                    }
                    if (request.status !== "eligible" && request.status !== "pending") continue;
                    const carriedCount = consumeGrantEquipment(request.grant, type, available);
                    if (carriedCount <= 0) continue;
                    consumeCount(type, carriedCount);
                    (request.teammateCarriedItems ??= {})[type] = Number(request.teammateCarriedItems?.[type] ?? 0)
                        + carriedCount;
                    const carriers = request.teammateCarriers ??= [];
                    if (!carriers.includes(extractorName)) carriers.push(extractorName);
                }
            }

            const allowDeposit = (rawType: string): boolean => {
                const base = baseGunOf(rawType) ?? rawType;
                const blocked = blockedDeposit.get(base) ?? 0;
                if (blocked <= 0) return true;
                if (blocked === 1) blockedDeposit.delete(base);
                else blockedDeposit.set(base, blocked - 1);
                return false;
            };
            // 双持枪拆成两把基准枪入库，才能精确拦截其中一把已返还的枪。
            const depositWeapons = carried.weapons.flatMap((type) => {
                const base = baseGunOf(type);
                return base ? [base, base] : [type];
            });
            for (const type of depositWeapons) {
                if (!allowDeposit(type)) continue;
                if (stashCategoryFor(type) === "guns") {
                    this.addItem(name, type, 1);
                }
            }
            if (carried.melee && carried.melee !== "fists") {
                if (allowDeposit(carried.melee) && stashCategoryFor(carried.melee) === "melee") {
                    this.addItem(name, carried.melee, 1);
                }
            }
            // 撤离时背包里所有倍镜一起带回（1xscope 默认倍镜除外）。
            // 倍镜在局内是 inventory 物品（scope 只是当前激活项），
            // 玩家切小倍镜后 15xscope 等稀有倍镜仍留在背包——必须入库，
            // 否则"捡到 15 倍镜、撤离前切小倍镜"时 15 倍镜会丢失。
            const scopesCarried = new Set<string>();
            for (const [type, count] of Object.entries(carried.inventory)) {
                if (type === "1xscope") continue; // 默认倍镜不入库
                const category = stashCategoryFor(type);
                if (category === "scopes") {
                    scopesCarried.add(type);
                    const amount = Math.max(1, Math.floor(Number(count) || 1));
                    let deposited = 0;
                    for (let index = 0; index < amount; index++) {
                        if (allowDeposit(type)) deposited++;
                    }
                    if (deposited > 0) this.addItem(name, type, deposited);
                    continue;
                }
                if (category) this.addItem(name, type, count);
            }
            for (const perkType of carried.perks ?? []) {
                if (allowDeposit(perkType) && stashCategoryFor(perkType) === "perks") {
                    this.addItem(name, perkType, 1);
                }
            }
            for (
                const type of [
                    carried.helmet,
                    carried.chest,
                    carried.backpack,
                    carried.scope,
                ]
            ) {
                if (type === "1xscope") continue; // 默认倍镜不入库
                const category = type ? stashCategoryFor(type) : null;
                if (
                    category === "helmets"
                    || category === "chests"
                    || category === "backpacks"
                    || category === "scopes"
                ) {
                    if (!allowDeposit(type!)) continue;
                    // 装备的倍镜若已在背包入库（切倍镜后旧倍镜留在背包），
                    // 不重复入库。
                    if (category === "scopes" && type && scopesCarried.has(type)) {
                        continue;
                    }
                    this.addItem(name, type!, 1);
                }
            }
        });
    }

    /** Read-only view for the admin dashboard. */
    listAll(): Array<{ name: string; stash: PlayerStash }> {
        // 每次重新加载磁盘：后台进程可能晚于玩家创建启动，缓存里的玩家列表
        // 会过期，导致"后台找不到玩家仓库"。与 getStash 一致地 reload。
        return this.readLatest(() => Object.entries(this.data.players).map(([name, stash]) => ({ name, stash })));
    }

    /** 只读仓库快照（排行榜 / 查看他人仓库用）：不创建新仓库，不存在返回 null。 */
    publicStashView(name: string): {
        name: string;
        coins: number;
        score: number;
        level: number;
        items: StashData;
        loadout: BringInLoadout;
        oneTimePerks: string[];
        achievements: AchievementId[];
    } | null {
        return this.readLatest(() => {
            const key = String(name ?? "").trim() || "anonymous";
            const stash = this.data.players[key];
            if (!stash) return null;
            const score = stashScore(stash);
            return {
                name: key,
                coins: Number(stash.coins ?? 0),
                score,
                level: levelFromScore(score),
                items: stash.items,
                loadout: stash.loadout,
                oneTimePerks: [...(stash.oneTimePerks ?? [])],
                achievements: normalizeAchievementIds(stash.achievements),
            };
        });
    }

    /** 排行榜：按仓库身价（金币 + 物品价值）降序，返回前 limit 名。 */
    leaderboard(
        limit = 50,
    ): Array<{
        name: string;
        coins: number;
        score: number;
        level: number;
        achievements: AchievementId[];
    }> {
        return this.readLatest(() =>
            Object.entries(this.data.players)
                .map(([name, stash]) => {
                    const score = stashScore(stash);
                    return {
                        name,
                        coins: Number(stash.coins ?? 0),
                        score,
                        level: levelFromScore(score),
                        achievements: normalizeAchievementIds(stash.achievements),
                    };
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, Math.max(1, Math.min(200, limit)))
        );
    }
}

export const stashManager = new StashManager();

/** 单件物品价值估算（排行榜 / 仓库价值展示用）：按品质/等级给分，弹药按发计。 */
export function itemValue(type: string): number {
    if (!type) return 0;
    const def = GameObjectDefs[type];
    // 个别物品（如 awm）不在 GameObjectDefs：按通用物品估值，避免身价算成 0。
    if (!def) return 100;
    switch (def.type) {
        case "gun": {
            const quality = Number((def as { quality?: unknown }).quality ?? 0);
            return 80 + Math.max(0, quality) * 220;
        }
        case "melee":
            return 120;
        case "helmet":
        case "chest":
        case "backpack": {
            const tier = Number(String(type).match(/(\d)$/)?.[1] ?? 1);
            return 40 + Math.max(1, tier) * 60;
        }
        case "scope": {
            const zoom = Number(String(type).match(/^(\d+)x/)?.[1] ?? 1);
            return 20 + Math.max(1, zoom) * 50;
        }
        case "ammo": {
            const perRound: Record<string, number> = {
                "9mm": 0.15,
                "9mm_cursed": 0.2,
                "45acp": 0.15,
                "12gauge": 0.18,
                "556mm": 0.22,
                "762mm": 0.3,
                "50AE": 0.7,
                "308sub": 1.2,
                awm: 12,
                flare: 10,
                potato_ammo: 0.05,
                bugle_ammo: 0.05,
            };
            return perRound[type] ?? 0.15;
        }
        case "heal":
            return /bandage/i.test(type) ? 14 : 45;
        case "boost":
            return 25;
        case "throwable": {
            const per: Record<string, number> = {
                frag: 45,
                mirv: 150,
                smoke: 35,
                strobe: 120,
                snowball: 5,
                potato: 5,
            };
            return per[type] ?? 45;
        }
        case "perk":
            return 800;
        default:
            return 10;
    }
}

/** 玩家身价 = 金币 + 仓库物品价值 + 当前配装价值。 */
export function stashScore(stash: PlayerStash): number {
    let total = Number(stash.coins ?? 0);
    const addRecord = (record: Record<string, number> | undefined): void => {
        if (!record) return;
        for (const [type, count] of Object.entries(record)) {
            const n = Number(count) || 0;
            if (n > 0 && type) total += itemValue(type) * n;
        }
    };
    const items = stash.items;
    if (items) {
        addRecord(items.guns);
        addRecord(items.melee);
        addRecord(items.ammo);
        addRecord(items.consumables);
        addRecord(items.helmets);
        addRecord(items.chests);
        addRecord(items.backpacks);
        addRecord(items.scopes);
        addRecord(items.throwables);
        addRecord(items.perks);
    }
    for (const perk of stash.oneTimePerks ?? []) {
        if (perk) total += itemValue(perk);
    }
    const loadout = stash.loadout;
    if (loadout) {
        for (const gun of loadout.guns ?? []) {
            if (gun) total += itemValue(gun);
        }
        if (loadout.melee) total += itemValue(loadout.melee);
        addRecord(loadout.ammo);
        addRecord(loadout.consumables);
        addRecord(loadout.throwables);
        for (const perk of loadout.perks ?? []) {
            if (perk) total += itemValue(perk);
        }
        const armor = loadout.armor;
        if (armor) {
            for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
                const armorType = armor[key];
                if (armorType) total += itemValue(armorType);
            }
        }
    }
    return Math.round(total);
}

/** 等级：按身价换算。等级要求大幅提高：每 15000 身价升 1 级，
 *  当前最富裕的玩家（身价约 6.5 万）约为 LV5，封顶 50。 */
export function levelFromScore(score: number): number {
    return Math.max(1, Math.min(50, 1 + Math.floor(Math.max(0, score) / 15000)));
}
