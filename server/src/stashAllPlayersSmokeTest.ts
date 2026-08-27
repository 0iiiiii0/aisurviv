import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getServerDataFilePath, PersistenceError } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const TEST_FILE = "survivio-test-stash-all.json";
const testPath = getServerDataFilePath(TEST_FILE);

try {
    fs.rmSync(testPath, { force: true });
} catch {
    // ignore
}

let manager: StashManager | null = null;
try {
    manager = new StashManager(TEST_FILE);
    // 创建 3 个测试玩家。
    manager.addItem("Alice", "ak47", 2);
    manager.addItem("Bob", "ak47", 2);
    manager.addItem("Carol", "ak47", 2);
    assert.equal(manager.listAll().length, 3);

    // 给全体玩家添加普通子弹：每人 +30。
    let result = manager.addItemToAll("9mm", 30);
    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 3);
    for (const p of manager.listAll()) {
        assert.equal(p.stash.items.ammo?.["9mm"], 30);
    }

    // 枪械每人 +1。
    const akBefore = manager.listAll().map(
        (p) => Number(p.stash.items.guns.ak47 ?? 0),
    );
    result = manager.addItemToAll("ak47", 1);
    assert.equal(result.updatedCount, 3);
    const akAfter = manager.listAll().map(
        (p) => Number(p.stash.items.guns.ak47 ?? 0),
    );
    assert.deepEqual(
        akAfter.map((value, index) => value - akBefore[index]),
        [1, 1, 1],
        "every player must receive exactly +1 gun",
    );

    // 双枪折算：给全体加 1 把双持 m93r → 每人 2 把单枪 m93r。
    result = manager.addItemToAll("m93r_dual", 1);
    assert.equal(result.ok, true);
    assert.equal(result.updatedCount, 3);
    for (const p of manager.listAll()) {
        assert.equal(p.stash.items.guns.m93r, 2);
    }

    // 无效类型拒绝。
    result = manager.addItemToAll("not-a-real-item", 5);
    assert.equal(result.ok, false);
    assert.equal(result.updatedCount, 0);

    // 能力（perk）：可入库、可携带、进局发放并扣仓、撤离回收。
    manager.addItem("Alice", "endless_ammo", 2);
    manager.addItem("Alice", "ap_rounds", 1);
    assert.equal(manager.listAll()[0].stash.items.perks.endless_ammo, 2);
    assert.equal(
        manager.setLoadout("Alice", {
            guns: [],
            ammo: {},
            consumables: {},
            throwables: {},
            perks: ["endless_ammo", "ap_rounds", "not-a-perk"],
            armor: {},
        }).ok,
        true,
    );
    const granted = manager.grantLoadout("Alice");
    assert(granted, "loadout with perks must grant");
    assert.deepEqual(granted.perks, ["endless_ammo", "ap_rounds"]);
    const after = manager.getStash("Alice");
    assert.equal(after.items.perks.endless_ammo, 1, "one endless_ammo consumed");
    assert.equal(
        "ap_rounds" in after.items.perks,
        false,
        "ap_rounds fully consumed",
    );
    // 撤离回收：携带的 perk 归还仓库。
    manager.collectCarriedLoot("Alice", {
        weapons: [],
        inventory: {},
        perks: [...(granted.perks ?? [])],
    });
    const recovered = manager.getStash("Alice");
    assert.equal(recovered.items.perks.endless_ammo, 2, "perk recovered on extraction");
    assert.equal(recovered.items.perks.ap_rounds, 1, "perk recovered on extraction");

    // 5) listAll 必须重新加载磁盘：模拟"后台进程在玩家创建后才启动"，也能看到
    //    全部玩家（修复"后台找不到玩家仓库"）。
    {
        // 新实例（模拟另一进程）先创建一名玩家。
        const lateManager = new StashManager(TEST_FILE);
        lateManager.addItem("LateArrival", "9mm", 30);
        const names = manager.listAll().map((entry) => entry.name);
        assert.ok(
            names.includes("LateArrival"),
            "listAll must reload disk to see late-created players",
        );
        assert.ok(names.includes("Alice"), "existing players still listed");
    }

    // #10: 仓库 JSON 损坏后不得自动变成空仓库——进入只读维护拒绝写入，
    // 损坏文件用时间戳保存；有有效备份时从备份恢复。
    {
        const corruptFile = "survivio-test-stash-corrupt.json";
        const corruptPath = getServerDataFilePath(corruptFile);
        const backupPath = `${corruptPath}.bak`;
        const cleanUp = (): void => {
            for (const p of [corruptPath, backupPath]) {
                try {
                    fs.rmSync(p, { force: true });
                } catch {
                    // ignore
                }
            }
            const dir = path.dirname(corruptPath);
            for (const f of fs.readdirSync(dir)) {
                if (f.startsWith(`${corruptFile}.corrupt-`)) {
                    try {
                        fs.rmSync(path.join(dir, f), { force: true });
                    } catch {
                        // ignore
                    }
                }
            }
        };
        try {
            cleanUp();
            // 无有效备份：进入只读维护，写操作必须抛 PersistenceError，
            // 绝不能把空仓库写回正式文件。
            fs.writeFileSync(corruptPath, "{ not valid json !!!", "utf8");
            const readOnlyManager = new StashManager(corruptFile);
            assert.throws(
                () => readOnlyManager.addItem("Alice", "ak47", 1),
                PersistenceError,
                "write must be rejected while the stash file is corrupt (read-only maintenance)",
            );
            const dir = path.dirname(corruptPath);
            const backups = fs.readdirSync(dir).filter(
                (f) => f.startsWith(`${corruptFile}.corrupt-`),
            );
            assert.ok(backups.length > 0, "corrupt file must be preserved as a timestamped copy");

            // 有有效 .bak：从备份恢复，写入恢复可用。
            fs.rmSync(corruptPath, { force: true });
            fs.writeFileSync(
                backupPath,
                JSON.stringify({
                    players: {
                        Bob: { coins: 5, items: {}, loadout: {} },
                    },
                }),
                "utf8",
            );
            fs.writeFileSync(corruptPath, "{ also not valid json", "utf8");
            const recoveredManager = new StashManager(corruptFile);
            assert.equal(
                recoveredManager.getStash("Bob").coins,
                5,
                "stash must recover from the validated backup",
            );
            assert.equal(
                recoveredManager.addItem("Bob", "ak47", 1).ok,
                true,
                "writes are allowed again after recovery from backup",
            );
        } finally {
            cleanUp();
        }
    }

    // #6: addItemToAll 不得双重持久化——内部不应再调用 persistNow()，
    // 否则同一次发放会写磁盘两次：第一次成功、第二次失败时接口误报
    // “发放失败”而磁盘已生效，管理员重试会造成重复补偿。
    {
        const st = manager as unknown as { persistNow: () => void };
        const originalPersist = st.persistNow.bind(manager);
        let persistCalls = 0;
        st.persistNow = () => {
            persistCalls += 1;
            originalPersist();
        };
        try {
            const result = manager.addItemToAll("bandage", 1);
            assert.equal(result.ok, true);
            assert.equal(
                persistCalls,
                1,
                "addItemToAll must persist exactly once (outer transaction only)",
            );
        } finally {
            st.persistNow = originalPersist;
        }
    }

    // 幽灵武器：配装引用了仓库中已不存在的枪时，保存、读取、进局发放
    // 三处都要清掉，避免绝密入口检查误判“已带合格武器”却空手进局。
    {
        // 注意：首次创建玩家会发放新手包（ak47×2），因此这里用新手包
        // 之外的 groza / m93r 来精确构造“仓库里没有枪”的场景。
        // setLoadout 保存时清理。
        manager.addItem("GhostGun", "groza", 2);
        assert.equal(
            manager.setLoadout("GhostGun", {
                guns: ["groza", ""],
                ammo: { "762mm": 30 },
                consumables: {},
                throwables: {},
                armor: {},
            }).ok,
            true,
        );
        assert.equal(manager.getStash("GhostGun").loadout.guns[0], "groza");
        // 仓库的枪被消耗/丢失后，再保存配装必须把幽灵枪清掉。
        assert.equal(manager.removeItem("GhostGun", "groza", 2).ok, true);
        assert.equal(
            manager.setLoadout("GhostGun", {
                guns: ["groza", ""],
                ammo: {},
                consumables: {},
                throwables: {},
                armor: {},
            }).ok,
            true,
        );
        assert.equal(
            manager.getStash("GhostGun").loadout.guns[0],
            "",
            "setLoadout must drop guns that no longer exist in the stash",
        );

        // 读取时清理（含持久化）：直接把幽灵枪写进旧数据再读取。
        manager.addItem("GhostRead", "groza", 2);
        assert.equal(
            manager.setLoadout("GhostRead", {
                guns: ["groza", ""],
                ammo: {},
                consumables: {},
                throwables: {},
                armor: {},
            }).ok,
            true,
        );
        assert.equal(manager.removeItem("GhostRead", "groza", 2).ok, true);
        assert.equal(
            manager.getStash("GhostRead").loadout.guns[0],
            "",
            "getStash must drop guns that no longer exist in the stash",
        );

        // 进局发放时清理：仓库不足时空手发放，且同步清掉配装里的幽灵枪。
        manager.addItem("GhostGrant", "m93r", 2);
        assert.equal(
            manager.setLoadout("GhostGrant", {
                guns: ["m93r_dual", ""],
                ammo: { "9mm": 60 },
                consumables: {},
                throwables: {},
                armor: {},
            }).ok,
            true,
        );
        assert.equal(manager.removeItem("GhostGrant", "m93r", 2).ok, true);
        const ghostGrant = manager.grantLoadout("GhostGrant");
        assert(ghostGrant, "a ghost-only loadout must still return a grant result");
        assert.equal(
            ghostGrant.weapons[0]?.type ?? "",
            "",
            "grant must not hand out a gun that is missing from the stash",
        );
        assert.equal(
            manager.getStash("GhostGrant").loadout.guns[0],
            "",
            "grant must clear the ghost gun from the persisted loadout",
        );
    }

    console.log(
        "Stash all-players smoke test passed: addItemToAll single-persist, perk carry/grant/recover, caps, dual-gun conversion, ghost-gun cleanup, listAll disk reload, corrupt-file read-only safety + backup recovery.",
    );
} finally {
    try {
        fs.rmSync(testPath, { force: true });
    } catch {
        // ignore
    }
}
