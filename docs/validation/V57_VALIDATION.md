# V57 Validation

## Builds

- Server TypeScript production build: PASS
- `test:special-roles` (extended with unarmed opening-staging cases): PASS
- `test:gameplay-roles`: PASS
- `test:all-modes`: PASS
- `test:faction-autofill`: PASS
- `test:v41-suite` (11 tests): PASS

## Live verification (faction pure-AI match, 8 bots, 240 s)

- Each faction produced a leader (bot 1 team 1, bot 2 team 2): PASS
- Team-1 leader repositioned to its mid-back staging point and held it in the
  "special" flare state with `flare_gun` equipped: PASS
- Leader queued flare shots at the friendly-half staging target: PASS
- Flare fired successfully (flare ammo 1 -> 0 ~90 s into the match): PASS
- Military airdrop crate (`airdrop_crate_03`) spawned afterwards: PASS

## Files changed

- `server/src/bot/specialRoleStrategy.ts`
- `server/src/smartBot.ts`
- `server/src/specialRoleSmokeTest.ts`
