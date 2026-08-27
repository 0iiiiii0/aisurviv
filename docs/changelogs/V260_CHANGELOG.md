# V260 — 1v1 AI Combat Regression Recovery

## AI combat

- Restored spread-aware ricochet planning from the stronger V45 behavior.
- Removed impossible `recoilTime` first-shot-accuracy waits from both Forbidden/LEGIT and local tactical ricochet execution.
- Kept a strict packet-facing ricochet alignment gate with a tiny bounded recovery (`0.0006 -> 0.0009 rad after 140 ms`).
- Emergency proven bullet/explosive/gun-line dodges now bypass V68 movement smoothing; normal movement remains smoothed.
- Final wall safety now validates the first blocker on the actual transmitted aim ray and permits the intended tactical object itself.
- Fixed throwable special-action phase churn during grenade cooking.

## Test safety

- `zombieNuclearAchievementG13SmokeTest.ts` now requires an explicit safe temporary `SURVIV_DATA_DIR`; it can no longer default to recursively cleaning the current project directory.

## Included prior fixes

- V258 extraction party reserved-slot/auto-fill repair.
- V259 zombie difficulty propagation and queue isolation for nuclear achievement production rooms.

## New regression test

- `server/src/v260DuelCombatRegressionSmokeTest.ts`
