# V54 Matchmaking Quality

- Prefer rooms that already contain humans, then rooms with more contestants
  (bot fill progress), then the oldest room, instead of always selecting the
  oldest empty room in `findGame()`.
- Accelerate bot auto-fill while a room's first human is still waiting: bots
  connect at up to ~800 ms apart for the first 15 seconds, then the configured
  cadence (usually 2 s) resumes.
- Return a best-effort `fill` snapshot (`humanPlayers`, `botPlayers`,
  `totalPlayers`, `targetPlayers`, `reservedPlayers`) from
  `/api/find_game` for lobby feedback.
- Record a `match_ended` event (duration, bot count, frames written, per-bot
  results) once every registered bot in a recorder session finishes.
- Rotate recording quota by deleting interrupted `.part` sessions first,
  preserving complete matches for replay analysis.
- Recording format version bumped to 13.
