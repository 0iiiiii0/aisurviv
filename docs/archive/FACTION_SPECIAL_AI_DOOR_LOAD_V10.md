# Faction Special AI / Door / Load V10

## Door control

- A bot now interacts only with a closed usable door that lies in front of its current movement route.
- Each door has a 950 ms interaction cooldown, preventing multiple stale `Interact` inputs from reopening and immediately closing the same door.
- Random unstuck movement no longer spams `Interact` every AI tick.
- When a bot is stuck or idle inside a building, it selects a nearby usable door, keeps a stable direction through it, opens it once, and walks beyond the doorway.

## Resource commitment

- A reserved loot/container action outranks low-priority special-role positioning.
- Special roles no longer repeatedly interrupt a captain/leader that has already committed to breaking a resource object.
- The leader's one-time opening flare deployment is the only deliberate exception.

## 50v50 special roles

- Leader: deploys the starting flare shortly after receiving the role when the area is safe, then holds a rear command position and defends the airdrop.
- Lieutenant: escorts the leader and occupies a forward command position.
- Medic: stays behind the line, follows injured allies, prioritizes rescue and smoke cover.
- Marksman: moves to rear/flank overwatch positions and maintains longer engagement ranges.
- Recon: screens ahead of the formation and uses short-range/mobile weapons.
- Grenadier: occupies assault-support positions and uses explosives against safe enemy clusters.
- Bugler: remains near command/allied groups and uses the bugle during suitable attack or emergency windows.
- Last man: abandons rescue duties and performs an aggressive counterattack.

## AI process load

- 50v50 still enters at one AI per second and remains capped at 20+20 AI.
- Five future AI joins are reserved in one smart-bot worker process and connected sequentially at 1000 ms intervals.
- A full 40-AI faction room therefore uses about eight bot worker processes instead of forty.
- Opposing factions inside the same worker receive separate coordinators, preventing cross-faction squad sharing.
- Pending reservations expire after the delayed join window, so one failed connection cannot permanently stop auto-fill.
