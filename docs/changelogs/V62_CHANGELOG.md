# V62 Worker-thread game rooms (multi-threaded)

- Room processes now run on `worker_threads` inside the game server by
  default instead of forked child processes: every room gets a parallel OS
  thread (true multi-threading across cores) with faster spawns and lower
  memory than a separate process.
- `GameProcessManager` creates `Worker` rooms (`gameProcess.ts` talks IPC via
  `parentPort`); fork() remains available as a fallback with
  `SURVIV_ROOM_TRANSPORT=fork`.
- Worker crash isolation is preserved: `worker.on("error")` is handled and the
  room is cleaned up through the existing exit/kill path.
- `processPid` exposes the worker `threadId` for logging/admin display.
