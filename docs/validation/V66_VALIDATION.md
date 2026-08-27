# V66 Validation

## Builds

- Server TypeScript production build (`npm run build`): PASS
- `test:bot-disconnect-recovery` (new): PASS
- `test:all-downed-elimination` (updated for self-revive last stand): PASS
- `test:v41-suite` (11 tests): PASS
- `test:worker-thread-room`: PASS
- `test:new-behavior-port`: PASS
- `test:new-perks-port`: PASS
- `test:savannah-perks`: PASS
- `test:loot-capacity`: PASS
- `test:reload-guard`: PASS
- `test:v53-matchmaking`: PASS
- `test:ai-capability-match`: PASS
- `test:spectator-autofill`: PASS
- `test:faction-autofill`: PASS

## Fix verification (`test:bot-disconnect-recovery`)

- Bot drops socket; player is marked `disconnected` with `disconnectAt`, and is
  NOT removed on the spot (serverBot + faction mode): PASS
- Reconnect with the same `matchPriv` on a new socket resumes the exact same
  player object, clears `disconnected`/`disconnectAt`, removes the stale socket
  binding and creates no duplicate contestant: PASS
- Faction bots that never return are removed after
  `GameConfig.player.disconnectTimeout` and their team stops counting as alive
  (`aliveCount` 2 -> 1, `getAliveTeams` length 1): PASS
- Source checks: smartBot owns `openSocket`/`socketLost`/`scheduleReconnect`/
  `checkConnectionWatchdog`, game over terminates without reconnect, game owns
  the disconnect-cleanup ticker, `removePlayer` cleans the faction team and
  `addPlayer` resumes by join token: PASS

## Fix verification (`test:all-downed-elimination`)

- No self-revive (faction): all-downed team eliminated immediately, game ends: PASS
- With self-revive (faction, both members can self-revive): last standing member
  is downed instead of eliminated; finishing one member does NOT drag down the
  other while a self-revive member remains; after the last self-revive member
  dies the team is eliminated and the game ends: PASS
- Same behavior in duo (group mode): PASS

## Files changed

- `shared/gameConfig.ts`
- `server/src/game/game.ts`
- `server/src/game/gameModeManager.ts`
- `server/src/game/group.ts`
- `server/src/game/team.ts`
- `server/src/game/objects/player.ts`
- `server/src/smartBot.ts`
- `server/src/botDisconnectRecoverySmokeTest.ts` (new)
- `server/src/allDownedEliminationSmokeTest.ts` (updated)
- `server/package.json`