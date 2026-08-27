# V48 Comprehensive Fix Changelog

## Broken Arrow and airstrike behavior

- Removed automatic Broken Arrow perk assignment based on carrying multiple strobes.
- Restored the actual perk effect: an ordinary strobe produces three passes; the real perk adds two passes.
- Removed historical accelerated throw-animation behavior.
- Enforced the server's 100 ms throwable cook floor and the normal 300 ms throw cooldown.
- Replaced inventory-triggered opening bombardment with a bounded response to observed hostile strobe/airstrike pressure.
- Added tactical single-strobe use against healing or protected enemies.
- Retained and validated edge-safe airstrike path generation and multi-zone evacuation.

## 1v1 knowledge and high-level AI

- Every 1v1 difficulty receives the mirrored human starting position before visual contact.
- Round resets restore that initial-position knowledge.
- Subsequent real-time tracking still follows each difficulty's perception model.
- LEGIT/HACKER precision, prediction, ricochet, cover pressure and feasible-dodge policies remain enabled.

## Throwable tactics

- Added a shared tactical selector for smoke, strobe, MIRV and frag grenades.
- Smoke protects critically exposed, healing or reloading bots.
- Strobes dislodge mid/long-range protected enemies.
- MIRV grenades apply wider area denial at longer protected ranges.
- Frag grenades pressure nearer protected targets.
- Throwing is cancelled while outside gas, under immediate airstrike danger or during immediate incoming damage.
- Grenade trajectory, collision, fuse and self-damage validation remain required after tactical selection.

## Resource geometry and harvesting

- Resource selection, approach, path checking, melee aim and progress tracking now share transformed real collision geometry.
- Circle and AABB colliders account for local offset, world position, cardinal rotation and runtime scale.
- AI uses nearest collider surface/attack points instead of object-center distance.
- Expanded strategic resource recognition beyond non-empty direct loot arrays to `destroyType`, `smartLoot`, airdrop, regrow, loot-spawn and weapon-swap resources.
- Replaced very low fixed hit limits with threat/value-aware limits and a higher safety ceiling.
- Added stronger immediate-value priority for nearby/in-reach resources.
- No-progress abandonment now requires confirmed in-range, clear-path misses.
- Ranged destruction considers actual piercing capability and explosive safety.
- Added a complete resource collider audit and smoke test.

## Flare gun stability

- Added a pickup grace period for newly acquired empty flare guns.
- Nearby flare ammunition prevents premature dropping.
- Genuine empty guns are eventually dropped with a retry cooldown.
- This prevents repeated pickup/drop loops when a crate contains a flare gun and flare ammo.

## Cover and line-of-fire

- Replaced obstacle center-radius approximations with transformed Circle/AABB segment intersections.
- AI no longer treats rectangular, offset or rotated hard cover as a clear shot merely because the center-radius approximation misses it.
- Existing hard-cover, ricochet and explosive-cover policies remain separated.

## Ghillie configuration

- Added environment-specific dynamic ghillie tints:
  - Desert: `0xdfa761`
  - Snow: `0xbbbbbb`
  - Woods Snow: `0xbbbbbb`
  - Woods Spring: `0x41630a`
- Validated that map loot tables use the defined dynamic `outfitGhillie` item rather than undefined map-specific outfit names.

## Match recording quota

- Added a hard total recording-root limit of 1 GiB (`1,073,741,824` bytes).
- Deletes oldest inactive session directories first.
- Never deletes the current active session.
- Stops and marks the current match as truncated if inactive-session cleanup cannot create enough space.
- Uses `.part` files while writing and atomically renames completed parts.
- Recording failures do not terminate the game server.
- Added quota, rotation, truncation and finalization tests.
