# V78 Validation

## Builds

- Server TypeScript production build: PASS
- Client TypeScript + Vite build: PASS
- `test:perk-role-wander` (new): PASS
- `test:savannah-perks`: PASS
- `test:new-perks-port`: PASS
- `test:v41-suite` (11 tests): PASS
- V53–V77 regression tests: PASS

## Fix verification

### ap_rounds / loot-perk preservation
- `ap_rounds` (droppable loot) survives a `last_man` role assignment (5 role
  perks) and keeps its droppable loot slot: PASS
- `splinter` also survives the role assignment: PASS
- The old "drop all droppable perks when the role has >= 4 perks" branch is
  removed: PASS
- `test:new-perks-port` still verifies armorPenetration / obstacleMult: PASS

### Low-health wander (hysteresis)
- Faction injured band: 44 HP -> flagged; 50 HP -> still flagged (45..55 band);
  60 HP -> cleared: PASS
- `injuredHigh` maintained in `updateBot`, consumed by `injuredCount`: PASS
- Bot retreat hysteresis (`retreatHysteresisActive`) exists in smartBot: PASS

## Files changed

- `server/src/game/objects/player.ts`
- `server/src/bot/factionStrategy.ts`
- `server/src/smartBot.ts`
- `server/src/perkRoleAndWanderSmokeTest.ts` (new)
- `server/package.json` (`test:perk-role-wander`)