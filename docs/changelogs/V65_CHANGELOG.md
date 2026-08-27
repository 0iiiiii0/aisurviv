# V65 50v50 all-downed team now loses immediately

- Fixed: in 50v50 (faction) and duo/squad, when a team's last survivors are
  all downed, the game kept running until a slow bleed-out (~40s) or a
  self-revive, so the winning side was not decided promptly.
- Root cause: `Team.checkAllDowned()` discarded downed `self_revive` members
  from the check, so a team whose only other member was a downed self-revive
  player was never considered "all downed".
- Fix:
  - `Team.checkAllDowned()` now matches `Group.checkAllDowned()`: the team is
    all downed when every other living member is downed/dead/disconnected,
    regardless of `self_revive`.
  - The duo/squad induction branch in `GameModeManager.handlePlayerDeath()`
    no longer skips elimination when a `self_revive` perk is present.
- Result: a fully-knocked team is eliminated immediately and the game ends.
