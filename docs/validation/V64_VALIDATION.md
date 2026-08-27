# V64 Validation

## Builds

- Server TypeScript production build: PASS
- Client production build (dist regenerated with new perk icons): PASS
- `test:new-perks-port` (new): PASS (5 consecutive runs)
- `test:v41-suite` (11 tests): PASS
- `test:new-behavior-port`, `test:savannah-perks`, `test:loot-capacity`,
  `test:reload-guard`, `test:worker-thread-room`, `test:v53-matchmaking`,
  `test:all-modes`: PASS

## Perk verification (`test:new-perks-port`, faction game)

- Indomitable: a lethal 120-damage hit leaves the player at 1 HP and consumes
  adrenaline: PASS
- Combat Stimulants: friendly gunfire while stims are active heals the target
  (50 -> 56 HP): PASS
- AP Rounds: `armorPenetration: 0.8` deals more damage through a chest with
  25% reduction than a normal hit: PASS
- Source assertions cover the perk properties, damage wiring, and bullet
  penetration/obstacle multipliers: PASS

## Files changed

- `shared/defs/gameObjects/perkDefs.ts`
- `shared/defs/maps/baseDefs.ts`, `shared/defs/maps/savannahDefs.ts`
- `shared/defs/gameObjects/gameObject.ts` (DamageParams)
- `server/src/game/objects/player.ts`, `weaponManager.ts`, `objects/bullet.ts`
- `client/public/img/loot/*.svg` (3 new icons) + rebuilt `client/dist`
- `server/src/newPerksPortSmokeTest.ts` (new)
- `server/package.json`
