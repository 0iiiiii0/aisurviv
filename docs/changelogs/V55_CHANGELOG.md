# V55 50v50 teammate visibility fix

- Fix invisible teammates on the faction (50v50) minimap.
- Root cause: the server sends a full player-info snapshot for the first few
  syncs (initialFullSyncsRemaining), but the client appended every player id to
  playerIds unconditionally. The duplicated ids made
  updatePlayerStatus() early-return on its strict length check, so no player
  status (positions/visibility) was ever applied and every teammate dot stayed
  hidden.
- Fix: setPlayerInfo() now keeps playerIds unique, and deletePlayerInfo()
  removes every occurrence of an id.
