# V64 Port the new upstream perks

Ported the remaining upstream 0.3.11 perk mechanics from the V61 audit:

- **lifeline (Indomitable)**: lethal hits convert adrenaline into survival at
  1 HP (`conversionRate`), and adrenaline decays slower (`decayMult`).
- **combat_stims (Combat Stimulants)**: using a heal/boost activates a 5-second
  window; while active the bot's gunfire heals friendly targets
  (`healPercent`) and deals bonus damage (`bonusDamageMult`).
- **ap_rounds (AP Rounds)**: bullets carry `armorPenetration` that reduces the
  target's armor damage reductions, and deal `obstacleMult` extra damage to
  obstacles.
- Perk definitions, client loot icons, loot-table entries (base crate tier and
  Savannah perk tier) and `DamageParams.armorPenetration` were added.

The `fat`/view-distance scaling mechanic was NOT ported: it depends on a food
system that does not exist in this build.
