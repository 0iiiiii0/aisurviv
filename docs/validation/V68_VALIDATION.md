# V68 Validation

## Builds

- Server TypeScript production build (`npm run build`): PASS
- Client TypeScript + Vite build (`npm run build` in client/): PASS
- `test:movement-jitter` (new): PASS
- `test:v22-resource-combat`: PASS
- `test:bot-input`: PASS
- `test:v41-suite` (11 tests): PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:savannah-perks`: PASS
- `test:loot-capacity`: PASS
- `test:v53-matchmaking`: PASS

## Fix verification (`test:movement-jitter`)

- Micro-wobble (0.1 rad) never toggles keyboard flags: PASS
- A 180-degree flip inside the lock rotates smoothly, no snap: PASS
- A sustained flip completes within a bounded time (real 30 ms ticks): PASS
- Lock expiry continues the turn with a fresh hold instead of snapping: PASS
- Emergency movement still snaps immediately: PASS
- Left/right oscillating target never drags the bot into a full flip; the
  oscillation amplitude stays bounded (<0.9 rad): PASS

## Live measurement (main map, 8 bots, 120 s, 100 ms sample)

- loot >=90deg flip rate: 17.9% -> 1.8%: PASS
- break-crate: 21.8% -> 1.8%: PASS
- gas: 31.7% -> 13.6%: PASS
- heal: 32.4% -> 7.0%: PASS
- overall flip rate: ~18-32% -> ~4-5%: PASS

## Files changed

- `server/src/bot/movementInput.ts` (`stabilizeMovementDirection` rewrite:
  hysteresis + bounded angular rotation + non-snapping lock expiry)
- `server/src/smartBot.ts` (per-state turn rates, gas smoothing, elapsedMs
  tracking, `lastMovementStabilizeAt` field)
- `server/src/movementJitterSmokeTest.ts` (new)
- `server/package.json` (`test:movement-jitter`)