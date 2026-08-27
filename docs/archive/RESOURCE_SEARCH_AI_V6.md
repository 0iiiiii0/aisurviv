# Resource Search AI V6

This update is based on the V5 project and keeps the V4 decision refactor plus the V5 50v50 30+30 AI limit.

## Resource obstacle recognition

The bot no longer relies on a short crate-name or obstacle-category list. It reads the authoritative `MapObjectDefs` entry and accepts an obstacle when it is:

- an obstacle object;
- destructible;
- on the bot's current layer;
- alive;
- configured with one or more loot drops;
- not a wall, door, interaction button, or point-blank explosive hazard.

This includes bank deposit boxes/safes (`deposit_box_01`, `deposit_box_02`), lockers, drawers, bookshelves, gun mounts, vending machines, toilets, pots, planters, event pumpkins/potatoes, resource trees/stones, and every normal/special crate whose definition actually contains loot.

## Expected-value and hit-cost planning

For each resource obstacle, the bot estimates:

- expected drop count and value from direct item/tier definitions;
- remaining obstacle health;
- melee damage × obstacle-damage multiplier;
- armor/stone piercing compatibility;
- estimated hits and time to destroy;
- route distance and threat exposure.

The absolute commitment limit is 16 melee hits. Armor-plated or stone-plated targets are skipped unless the current melee can damage them. Explosive barrels are not punched at point-blank range.

## Optimized search

Ground loot and breakable resources use a two-stage search:

1. Cheap value/distance/inventory evaluation for all visible candidates.
2. Near, middle, and far candidate buckets.
3. Only the highest-ranked shortlist receives obstacle/path validation.
4. Squad reservations prevent multiple bots selecting the same item or resource.
5. Lock duration scales with distance and estimated destruction time, reducing target oscillation.

This avoids repeatedly running full path checks for every loot pile and obstacle in dense towns or 50v50 games.

## Threat-aware behavior

- One-hit deposit boxes and lockers may still be broken when an enemy is moderately close.
- Long tree/stone/crate commitments are rejected as danger, low health, late gas, or distance increases.
- Under-armed bots receive a large resource-search bonus when no loose gun is available.
- Three swings without health progress temporarily blacklist the target, preventing permanent wall/collider loops.

## Validation

- TypeScript server build passed.
- Loot/resource strategy smoke test passed.
- Smart bot decision and input smoke tests passed.
- 50v50 faction auto-fill test passed with 2 bots/second and 30+30 cap.
- Spectator/auto-fill test passed.
- All-mode test passed for 47 playlists and 17 maps.
- Definition coverage: 129/129 authoritative destructible loot obstacles profiled; 128 safe non-explosive targets; 119 destroyable with fists within the 16-hit cap.
