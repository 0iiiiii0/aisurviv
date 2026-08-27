import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import { stashManager } from "./stash/stashManager.ts";

function joinPlayer(game: Game, id: string) {
    const token = `${id}-token`;
    game.addJoinToken(token, false, 1, 60_000);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.name = id;
    const player = game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        game.joinTokens.get(token)?.data as JoinTokenData,
        msg,
        token,
    )?.player;
    assert(player);
    player.backpack = "backpack03";
    return player;
}

function assertBackpack(
    mapName: "main" | "duel" | "faction" | "potato" | "extraction" | "extraction_secret",
    extractionMode: boolean,
) {
    const game = new Game(`bag-capacity-${mapName}`, {
        mapName,
        teamMode: TeamMode.Solo,
    });
    try {
        if (mapName === "extraction_secret") {
            // 绝密模式要求真人携带至少一把 A/S/S+ 配装枪，先给仓库播种资格。
            stashManager.addItem("Player", "vector", 1);
            assert.equal(
                stashManager.setLoadout("Player", {
                    guns: ["vector", ""],
                    ammo: {},
                    consumables: {},
                    throwables: {},
                    armor: {},
                }).ok,
                true,
                "secret-extraction test stash must accept an eligible loadout",
            );
        }
        const player = joinPlayer(game, "Player");
        assert.equal(
            Boolean(player.game.map.mapDef.gameMode.extractionMode),
            extractionMode,
        );
        assert.equal(player.invManager.getMaxCapacity("9mm"), extractionMode ? 840 : 420);
        const given = player.invManager.give("9mm", 1_000);
        assert.equal(given.added, extractionMode ? 840 : 420);
        assert.equal(player.invManager.get("9mm"), given.added);
    } finally {
        game.stop();
        stashManager.removePlayer("Player");
    }
}

for (const mapName of ["main", "duel", "faction", "potato"] as const) {
    assertBackpack(mapName, false);
}
assertBackpack("extraction", true);
assertBackpack("extraction_secret", true);

console.log(
    "Bag capacity modes smoke test passed: only extraction/secret extraction doubles level-3 ammo; all other modes keep base capacity.",
);
