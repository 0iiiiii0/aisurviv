# V51 50v50 Medic Revive Fix

Base: V50 commit `00e7018`

## Fixed

- 50v50 AI medics now start self-revive while downed when no revive action is active.
- AI medics hold an existing revive action instead of repeatedly sending Revive and resetting/contesting it.
- Added explicit revive ownership through `revivedBy`.
- A medic being revived by another player no longer converts that player's direct revive into the medic's area revive.
- Area revive remains valid when:
  - the medic self-revives; or
  - the medic is the actual player reviving a teammate.
- Revive cancellation now clears both the reviver and target links.
- Death during a revive clears the action owner and target, preventing stale revive state.
- Downed self-revive target selection is explicit and no longer depends on spatial-grid ordering.

## Added

- `server/src/game/revivePolicy.ts`
- `server/src/v51FactionMedicReviveSmokeTest.ts`
- `test:v51-medic-revive`
- `V51_MEDIC_LOGIC_COMPARISON.md`
- `V51_VALIDATION.md`
