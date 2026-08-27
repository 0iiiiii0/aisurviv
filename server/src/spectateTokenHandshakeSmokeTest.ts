import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { GameProcessManager } from "./game/gameProcessManager.ts";

async function main(): Promise<void> {
    const manager = new GameProcessManager();
    try {
        const room = await manager.createGame({
            mapName: "faction",
            teamMode: TeamMode.Squad,
            privateGame: true,
            pureAiMatch: true,
        });
        const startedAt = Date.now();
        const observer = await manager.createJoinToken(room.id, 60_000, true);
        assert.equal(observer.gameId, room.id);
        assert(observer.data.length > 0);
        assert(
            Date.now() - startedAt < 10_000,
            "room must acknowledge the installed observer token before the API returns it",
        );
        console.log("Spectate token IPC handshake smoke test passed.");
    } finally {
        for (const room of manager.listGames()) manager.stopGame(room.id);
    }
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
