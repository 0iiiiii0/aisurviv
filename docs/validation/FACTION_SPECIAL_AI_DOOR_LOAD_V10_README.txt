V10 changes

1. Fixes repeated door open/close shaking with directional door selection and a per-door interaction cooldown.
2. Makes indoor idle/stuck bots find a usable door and walk through it instead of wandering inside rooms.
3. Prevents special-role positioning from starving a locked resource/container action.
4. Adds dedicated 50v50 positioning for leader, lieutenant, medic, marksman, recon, grenadier, bugler and last-man roles.
5. Makes a newly assigned leader safely fire the opening flare and defend the called airdrop.
6. Keeps 50v50 at 1 AI/second and 20+20 AI, while batching five delayed joins per Node.js worker to reduce process and memory load.

Install: stop all related node.exe processes, extract this package into the project root, overwrite files, restart the server, and create a new room.
