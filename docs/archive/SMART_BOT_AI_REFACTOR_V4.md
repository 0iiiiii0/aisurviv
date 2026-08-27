# Smart Bot AI Refactor V4

This revision restructures the ordinary-mode bot around the state and priority model described in `SURVIV_SMART_BOT_AI_LOGIC_SPEC.md`.

## Architecture

1. **Perception** remains client-side and uses only objects, local player state, gas data and packets visible to the bot.
2. **Intent arbitration** is handled by `server/src/bot/decisionBrain.ts`.
3. **Local navigation** and door/obstacle steering are handled by `server/src/bot/navigationController.ts`.
4. **Action execution** remains in `server/src/smartBot.ts`, but it now executes one selected intent per think cycle instead of relying on a growing mutually exclusive branch chain.

## Priority bands

The brain compares explicit candidates in these bands:

- Critical: airstrike and gas escape.
- Emergency: counterfire and post-revive extraction.
- Combat: direct combat, tactical shots and hidden-enemy flushing.
- Support: revive, healing, rescue cover and protected actions.
- Resource: urgent gun/ammo/gear search, ordinary loot and containers.
- Strategic: faction orders, formation, regrouping, ring positioning and exploration.

Higher bands interrupt lower bands. Target-specific commitments and switch margins keep the bot from changing state every think tick.

## Ordinary-mode behavior

- An unarmed bot searches loose guns first, then breakable loot containers.
- A nearby enemy can interrupt looting; distant enemies no longer make an unarmed bot abandon every weapon target.
- After obtaining a gun, matching ammunition and missing core equipment are prioritized.
- Loot targets, crate targets and strategic movement have state dwell times.
- Failed pickup targets are temporarily blacklisted and replanned instead of freezing the bot.
- Weapon replacement now requires a material loadout improvement and selects the intended replacement slot before pickup. This prevents two dropped rifles from replacing each other indefinitely.
- Closed usable doors are approached and opened. Solid blockers receive stable left/right local detours.
- Gas movement, exploration, regrouping, looting and crate approach share the same local steering layer.
- Mouse distance remains clamped to the protocol range, and team size is resolved from the selected playlist unless explicitly overridden.

## Added validation

- `npm run test:bot-brain`
- Existing input, loot, all-mode, spectator/auto-fill, duel, duel-vision, duel-lobby and admin smoke tests.
