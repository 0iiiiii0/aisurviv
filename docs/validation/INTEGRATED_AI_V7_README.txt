Integrated AI V7 update-only package
====================================

Base version: Resource Search AI V6

Install:
1. Stop the server and every related node.exe process.
2. Extract this archive into the project root that contains server, client, and shared.
3. Replace all matching files.
4. Start the server again and create a new room.

Main changes:
- 50v50: one AI per second, 20 AI per faction, 40 AI total.
- 1v1: deterministic trigger after reaction/range/LoS/ammo checks; no aim-only deadlock.
- Combat healing: retreat to hard cover or a safe indoor position before using medicine.
- Lethal gas and airstrike are hard survival branches; close melee pressure interrupts lower priorities.

Run focused validation from the server directory:
  npm run build
  npm run test:faction-autofill
  npm run test:bot-combat-heal
