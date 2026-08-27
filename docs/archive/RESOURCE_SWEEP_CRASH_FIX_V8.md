# Resource Sweep and Loot Crash Fix V8

## Opening resource-point clearing

During the early map phase, ordinary-mode bots now commit to a local resource sweep after selecting loose loot or a breakable resource object.

- Sweep radius is 20-30 world units, scaled by the value of the detected resource source.
- Useful loose loot inside the active point is collected before another point is selected.
- When no useful loose loot remains, the bot searches the same point for reachable resource-dropping obstacles.
- Loot produced by a destroyed obstacle extends the existing sweep instead of pulling the bot toward an unrelated distant target.
- The sweep ends when no useful loose loot or reachable resource obstacle remains, the map leaves the early phase, or the 26-second hard limit expires.
- Combat, gas, airstrikes, rescue and cover-healing retain their higher priorities.
- Full inventory stacks and worthless/redundant items do not keep a point active indefinitely.

## Crash repair

The reported crash occurred while an obstacle was creating loot:

`TypeError: Cannot use 'in' operator to search for 'lootImg' in undefined`

The faction loot table referenced the undefined item `outfitDarkGhillie`; the spring woods table also referenced `outfitSpringGhillie`, which was not present in `GameObjectDefs`.

Repairs:

- Both invalid outfit entries now use the valid `outfitGhillie` definition.
- The missing `tier_faction_outfits` table is now defined.
- `LootBarn.addLoot()` and `addLootWithoutAmmo()` validate item definitions before constructing loot.
- Invalid or undefined loot entries are skipped and logged once instead of terminating the process.
- Loot-tier selection rejects empty/malformed weighted tables and circular tier references safely.
- The `Loot` constructor assertion now short-circuits safely when a definition is missing.

The Vite `/admin-api/status` `ECONNREFUSED` messages in the supplied log were secondary: the proxy could no longer reach port 8001 after the server process exited.
