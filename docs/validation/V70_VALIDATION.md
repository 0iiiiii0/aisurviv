# V70 Validation

## Builds

- Server TypeScript production build: PASS
- `test:combat-readiness` (new): PASS
- `test:v22-resource-combat`: PASS
- `test:v41-suite` (11 tests): PASS
- `test:cooperation`: PASS
- `test:movement-jitter`: PASS
- `test:bot-disconnect-recovery`: PASS
- `test:all-downed-elimination`: PASS
- `test:puzzle-door`: PASS
- `test:worker-thread-room`: PASS
- `test:savannah-perks`: PASS
- `test:loot-capacity`: PASS
- `test:v53-matchmaking`: PASS

## Fix verification (`test:combat-readiness`)

- Unarmed bot, solo mode: `prioritizeWeaponSearch=true`, `allowCombat=false`: PASS
- Unarmed bot, faction mode: same refusal: PASS
- Armed + sufficient ammo: `allowCombat=true`: PASS
- Armed + insufficient ammo: `prioritizeWeaponSearch=true`, `allowCombat=false`: PASS
- Backward compatibility (no ammo flag): armed bot fights: PASS
- Point-blank melee against an unarmed/low-ammo bot: `immediateMeleeThreat=true`,
  `allowCombat=false` (self-defense is forced, not voluntary): PASS
- Source guarantees: `hasSufficientCombatAmmo`, `combatAmmoSufficient` wiring,
  `forcedMeleeSelfDefense` gate, mode-agnostic weapon-search reasons: PASS

## Live run (solo, 8 bots, 150 s)

- No crashes or reconnect loops: PASS
- combat-state share 0.9%: PASS
- 8 low-ammo combat frames audited: every one is policy-allowed (shotgun clip>=2
  or m9 clip>=5; frame data does not include reserve ammo): PASS

## Files changed

- `server/src/bot/resourceCombatPolicy.ts` (mode-agnostic, `combatAmmoSufficient`)
- `server/src/smartBot.ts` (`hasSufficientCombatAmmo`, policy wiring, melee
  self-defense gate, generic weapon-search reasons)
- `server/src/combatReadinessSmokeTest.ts` (new)
- `server/package.json` (`test:combat-readiness`)