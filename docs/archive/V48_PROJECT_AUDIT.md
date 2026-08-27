# V48 Project Logic Audit

## High-risk areas reviewed

- Empty-array reduction and airstrike edge intersections
- Throwable equip/release state transitions
- Multiple overlapping airstrike warnings
- Resource target lock and no-progress loops
- Circle/AABB collision transformation
- Flare gun/ammunition inventory oscillation
- Hard-cover line-of-fire checks
- Map loot-definition validity and ghillie tint inheritance
- Recorder file growth and inactive-session rotation

## Findings addressed

1. Multiple strobes incorrectly auto-granted Broken Arrow in 1v1.
2. Historical 55 ms release and 42 ms repeat timings were below authoritative game timing.
3. Resource selection used object centers while approach and attack used inconsistent approximations.
4. AABB resources used a radius approximation that failed for long, offset or rotated colliders.
5. Strategic resources without direct `loot.length` were excluded.
6. Low fixed hit-count thresholds rejected many valid resources.
7. Confirmed misses could be counted while the bot was not at a real attack surface.
8. Flare guns could oscillate between drop and pickup before nearby flare ammo was considered.
9. Rectangular hard cover could be missed by center-radius line tests.
10. Several environment maps inherited an unsuitable green ghillie tint.
11. Match recordings had no total root-directory quota.

## Existing items intentionally not changed

- General map-generation TODO comments whose behavior is unrelated to AI resource use.
- The maintained collision library's legacy interior-corner comment; changing global projectile collision was outside this patch and would carry broad gameplay risk.
- Stress-test infinite loops that are intentionally bounded by the stress-test process lifecycle.
- Existing public game rules unrelated to the requested AI, map tint or recording changes.

## Remaining operational validation

A real-client soak test is still recommended for:

- Long 1v1 sessions with repeated hostile strobe spam.
- Dense buildings containing rotated AABB resources.
- 40-AI faction matches over several hours.
- Recorder rotation with real multi-gigabyte historical sessions.
- Client production bundling after installing platform-correct dependencies on the target Windows machine.
