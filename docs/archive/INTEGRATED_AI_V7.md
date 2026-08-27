# Integrated AI V7

## 50v50 population policy

- Public 50v50 rooms launch at most **one server bot per second**.
- The planner assigns each new bot to the faction with fewer connected plus pending bots.
- Each faction is capped at **20 server bots**, for a total server-bot ceiling of **40**.
- Pending WebSocket joins count toward the cap and real-player reservations still reduce available room slots.
- Manual AI addition uses the same 20+20 faction cap.

## 1v1 combat execution

- A precision weapon may stop movement only when the opponent is inside the weapon's actual range and a clear firing lane exists.
- In duel mode, once reaction time, ammunition, range, and line-of-sight checks pass, the trigger is deterministic rather than depending on repeated random rolls.
- If a shot is unavailable, the bot advances into range or sidesteps to recover a firing lane instead of remaining in an aim-only state.
- Leading a moving target now falls back to the target's current position when the predicted lead point is obstructed.
- A nearby enemy holding a melee weapon is promoted to an emergency combat interrupt.

## Safe combat healing

- Medicine is prohibited while an enemy has direct line-of-sight, at point-blank range, in lethal gas, or in an airstrike zone.
- Under combat pressure, the bot first searches for hard cover or an intact indoor position.
- Cover candidates are placed on the side of a solid obstacle opposite the threat and must break enemy line-of-sight, remain inside the safe zone, and be navigable.
- Healing begins only after cover is reached and a short no-damage window has elapsed.
- An active heal is cancelled when line-of-sight reopens, the enemy closes to point-blank range, gas becomes lethal, or an airstrike begins.
- Critical health increases the urgency to retreat to cover; it does not permit healing directly in front of an enemy.

## Integrated decision-order changes

- Lethal gas is a hard branch and is resolved before medicine holds, special actions, looting, crate breaking, or normal combat scoring.
- Airstrike evasion is the next hard survival branch.
- Immediate melee pressure interrupts lower-priority actions.
- Existing V6 resource search, no-wall-break crate checks, doors, flare handling, unarmed weapon search, faction doctrine, spectator repair, and ordinary-mode auto-fill remain included.
