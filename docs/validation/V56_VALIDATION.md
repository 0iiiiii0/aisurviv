# V56 Validation

## Builds

- Server TypeScript production build: PASS
- `test:ai-capability-match` smoke test: PASS

## Live run (automatic pure-AI match, main/solo, 6 bots)

- Match created through `createAutoAiCapabilityMatch` and all 6 bots joined: PASS
- Match ran until the 300 s timeout with real smart-bot workers: PASS
- Recordings aggregated (6/6 bots recorded): PASS
- Report written to `V56_AI_CAPABILITY_REPORT.json`: PASS
- Metrics produced:
  - Search: loot-state share 0.67, 6/6 bots found weapons, first weapon ~4.8 s
  - Gas: gas-state share 0.21, gas escapes 7 started / 1 ended
  - Combat: combat-state share 0.01, 78 damage events / 300 total damage,
    3 deaths but 0 bot-vs-bot kills, final 3 bots stalled until timeout

## Notes

- The 6-bot main/solo run exposed exactly the capabilities this test is for:
  strong looting/search, weak gas-escape resolution, and very low combat
  engagement (bots rarely fight). Longer faction runs give more combat data.
- Environment knobs: `AI_TEST_MAP`, `AI_TEST_TEAM`, `AI_TEST_BOTS`,
  `AI_TEST_TIMEOUT_MS`, `AI_TEST_DIFFICULTIES`.
