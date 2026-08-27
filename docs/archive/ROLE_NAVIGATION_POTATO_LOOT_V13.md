# ROLE_NAVIGATION_POTATO_LOOT_V13

V13 is a hard-fix release based on the V12 full project. It replaces several heuristic-only decisions with authoritative server state and adds continuous collision handling for spawned loot.

## Commander flare gun

- The server now sends the authoritative `Player.indoors` state to the bot client.
- A commander never equips or fires a flare while `indoors === true` or while below ground.
- After crossing a doorway, the commander walks at least 4.2 world units into open ground and remains continuously outdoors for 1000 ms before firing.
- A local Shoot input no longer counts as success. Flare deployment is confirmed only when flare ammunition decreases or a new airdrop appears.
- Rejected or lost fire inputs are retried after a fresh outdoor check.
- The commander opening deployment no longer expires permanently after an arbitrary short window.

## Building navigation

- Door selection is restricted to the current building/roof area instead of choosing a nearby door from an adjacent building.
- Exit direction is derived from the bot-to-door approach vector.
- Door crossing persists beyond the doorway before the route is released.
- A failed exit is temporarily blacklisted and another door is selected.
- When no door is visible, the bot scores 16 probe directions using short/long collision clearance and target alignment.
- Stuck recovery now applies during loot collection, resource breaking, and commander flare deployment.
- Resource reservations are released when a committed resource target causes a room deadlock.

## 50v50 roles

The existing V12 role framework is retained and the commander opening flare thresholds are adjusted so distant formation combat does not postpone deployment indefinitely:

- Commander: command direction, opening flare, airdrop defence.
- Lieutenant: close commander escort and side-front protection.
- Medic: rear support, injured-player priority, revive/heal assistance.
- Marksman: rear/side overwatch and priority-target engagement.
- Recon: forward/side scouting and mobile screening.
- Grenadier: assault support and safe enemy-cluster grenade use.
- Bugler: follows the command group and uses the bugle during pushes/airstrike escape.
- Lone survivor: abandons ordinary rescue priorities and switches to aggressive survival.

## Auto-fill cadence

All auto-filled rooms, including private/invite rooms, use one AI connection every 2000 ms. This follows the literal all-room requirement; a private duel slot can therefore be occupied by AI after the same delay.

- Solo target: 15 total contestants.
- Duo/squad target: 20 total contestants.
- 50v50: maximum 20 server AI per faction, 40 server AI total.
- 50v50 worker batching remains enabled, but each connection is still staggered by 2000 ms.

## Potato mode

- A bot whose gun slots are occupied by unusable/no-ammo utility weapons is treated as effectively unarmed.
- Ground guns and compatible ammunition receive much larger early-game urgency and search ranges.
- Potato resource targets receive a large score bonus when a usable gun slot can be rerolled.
- The bot attacks a potato with its weakest usable gun so the intended slot is replaced.
- It reloads, verifies range/line of fire, and uses the gun for the final destruction instead of defaulting to fists.

## Combat healing

- Healing is hard-blocked when an enemy is within 30 units, even at critical health.
- Indoors alone is not considered cover.
- Enemy pressure is evaluated out to 110 units, including line of sight, ballistic pressure, and recent damage.
- Active medicine is cancelled before lower-priority behaviours can keep the bot stationary.
- The bot then seeks real hard cover or retreats/evasively moves.

## Loot anti-tunnelling

- Loot movement uses a capped 0.1-second physics interval and up to 48 substeps.
- Every substep performs a continuous swept-circle test against expanded wall/obstacle colliders.
- On impact, loot is placed at the near collision face and inward velocity is removed.
- Initial spawn overlap resolution is followed by a radial collision-free position search.
- A thin-wall high-speed regression test is included.

## Modified source files

- `shared/net/updateMsg.ts`
- `client/src/objects/player.ts`
- `server/src/game/objects/player.ts`
- `server/src/smartBot.ts`
- `server/src/bot/healSafety.ts`
- `server/src/bot/specialRoleStrategy.ts`
- `server/src/game/objects/loot.ts`
- `server/src/specialRoleSmokeTest.ts`
- `server/src/lootSafetySmokeTest.ts`
- `server/src/botAutoFill.ts`
- `server/src/gameServer.ts`
- `server/src/factionAutoFillSmokeTest.ts`

## Installation

1. Stop the launcher, game server, web development server, and all related `node.exe` processes.
2. Extract the update-only archive into the project root containing `server`, `client`, and `shared`.
3. Overwrite matching files.
4. Restart the server and create a new room. Existing game processes do not reload source changes.
5. This version changes the active-player network packet. Vite development mode recompiles it after restart; deployments serving a static `client/dist` must run `npm run build` inside `client` on the target Windows machine.

## Limits

Automated tests cover the state machines, collision helpers, modes, and representative room/door conditions. They cannot enumerate every custom building, furniture arrangement, or dynamic player blockage. Failed-door blacklisting and multi-direction probing are intended to recover from untested layouts rather than claiming perfect global pathfinding.
