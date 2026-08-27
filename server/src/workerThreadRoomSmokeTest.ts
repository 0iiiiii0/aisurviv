import assert from "assert";
import { Worker } from "worker_threads";
import { GameProcessManager, roomTransport } from "./game/gameProcessManager.ts";

assert.equal(roomTransport, "worker", "rooms should use worker_threads by default");

const manager = new GameProcessManager();
const startedAt = Date.now();
let settled = false;

const check = setInterval(() => {
    if (settled) return;
    const games = manager.listGames();
    const ready = games.find((game) => !game.stopped);
    if (ready) {
        settled = true;
        clearInterval(check);
        try {
            assert.ok(
                (ready as unknown as { process: unknown }).process instanceof Worker,
                "the room must run on a worker thread",
            );
            assert.ok(typeof ready.processPid === "number", "worker thread id must be exposed as processPid");
            assert.equal(manager.getById(ready.id), ready, "room must be addressable by id");
            assert.ok(ready.mapName.length > 0, "the room must have loaded a map");
            console.log("Worker-thread room smoke test passed: room created on thread " + ready.processPid + " in " + (Date.now() - startedAt) + "ms");
            manager.commitProcessGenocide();
            setTimeout(() => process.exit(0), 300);
        } catch (error) {
            manager.commitProcessGenocide();
            console.error(error);
            process.exit(1);
        }
    } else if (Date.now() - startedAt > 30000) {
        settled = true;
        clearInterval(check);
        manager.commitProcessGenocide();
        console.error("Timed out waiting for the worker-thread room");
        process.exit(1);
    }
}, 200);
