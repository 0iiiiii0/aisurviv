# Surviv Bot Full Integrated Logic V11

This version incorporates the contents of `surviv-bot-full-integrated-logic(1).zip` into the V10 codebase.
The original specification files are preserved under `docs/surviv-bot-full-integrated-logic/`.

## Runtime integration

- Strict survival priority: lethal gas and airstrike escape remain hard branches before loot/combat scoring.
- Crate threat table B: melee attacker or armed bot causes counterattack; an unarmed bot flees an armed enemy; two unarmed players allow the crate action to continue.
- Ground guns immediately interrupt unarmed crate breaking.
- Unarmed target order uses the specification multipliers: ground gun 3, loot container 2.25, vault panel 2, non-emergency combat 0.15.
- Vault/control panels are detected from live button state and used instead of attacking thick doors.
- Flare gun is treated as an F-tier utility: pick only with ammo available, fire outside combat, and drop after ammunition is exhausted.
- The complete S+ through F weapon tier table is added to gun evaluation and replacement decisions.
- Human ammo requests from the ammo emote wheel are decoded and serviced by nearby same-team bots.
- Donors that do not use the requested caliber continue dropping until empty; donors that use it retain approximately one magazine.
- Human requests in 50v50 permit multiple donors and receive a team `coming` marker at the drop point.
- Bot-to-bot ammo needs use squad/faction blackboards and do not place the human-facing gift marker.
- Resource targets retain the existing same-layer, reachable, clear-line and destroyability checks, with a hard maximum of 16 estimated melee hits.
- Existing V10 door handling, healing-in-cover, 1v1 behavior, aim smoothing, resource sweep and 50v50 doctrine remain active.

## Compatibility note

This codebase has no dedicated `gift` ping definition. Human ammo gifts therefore use the existing team-only `ping_coming` marker at the actual drop position. No marker is emitted for bot-to-bot transfers.

## Validation

Run from `server/`:

```bash
npm run build
npm run test:integrated-spec
```

The integrated smoke test checks the arbiter order, unarmed multipliers, weapon tiers, ammo request mapping and reserve behavior, crate threat matrix, vault panel recognition, flare decisions, and faction ammo blackboard reservation rules.
