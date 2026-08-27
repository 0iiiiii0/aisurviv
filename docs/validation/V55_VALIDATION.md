# V55 Validation

## Reproduction

Ran the game locally (single-thread dev server + Vite client) with 50v50
enabled and bot auto-fill. Before the fix the browser console flooded with:

    PlayerIds and playerStatus.players out of sync. OurLen: 30 MsgLen: 28
    IDs=[3857,3857,3857,...] (local player duplicated by the initial snapshots)

## Fix verification (live match, faction map)

- `playerIds.length == playerInfo count` (16 == 16, no duplicates): PASS
- `updatePlayerStatus()` no longer early-returns; console sync errors: 0
- Teammate minimap dots: 8/8 same-faction teammates `minimapVisible=true`,
  `minimapAlpha=1`, live positions flowing every status update: PASS

## Builds

- Client TypeScript no-emit check: PASS

## Files changed

- `client/src/objects/player.ts` only (PlayerBarn.setPlayerInfo /
  deletePlayerInfo idempotency).
