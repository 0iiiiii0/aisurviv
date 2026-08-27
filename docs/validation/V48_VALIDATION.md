# V48 Validation Report

Generated: 2026-07-31T09:46:40.922548+00:00

## Result

- Server TypeScript build: **PASS** (`npm --prefix server run build`)
- Independent server tests: **67/67 PASS**
- Resource collider audit: **PASS**
  - 170 resource definitions
  - 83 Circle definitions
  - 87 AABB definitions
  - 3360 transformed geometry/approach cases
  - 0 issues
- Changed-file whitespace validation: **PASS** (`git diff --check`)
- Clean-baseline patch application: **PASS** (`git apply --check`, server build and focused tests after applying)
- Client TypeScript type-check: **PASS** (`cd client && node node_modules/typescript/bin/tsc --noEmit`)

## Client bundle limitation

The Vite bundle could not be completed in this Linux validation container because the uploaded `client/node_modules` contains the Windows Rollup native package (`@rollup/rollup-win32-x64-msvc`) but not the Linux optional package (`@rollup/rollup-linux-x64-gnu`). The extracted `.bin/vite` file also lacks an executable bit. This is an environment/dependency-layout problem; the client TypeScript source itself passed type-checking.

## Test list

- `test:duel` — PASS
- `test:duel-lobby` — PASS
- `test:admin` — PASS
- `test:ipv6` — PASS
- `test:potato` — PASS
- `test:bot-input` — PASS
- `test:duel-vision` — PASS
- `test:all-modes` — PASS
- `test:spectator-autofill` — PASS
- `test:loot-ai` — PASS
- `test:bot-brain` — PASS
- `test:faction-autofill` — PASS
- `test:bot-combat-heal` — PASS
- `test:resource-sweep` — PASS
- `test:loot-safety` — PASS
- `test:aim-control` — PASS
- `test:special-roles` — PASS
- `test:gameplay-roles` — PASS
- `test:integrated-spec` — PASS
- `test:faction-airdrop-container` — PASS
- `test:admin-auth` — PASS
- `test:bot-autofill-config` — PASS
- `test:navigation-recovery` — PASS
- `test:room-lifecycle` — PASS
- `test:revive-coordination` — PASS
- `test:spectator-difficulty` — PASS
- `test:cpu-load` — PASS
- `test:gas-escape` — PASS
- `test:combat-tactics` — PASS
- `test:v22-resource-combat` — PASS
- `test:forbidden-ai` — PASS
- `test:forbidden-context` — PASS
- `test:airstrike-safety` — PASS
- `test:spud-gun` — PASS
- `test:ai-recorder` — PASS
- `test:collective-sim` — PASS
- `test:mode-isolation` — PASS
- `test:v26-sim` — PASS
- `test:v27-sim` — PASS
- `test:spectator-supervisor` — PASS
- `test:v28-spectator-sim` — PASS
- `test:aim-training` — PASS
- `test:v29-aim-sim` — PASS
- `test:dual-switch` — PASS
- `test:v30-dual-switch-sim` — PASS
- `test:v31-ui-cover` — PASS
- `test:v32-combat-nav-airdrop` — PASS
- `test:v33-aim-brokenarrow` — PASS
- `test:v34-vision-process` — PASS
- `test:v35-sim` — PASS
- `test:v36-tactics` — PASS
- `test:v40-duel-recovery` — PASS
- `test:game-process-reuse` — PASS
- `test:v41-spectator-share` — PASS
- `test:v41-duel-room` — PASS
- `test:v41-pure-ai` — PASS
- `test:v41-spectator-interaction` — PASS
- `test:v41-launcher` — PASS
- `test:v42-aim-spectator` — PASS
- `test:v43-regression` — PASS
- `test:v44-map-dodge` — PASS
- `test:v45-core` — PASS
- `test:v46-replay-ai` — PASS
- `test:v47-regular-replay` — PASS
- `test:resource-colliders` — PASS
- `test:ghillie-config` — PASS
- `test:throwable-tactics` — PASS

## Validation notes

- Two stale regression assertions were found and corrected during testing: the old 3.25-second ordinary strobe hazard duration and the invalid 55 ms / 42 ms historical throw cadence.
- No production test remained failing after those outdated expectations were corrected.
- This validation is deterministic/static and does not replace a long-duration live multiplayer soak test with real clients.
