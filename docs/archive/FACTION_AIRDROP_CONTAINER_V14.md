# Surviv.io AI V14 — Faction Airdrop and Container Navigation

Base: V13 (`surviv.io-main-role-navigation-potato-loot-v13-full.zip`)

## 1. Commander military-airdrop placement

The 50v50 commander now uses the faction coordinator's learned opening/spawn anchor as the primary rear-line reference.

The flare staging calculation now:

- strongly prefers the commander's own half during opening and early phases;
- resists frontline formation/objective positions pulling the flare across the map midpoint;
- reapplies the friendly-side constraint after safe-circle correction;
- scores several nearby candidate points and rejects points under a roof, close to structures, inside an active airstrike, outside the usable safe area, or close to an enemy cluster;
- keeps the existing authoritative indoor check and successful-shot verification.

If the safe zone eventually forces the faction away from its original half, the bot retains as much friendly-side depth as the circle permits rather than refusing to deploy indefinitely.

## 2. Military airdrop opening and payload destruction

Military airdrops are handled in three stages:

1. **Falling crate:** nearby assigned bots form a security area and avoid standing directly under it.
2. **Landed shell (`airdrop_crate_03` / `airdrop_crate_04`):** a reserved opener approaches and uses the interaction button.
3. **Military payload (`crate_12` / `crate_13`):** suitable faction bots explicitly prioritize and destroy the inner crate while other assigned bots maintain the security ring.

The heavy `crate_12` needs more than the ordinary 16-hit resource limit when using fists. The dedicated military-airdrop plan therefore permits up to 28 estimated melee hits. This exception applies only to the military payload, not to ordinary low-value scenery.

Combat, recent damage, gas and airstrike emergencies still override airdrop work.

## 3. Shipping-container loot navigation

Shipping-container loot no longer uses a direct straight line through the container wall.

The navigation layer now understands the local geometry and orientation of:

- `container_01`
- `container_02`
- `container_03`
- `container_04`
- `container_01x`
- `container_05`
- `container_06`

For a closed container, the route is:

`outside mouth -> inside mouth -> selected loot`

For the open-through container variant, the bot chooses the nearer end.

When an obstacle blocks the entrance:

- wooden boards, planks, barricades, crates and safe destructible furniture are attacked first;
- metal container walls are never mistaken for boards;
- explosive barrels are not punched merely because they obstruct the entrance;
- plated, stone, button-operated and non-destructible obstacles are rejected;
- after repeated attacks without damage, the blocker and loot target are temporarily ignored and the bot replans instead of vibrating against the wall.

## 4. Files changed

- `server/src/smartBot.ts`
- `server/src/bot/containerNavigation.ts` (new)
- `server/src/bot/factionStrategy.ts`
- `server/src/bot/specialRoleStrategy.ts`
- `server/src/specialRoleSmokeTest.ts`
- `server/src/factionAirdropContainerSmokeTest.ts` (new)
- `server/package.json`
- corresponding compiled files under `server/dist/`

## 5. Installation

1. Stop the launcher and all related `node.exe` processes.
2. Extract the update-only package into the project root that contains `server`, `client` and `shared`.
3. Overwrite matching files.
4. Restart the server and create a new room.

Existing game processes do not reload bot code after files are replaced.

## 6. Validation scope

The build and automated smoke tests pass. The tests cover friendly-half flare planning, military-airdrop definitions and heavy payload break feasibility, rotated container entrance geometry, safe board classification, all-mode configuration, 50v50 autofill, spectator logic, combat/healing, potato mode, duel mode and admin flows.

No claim is made that this automated suite reproduces every live 40-bot map layout or every dynamically generated obstacle arrangement. A new 50v50 room should still be observed for map-specific edge cases.
