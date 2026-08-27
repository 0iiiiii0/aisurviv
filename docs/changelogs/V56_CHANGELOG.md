# V56 Automatic pure-AI capability match

- Add `GameServer.createAutoAiCapabilityMatch()`: creates a private
  `pureAiMatch` battle-royale room on any standard map (main/faction/potato/...)
  and spawns real smart-bot workers to play it automatically. Faction bots are
  split evenly across teams; bot count 2-60 with an optional difficulty cycle.
- Add `ai-capability` runner (`server/src/aiCapabilityTest.ts`): boots the
  single-thread dev server, runs the match to completion (or timeout), then
  aggregates the AI match recordings into a search / gas-escape / combat
  capability report written to `V56_AI_CAPABILITY_REPORT.json`.
- Report metrics:
  - Search: loot-state share, weapon-search abandonments, resource-target
    abandonments, bots that found a weapon, time to first weapon.
  - Gas: gas-state share, gas-danger frame share, gas escapes started/ended.
  - Combat: combat-state share, damage taken, visible-threat interrupts,
    gunfire wall blocks, kills, survivors.
  - Server: alive-count trajectory, observed duration, stopped flag.
- Add `test:ai-capability-match` smoke test covering solo batching, faction
  team split, difficulty cycling and validation.
