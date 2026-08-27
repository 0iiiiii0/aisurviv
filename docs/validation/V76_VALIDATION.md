# V76 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript + Vite build: PASS
- admin.js syntax: PASS
- `test:bot-autofill-config`: PASS
- `test:faction-autofill`: PASS
- `test:admin`: PASS
- `test:v50-room-targets`: PASS
- `test:v41-suite` (11 tests): PASS
- V53–V75 regression tests: PASS

## Fix verification

- `getBotAutoFillPolicy("main", Solo)` uses `soloTargetPlayerCount`: PASS
- `getBotAutoFillPolicy("main", Duo)` uses `duoTargetPlayerCount`: PASS
- `getBotAutoFillPolicy("main", Squad)` uses `squadTargetPlayerCount`: PASS
- `getBotAutoFillPolicy("faction", Squad)` uses `factionTargetPlayerCount`, and
  falls back to the squad target when the faction cap is unset: PASS
- Config migration: legacy shared `targetPlayerCount` seeds all three ordinary
  targets and is deleted; explicit V50 target wins over legacy caps: PASS
- Admin snapshot returns the four fields; admin UI shows four inputs and each
  mode card uses its own team-mode target: PASS
- Startup normalization clamps each target to 1-100: PASS

## Files changed

- `server/src/config.ts`
- `server/src/botAutoFill.ts`
- `server/src/game/gameManager.ts`
- `server/src/adminServer.ts`
- `client/public/admin/admin.js`
- `client/public/admin/index.html`
- `server/src/botAutoFillConfigSmokeTest.ts`
- `server/src/factionAutoFillSmokeTest.ts`
- `server/src/adminSmokeTest.ts`
- `server/src/v50UnifiedTargetDuelAdminSmokeTest.ts`