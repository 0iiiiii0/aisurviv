# V53 Matchmaking failure root cause

## Symptom

After the server has run for a period of time and at least one public room has ended, clients can receive `Failed finding game` even though the API and game-server processes remain alive and show no fatal error.

## Root cause

`GameProcessManager.findGame()` selected room-process records using `canJoin`, available slots, map, and team mode, but did not reject `stopped` records. A room's final status update could leave stale `canJoin=true` and positive slot data while also setting `stopped=true`.

The old code then entered this branch:

```ts
if (game.stopped) {
    return new Promise((resolve) => {
        game.onCreatedCbs.push(...);
    });
}
```

No new `Create` message was sent for that selected record, so no future `Created` event existed. The promise remained pending indefinitely. The browser timed out twice and displayed the generic matchmaking failure. A pending promise is not an exception, so the server logged no error.

## Secondary silent-failure paths

- API-to-region forwarding had no timeout.
- `/api/find_game` exception handlers logged but did not always complete the HTTP response.
- Standard Nginx forwarding headers were ignored by the IP limiter, so proxied clients could share the loopback address and rate-limit bucket.
- Rate-limit responses had no `Retry-After` guidance.

## Fix

- Matchmaking excludes stopped, terminal, disconnected, and heartbeat-stale room processes.
- New/reused rooms are created through `createGame()`, which waits for `Created` with a 15-second timeout and child-exit handling.
- A final availability guard rejects an unusable selected process before issuing a token.
- Region forwarding times out after 8 seconds.
- API and game-server handlers always return structured JSON on failure.
- The find-game limiter safely reads `X-Forwarded-For`/`X-Real-IP` only from a loopback reverse proxy.
- The client respects a 429 retry window and performs bounded transient retries.
