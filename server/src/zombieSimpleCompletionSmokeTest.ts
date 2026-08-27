import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

void (async () => {
    const game = new Game(
        `zombie-simple-completion-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "simple" },
        () => {},
        () => {},
    );
    try {
        const runtime = game as unknown as {
            started: boolean;
            startedTime: number;
            over: boolean;
            update(): void;
        };
        runtime.started = true;
        runtime.startedTime = 0;

        const survivor = game.playerBarn.addTestPlayer({ name: "Survivor" });
        survivor.layer = 1;
        runtime.update();
        assert.ok((game.zombieMode?.zombieCount ?? 0) > 0, "simple mode starts its own zombie horde");

        // Reproduce the reported polluted room. The leaked generic bot remains
        // alive, but it must neither count as a zombie nor hold nuclear victory open.
        const leakedGenericBot = game.playerBarn.addTestPlayer({ name: "AI-normal" });
        leakedGenericBot.serverBot = true;
        const zombieMode = game.zombieMode as unknown as {
            zombieCount: number;
            nextReplenishAt: number;
            detonateNuke(): void;
        };
        zombieMode.detonateNuke();

        assert.equal(zombieMode.zombieCount, 0, "nuclear blast removes the zombie horde");
        assert.equal(leakedGenericBot.dead, false, "fixture keeps the unrelated generic bot alive");
        assert.equal(runtime.over, true, "nuclear completion ends the match despite an unrelated server bot");

        zombieMode.nextReplenishAt = 0;
        runtime.update();
        assert.equal(zombieMode.zombieCount, 0, "simple-mode replenish is disabled after detonation");
        console.log("Simple zombie completion passed: no generic auto-fill policy, nuclear victory ends immediately, and no post-nuke replenish.");
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
