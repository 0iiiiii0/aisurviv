# V60 Validation

## Builds

- Server TypeScript production build: PASS
- `test:loot-capacity` (new): PASS
- `test:v41-suite` (11 tests): PASS
- `test:savannah-perks`: PASS

## Fix verification (`test:loot-capacity`)

- heal (`scoreLoot`) caps its target at `inventoryCapacity` and returns -100
  when the backpack is already full: PASS
- boost caps its target the same way: PASS
- throwable is skipped at full capacity: PASS
- `PickupMsgType.Full` blacklists the loot object for 8 seconds: PASS
- Documented capacity facts (level-0 backpack):
  bandage 5 < old target 10, medkit 1 < 3, soda 2 < 5, painkiller 1 < 2,
  frag 3 < 4: PASS

## Files changed

- `server/src/smartBot.ts`
- `server/src/lootCapacitySmokeTest.ts` (new)
- `server/package.json`
