import assert from "assert/strict";
import {
    adaptiveBotJoinDelay,
    cpuThrottleScale,
    normalizeCpuLimits,
} from "./utils/systemCpu.ts";

function main(): void {
    assert.deepEqual(normalizeCpuLimits(70, 80), { softLimit: 70, hardLimit: 80 });
    assert.equal(cpuThrottleScale(55, 70, 80), 1);
    assert(cpuThrottleScale(74, 70, 80) > 1, "soft pressure must slow bot thinking");
    assert(
        cpuThrottleScale(83, 70, 80) > cpuThrottleScale(76, 70, 80),
        "hard pressure must throttle more aggressively",
    );

    const normal = adaptiveBotJoinDelay(2000, 55, 70, 80);
    assert.equal(normal.pause, false);
    assert.equal(normal.delayMs, 2000);

    const soft = adaptiveBotJoinDelay(2000, 75, 70, 80);
    assert.equal(soft.pause, false);
    assert(soft.delayMs > 2000, "70%+ CPU must reduce AI generation speed");

    const hard = adaptiveBotJoinDelay(2000, 82, 70, 80);
    assert.equal(hard.pause, true, "80%+ CPU must pause new AI creation");
    assert(hard.delayMs >= 5000);

    // Limits disabled (the default): no throttle at any CPU level.
    assert.equal(cpuThrottleScale(90, 70, 80, false), 1, "disabled scale must stay 1");
    const unlimited = adaptiveBotJoinDelay(2000, 95, 70, 80, false);
    assert.equal(unlimited.pause, false, "disabled mode must never pause");
    assert.equal(unlimited.delayMs, 2000, "disabled mode keeps the base join delay");

    console.log(
        "CPU load control smoke test passed: soft throttle, hard spawn pause, bounded limits, and unlimited mode.",
    );
}

main();
