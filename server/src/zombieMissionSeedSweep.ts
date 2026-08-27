import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

void (async () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 32; i++) {
        const game = new Game(
            `zombie-seed-sweep-${i}-${Date.now()}`,
            { mapName: "zombie", teamMode: TeamMode.Solo },
        );
        try {
            const system = game.zombieMode!;
            const snapshot = system.missionSnapshot;
            assert.equal(snapshot.elements.length, 3);
            assert.ok(
                game.map.isPlayerWalkableAt(snapshot.devicePos, 0, 0.8),
                "mission console is on a player-walkable ground point",
            );
            assert.ok(
                system.isMissionPointReachable(snapshot.devicePos),
                "mission console belongs to its own reachable component",
            );
            signatures.add(
                snapshot.elements
                    .map((element) => `${element.pos.x.toFixed(1)},${element.pos.y.toFixed(1)}`)
                    .join("|"),
            );
            for (const element of snapshot.elements) {
                assert.ok(game.map.isPlayerWalkableAt(element.pos, 0, 0.7));
                assert.ok(system.isMissionPointReachable(element.pos));
                assert.ok(
                    Math.hypot(
                        element.pos.x - snapshot.devicePos.x,
                        element.pos.y - snapshot.devicePos.y,
                    ) >= 36,
                );
            }
            for (let a = 0; a < 3; a++) {
                for (let b = a + 1; b < 3; b++) {
                    assert.ok(
                        Math.hypot(
                            snapshot.elements[a].pos.x - snapshot.elements[b].pos.x,
                            snapshot.elements[a].pos.y - snapshot.elements[b].pos.y,
                        ) >= 48,
                    );
                }
            }
        } finally {
            game.stop();
        }
    }
    assert.ok(signatures.size >= 28, "map seeds produce distinct objective layouts");
    console.log(`✓ zombie mission seed sweep: ${signatures.size}/32 distinct, safe, reachable layouts`);
})();
