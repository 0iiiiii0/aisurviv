# Role, Navigation, Potato and Loot Safety V12

This revision is based on the V11 integrated bot logic.

## Main changes

- Every public auto-filled room now admits one AI every two seconds.
- 50v50 remains capped at 20 server bots per faction (40 total), with five sequential bot connections per worker process to reduce process overhead.
- Commander flare deployment now checks the authoritative indoor flag, routes through a usable door, waits for several outdoor updates, and only then fires. Rejected indoor or underground attempts do not consume the opening deployment.
- Building navigation proactively routes strategic targets through doors, applies a longer single-interaction cooldown, keeps a fixed pass-through direction, and temporarily blacklists doors that make no progress.
- 50v50 role cooperation was aligned with the mode mechanics: Lieutenant escorts command, Marksman remains in overwatch and prioritizes roles, Recon screens the front/flank, Grenadier supports from behind, Medic stays behind cover/rescues, Bugler can accelerate allies escaping an airstrike, and Lone Survivr switches to independent counterattack.
- Potato mode strongly prioritizes initial guns. Armed bots target potato obstacles and use their weakest usable gun for the finishing damage so the firearm slot is rerolled instead of the melee slot.
- Combat medicine now requires actual hard cover when an enemy is nearby. Being indoors alone is not considered safe; enemies within 18 units, direct line of sight, recent damage, or ballistic pressure cancel medicine.
- Loot spawning resolves initial wall overlaps before registration. Moving loot uses clamped time and collision substeps so server hitches cannot throw crate drops through thin walls.

## Installation

Stop the launcher and all related Node.js processes, extract the update package over the project root, restart the server, and create a new room.
