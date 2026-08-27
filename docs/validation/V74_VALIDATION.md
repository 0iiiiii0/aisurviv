# V74 Validation

## Builds

- Server TypeScript production build: PASS
- `test:downed-finish` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:cooperation`: PASS
- `test:combat-readiness`: PASS
- `test:smoke-handling`: PASS
- `test:scope-suppression`: PASS
- `test:movement-jitter`: PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:bot-disconnect-recovery`: PASS
- `test:v53-matchmaking`: PASS

## Fix verification (`test:downed-finish`)

- Solo `targetScoreModifier`: finishDowned=true (+22) beats finishDowned=false
  (-34): PASS
- Solo safe finish contributes a positive score: PASS
- Faction finish (+22) beats the threat penalty (-8): PASS
- Source guarantees:
  - `directThreatActive` pre-scan exists: PASS
  - `downedPenalty = data.downed ? (directThreatActive ? 45 : -20) : 0`: PASS
  - `finishDowned: Boolean(data.downed) && !directThreatActive` passed to the
    mode strategy: PASS
  - mode strategy `finishDowned ? 22` positive branch: PASS

## Behavior matrix

- No direct threat + downed enemy in view: targeted and finished (bonus): FIXED
- Direct threat (close / aiming / recent fire) + downed enemy: threat first,
  downed still penalized: unchanged
- Self-reviving faction medic: still finished with high priority: unchanged

## Live run (main, 14 bots, 240 s)

- No regressions; no downed enemies appeared in view during the pure-AI run, so
  the finish scenario could not fire live; decision logic is covered by the
  deterministic tests above.

## Files changed

- `server/src/smartBot.ts` (`directThreatActive` pre-scan, conditional downed
  penalty, `finishDowned` flag)
- `server/src/bot/modeStrategy.ts` (`ModeTargetContext.finishDowned`, +22 finish
  branch)
- `server/src/downedFinishSmokeTest.ts` (new)
- `server/package.json` (`test:downed-finish`)