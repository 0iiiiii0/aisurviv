# V63 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript no-emit check: PASS
- `test:new-behavior-port` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:gameplay-roles`, `test:savannah-perks`, `test:loot-capacity`,
  `test:reload-guard`, `test:worker-thread-room`, `test:v53-matchmaking`: PASS

## Behavior verification (`test:new-behavior-port`, faction game)

- Enemy damage downs a player with a damage buffer: PASS
- The buffer blocks the immediate finishing hit: PASS
- After `update(0.3)` the buffer expires and the player can be finished: PASS
- Downing in the final circle gives 50 HP: PASS
- `useHealingItem` does not cancel an active revive: PASS

## Files changed

- `shared/gameConfig.ts`
- `server/src/game/objects/player.ts`
- `server/src/newBehaviorPortSmokeTest.ts` (new)
- `server/package.json`
