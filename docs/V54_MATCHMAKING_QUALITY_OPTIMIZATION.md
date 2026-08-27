# V54 Matchmaking quality optimization

V53 fixed the matchmaking hang (stopped rooms with stale slot data). V54
focuses on the human-vs-AI waiting experience and the replay-analysis loop,
based on an audit of `server/ai-match-recordings` (25 sessions, faction mode,
8 bots per worker, 750 ms frame sampling).

## What the recordings showed

- Matches spanned ~3.4-6.8 minutes; bots spent most frames in
  explore/regroup/loot/break-crate/gas states with almost no combat frames.
- 7629 `path_recovery_triggered` events and 2140
  `resource_target_abandoned` (`no-distance-progress`) events indicated bots
  stalling, but the stall handling itself was already present
  (`repeatedRecoveryLimit`, intent suppression, resource blacklists).
- Many sessions were `.part` files with no lifecycle end event, making it
  impossible to tell complete matches from aborted ones.

## Changes

### 1. Matchmaking room selection (readiness sort)

`findGame()` in both `GameProcessManager` and the single-thread dev manager
now sorts candidate rooms with `compareMatchmakingReadiness()`:

1. rooms that already contain humans first,
2. then rooms with more contestants (bot fill progress),
3. then the oldest room.

A fresh empty room is only selected when no populated room exists, so humans
stop being repeatedly dropped into empty rooms that then wait for bot
auto-fill.

### 2. Early-fill acceleration

The auto-fill scheduler tracks `roomFirstHumanAt` per room. While the first
human has been waiting less than `EARLY_FILL_ACCELERATION_WINDOW_MS` (15 s),
the join interval is capped at `EARLY_FILL_ACCELERATED_INTERVAL_MS` (800 ms);
after the window the configured cadence (default 2 s) resumes. CPU throttle
limits still apply on top.

### 3. Fill snapshot in `/api/find_game`

`FindGameResponse` carries an optional `fill` snapshot:
`{humanPlayers, botPlayers, totalPlayers, targetPlayers, reservedPlayers}`.
The client `MatchData` type accepts it for future lobby feedback; the in-game
lobby already shows live player counts via `AliveCounts`.

### 4. Recording lifecycle

`AiMatchRecorder.finishBot()` now aggregates per-bot finishes and emits a
`match_ended` event (duration, registered bot count, frames written, per-bot
results) once every registered bot has finished. Quota rotation deletes
interrupted sessions (all `.part`, no finalized events) before complete ones.
Recording format version bumped to 13.

## Files changed

- `server/src/game/gameManager.ts`
- `server/src/game/gameProcessManager.ts`
- `server/src/botAutoFill.ts`
- `server/src/gameServer.ts`
- `server/src/bot/aiMatchRecorder.ts`
- `server/src/v53MatchmakingRecoverySmokeTest.ts`
- `server/src/botAutoFillConfigSmokeTest.ts`
- `server/src/aiMatchRecorderSmokeTest.ts`
- `client/src/main.ts`
