# V59 Savannah kill-streak buff no longer wipes loot perks

- Port the upstream perk-preservation fix into `server/src/game/objects/player.ts`.
- Root cause: `handleFactionModeRoles()` removed EVERY existing perk before
  granting a role's perks, so the Savannah kill-streak buff (the_hunted, after
  3 kills) deleted loot perks such as split bullets (分裂子弹).
- Fix:
  - Track `isFromRole` on perks (`addPerk(..., isFromRole)`).
  - Role promotion only removes role-origin perks that are not re-granted;
    loot perks are preserved. Perk-heavy roles (4+) still drop droppable loot
    perks first, matching upstream.
  - Add `removeRole()` that clears the role and only its role-origin perks;
    used when the kill leader is replaced or dies.
  - Guard `removePerk()` against a missing type (was splicing the last perk).
