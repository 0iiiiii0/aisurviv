# V260 AI Combat Regression Analysis

## Scope

Compared the current V257 full project and the old V45 full project, then analyzed the supplied V257 1v1 recordings. The V45 project also contains its historical `V43_RECORDING_ANALYSIS.json`, which is useful as a pre-regression reference for the combat path inherited by V45.

## What did *not* regress

The following core modules are unchanged between V45 and the V257 baseline:

- `bot/duelStrategy.ts`
- `bot/weaponBallistics.ts`
- `bot/difficultyProfiles.ts`

The main intercept/lead and proven dodge mathematics are still present. The loss of combat strength came mainly from later execution/safety layers around those algorithms, not from replacing the core solver.

## V257 recording evidence

For 86 LEGIT, one-bot duel sessions in the supplied recording:

- 15,387 sampled frames.
- 9,541 visible/on-screen target frames; only ~25.56% transmitted a shot in the sampled frame.
- 3,290 frames selected `ricochet`, but **0** of those frames requested a shot; only 66 had a transmitted shot due to packet/state overlap.
- 67,984 `indirect_ricochet_selected` events.
- 36,754 `gunfire_wall_blocked` events.
- 3,222 final `gunfire_request_suppressed` events.
- 135,989 `special_action_phase_changed` events for only 498 queued special actions.

The old recording analysis embedded in the V45 project has 195 ricochet-intent frames and 137 ricochet-shot frames (~70.26%). The datasets are not identical matches, so this is not a direct win-rate benchmark, but it strongly confirms the execution-path regression seen in source.

## Confirmed regression 1: ricochet fire deadlock

V257 changed the forbidden ricochet planner to `spreadRadians: 0`, then required `currentWeapon.recoilTime <= 0.015` before firing. The duel AK-47 and M39 definitions both use `recoilTime: 1e10`, so this condition is effectively never satisfied.

V257 also added the same assumption to the local tactical ricochet path, deriving a wait duration from `recoilTime * 1000`.

### V260 fix

- Restore real `shotSpread` in both ricochet planners.
- Remove `recoilTime` as a ricochet execution gate.
- Preserve authoritative `cooldown`/WeaponManager cadence.
- Preserve a strict packet-facing ricochet alignment gate.
- Initial alignment remains 0.0006 rad; after 140 ms of a continuous request, only 0.0009 rad is accepted.
- Authoritative ricochet physics simulation at 0.0009 rad: 960 shots, 99.375% reflection rate, 96.458% aggregate hit rate; every tested weapon/movement bucket remained >=90% hit rate.

## Confirmed regression 2: intended tactical cover shot vetoed as a wall

The V257 final packet safety layer could prefer an older generic tactical lock over the current forbidden shot intent, then use a center-bearing approximation. This can make the exact crate/stone/barrel selected for destruction or detonation become the object that cancels the shot.

A conservative correlation of wall events to the immediately preceding duel frame found 594 cases where the wall blocker ID was the same object as the current `destroy`/`explode` intent (535 crate, 57 stone, 2 barrel).

### V260 fix

The final safety check now casts the **actual transmitted aim ray**. It allows a tactical shot only if the intended tactical object is the first blocker. A different first blocker is still rejected, so wall-penetration protection remains intact.

## Confirmed regression 3: emergency dodge execution lag

V68 introduced bounded-angle movement smoothing. This is useful for navigation/loot jitter, but a 180-degree combat reversal can take multiple ticks. The proven bullet/gun-line dodge solver assumes the selected escape direction is executed immediately.

### V260 fix

Only verified emergency evasions bypass smoothing:

- reactive bullet dodge;
- explosive escape;
- proactive live gun-line dodge.

Ordinary combat movement, navigation, loot movement and cover steering keep the newer smoothing logic.

## Confirmed regression 4: throwable phase churn

During grenade cook, V257 could do `holding -> aligning -> holding` every tick. In the supplied duel logs this produced roughly 135k phase records for 498 queued actions.

### V260 fix

Once `throwPhase` has begun, the action stays in its holding/released phase instead of being reset to aligning every tick.

## Other fixes retained

V260 also contains:

- V258 extraction TeamMenu reserved-seat fix;
- V259 production zombie difficulty propagation/queue isolation fix for automatic nuclear achievement granting;
- safety hardening for `zombieNuclearAchievementG13SmokeTest.ts` so running it without an explicit temporary `SURVIV_DATA_DIR` cannot recursively erase the server working directory.

## Validation caveat

The supplied V257 logs cannot be replayed as a new live V260 human-vs-bot match inside this offline build environment. Therefore V260 does **not** claim a measured post-fix win-rate increase. The repaired paths are instead verified with source regression tests, existing duel/Forbidden AI tests, and authoritative server bullet physics simulation.
