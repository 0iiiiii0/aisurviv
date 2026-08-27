# V73 Validation

## Builds

- Client TypeScript + Vite build: PASS
- Server TypeScript production build: PASS
- `test:v41-spectator-interaction` (extended): PASS
- `test:v41-suite` (11 tests): PASS
- `test:smoke-handling`: PASS
- `test:scope-suppression`: PASS
- `test:cooperation`: PASS
- `test:combat-readiness`: PASS
- `test:movement-jitter`: PASS
- `test:puzzle-door`: PASS
- `test:bot-disconnect-recovery`: PASS
- `test:v53-matchmaking`: PASS

## Fix verification

- Source assertion: `game.ts` passes the occluder-transparency flag whenever
  spectating (`this.spectating && this.uiManager.specTransparentObstacles`): PASS
- Source assertion: the old free-camera-only gate is gone
  (`spectating && freeSpectating && specTransparentObstacles` no longer matches): PASS
- Client build compiles: PASS

## Behavior matrix

- Following a spectated player + toggle on: transparent roofs/walls (0.42): FIXED
- Free camera + toggle on: transparent roofs/walls: unchanged (still works)
- Active player (not spectating): normal ceiling fade from own position: unchanged

## Files changed

- `client/src/game.ts`
- `server/src/v41SpectatorInteractionSmokeTest.ts`