# V62 Validation

## Builds

- Server TypeScript production build: PASS
- `test:worker-thread-room` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:game-process-reuse`: PASS

## Live end-to-end (multi mode, worker_threads)

- Game server started with `processMode=multi`; the initial room came up on a
  worker thread: PASS
- `POST /api/find_game` returned the worker room with a join token and the
  `fill` snapshot: PASS
- smartBot workers connected over WebSocket and joined the worker-thread room
  ("Player AI-normal joined game ID ..."); the room ticked normally: PASS
- Fork fallback (`SURVIV_ROOM_TRANSPORT=fork`) still creates rooms: PASS

## Notes

- First worker spawn is slower while ts-node compiles the room script; later
  spawns are faster than fork (2.9s vs 4.3s in the smoke run after warm-up).
- A worker-thread room dies with the game-server process (no orphan cleanup
  needed); use the fork fallback when room/process isolation is preferred.
