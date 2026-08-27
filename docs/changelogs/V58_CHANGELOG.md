# V58 Unified AI join interval + configurable 50v50 fill cap

- Admin "人机自动补入" now uses ONE backend-wide AI join interval for every
  mode (including 50v50); per-playlist interval fields and the "apply to all"
  button are removed. Saving clears legacy `modeOverrides`.
- `getBotAutoFillPolicy()` always uses `botAutoFill.defaultJoinIntervalMs`.
- Add `botAutoFill.factionTargetPlayerCount`: an independent 50v50 fill cap
  (humans + AI, split evenly across factions), changeable from the admin page
  and persisted to `survivio-config.json`. Falls back to the ordinary target
  when unset.
- `/admin-api/bot-autofill` now accepts `factionTargetPlayerCount` and no
  longer requires the per-mode `modes` array.
