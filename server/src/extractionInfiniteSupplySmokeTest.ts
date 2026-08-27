import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { canDonateMedicalItem } from "./bot/medicalSharing.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";

const MEDS = ["bandage", "healthkit", "soda", "painkiller"] as const;

const game = new Game("extraction-infinite-supply", {
    mapName: "extraction",
    teamMode: TeamMode.Solo,
});

game.addJoinToken("supply-bot", false, 1, 60_000, false, true);
const msg = new net.JoinMsg();
msg.protocol = GameConfig.protocolVersion;
msg.joinToken = "supply-bot";
msg.name = "SupplyBot";
msg.bot = true;
const bot = game.clientBarn.addClientWithPlayer(
    new NoOpSocket(),
    game.joinTokens.get("supply-bot")?.data!,
    msg,
    "supply-bot",
)?.player;
assert(bot?.serverBot);
bot.backpack = "backpack03";

for (const item of MEDS) {
    bot.invManager.set(item, GameConfig.inventoryInfiniteCount);
}

bot.boost = 0;
bot.useBoostItem("soda");
bot.update(bot.action.duration + 0.01);
assert(bot.boost > 0, "the bot must finish drinking its infinite soda");
assert.equal(
    bot.invManager.get("soda"),
    GameConfig.inventoryInfiniteCount,
    "drinking must not turn the infinite soda sentinel into a finite stack",
);

for (const item of MEDS) {
    assert.equal(bot.invManager.take(item, 1), 1, `${item} infinite supply must satisfy use`);
    assert.equal(
        bot.invManager.get(item),
        GameConfig.inventoryInfiniteCount,
        `${item} infinite supply must retain its sentinel after use`,
    );
    assert.equal(
        canDonateMedicalItem({
            item,
            inventoryCount: GameConfig.inventoryInfiniteCount,
            humanEmergency: true,
        }),
        false,
        `${item} marked as infinite supply must not be donated`,
    );
    const drop = new net.DropItemMsg();
    drop.item = item;
    const beforeLoots = game.lootBarn.loots.length;
    bot.dropItem(drop);
    assert.equal(
        game.lootBarn.loots.length,
        beforeLoots,
        `${item} infinite supply must not create a drop`,
    );
    assert.equal(bot.invManager.get(item), GameConfig.inventoryInfiniteCount);
}

assert.equal(
    bot.invManager.getMaxCapacity("9mm"),
    840,
    "level-3 extraction backpack must expose the unified doubled 9mm capacity",
);

const beforeDeathLoots = game.lootBarn.loots.length;
bot.kill({ damageType: 0, dir: v2.create(0, 0), amount: 999 });
assert.equal(bot.dead, true);
assert.equal(
    game.lootBarn.loots.slice(beforeDeathLoots).some((loot) =>
        MEDS.includes(loot.type as typeof MEDS[number])
        && loot.count >= GameConfig.inventoryInfiniteCount
    ),
    false,
    "death must not spill infinite medical stacks",
);

game.stop();

console.log(
    "Extraction infinite supply smoke test passed: medical sentinels survive use, remain non-shareable/non-droppable, and bag capacity is unified.",
);
