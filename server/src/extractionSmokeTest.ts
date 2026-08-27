import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
    EXTRACTION_HOLD_SECONDS,
    EXTRACTION_POINT_COUNT,
    EXTRACTION_ZONE_RADIUS,
    farthestExtractionPoint,
    generateExtractionPoints,
    insideExtractionZone,
} from "../../shared/defs/extractionDefs.ts";
import { Config, getServerDataFilePath } from "./config.ts";
import {
    defaultExtractionAiLoadouts,
    defaultExtractionSecretAiLoadouts,
    normalizePreset,
    pickWeightedExtractionLoadout,
    specToGrantedLoadout,
} from "./extractionLoadouts.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { StashManager } from "./stash/stashManager.ts";
import { stashManager } from "./stash/stashManager.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

// 1) Deterministic extraction points shared by server and client.
{
    const points = generateExtractionPoints("extraction", 1024, 1024);
    assert.equal(points.length, EXTRACTION_POINT_COUNT);
    const again = generateExtractionPoints("extraction", 1024, 1024);
    assert.deepEqual(points, again, "points must be deterministic per map");
    const other = generateExtractionPoints("extraction", 512, 512);
    assert.notDeepEqual(points, other, "different dimensions must differ");
    for (const point of points) {
        assert.ok(point.x > 20 && point.x < 1004, `point x in bounds: ${point.x}`);
        assert.ok(point.y > 20 && point.y < 1004, `point y in bounds: ${point.y}`);
    }
}

// 2) The active extraction point is the farthest one from the player.
{
    const points = [
        { x: 100, y: 100 },
        { x: 900, y: 100 },
        { x: 100, y: 900 },
        { x: 900, y: 900 },
        { x: 500, y: 500 },
    ];
    const active = farthestExtractionPoint(points, { x: 110, y: 90 });
    assert.deepEqual(active, { x: 900, y: 900 }, "farthest point must be active");
    assert.equal(
        insideExtractionZone(active, { x: 902, y: 902 }, EXTRACTION_ZONE_RADIUS),
        true,
    );
    assert.equal(
        insideExtractionZone(active, { x: 100, y: 100 }, EXTRACTION_ZONE_RADIUS),
        false,
    );
    assert.equal(EXTRACTION_HOLD_SECONDS > 0, true);
}

// 3) Stash: same-type stacking, category separation, caps and loadout grant.
{
    const file = getServerDataFilePath("survivio-stash-test.json");
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    const stash = new StashManager("survivio-stash-test.json");
    try {
        assert.equal(stash.addItem("tester", "ak47", 2).ok, true);
        assert.equal(stash.addItem("tester", "ak47", 1).ok, true);
        // Test starter pack seeds 2x ak47 before the added items stack on top.
        assert.equal(stash.getStash("tester").items.guns.ak47, 5, "guns stack by type");
        assert.equal(stash.addItem("tester", "762mm", 90).ok, true);
        assert.equal(stash.addItem("tester", "762mm", 60).ok, true);
        assert.equal(
            stash.getStash("tester").items.ammo["762mm"],
            350,
            "ammo stacks with starter pack (stash cap 999, independent of protocol)",
        );
        assert.equal(stash.addItem("tester", "bandage", 4).ok, true);
        assert.equal(
            stash.getStash("tester").items.consumables.bandage,
            14,
            "consumables stack with starter pack",
        );
        assert.equal(stash.addItem("tester", "helmet01", 1).ok, true);
        assert.equal(stash.addItem("tester", "bogus_item", 1).ok, false, "invalid items rejected");

        const loadoutResult = stash.setLoadout("tester", {
            guns: ["ak47"],
            ammo: { "762mm": 90 },
            consumables: { bandage: 4 },
            armor: { helmet: "helmet01", backpack: "backpack01" },
        });
        assert.equal(loadoutResult.ok, true);

        const granted = stash.grantLoadout("tester");
        assert.ok(granted, "loadout must be granted");
        assert.equal(granted.weapons[0]?.type, "ak47");
        // 弹匣装 30 发（ak47 满弹匣），剩余 60 发作后备。
        assert.equal(granted.weapons[0]?.ammo, 30, "weapon starts with a full clip");
        assert.equal(granted.inventory?.["762mm"], 60);
        assert.equal(granted.helmet, "helmet01");
        // The starter pack includes a backpack, so it is granted and deducted.
        assert.equal(granted.backpack, "backpack01");
        assert.equal(stash.getStash("tester").items.backpacks.backpack01, 1);
        // Deducted from the stash.
        assert.equal(stash.getStash("tester").items.guns.ak47, 4);
        assert.equal(stash.getStash("tester").items.ammo["762mm"], 260);

        stash.collectCarriedLoot("tester", {
            weapons: ["m4a1"],
            inventory: { "556mm": 60, bandage: 2 },
            helmet: "helmet02",
        });
        assert.equal(stash.getStash("tester").items.guns.m4a1, 1);
        assert.equal(stash.getStash("tester").items.helmets.helmet02, 1);

        // A brand-new player receives the starter pack exactly once.
        const starter = stash.getStash("newbie");
        assert.equal(starter.items.guns.ak47, 2, "starter pack grants 2 ak47");
        assert.equal(starter.items.melee.knuckles, undefined, "starter pack grants no melee");
        assert.equal(starter.items.ammo["762mm"], 200, "starter pack grants 200 762mm");
        assert.equal(starter.items.ammo["9mm"], undefined, "starter pack grants no 9mm");
        assert.equal(
            starter.items.consumables.bandage,
            10,
            "starter pack grants 10 bandages",
        );
        assert.equal(starter.items.helmets.helmet01, 2, "starter pack grants 2 helmets");
        assert.equal(starter.items.backpacks.backpack01, 2, "starter pack grants 2 backpacks");
        assert.equal(starter.items.scopes["2xscope"], 2, "starter pack grants 2 scopes");
        assert.equal(starter.items.scopes["1xscope"], undefined, "1x scope is default-issued");
        assert.equal(starter.items.throwables.frag, undefined, "starter pack grants no throwables");

        // 双枪同口径：备用弹药只扣一次（不重复扣）。
        stash.addItem("dualammo", "glock", 2);
        stash.addItem("dualammo", "9mm", 200);
        stash.setLoadout("dualammo", {
            guns: ["glock", "glock"],
            ammo: { "9mm": 100 },
            consumables: {},
            armor: {},
        });
        const ammoBefore = stash.getStash("dualammo").items.ammo["9mm"];
        stash.grantLoadout("dualammo");
        const ammoAfter = stash.getStash("dualammo").items.ammo["9mm"];
        assert.equal(
            ammoBefore - ammoAfter,
            100,
            "dual guns share one reserve-ammo deduction",
        );

        // 撤离收集：倍镜不重复入库；默认 1x 倍镜不入库。
        stash.collectCarriedLoot("collector", {
            weapons: [],
            inventory: { "2xscope": 1, "1xscope": 1, "9mm": 30 },
            scope: "2xscope",
        });
        const collected = stash.getStash("collector").items;
        assert.equal(
            collected.scopes["2xscope"],
            3,
            "scope collected exactly once (starter 2 + 1)",
        );
        assert.equal(
            collected.scopes["1xscope"],
            undefined,
            "default 1x scope never enters the stash",
        );
        assert.equal(
            collected.ammo["9mm"],
            30,
            "ammo collected exactly once",
        );

        // 背包容量：发放按最终背包等级限制（backpack01 = level 1）。
        stash.addItem("capacity", "glock", 1);
        stash.addItem("capacity", "9mm", 300);
        stash.setLoadout("capacity", {
            guns: ["glock"],
            ammo: { "9mm": 300 },
            consumables: {},
            armor: { backpack: "backpack01" },
        });
        const grantedCapacity = stash.grantLoadout("capacity");
        assert.equal(
            grantedCapacity?.inventory?.["9mm"],
            223,
            "reserve clamps to backpack capacity (240) minus the glock clip (17)",
        );
        // 保存时同样按背包容量收紧：超限部分不写入配装。
        assert.equal(
            stash.getStash("capacity").loadout.ammo["9mm"],
            240,
            "setLoadout clamps carried ammo to the backpack capacity",
        );
        // 移除背包后容量回到 level 0（9mm 上限 120）。
        stash.setLoadout("capacity", {
            guns: ["glock"],
            ammo: { "9mm": 240 },
            consumables: {},
            armor: {},
        });
        assert.equal(
            stash.getStash("capacity").loadout.ammo["9mm"],
            120,
            "removing the backpack clamps carried ammo to level-0 capacity",
        );

        // 仓库存储与局内协议解耦：弹药可存超过 510（上限 999）。
        stash.addItem("overlimit", "9mm", 50);
        assert.equal(
            stash.getStash("overlimit").items.ammo["9mm"],
            50,
            "stash ammo stacks (starter has no 9mm; cap is 999)",
        );
    } finally {
        try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    }
}

// 3b) 多进程一致性：锁 + 读前重载 + 唯一临时文件。
//     模拟 API 进程与房间 worker 各自持有 StashManager 并发读写同一文件。
{
    const file = getServerDataFilePath("survivio-stash-test.json");
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    const instanceA = new StashManager("survivio-stash-test.json");
    const instanceB = new StashManager("survivio-stash-test.json");
    try {
        instanceA.addItem("p1", "ak47", 1);
        // 另一实例立即可见（读前重载磁盘最新）。
        assert.equal(
            instanceB.getStash("p1").items.guns.ak47,
            3,
            "second instance sees writes after reload",
        );
        // 两个"进程"交替写入同一玩家，互不覆盖（锁串行 + 重载合并）。
        for (let i = 0; i < 20; i++) {
            instanceA.addItem("p1", "bandage", 1);
            instanceB.addItem("p1", "soda", 1);
        }
        const latest = new StashManager("survivio-stash-test.json");
        const items = latest.getStash("p1").items;
        assert.equal(
            items.consumables.bandage,
            10 + 20,
            "bandage accumulated across instances",
        );
        assert.equal(
            items.consumables.soda,
            4 + 20,
            "soda accumulated across instances",
        );
        assert.equal(
            items.guns.ak47,
            3,
            "guns unchanged across concurrent writes",
        );
        // 无 .tmp 残留（唯一临时文件名，写完即 rename）。
        const leftovers = fs
            .readdirSync(path.dirname(file))
            .filter((name) => name.includes(".tmp"));
        assert.equal(leftovers.length, 0, "no stale .tmp files left behind");
    } finally {
        try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    }
}

// 3c) 崩溃恢复：进局发放记录"待结算"，崩溃后重启把装备归还仓库；
//     正常死亡/撤离会清除待结算，崩溃后不再归还。
{
    const file = getServerDataFilePath("survivio-stash-crash-test.json");
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    const sm = new StashManager("survivio-stash-crash-test.json");
    try {
        sm.addItem("crash", "ak47", 3);
        sm.addItem("crash", "762mm", 200);
        sm.setLoadout("crash", {
            guns: ["ak47"],
            ammo: { "762mm": 90 },
            consumables: {},
            armor: {},
        });
        const beforeGuns = sm.getStash("crash").items.guns.ak47;
        const beforeAmmo = sm.getStash("crash").items.ammo["762mm"];
        sm.grantLoadout("crash");
        const afterGrant = sm.getStash("crash").items;
        assert.equal(afterGrant.guns.ak47, beforeGuns - 1, "grant deducts the gun");
        // 新实例模拟崩溃后重启：未结算 → 全额归还（含弹匣子弹）。
        const rebooted = new StashManager("survivio-stash-crash-test.json");
        assert.equal(
            rebooted.recoverPendingGrants(),
            1,
            "crash recovery returns the pending grant",
        );
        const after = rebooted.getStash("crash").items;
        assert.equal(after.guns.ak47, beforeGuns, "gun returned after crash recovery");
        assert.equal(
            after.ammo["762mm"],
            beforeAmmo,
            "ammo (mag + reserve) returned after crash recovery",
        );

        // 正常死亡：清除待结算，崩溃后不再归还。
        sm.setLoadout("crash", {
            guns: ["ak47"],
            ammo: { "762mm": 60 },
            consumables: {},
            armor: {},
        });
        const before2 = sm.getStash("crash").items.ammo["762mm"];
        sm.grantLoadout("crash");
        sm.clearPendingGrant("crash");
        const rebooted2 = new StashManager("survivio-stash-crash-test.json");
        assert.equal(
            rebooted2.recoverPendingGrants(),
            0,
            "cleared pending grants are not recovered",
        );
        assert.equal(
            rebooted2.getStash("crash").items.ammo["762mm"],
            before2 - 60,
            "normal death keeps the deduction (no return)",
        );
    } finally {
        try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    }
}

// 4) AI loadout presets: normalization, weighted pick and granted shape.
{
    const preset = normalizePreset({
        name: "测试配装",
        weight: 10,
        loadout: {
            guns: ["ak47", "bad_gun", "m9"],
            ammo: { "762mm": 120, bogus: 5 },
            consumables: { bandage: 5 },
            armor: { helmet: "helmet01", chest: "not-chest" },
        },
    });
    assert.ok(preset, "preset must normalize");
    assert.deepEqual(preset.loadout.guns, ["ak47", "m9"], "guns limited to two valid");
    assert.equal(preset.loadout.ammo["762mm"], 120);
    assert.equal(preset.loadout.ammo.bogus, undefined);
    assert.equal(preset.loadout.armor.chest, undefined);

    const picked = pickWeightedExtractionLoadout([
        { name: "only", weight: 1, loadout: { guns: ["mp5"], ammo: {}, consumables: {}, armor: {} } },
    ]);
    assert.equal(picked?.guns[0], "mp5");

    const granted = specToGrantedLoadout({
        guns: ["ak47"],
        ammo: { "762mm": 90 },
        consumables: { bandage: 3 },
        armor: { helmet: "helmet01" },
    });
    assert.equal(granted.weapons[0].type, "ak47");
    assert.equal(granted.inventory?.["762mm"], 90);
    assert.equal(granted.inventory?.bandage, 3);
    assert.equal(granted.helmet, "helmet01");
}

// 4b) 默认配装的弹药必须与武器匹配（如 mosin/sv98 用 762mm，awc 用 308sub）。
{
    const gunAmmo = (type: string): string =>
        (GunDefs as Record<string, { ammo?: string }>)[type]?.ammo ?? "";
    const checkPreset = (preset: {
        name: string;
        loadout: { guns: string[]; ammo: Record<string, number> };
    }) => {
        const ammoKeys = Object.keys(preset.loadout.ammo);
        for (const gun of preset.loadout.guns) {
            const needed = gunAmmo(gun);
            if (!needed) continue;
            assert.equal(
                ammoKeys.includes(needed),
                true,
                `${preset.name} 的 ${gun} 需要 ${needed} 弹药，但配了 ${ammoKeys.join(",")}`,
            );
        }
    };
    for (const preset of defaultExtractionAiLoadouts) checkPreset(preset);
    for (const preset of defaultExtractionSecretAiLoadouts) checkPreset(preset);
}

// 5) Full game integration: the extraction map boots, AI receive a preset
//    loadout at spawn and the extraction system plans points for the map.

// 5b) MatchTimeMsg protocol round-trip: the countdown payload must survive
//     serialization exactly as broadcast by the game server.
{
    const msg = new net.MatchTimeMsg();
    msg.started = true;
    msg.startedTime = 123.5;
    const msgStream = new net.MsgStream(new ArrayBuffer(32));
    msgStream.serializeMsg(net.MsgType.MatchTime, msg);
    const serialized = msgStream.getBuffer();
    const copy = serialized.buffer.slice(
        serialized.byteOffset,
        serialized.byteOffset + serialized.byteLength,
    );
    const inStream = new net.BitStream(copy);
    assert.equal(inStream.readUint8(), net.MsgType.MatchTime, "payload starts with MatchTime type");
    const out = new net.MatchTimeMsg();
    out.deserialize(inStream);
    assert.equal(out.started, true, "MatchTime started flag round-trips");
    assert.ok(
        Math.abs(out.startedTime - 123.5) < 0.001,
        "MatchTime startedTime round-trips",
    );
}

// 5c) ExtractionHumanHintMsg 协议往返：搜打撤真人位置提示必须被机器人端
//     完整还原且保持字节对齐，避免破坏后续消息流。
{
    const hint = new net.ExtractionHumanHintMsg();
    hint.humans = [
        { id: 1234, x: 100.5, y: -200.25, layer: 1 },
        { id: 5678, x: 0, y: 512, layer: 0 },
    ];
    hint.battleOrders = [{
        botId: 77,
        targetHumanId: 1234,
        role: net.ExtractionBattleRole.Flanker,
        phase: net.ExtractionBattlePhase.Breach,
        active: true,
        blindFire: false,
        underFireResponse: true,
        targetLayer: 1,
        objectiveLayer: 0,
        objectiveX: 88.25,
        objectiveY: 92.5,
        fireX: 100.5,
        fireY: -200.25,
        entryStructureId: 901,
        entryStairIndex: 2,
        clearObstacleId: 444,
        cycle: 3,
    }];
    const msgStream = new net.MsgStream(new ArrayBuffer(256));
    msgStream.serializeMsg(net.MsgType.ExtractionHumanHint, hint);
    const serialized = msgStream.getBuffer();
    const copy = serialized.buffer.slice(
        serialized.byteOffset,
        serialized.byteOffset + serialized.byteLength,
    );
    const inStream = new net.BitStream(copy);
    assert.equal(
        inStream.readUint8(),
        net.MsgType.ExtractionHumanHint,
        "payload starts with ExtractionHumanHint type",
    );
    const restored = new net.ExtractionHumanHintMsg();
    restored.deserialize(inStream);
    assert.equal(restored.humans.length, 2, "hint count round-trips");
    assert.equal(restored.humans[0].id, 1234);
    assert.ok(Math.abs(restored.humans[0].x - 100.5) < 0.001);
    assert.ok(Math.abs(restored.humans[0].y - -200.25) < 0.001);
    assert.equal(restored.humans[0].layer, 1);
    assert.equal(restored.humans[1].id, 5678);
    assert.deepEqual(restored.battleOrders, hint.battleOrders);
    assert.equal(inStream.index % 8, 0, "hint message stays byte-aligned");
}

async function runGameIntegration(): Promise<void> {
    const game = new Game(
        "extraction-smoke",
        { mapName: "extraction", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();

    game.addJoinToken("ai-token", true, 1, 60_000, false, true, undefined);
    const aiMsg = new net.JoinMsg();
    aiMsg.protocol = GameConfig.protocolVersion;
    aiMsg.matchPriv = "ai-token";
    aiMsg.name = "AI-extract";
    const bot = game.playerBarn.addPlayer("ai-socket", aiMsg);
    assert(bot, "AI must join");
    (game as unknown as { applyExtractionSpawnLoadout(p: typeof bot): void }).applyExtractionSpawnLoadout(
        bot,
    );
    const hasGun =
        String(bot.weapons[GameConfig.WeaponSlot.Primary]?.type ?? "") !== "" ||
        String(bot.weapons[GameConfig.WeaponSlot.Secondary]?.type ?? "") !== "";
    assert.ok(hasGun, "extraction AI must spawn with a preset loadout gun");
    assert.ok(
        Number(bot.inventory.bandage ?? 0) > 0 ||
            Number(bot.inventory["762mm"] ?? 0) > 0 ||
            Number(bot.inventory["9mm"] ?? 0) > 0 ||
            Number(bot.inventory["556mm"] ?? 0) > 0,
        "extraction AI must spawn with preset ammo or consumables",
    );

    const points = game.extraction().points;
    assert.equal(points.length, EXTRACTION_POINT_COUNT);
    for (const point of points) {
        assert.ok(point.x > 0 && point.y > 0, "extraction points must be in-map");
    }
    const active = game.extraction().activePointFor(bot);
    assert.ok(points.some((p) => p.x === active.x && p.y === active.y), "active point is one of the planned points");

    // 固定撤离点：移动后不切换（不再追最远点）。
    const assigned = game.extraction().pointIndexFor(bot);
    bot.pos.x += 300;
    bot.pos.y += 300;
    assert.equal(
        game.extraction().pointIndexFor(bot),
        assigned,
        "extraction point must stay fixed after moving",
    );
    assert.deepEqual(
        game.extraction().activePointFor(bot),
        active,
        "active point stays the same while the player moves",
    );
    bot.pos.x -= 300;
    bot.pos.y -= 300;

    // 双枪形态：两把相同单枪 → 主槽合成双枪、副槽空（不占武器槽位）。
    bot.applyExtractionLoadout({
        weapons: [
            { type: "glock", ammo: 34 },
            { type: "glock", ammo: 34 },
        ],
    });
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Primary]?.type,
        "glock_dual",
        "two identical pistols combine into a dual weapon",
    );
    assert.equal(
        String(bot.weapons[GameConfig.WeaponSlot.Secondary]?.type ?? ""),
        "",
        "dual weapon does not occupy the secondary slot",
    );

    // 两把相同的非双枪武器：1、2 号位各装一把（"装备两把 ak47"）。
    bot.applyExtractionLoadout({
        weapons: [
            { type: "ak47", ammo: 30 },
            { type: "ak47", ammo: 30 },
        ],
    });
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Primary]?.type,
        "ak47",
        "first ak47 is equipped in the primary slot",
    );
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Secondary]?.type,
        "ak47",
        "second ak47 is equipped in the secondary slot",
    );

    // 双枪槽位内容显式携带：1 号位双持 + 2 号位单持 / 两个双持。
    bot.applyExtractionLoadout({
        weapons: [
            { type: "m9_dual", ammo: 32 },
            { type: "m9", ammo: 16 },
        ],
    });
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Primary]?.type,
        "m9_dual",
        "slot-1 dual weapon is equipped",
    );
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Secondary]?.type,
        "m9",
        "slot-2 single weapon stays in the secondary slot",
    );
    bot.applyExtractionLoadout({
        weapons: [
            { type: "m9_dual", ammo: 32 },
            { type: "m9_dual", ammo: 32 },
        ],
    });
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Primary]?.type,
        "m9_dual",
        "slot-1 dual weapon is equipped",
    );
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Secondary]?.type,
        "m9_dual",
        "slot-2 dual weapon is equipped",
    );

    // 武器槽固定位置：只有 2 号位的武器必须装在副武器槽，
    // 不会因为 1 号位为空而前移到主武器槽。
    bot.applyExtractionLoadout({
        weapons: [
            { type: "" },
            { type: "groza", ammo: 30 },
        ],
    });
    assert.equal(
        String(bot.weapons[GameConfig.WeaponSlot.Primary]?.type ?? ""),
        "",
        "empty primary slot stays empty",
    );
    assert.equal(
        bot.weapons[GameConfig.WeaponSlot.Secondary]?.type,
        "groza",
        "slot-2 weapon is equipped in the secondary slot",
    );

    // 6) 搜打撤没有毒圈：game.update() 永远不会推进 gas。
    {
        const stageBefore = game.gas.stage;
        const radBefore = game.gas.currentRad;
        game.update();
        game.update();
        assert.equal(game.gas.stage, stageBefore, "gas must never advance in extraction mode");
        assert.equal(game.gas.currentRad, radBefore, "gas radius must stay fixed in extraction mode");
    }

    // 7) 对局开始后服务端每秒广播 MatchTime（客户端倒计时数据源）。
    {
        const gameState = game as unknown as { started: boolean; startedTime: number };
        gameState.started = true;
        gameState.startedTime = 0;
        const bufferBefore = game.msgsToSend.getBuffer().length;
        const deadline = Date.now() + 2000;
        let found = false;
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        while (Date.now() < deadline) {
            game.update();
            const buf = game.msgsToSend.getBuffer();
            for (let i = bufferBefore; i < buf.length; i++) {
                if (buf[i] === net.MsgType.MatchTime) {
                    found = true;
                    break;
                }
            }
            if (found) break;
            await sleep(16);
        }
        assert.ok(found, "MatchTime must be broadcast ~1s after match start");
    }

    // 7b) 搜打撤没有“最后幸存者胜利”：杀完所有人后不弹胜利、对局继续。
    {
        // 此时 bot 是唯一存活者（aliveCount == 1）且对局已开始。
        const overBefore = game.over;
        game.checkGameOver();
        assert.equal(
            game.over,
            overBefore,
            "last-man-standing must not end an extraction match",
        );
    }

    // 7c) 撤离：站进固定撤离点 5 秒 → 撤离成功；不掉落、不产生尸体
    //     （已入库物资不会被复制到地面）。
    {
        // serverBot 被撤离循环跳过（AI 不主动撤离），用真人模拟撤离。
        game.addJoinToken("human-token", false, 1, 60_000, false, false, undefined);
        const humanMsg = new net.JoinMsg();
        humanMsg.protocol = GameConfig.protocolVersion;
        humanMsg.matchPriv = "human-token";
        humanMsg.name = "HumanExtractor";
        const human = game.playerBarn.addPlayer("human-socket", humanMsg);
        assert(human, "human must join for extraction test");
        (game as unknown as { applyExtractionSpawnLoadout(p: typeof human): void }).applyExtractionSpawnLoadout(
            human,
        );
        const pt = game.extraction().activePointFor(human);
        human.pos.x = pt.x;
        human.pos.y = pt.y;
        const lootBefore = game.lootBarn.loots.length;
        const bodiesBefore = game.deadBodyBarn.deadBodies.length;
        for (
            let i = 0;
            i < Math.ceil(EXTRACTION_HOLD_SECONDS / (1 / 30)) + 5;
            i++
        ) {
            game.extraction().update(1 / 30);
        }
        assert.equal(human.dead, true, "extraction removes the player from the match");
        assert.equal(
            game.playerBarn.livingPlayers.includes(human),
            false,
            "extracted player is no longer living",
        );
        assert.equal(
            game.lootBarn.loots.length,
            lootBefore,
            "extraction must not drop loot (no duplication)",
        );
        assert.equal(
            game.deadBodyBarn.deadBodies.length,
            bodiesBefore,
            "extraction must not spawn a corpse",
        );
        assert.equal(
            game.humanPlayerCount,
            0,
            "an extracted human must no longer count toward humanPlayerCount",
        );
    }

    // 7c2) 倒地玩家不累计撤离进度（站在圈内也不撤离）。
    {
        game.addJoinToken(
            "downed-token",
            false,
            1,
            60_000,
            false,
            false,
            undefined,
        );
        const dMsg = new net.JoinMsg();
        dMsg.protocol = GameConfig.protocolVersion;
        dMsg.matchPriv = "downed-token";
        dMsg.name = "DownedTest";
        const downedPlayer = game.playerBarn.addPlayer("downed-socket", dMsg);
        assert(downedPlayer, "downed test player must join");
        downedPlayer.down({
            amount: 0,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 0, y: 0 },
            source: undefined,
        });
        const pt = game.extraction().activePointFor(downedPlayer);
        downedPlayer.pos.x = pt.x;
        downedPlayer.pos.y = pt.y;
        for (
            let i = 0;
            i < Math.ceil(EXTRACTION_HOLD_SECONDS / (1 / 30)) + 5;
            i++
        ) {
            game.extraction().update(1 / 30);
        }
        assert.equal(
            downedPlayer.dead,
            false,
            "downed player must not accumulate extraction progress",
        );
    }

    // 7d) 重连不重复扣仓：复用旧 Player 后再次 applyExtractionSpawnLoadout
    //     不得再次扣仓库或覆盖局内装备。
    {
        game.addJoinToken(
            "reconnect-token",
            false,
            1,
            60_000,
            false,
            false,
            undefined,
        );
        const rcMsg = new net.JoinMsg();
        rcMsg.protocol = GameConfig.protocolVersion;
        rcMsg.matchPriv = "reconnect-token";
        rcMsg.name = "ReconnectTest";
        const rcPlayer = game.playerBarn.addPlayer("rc-socket", rcMsg);
        assert(rcPlayer, "reconnect test player must join");
        const loadoutApplier = game as unknown as {
            applyExtractionSpawnLoadout(p: typeof rcPlayer): void;
        };
        stashManager.setLoadout("ReconnectTest", {
            guns: ["ak47"],
            ammo: { "762mm": 30 },
            consumables: {},
            armor: {},
        });
        const before = JSON.stringify(
            stashManager.getStash("ReconnectTest").items,
        );
        loadoutApplier.applyExtractionSpawnLoadout(rcPlayer);
        const afterFirst = JSON.stringify(
            stashManager.getStash("ReconnectTest").items,
        );
        assert.notEqual(afterFirst, before, "first spawn deducts the loadout");
        // 模拟重连：同一 Player 对象再次触发发放流程。
        loadoutApplier.applyExtractionSpawnLoadout(rcPlayer);
        const afterReconnect = JSON.stringify(
            stashManager.getStash("ReconnectTest").items,
        );
        assert.equal(
            afterReconnect,
            afterFirst,
            "reconnect must not double-deduct the stash",
        );
        assert.equal(
            rcPlayer.extractionLoadoutGranted,
            true,
            "loadout granted flag set after first spawn",
        );
    }

    // 7e) 协议不符：不创建玩家、不扣搜打撤配装、join token 返还。
    {
        game.addJoinToken(
            "bad-protocol-token",
            false,
            1,
            60_000,
            false,
            false,
            undefined,
        );
        const badMsg = new net.JoinMsg();
        badMsg.protocol = GameConfig.protocolVersion + 999;
        badMsg.matchPriv = "bad-protocol-token";
        badMsg.name = "BadProtocol";
        const badPlayer = game.playerBarn.addPlayer("bad-socket", badMsg);
        assert.equal(
            badPlayer,
            undefined,
            "invalid protocol must not create a player",
        );
        const token = game.joinTokens.get("bad-protocol-token");
        assert.ok(
            token && token.avaliableUses >= 1,
            "join token must be refunded after protocol rejection",
        );
    }

    // 8) 整局限时 10 分钟：时间到后全员阵亡。
    {
        const gameState = game as unknown as { started: boolean; startedTime: number };
        gameState.started = true;
        gameState.startedTime = 600;
        // bot 仍在场：时间到全员阵亡，随后空场结束房间。
        game.extraction().update(0.1);
        assert.equal(bot.dead, true, "time-up eliminates all living players");
        assert.equal(game.over, true, "empty extraction arena must close the room");
    }

    // 8b) 全员阵亡（空场）后房间正常结束，但依旧不产生胜利者。
    assert.equal(game.over, true, "empty extraction arena must close the room");

    game.stop();
}

// 5c) Team variants (duo / squad): extraction must never announce a
//     last-team-standing victory; an empty arena still closes the room.
async function runTeamGameIntegration(teamMode: TeamMode): Promise<void> {
    const game = new Game(
        `extraction-team-${teamMode}`,
        { mapName: "extraction", teamMode },
        () => {},
        () => {},
    );
    await game.init();

    game.addJoinToken("team-ai-1", true, 1, 60_000, false, true, undefined);
    game.addJoinToken("team-ai-2", true, 1, 60_000, false, true, undefined);
    const msg1 = new net.JoinMsg();
    msg1.protocol = GameConfig.protocolVersion;
    msg1.matchPriv = "team-ai-1";
    msg1.name = "TeamBot-1";
    const msg2 = new net.JoinMsg();
    msg2.protocol = GameConfig.protocolVersion;
    msg2.matchPriv = "team-ai-2";
    msg2.name = "TeamBot-2";
    const bot1 = game.playerBarn.addPlayer("team-socket-1", msg1);
    const bot2 = game.playerBarn.addPlayer("team-socket-2", msg2);
    assert(bot1 && bot2, "team bots must join");
    assert.notEqual(bot1.groupId, bot2.groupId, "team bots must be opposing groups");

    const gameState = game as unknown as { started: boolean };
    gameState.started = true;
    assert.equal(game.modeManager.aliveCount(), 2, "two alive groups at start");

    // Eliminating the enemy group must NOT end the match with a victory.
    const overBefore = game.over;
    bot2.kill({
        amount: 0,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 0, y: 0 },
        source: bot1,
    });
    assert.equal(game.modeManager.aliveCount(), 1, "one group remains");
    assert.equal(
        game.over,
        overBefore,
        `extraction (teamMode ${teamMode}) must not trigger last-team-standing victory`,
    );

    // Eliminating the final group closes the room without a winner.
    bot1.kill({
        amount: 0,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 0, y: 0 },
        source: undefined,
    });
    assert.equal(game.modeManager.aliveCount(), 0, "arena is empty");
    assert.equal(
        game.over,
        true,
        `extraction (teamMode ${teamMode}) empty arena must close the room`,
    );

    game.stop();
}

// 5d) 搜打撤（含绝密）AI 在服务器层面互为队友：AI 的手雷/空袭/跳弹等
//     不会误杀其他 AI（它们没有共享 groupId/teamId，但 AI 在撤离点汇合时
//     互相爆炸会瞬间团灭）。真人仍能伤害 AI，AI 也仍能伤害真人。
async function runFriendlyFireIntegration(): Promise<void> {
    const game = new Game(
        "extraction-friendly-fire",
        { mapName: "extraction_secret", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();

    game.addJoinToken("ff-ai-1", true, 1, 60_000, false, true, undefined);
    game.addJoinToken("ff-ai-2", true, 1, 60_000, false, true, undefined);
    const msg1 = new net.JoinMsg();
    msg1.protocol = GameConfig.protocolVersion;
    msg1.matchPriv = "ff-ai-1";
    msg1.name = "FFBotA";
    const msg2 = new net.JoinMsg();
    msg2.protocol = GameConfig.protocolVersion;
    msg2.matchPriv = "ff-ai-2";
    msg2.name = "FFBotB";
    const botA = game.playerBarn.addPlayer("ff-socket-a", msg1);
    const botB = game.playerBarn.addPlayer("ff-socket-b", msg2);
    assert(botA && botB, "friendly-fire bots must join");
    assert(botA.serverBot && botB.serverBot, "both must be server bots");
    (
        game as unknown as {
            applyExtractionSpawnLoadout(p: typeof botA): void;
        }
    ).applyExtractionSpawnLoadout(botA);
    (
        game as unknown as {
            applyExtractionSpawnLoadout(p: typeof botB): void;
        }
    ).applyExtractionSpawnLoadout(botB);
    assert.notEqual(
        botA.groupId,
        botB.groupId,
        "bots have no shared group; protection must come from the extraction rule",
    );

    // AI 伤害 AI：必须被服务器当作队友伤害拦截。
    const botHealthBefore = botB.health;
    botB.damage({
        amount: 50,
        gameSourceType: "groza",
        source: botA,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    assert.equal(
        botB.health,
        botHealthBefore,
        "extraction AI must not damage other extraction AI (no friendly fire)",
    );

    game.addJoinToken("ff-human", false, 1, 60_000, false, false, undefined);
    // 服务端绝密资格校验：真人需配装合格武器（A/S/S+）才能加入。
    stashManager.addItem("FFHuman", "m4a1", 1);
    stashManager.setLoadout("FFHuman", {
        guns: ["m4a1", ""],
        ammo: {},
        consumables: {},
        armor: {},
    });
    const humanMsg = new net.JoinMsg();
    humanMsg.protocol = GameConfig.protocolVersion;
    humanMsg.matchPriv = "ff-human";
    humanMsg.name = "FFHuman";
    humanMsg.loadoutPriv = "FFHuman";
    const human = game.playerBarn.addPlayer("ff-socket-h", humanMsg);
    assert(human, "human must join");

    // 真人伤害 AI：正常生效。
    const aiHealthBefore = botA.health;
    botA.damage({
        amount: 30,
        gameSourceType: "groza",
        source: human,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    assert.ok(
        botA.health < aiHealthBefore,
        "a real player must still damage extraction AI",
    );

    // AI 伤害真人：正常生效。
    const humanHealthBefore = human.health;
    human.damage({
        amount: 20,
        gameSourceType: "groza",
        source: botA,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    assert.ok(
        human.health < humanHealthBefore,
        "extraction AI must still damage the real player",
    );

    // 即使 AI 被 AI 击杀（例如环境/异常路径），装备也要正常掉落。
    const lootBefore = game.lootBarn.loots.length;
    botA.kill({
        amount: 9999,
        gameSourceType: "groza",
        source: botB,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    const aiDrops = game.lootBarn.loots
        .slice(lootBefore)
        .map((loot) => loot.type);
    assert.ok(
        aiDrops.length > 0,
        "an AI killed by another AI must still drop equipment",
    );

    game.stop();

    // 普通搜打撤：自由各自为战——AI 之间可以互相伤害（与真人同等权重）。
    const normalGame = new Game(
        `extraction-ff-normal-${Math.random().toString(36).slice(2)}`,
        { mapName: "extraction", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await normalGame.init();
    normalGame.addJoinToken("nff-1", true, 1, 60_000, false, true, undefined);
    normalGame.addJoinToken("nff-2", true, 1, 60_000, false, true, undefined);
    const n1 = new net.JoinMsg();
    n1.protocol = GameConfig.protocolVersion;
    n1.matchPriv = "nff-1";
    n1.name = "NFBotA";
    const n2 = new net.JoinMsg();
    n2.protocol = GameConfig.protocolVersion;
    n2.matchPriv = "nff-2";
    n2.name = "NFBotB";
    const nBotA = normalGame.playerBarn.addPlayer("nff-a-sock", n1);
    const nBotB = normalGame.playerBarn.addPlayer("nff-b-sock", n2);
    assert(nBotA && nBotB, "normal extraction bots join");
    (
        normalGame as unknown as {
            applyExtractionSpawnLoadout(p: typeof nBotA): void;
        }
    ).applyExtractionSpawnLoadout(nBotA);
    (
        normalGame as unknown as {
            applyExtractionSpawnLoadout(p: typeof nBotB): void;
        }
    ).applyExtractionSpawnLoadout(nBotB);
    const nHealthBefore = nBotB.health;
    nBotB.damage({
        // 随机爆头会把 groza 伤害翻倍（50→100），无护甲 AI 会被秒杀导致
        // 后续 kill() 提前返回、装备不掉落。用小伤害验证"可互相伤害"即可。
        amount: 15,
        gameSourceType: "groza",
        source: nBotA,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    assert.ok(
        nBotB.health < nHealthBefore,
        "normal extraction AI must be able to damage each other (free-for-all)",
    );
    // 被 AI 击杀的 AI 必须掉落装备。
    const nLootBefore = normalGame.lootBarn.loots.length;
    nBotB.kill({
        amount: 9999,
        gameSourceType: "groza",
        source: nBotA,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
    });
    const nDrops = normalGame.lootBarn.loots
        .slice(nLootBefore)
        .map((loot) => loot.type);
    assert.ok(
        nDrops.length > 0,
        "normal extraction AI killed by AI must drop equipment",
    );
    normalGame.stop();
}

// 游戏集成部分使用全局 stashManager（真实 survivio-stash.json），
// 先备份、结束后恢复，避免测试污染玩家仓库数据。
const realStashFile = getServerDataFilePath("survivio-stash.json");
const stashBackupFile = getServerDataFilePath("survivio-stash-test-backup.json");
if (fs.existsSync(realStashFile)) fs.copyFileSync(realStashFile, stashBackupFile);
// 本文件只测普通搜打撤：显式关闭绝密规则（正式配置 extractionSecret.enabled 可能为 true，
// 否则普通 extraction 房间会被当成绝密模式，前 5 分钟撤离点锁定导致测试失败）。
const previousSecretEnabled = Config.extractionSecret.enabled;
Config.extractionSecret.enabled = false;

void runGameIntegration()
    .then(() => runTeamGameIntegration(TeamMode.Duo))
    .then(() => runTeamGameIntegration(TeamMode.Squad))
    .then(() => runFriendlyFireIntegration())
    .then(() => {
        console.log(
            "Extraction smoke test passed: deterministic points, farthest-active rule, stash stacking/grant, AI loadout presets, game integration, no-victory rule (solo/duo/squad), secret AI teammates / normal AI free-for-all, AI deaths always drop gear.",
        );
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        // 恢复真实仓库文件并清理备份。
        try {
            Config.extractionSecret.enabled = previousSecretEnabled;
            if (fs.existsSync(stashBackupFile)) {
                fs.copyFileSync(stashBackupFile, realStashFile);
            }
            fs.rmSync(stashBackupFile, { force: true });
        } catch {
            // 恢复失败不掩盖测试结果。
        }
    });
