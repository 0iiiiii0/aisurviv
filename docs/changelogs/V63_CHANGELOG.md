# V63 Align gameplay rules with the new upstream build

Ported the upstream 0.3.11 gameplay behaviours that the V61 audit classified
as rule changes:

- Kill leader now promotes at `GameConfig.player.killLeaderMinKills` (3 kills)
  on every map, not just Savannah (was 3 on Savannah / 1 elsewhere).
- Downing grants a short damage buffer (`GameConfig.player.downedDamageBuffer`)
  so a freshly downed player cannot be instantly finished.
- In the final circle (`gas.currentRad <= 0.1`) a downed player gets 50 HP
  instead of 100.
- Downed players auto-switch to melee and wear the pan.
- Airdrop damage is now reduced by armor (armor is only ignored for gas and
  bleeding).
- Headshot chance comes from `GameConfig.player.headshotChance` and explosions
  never headshot.
- Healing/boost items are locked while reviving or cooking a throwable.
- Picking up a gun that dual-wields with the active gun reports AlreadyOwned.
- Reviving resets the downed damage buffer.
