import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

void (async () => {
    const game = new Game(
        `zombie-no-gas-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );

    try {
        await game.init();
        assert.equal(game.map.mapDef.gameMode.zombieMode, true);
        assert.equal(game.gas.mode, GameConfig.GasMode.Inactive);
        assert.equal(game.gas.stage, 0);
        assert.equal(game.gas.damage, 0);
        assert.ok(
            game.gas.currentRad > Math.hypot(game.map.width, game.map.height),
            "the client-side gas boundary stays outside the entire map",
        );

        // Even an accidental caller cannot start the gas in zombie mode.
        game.gas.advanceGasStage();
        game.gas.update(GameConfig.gas.damageTickRate * 10);

        assert.equal(game.gas.mode, GameConfig.GasMode.Inactive);
        assert.equal(game.gas.stage, 0);
        assert.equal(game.gas.damage, 0);
        assert.equal(game.gas.doDamage, false);
        assert.equal(game.gas.isInGas({ x: 0, y: 0 }), false);
        assert.equal(
            game.gas.isInGas({ x: game.map.width, y: game.map.height }),
            false,
        );
        console.log("✓ zombie mode keeps the full map permanently gas-free");
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
