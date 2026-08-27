# V72 Validation

## Builds

- Server TypeScript production build: PASS
- `test:smoke-handling` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:cooperation`: PASS
- `test:combat-readiness`: PASS
- `test:movement-jitter`: PASS
- `test:scope-suppression`: PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
- `test:v53-matchmaking`: PASS

## Fix verification (`test:smoke-handling`)

- One-way smoke vision model:
  - Outside observer -> target inside smoke: hidden (AI cannot see the human): PASS
  - Inside observer -> target outside: visible (human's one-way advantage): PASS
  - Both inside: visible: PASS
- `injectSmokeContact` creates a smoke contact with confidence >= 0.5: PASS
- Repeated fire refreshes the contact and extends its expiry: PASS
- Source guarantees:
  - ballistic threat bridge is wired into concealment updates: PASS
  - `smoke_ambush_bridged` recording exists: PASS
  - `smokeDangerAvoidance` only reacts to smoke with a contact / incoming fire: PASS
  - tracker owns `injectSmokeContact` and `hasContactInZone`: PASS

## Live run (main, 16 bots, 240 s)

- No regressions; concealment standoff verified on bushes (suppress burst fired
  from ~31 units outside the target, outside the 1x vision ring): PASS
- No smoke was deployed/encountered in the pure-AI run, so the human-specific
  smoke-ambush bridge could not fire live; its decision logic is covered by the
  deterministic tests above.

## Files changed

- `server/src/bot/concealmentIntelligence.ts` (`injectSmokeContact`,
  `hasContactInZone`)
- `server/src/smartBot.ts` (`bridgeBallisticThreatToSmokeContact`,
  `smokeDangerAvoidance`, wiring in concealment update + moveDirection,
  `smoke_ambush_bridged` recording)
- `server/src/smokeHandlingSmokeTest.ts` (new)
- `server/package.json` (`test:smoke-handling`)