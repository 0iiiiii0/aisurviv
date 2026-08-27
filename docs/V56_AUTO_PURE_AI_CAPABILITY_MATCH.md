# V56 Automatic pure-AI capability match

## Purpose

A one-command runner that stages a full battle-royale match played only by
smart-bot workers, then measures how well the AI performs the three core
capabilities:

1. **搜索 (search/loot)** — weapon search, loot/crate acquisition, abandonment.
2. **跑毒 (gas escape)** — recognizing gas danger, escaping the circle.
3. **战斗 (combat)** — engaging enemies, dealing damage, getting kills.

## How to run

```powershell
cd server
npm run ai-capability                      # main/solo, 10 bots, 10 min cap
$env:AI_TEST_MAP="faction"; $env:AI_TEST_BOTS="20"; npm run ai-capability
$env:AI_TEST_DIFFICULTIES="hard,pro"; npm run ai-capability
```

Report: `V56_AI_CAPABILITY_REPORT.json` (project root).

## Implementation

- `server/src/gameServer.ts` — `createAutoAiCapabilityMatch(request)`:
  - Validates a standard BR map/team and 2-60 bots.
  - Creates a private `pureAiMatch` room.
  - Spawns bots in 8-bot smart-bot worker batches (faction bots alternate
    teams), waiting for every bot to connect.
- `server/src/aiCapabilityTest.ts` — boots the single-thread dev server,
  creates the match, polls alive counts until the room stops (match over) or
  the timeout, then aggregates the AI match recordings for that game id.
- Metrics are read from the recorder events/frames:
  - events: `weapon_search_abandoned`, `resource_target_abandoned`,
    `gas_escape_started/ended`, `damage_taken`, `visible_threat_interrupt`,
    `gunfire_wall_blocked`, `final_visible_trigger_restored`, `game_over`.
  - frames: state distribution (loot/break-crate/gas/combat/counterfire/
    retreat), gas danger flags, first weapon acquisition.

## Sample result (main/solo, 6 bots, 300 s)

- Search: loot-state share 0.67, 6/6 bots armed, first weapon ~4.8 s.
- Gas: gas-state share 0.21, escapes started 7 vs ended 1 (escape rarely
  resolves cleanly).
- Combat: combat-state share 0.01, 300 total damage taken, 0 bot kills — the
  match stalled with 3 bots alive and non-aggressive.
