# 50v50 AI Auto-fill V5

This update is based on the Smart Bot AI Refactor V4 project.

## Rules

- 50v50 auto-fill starts at a maximum rate of **2 bots per second**.
- The server aims for **30 server bots in faction 1 and 30 server bots in faction 2**.
- Human players do not consume the 30-per-faction AI quota.
- The normal 100-player room capacity is still enforced.
- Pending bot connections and human join reservations are counted before a new bot batch is launched.
- When both factions are below the cap, the normal batch is one bot for each faction.
- When one faction reaches 30 bots first, all remaining automatic bot slots are assigned to the other faction.
- Automatic and administrator-added 50v50 bots use explicit faction assignments, so a shared join token cannot pull both bots into the same faction.

## Unchanged modes

- Solo: 1 bot per second, total room target 15.
- Duo: 1 bot per second, total room target 20.
- Squad: 1 bot per second, total room target 20.
- Private rooms remain excluded from public auto-fill.

## Validation

The following checks passed after the change:

- Server TypeScript build.
- 50v50 auto-fill policy and hard-cap smoke test.
- Forced faction assignment test using a two-use bot token.
- Pending bot reservation and human slot reservation tests.
- Spectator/auto-fill regression test.
- Smart bot decision-brain and loot-strategy tests.
- All-mode AI test: 47 playlists and 17 maps.
- Duel lobby and administrator API tests.
