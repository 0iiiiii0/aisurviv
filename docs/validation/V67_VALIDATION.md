# V67 Validation

## Builds

- Server TypeScript production build (`npm run build`): PASS
- Client TypeScript + Vite build (`npm run build` in client/): PASS
- `test:puzzle-door` (new): PASS
- `test:integrated-spec`: PASS
- `test:special-roles`: PASS
- `test:v41-suite` (11 tests): PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
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

## Fix verification (`test:puzzle-door`)

- `inferPuzzleOrder`:
  - Eye bunker set -> egg,hydra,storm,conch,crossing,hatchet: PASS
  - Chrysanthemum set (any input order) -> ichi,ni,san,shi: PASS
  - Saloon set -> red,orange,yellow,green,blue,indigo,violet: PASS
  - {1,2,3,4} -> club_01 (longest wins over club_02): PASS
  - {1} -> club_02 (bathhouse): PASS
  - Partial order -> null: PASS
  - Decoys only (swine,caduceus) -> null: PASS
- Wire round-trip: `puzzlePiece` and `parentBuildingId` survive serialize/deserialize: PASS
- Server mechanics: correct password sequence opens `vault_door_eye` after the
  complete-use delay; the door starts locked and `canUse=false`: PASS
- Source guarantees: bot owns `continuePuzzle`/`choosePuzzleTarget`, uses
  `inferPuzzleOrder`, armed bots call `chooseVaultPanel(..., true)`, the `puzzle`
  intent competes in the search phase, protocolVersion is 84: PASS

## Live runs (pure-AI, woods map)

- 10 bots / 240 s and 24 bots / 300 s: bots searched, looted and fought normally;
  no crashes, no reconnect loops, no false puzzle triggers: PASS
- Eye-bunker contact in live RNG runs was rare (closest 24-97 units, surface
  layer only), so the solver engages opportunistically when an unarmed/under-
  equipped bot reaches a puzzle floor; the deterministic tests above pin the
  solver behaviour.

## Files changed

- `shared/gameConfig.ts` (protocolVersion 84)
- `shared/net/objectSerializeFns.ts` (obstacle `puzzlePiece` wire field)
- `server/src/bot/integratedLogicSpec.ts` (`PUZZLE_ORDERS`, `inferPuzzleOrder`)
- `server/src/bot/decisionBrain.ts` (`puzzle` intent kind + commit ms)
- `server/src/bot/adrenalineStrategy.ts` (`puzzle` movement purpose)
- `server/src/smartBot.ts` (puzzle solver, `puzzle` intent, armed button doors)
- `server/src/puzzleDoorSmokeTest.ts` (new)
- `server/package.json` (`test:puzzle-door`)