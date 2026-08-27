import assert from "node:assert/strict";
import fs from "node:fs";
import { Config, getServerDataFilePath } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import {
    getShopCatalog,
    shopAdminCatalog,
    shopBuy,
    shopSell,
} from "./economy/shopManager.ts";

/**
 * V243+ 商店（搜打撤经济系统）：
 * - 新玩家初始金币为 0；购买扣钱加仓、出售扣仓加钱；
 * - 不可能获得的物品不出现（四级甲/帽子/占位/彩蛋/能力）；
 * - S/S+ 武器、信号弹、信号枪、AWM 子弹默认仅出售，后台可切换购买/出售；
 * - 高品质物品价格提升（S+/S/A 武器、3 级护甲、8x/15x 倍镜等）；
 * - 不允许出售身上（已装备/携带）的物品；
 * - 后台价格覆盖生效。
 */

const NAME = "shop-smoke-tester";
const realStashFile = getServerDataFilePath("survivio-stash.json");
const backupFile = getServerDataFilePath("survivio-shop-test-backup.json");
if (fs.existsSync(realStashFile)) fs.copyFileSync(realStashFile, backupFile);

const previousShop = {
    prices: { ...Config.shop.prices },
};

void (async () => {
    try {
        Config.shop.prices = {};

        // 1) 新玩家初始金币固定为 0 + 目录。
        const catalog = getShopCatalog(NAME);
        assert.equal(catalog.coins, 0, "new player starts with 0 coins");
        const item = (type: string) =>
            catalog.items.find((candidate) => candidate.type === type);

        // 可购买的 B 级枪：逐枪排名价，不再全部同价。
        const ak = item("ak47");
        assert(ak, "ak47 must be in catalog");
        assert.equal(ak.buy, 900);
        assert.equal(ak.sell, 450);
        assert.equal(ak.sellOnly, false);
        assert.equal(item("ump9")!.buy, 500, "UMP9 must cost less than MP5");
        assert.equal(item("mp5")!.buy, 700, "MP5 must cost less than AK-47");
        assert.equal(item("mp220")!.buy, 1800, "MP220 burst strength must affect price");
        assert.equal(item("m870")!.buy, 800, "M870 must remain below MP220");
        assert.equal(item("imbel")!.buy, 800, "IMD-2 must use its ranked price");
        assert.equal(item("sw500")!.buy, 2000, "S&W 500 must use its ranked price");

        // 高品质枪也按实战强度细分；仍默认仅可出售。
        assert.equal(item("awc")!.sell, 2600, "AWM-S ranked sell price");
        assert.equal(item("m1014")!.sell, 2300, "Super 90 ranked sell price");
        assert.equal(item("usas")!.sell, 2200, "USAS-12 ranked sell price");
        assert.equal(item("m4a1")!.sell, 1600, "M4A1-S ranked sell price");
        assert.equal(item("potato_lmg")!.sell, 2500, "PMG-134 ranked sell price");
        assert.equal(item("ash12")!.sell, 2400, "ASh-12 ranked sell price");
        assert.equal(item("spas16")!.sell, 1800, "SPAS-16 ranked sell price");
        assert.equal(item("barrett")!.sell, 1700, "Barrett M107 ranked sell price");
        assert.equal(item("potato_lmg")!.buy, null, "PMG-134 must default to sell-only");

        // 冬季外观变体继承本体价格和交易限制。
        assert.equal(item("awc_winter")!.buy, null);
        assert.equal(item("awc_winter")!.sell, 2600);
        assert.equal(item("sv98_winter")!.buy, null);
        assert.equal(item("sv98_winter")!.sell, 1650);
        assert.equal(item("svd_winter")!.buy, 1850);
        assert.equal(item("svd_winter")!.sell, 925);
        assert.equal(item("8xscope")!.buy, 1500, "8x scope buy price raised");
        assert.equal(item("helmet03")!.buy, 1200, "lvl-3 armor buy price raised");

        // 投掷物白名单：手雷、烟雾弹、MIRV 可买卖，IR Strobe 仅可出售。
        for (const [type, buy] of Object.entries({
            frag: 40,
            smoke: 30,
            mirv: 160,
        })) {
            assert.equal(item(type)?.buy, buy, `${type} throwable must be purchasable`);
        }
        assert.equal(item("strobe")?.buy, null);
        assert.equal(item("strobe")?.sell, 250);
        assert.equal(item("strobe")?.sellOnly, true);

        // 仅出售：S 级 m4a1、S+ 级 awc、信号弹 flare、信号枪 flare_gun、AWM 子弹 308sub。
        for (const type of ["m4a1", "awc", "flare", "flare_gun", "308sub"]) {
            const entry = item(type);
            assert(entry, `${type} must be in catalog`);
            assert.equal(entry.buy, null, `${type} must not be purchasable`);
            assert.ok(entry.sell !== null, `${type} must be sellable`);
            assert.equal(entry.sellOnly, true, `${type} must be sell-only`);
        }
        const knuckles = item("knuckles");
        assert(knuckles, "melee must be in catalog");
        assert.equal(knuckles.buy, 1000, "melee must be purchasable at the fixed 1000 price");
        assert.equal(knuckles.sell, 15, "melee sell price stays at half of its default price");
        assert.equal(knuckles.sellOnly, false, "melee must no longer be marked sell-only");

        // 头盔硬性白名单：只有 1/2/3 级普通头盔。
        const adminItem = (type: string) =>
            shopAdminCatalog().find((candidate) => candidate.type === type);
        assert.deepEqual(
            shopAdminCatalog()
                .filter((entry) => entry.category === "helmets")
                .map((entry) => entry.type),
            ["helmet01", "helmet02", "helmet03"],
        );
        for (const type of ["helmet04", "helmet03_leader", "helmet04_medic"]) {
            assert.equal(adminItem(type), undefined, `${type} must be excluded from trade admin`);
            assert.equal(item(type), undefined, `${type} must be hidden from player shop`);
            assert.equal(shopBuy(NAME, type, 1).ok, false, `${type} purchase must be rejected`);
            assert.equal(shopSell(NAME, type, 1).ok, false, `${type} sale must be rejected`);
        }

        // 普通头盔在后台同时关闭购买/出售后，玩家目录和两个交易接口都必须禁用。
        Config.shop.prices = {
            helmet01: { buyEnabled: false, sellEnabled: false },
        };
        assert.equal(
            getShopCatalog(NAME).items.find((candidate) => candidate.type === "helmet01"),
            undefined,
            "fully disabled normal helmet must be hidden from player shop",
        );
        assert.equal(shopBuy(NAME, "helmet01", 1).reason, "not-for-sale");
        assert.equal(shopSell(NAME, "helmet01", 1).reason, "not-sellable");
        const disabledHelmetAdmin = shopAdminCatalog().find(
            (candidate) => candidate.type === "helmet01",
        )!;
        assert.equal(disabledHelmetAdmin.buyEnabled, false);
        assert.equal(disabledHelmetAdmin.sellEnabled, false);
        Config.shop.prices = {};

        // 非商品内部对象仍不进入目录。
        for (const type of [
            "backpack00",
            "m9_cursed",
            "1xscope",
            "endless_ammo",
            "potato_cannon",
            "potato_cannonball",
            "potato_smgshot",
            "potato_lmgshot",
            "mirv_mini",
            "martyr_nade",
            "snowball_heavy",
            "potato_heavy",
            "bomb_iron",
            "snowball",
            "potato",
            "coconut",
            "tomato",
        ]) {
            assert.equal(item(type), undefined, `${type} must be excluded from shop`);
        }

        // 2) 购买：先由测试充值 5000（真实游戏中靠出售物资赚金币），再扣金币 + 加仓。
        stashManager.setCoins(NAME, 5000);
        const before = getShopCatalog(NAME);
        const akBefore = before.items.find((c) => c.type === "ak47")!.owned;
        const buyResult = shopBuy(NAME, "ak47", 1);
        assert.equal(buyResult.ok, true, "buy ak47 must succeed");
        assert.equal(buyResult.coins, 4100, "5000 - 900 = 4100 coins remain");
        const after = getShopCatalog(NAME);
        assert.equal(
            after.items.find((c) => c.type === "ak47")!.owned,
            akBefore + 1,
            "bought ak47 must be added to stash",
        );

        // 3) 金币不足拒绝。
        const poor = shopBuy(NAME, "hk416", 1);
        assert.equal(poor.ok, true, "hk416 affordable at 950");
        const poor2 = shopBuy(NAME, "m4a1", 1); // 仅出售，应被拒
        assert.equal(poor2.ok, false);
        assert.equal(poor2.reason, "not-for-sale");
        const broke = shopBuy(NAME, "awc", 1);
        assert.equal(broke.ok, false);
        assert.equal(broke.reason, "not-for-sale");
        // 金币不足：先买多把 ak47 花光，再验证。
        shopBuy(NAME, "ak47", 3); // +3 → 3150 - 2700 = 450
        const broke2 = shopBuy(NAME, "hk416", 1); // 950 > 450
        assert.equal(broke2.ok, false);
        assert.equal(broke2.reason, "not-enough-coins");

        // 4) 仅出售物品购买被拒绝。
        const sellOnlyBuy = shopBuy(NAME, "m4a1", 1);
        assert.equal(sellOnlyBuy.ok, false);
        assert.equal(sellOnlyBuy.reason, "not-for-sale");

        // 5) 出售：扣仓 + 加金币。
        const ownedBeforeSell = getShopCatalog(NAME).items.find(
            (c) => c.type === "ak47",
        )!.owned;
        const sellResult = shopSell(NAME, "ak47", 1);
        assert.equal(sellResult.ok, true, "sell ak47 must succeed");
        assert.equal(sellResult.coins, 900, "450 + 450 = 900 coins after selling ak47");
        assert.equal(
            getShopCatalog(NAME).items.find((c) => c.type === "ak47")!.owned,
            ownedBeforeSell - 1,
            "sold ak47 must leave the stash",
        );

        // 6) 无货出售拒绝。
        const emptySell = shopSell(NAME, "m249", 1);
        assert.equal(emptySell.ok, false);
        assert.equal(emptySell.reason, "not-enough");

        // 6b) 不允许出售身上（已装备/携带）的物品：
        // 仓库 ak47 若干 + 配装 1 号位装一把 → 最多只能卖 仓库数 - 1。
        stashManager.setLoadout(NAME, {
            guns: ["ak47", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const ownedAk = getShopCatalog(NAME).items.find(
            (c) => c.type === "ak47",
        )!.owned;
        const tooMany = shopSell(NAME, "ak47", ownedAk); // 全卖（含身上那把）
        assert.equal(tooMany.ok, false, "cannot sell the equipped gun");
        assert.equal(tooMany.reason, "equipped");
        const sellRemaining = shopSell(NAME, "ak47", ownedAk - 1);
        assert.equal(sellRemaining.ok, true, "can sell all but the equipped gun");
        assert.equal(
            getShopCatalog(NAME).items.find((c) => c.type === "ak47")!.owned,
            1,
            "only the equipped ak47 remains after selling the rest",
        );

        // 6c) 近战武器可购买（固定定价 1000），出售价保持不变。
        stashManager.setCoins(NAME, 5000);
        const meleeBefore = getShopCatalog(NAME).items.find(
            (c) => c.type === "knuckles",
        )!.owned;
        const meleeBuy = shopBuy(NAME, "knuckles", 1);
        assert.equal(meleeBuy.ok, true, "buy melee must succeed at the fixed 1000 price");
        assert.equal(meleeBuy.coins, 4000, "5000 - 1000 = 4000 coins remain");
        assert.equal(
            getShopCatalog(NAME).items.find((c) => c.type === "knuckles")!.owned,
            meleeBefore + 1,
            "bought melee must be added to stash",
        );
        const meleeSell = shopSell(NAME, "knuckles", 1);
        assert.equal(meleeSell.ok, true, "melee must remain sellable");
        assert.equal(meleeSell.coins, 4015, "selling knuckles adds 15 (sell price unchanged)");

        // 7) 后台价格覆盖：把 ak47 买入改为 123。
        Config.shop.prices = { ak47: { buy: 123 } };
        const overridden = getShopCatalog(NAME).items.find((c) => c.type === "ak47")!;
        assert.equal(overridden.buy, 123, "admin buy override must apply");
        assert.equal(overridden.sell, 450, "sell stays at default when not overridden");
        Config.shop.prices = {};

        // 8) 旧配置只有价格时仍沿用 S 级默认禁买规则。
        Config.shop.prices = { m4a1: { buy: 50 } };
        const m4 = getShopCatalog(NAME).items.find((c) => c.type === "m4a1")!;
        assert.equal(m4.buy, null, "price alone must not change default availability");

        // 9) 后台可让原本仅售商品开放购买，也可禁止任意商品出售。
        Config.shop.prices = {
            m4a1: { buyEnabled: true, buy: 50 },
            ak47: { sellEnabled: false },
        };
        const toggledCatalog = getShopCatalog(NAME);
        const toggledM4 = toggledCatalog.items.find((c) => c.type === "m4a1")!;
        const toggledAk = toggledCatalog.items.find((c) => c.type === "ak47")!;
        assert.equal(toggledM4.buy, 50, "admin must be able to enable S-tier purchases");
        assert.equal(toggledM4.buyEnabled, true);
        assert.equal(toggledM4.sellOnly, false);
        assert.equal(toggledAk.sell, null, "admin must be able to disable sales");
        assert.equal(toggledAk.sellEnabled, false);

        stashManager.setCoins(NAME, 100);
        const enabledBuy = shopBuy(NAME, "m4a1", 1);
        assert.equal(enabledBuy.ok, true, "enabled S-tier purchase must succeed");
        const disabledSell = shopSell(NAME, "ak47", 1);
        assert.equal(disabledSell.ok, false, "disabled sale must be rejected");
        assert.equal(disabledSell.reason, "not-sellable");

        // 10) 开关开启但沿用旧 null 价格时，使用建议价而不是继续禁用。
        Config.shop.prices = { flare: { buyEnabled: true, buy: null } };
        const enabledFlare = getShopCatalog(NAME).items.find((c) => c.type === "flare")!;
        assert.equal(enabledFlare.buy, 150);
        // IR Strobe 是硬性仅售，后台误开购买也不能放开。
        Config.shop.prices = { strobe: { buyEnabled: true, buy: 1 } };
        const protectedStrobe = getShopCatalog(NAME).items.find((c) => c.type === "strobe")!;
        assert.equal(protectedStrobe.buy, null);
        assert.equal(shopBuy(NAME, "strobe", 1).reason, "not-for-sale");
        Config.shop.prices = {};

        console.log(
            "Shop smoke test passed: starter coins, catalog exclusions, default sell-only rules, per-item buy/sell switches, price overrides, and equipped-item sell guard.",
        );
    } finally {
        Config.shop.prices = previousShop.prices;
        if (fs.existsSync(backupFile)) {
            fs.copyFileSync(backupFile, realStashFile);
            fs.rmSync(backupFile, { force: true });
        }
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
