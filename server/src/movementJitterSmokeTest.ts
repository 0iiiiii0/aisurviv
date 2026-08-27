import assert from "assert/strict";
import { movementInputFromDirection, stabilizeMovementDirection } from "./bot/movementInput.ts";

// 1) Micro-jitter deadband: a small desired-direction wobble must not reach
// the keyboard flags at all.
{
    const committed = { x: 1, y: 0 };
    const result = stabilizeMovementDirection(
        { x: Math.cos(0.1), y: Math.sin(0.1) },
        committed,
        { timestamp: 1000, lockUntil: 1400, holdMs: 400, allowImmediate: false },
    );
    const flagsBefore = movementInputFromDirection(committed);
    const flagsAfter = movementInputFromDirection(result.direction);
    assert.deepEqual(flagsAfter, flagsBefore, "micro-wobble must never toggle the keyboard flags");
}

// 2) A full flip inside the hold window rotates smoothly instead of snapping.
{
    const committed = { x: 1, y: 0 };
    const result = stabilizeMovementDirection(
        { x: -1, y: 0 },
        committed,
        {
            timestamp: 1000,
            lockUntil: 1400,
            holdMs: 400,
            allowImmediate: false,
            turnRateRadiansPerSecond: 3.2,
        },
    );
    assert.ok(result.direction.x > 0, "a 180-degree flip must not snap within the lock window");
    assert.ok(Math.abs(result.direction.y) > 0, "the direction must rotate toward the target");
}

// 3) A sustained flip (real 30 ms ticks) completes within a bounded time.
{
    let committed = { x: 1, y: 0 };
    let t = 1000;
    let lockUntil = 0;
    let reached = false;
    for (let i = 0; i < 40; i++) {
        const stable = stabilizeMovementDirection(
            { x: -1, y: 0 },
            committed,
            { timestamp: t, lockUntil, holdMs: 400, allowImmediate: false, turnRateRadiansPerSecond: 6, elapsedMs: 30 },
        );
        committed = stable.direction;
        lockUntil = stable.lockUntil;
        if (committed.x < -0.99) { reached = true; break; }
        t += 30;
    }
    assert.ok(reached, "the bot must complete the turn once the target stays flipped");
}

// 4) When the lock expires while still facing away, the turn continues smoothly
// (a fresh hold starts) instead of snapping to the opposite direction.
{
    const result = stabilizeMovementDirection(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        {
            timestamp: 1500,
            lockUntil: 1400,
            holdMs: 400,
            allowImmediate: false,
            turnRateRadiansPerSecond: 3.2,
            elapsedMs: 33,
        },
    );
    assert.ok(result.direction.x > 0, "lock expiry must not snap the direction");
    assert.equal(result.lockUntil, 1900, "a fresh hold must start at expiry");
}

// 5) Emergency movement (gas/airstrike/retreat) bypasses the smoothing.
{
    const result = stabilizeMovementDirection(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { timestamp: 1000, lockUntil: 1400, holdMs: 400, allowImmediate: true },
    );
    assert.ok(result.direction.x < 0, "emergency movement must bypass smoothing");
}

// 5b) A newly entered state has no valid old commitment. The caller marks it
// immediate so a duel spawn that needs to travel left never walks right first.
{
    const result = stabilizeMovementDirection(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { timestamp: 1000, lockUntil: 0, holdMs: 400, allowImmediate: true },
    );
    assert.ok(result.direction.x < 0, "a fresh state must adopt its first objective immediately");
}

// 6) An oscillating target cannot shake the bot: after alternating left/right
// requests every 100 ms (real ticks), the direction never completes the flip
// and only wobbles a little around the committed heading.
{
    // The bot is already committed to +x with an active lock.
    let committed = { x: 1, y: 0 };
    let t = 1000;
    let lockUntil = 1400;
    let maxAngle = 0;
    let reachedFlip = false;
    for (let i = 0; i < 30; i++) {
        const desired = Math.floor(t / 100) % 2 === 0 ? { x: -1, y: 0 } : { x: 1, y: 0 };
        const stable = stabilizeMovementDirection(
            desired,
            committed,
            { timestamp: t, lockUntil, holdMs: 400, allowImmediate: false, turnRateRadiansPerSecond: 3.2 },
        );
        committed = stable.direction;
        lockUntil = stable.lockUntil;
        const angle = Math.acos(Math.max(-1, Math.min(1, committed.x)));
        maxAngle = Math.max(maxAngle, angle);
        if (committed.x < -0.5) reachedFlip = true;
        t += 30;
    }
    assert.ok(!reachedFlip, "an oscillating target must never drag the bot into a full flip");
    assert.ok(maxAngle < 0.9, `oscillation amplitude must stay bounded, got ${maxAngle.toFixed(2)} rad`);
}

console.log("Movement jitter smoothing smoke test passed: micro-wobble is held, flips rotate smoothly, oscillation is bounded.");
