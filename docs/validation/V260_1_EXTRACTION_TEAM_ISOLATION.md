# V260.1 Extraction Human / Server-Bot Team Isolation

## Reported regression

In secret extraction, a real player selecting **Squad (4-player) + auto-fill teammates** could enter the match already grouped with a server AI.

## Root cause

`PlayerBarn.findFreeGroup()` treated every `Group.autoFill === true` group as a valid auto-fill destination. It did not distinguish whether the existing group contained real players or `serverBot` players.

This is especially reproducible in secret extraction because Boss guards are created with `serverBot=true` and an `autoFill=true` join token. In Squad mode a solo human team-menu token also has `autoFill=true` and requests only one seat, so the old selector could choose a half-empty BossGuard group.

V258 protected the remaining seats of a multi-player shared team token, but a single queued human (`playerCount=1`) had no party-seat reservation to protect and could still be merged with an AI group.

## Fix

For every extraction map (`gameMode.extractionMode`):

- a real player may auto-fill only into a group whose existing players are all real players;
- a `serverBot` may auto-fill only into a group whose existing players are all server bots;
- human-to-human auto-fill remains enabled;
- bot-to-bot grouping remains enabled;
- non-extraction modes retain their previous grouping rules.

The rule is enforced in the authoritative group selector, so it covers BossGuard, smartBot and future server-bot sources rather than special-casing one AI type.

## Regression coverage

New test: `server/src/extractionHumanBotTeamIsolationSmokeTest.ts`

Validated scenarios:

1. Two existing server-bot groups + one real Squad auto-fill player -> human gets a human-only group.
2. A second independently matched real player -> joins the first human's group.
3. A later server bot -> cannot consume a free seat in the human group.
4. Secret extraction with Boss/BossGuard population -> human group selection cannot choose an AI group.
5. Existing V258 `extractionTeamAutoFillSmokeTest` still passes.
6. Real duo team entry for normal and secret extraction still passes.
7. TypeScript strict typecheck passes.

## Test safety hardening

During validation, `extractionTeamEnterSmokeTest.ts` revealed the same destructive default-data-dir pattern previously fixed in another smoke test: when `SURVIV_DATA_DIR` was omitted it used `.` and recursively deleted its contents.

V260.1 adds `prepareEmptySmokeTestDataDir()` and applies it to the remaining destructive smoke tests discovered with this pattern. They now require an explicit temporary `SURVIV_DATA_DIR` outside the project/current-working-directory tree and refuse unsafe paths.
