# V53 Matchmaking Recovery

- Prevent stopped room processes with stale `canJoin`/slot data from being selected by matchmaking.
- Create replacement rooms through the existing timeout-aware child-process creation path.
- Add structured JSON responses and logs for game creation/region forwarding failures.
- Add an 8-second timeout to API-to-region `/api/find_game` forwarding.
- Resolve real client IPs behind a loopback Nginx proxy without trusting spoofed public headers.
- Return `Retry-After` for matchmaking rate limits and make the client back off before retrying.
- Increase client matchmaking attempts from two to four for transient room rollover failures.
