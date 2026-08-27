# V71 Validation

## Builds

- Server TypeScript production build: PASS
- `test:scope-suppression` (new): PASS
- `test:combat-readiness`: PASS
- `test:movement-jitter`: PASS
- `test:cooperation`: PASS
- `test:v41-suite` (11 tests): PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
- `test:savannah-perks`: PASS
- `test:v53-matchmaking`: PASS
- `test:loot-capacity`: PASS

## Fix verification (`test:scope-suppression`)

- 8x scope + close enemy (12u) -> drop-scope "close-enemy": PASS
- 8x scope + visible target off-screen -> drop-scope "off-screen-target": PASS
- 8x scope + recently damaged -> drop-scope "under-fire": PASS
- 8x scope + close ballistic threat -> drop-scope: PASS
- 1x scope never drops: PASS
- Suppression cleared + long-range + grace passed -> raise-scope "safe-long-range": PASS
- Grace period / short distance blocks re-scoping: PASS
- Scope-switch cooldown blocks repeated toggling: PASS
- Source wiring (decideScopeAction, EquipPrev/NextScope, combat +
  counterfireFromTrajectory call sites, recorder event): PASS

## Live run (main, 12 bots, 180 s)

- No regressions; solo `weapon-search` intents observed (27): PASS
- The only 4x-scoped bot never met a close enemy while scoped, so no suppression
  fired (correct no-op, no false drops): PASS

## Files changed

- `server/src/bot/scopeSuppressionStrategy.ts` (new pure decision module)
- `server/src/smartBot.ts` (`manageScopedVision`, scope state fields, calls in
  combat/counterfire, `scope_suppression_dropped` recording)
- `server/src/scopeSuppressionSmokeTest.ts` (new)
- `server/package.json` (`test:scope-suppression`)