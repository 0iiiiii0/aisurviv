# V65 Validation

## Builds

- Server TypeScript production build: PASS
- `test:all-downed-elimination` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:faction-autofill`, `test:gameplay-roles`, `test:new-perks-port`,
  `test:new-behavior-port`, `test:savannah-perks`: PASS

## Verification (`test:all-downed-elimination`)

- Faction (50v50), no self_revive: last survivors downed -> whole team
  eliminated, `aliveCount` 1, `game.over` true: PASS
- Faction, with self_revive on a teammate: same immediate elimination: PASS
- Duo with self_revive: same immediate elimination: PASS
- Before the fix the same scenarios left both players downed with
  `aliveCount` 2 and the game running until bleed-out.

## Files changed

- `server/src/game/team.ts` (`Team.checkAllDowned`)
- `server/src/game/gameModeManager.ts` (Team-mode induction branch)
- `server/src/allDownedEliminationSmokeTest.ts` (new)
- `server/package.json`
