# 50v50 Medic Logic Comparison

## Versions compared

- Embedded V21 Alpha 1.7 source
- V48 comprehensive fix
- V49 replay/faction/ammo/admin
- V50 unified room target/admin
- V51 medic revive fix
- Current maintained `survev/survev` revive design, used as a behavioral reference

## Summary table

| Logic | V21 Alpha 1.7 | V48 | V49 | V50 | V51 |
|---|---|---|---|---|---|
| AI medic sends self-revive input | No | No | No | No | Yes |
| Downed AI behavior | Crawl toward gas safety/teammates | Improved gas escape, still no self-revive | Same as V48 | Same as V49 | Self-revive plus gas-safe crawling |
| Self target selection | Depends on self appearing in nearby-player grid results | Same | Same | Same | Explicitly returns self |
| Duplicate external reviver guard | No | Yes (`activeReviverFor`) | Yes | Yes | Yes |
| Explicit reviver ownership | No | No | No | No | Yes (`revivedBy`) |
| Direct revive separated from target medic AOE | Not guaranteed | Not guaranteed | Not guaranteed | Not guaranteed | Enforced by action ownership |
| Legitimate medic self-revive AOE | Possible but state-dependent | Same | Same | Same | Preserved and explicit |
| Medic reviving teammates with AOE | Yes | Yes | Yes | Yes | Preserved |
| Cancellation clears both participants | Partial, one-directional | Partial, one-directional | Same | Same | Bidirectional |
| Death clears stale revive link | Not guaranteed | Not guaranteed | Not guaranteed | Not guaranteed | Yes |

## Detailed differences

### 1. AI downed behavior

V21 through V50 used the same basic downed branch:

1. stop firing;
2. crawl out of gas when necessary;
3. otherwise crawl toward the nearest living squad member.

The branch never emitted `GameConfig.Input.Revive`, so an AI medic could possess the `self_revive` perk indefinitely without using it.

V51 adds a three-state decision:

- `start`: downed 50v50 medic, no action active — send Revive;
- `hold`: a revive action is already active — do not spam another input;
- `none`: non-medic, non-faction, alive, or busy with another action.

The bot can continue gas-escape movement while the revive action progresses.

### 2. Self-revive target selection

V21–V50 searched nearby downed teammates and relied on the spatial query returning the downed player itself. This was order-dependent and indirect.

V51 returns the player itself immediately when downed and carrying `self_revive`. A downed player cannot select another downed teammate.

### 3. Revive ownership

V21–V50 tracked only `playerBeingRevived` on the reviver. The target did not record who owned the action. This made simultaneous timers and stale self-revive pointers ambiguous.

V51 adds:

```ts
playerToRevive.revivedBy = this;
```

A revive effect is authoritative only when the target's `revivedBy` points back to the actor.

### 4. Incorrect area rescue when another player revives a medic

The medic role has both `aoe_heal` and `self_revive`. In the old state model, the target medic could retain or complete a revive state without a reliable distinction between:

- medic self-revive;
- medic reviving a teammate;
- another player reviving the medic.

V51 requires ownership before any revive callback runs. Therefore:

- non-medic A revives medic B: only B is revived;
- medic A revives player B: A's range revive is valid;
- medic A self-revives: A's range revive is valid;
- medic B is being revived by A but has a stale self pointer: B does not execute area revive.

### 5. Cancellation and death

V21–V50 cancellation primarily followed `playerBeingRevived` from actor to target. The target had no matching owner pointer.

V51 clears both directions and calls `cancelAction()` before a player is killed. This prevents a dead target or dead reviver from leaving the other participant locked in Revive.

### 6. Changes that were not responsible

- V49 changed faction visibility, resource search, and ammo-request handling, but did not change the core player revive file.
- V50 changed room population and admin settings, but did not change player or AI medic revive logic.
- The V48, V49, and V50 `server/src/game/objects/player.ts` files are byte-identical in the reviewed source packages.

## Retained behavior

V51 does not remove the medic role's intended capabilities:

- area healing;
- area boost application;
- area revive when the medic owns the revive action;
- self-revive;
- medic rescue priority;
- smoke-covered rescue;
- gas escape while downed.
