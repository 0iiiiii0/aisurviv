import assert from "assert";
import { GameProcessManager } from "./game/gameProcessManager.ts";

/**
 * 回归测试：multi 进程模式下，HACKER/LEGIT AI 的权威敌人快照能经“房间 worker
 * IPC”构建并回传（方向2），而不是像旧版那样直接要求 processMode=single。
 */
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
        void (async () => {
            try {
                // 未知房间：立即返回 null（不阻塞、不抛错）。
                const none = await manager.requestForbiddenContext("no-such-room", {
                    botPlayerId: 1,
                    sequence: 1,
                    difficulty: "legit",
                });
                assert.equal(none, null, "unknown room must resolve null");

                // 真实房间：权威快照经房间 worker IPC 构建并回传。
                const payload = await manager.requestForbiddenContext(ready.id, {
                    botPlayerId: 1,
                    sequence: 7,
                    difficulty: "legit",
                });
                assert.ok(
                    payload && typeof payload === "object",
                    "worker must return a snapshot over IPC",
                );
                const snap = payload as {
                    type?: string;
                    sequence?: number;
                    mapName?: string;
                    enemies?: unknown[];
                    botPlayerId?: number;
                };
                assert.equal(snap.type, "forbidden-context", "must be a forbidden context");
                assert.equal(snap.sequence, 7, "sequence must round-trip");
                assert.equal(snap.botPlayerId, 1, "botPlayerId must round-trip");
                assert.ok(Array.isArray(snap.enemies), "enemies list must be present");
                assert.ok(
                    typeof snap.mapName === "string" && snap.mapName.length > 0,
                    "map name must be present",
                );

                console.log(
                    "Forbidden-context multi-mode smoke test passed: worker IPC round-trip for LEGIT/HACKER authoritative data in " +
                        (Date.now() - startedAt) +
                        "ms",
                );
                manager.commitProcessGenocide();
                setTimeout(() => process.exit(0), 300);
            } catch (error) {
                manager.commitProcessGenocide();
                console.error(error);
                process.exit(1);
            }
        })();
    } else if (Date.now() - startedAt > 30_000) {
        settled = true;
        clearInterval(check);
        manager.commitProcessGenocide();
        console.error("Timed out waiting for the worker-thread room");
        process.exit(1);
    }
}, 200);
