# V61 Old-vs-new game-logic diff audit

Scope: `surviv.io-main-v53-matchmaking-recovery` (old, based on survev 0.0.15)
vs `survev-master` (new upstream 0.3.11). Compared shared config/defs, the
server Player/WeaponManager/explosion/gas/airdrop/loot logic, and the AI loot
loop.

## Clear bugs found and fixed (in this workspace)

1. **Savannah kill-streak buff replaced loot perks** (`V59`): role promotion
   removed every perk. Ported the upstream `isFromRole` preservation logic.
2. **AI looped picking up loot the backpack cannot hold** (`V60`): heal/boost/
   throwable loot scoring ignored bag capacity; added capacity caps and a
   `PickupMsgType.Full` blacklist.
3. **`WeaponManager.reload()` crashed on an emptied weapon slot** (`V61`):
   added the upstream empty-slot guard.

## Verified identical (no gap)

- `shared/gameConfig.ts` constants: 0 leaf differences (bag sizes, gas,
  player stats, killLeaderMinKills, ...).
- Gas stage damage/duration table.
- Airdrop collision/damage logic.
- Explosion "sort by distance to prevent damaging through walls" (already
  present in the old build).
- Revive end-of-revive `cancelAction` guard (already present).

## Differences classified as new features / balance (not ported)

- `down()`: downed-damage buffer, final-circle downed HP 50, auto melee, pan.
- `damage()`: combat-stim heal, lifeline perk, armor penetration, headshot
  chance config, airdrop armor reduction.
- `useHealingItem/useBoostItem`: locked during revive / cooking throwable.
- `getFreeGunSlot`: dual-wield `AlreadyOwned` refinement.
- `recalculateScale`: "fat" scaling modifier + visual-bounds refresh.
- Kill-leader threshold: new build promotes at 3 kills on every map; the old
  build used 3 for Savannah and 1 elsewhere.

## Notes

- The old build carries large custom AI/faction code that does not exist in
  upstream; method-level diffs on those areas were excluded from this audit.
