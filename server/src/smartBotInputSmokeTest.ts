import assert from "assert/strict";

import { InputMsg, MsgStream, MsgType } from "../../shared/net/net.ts";
import {
    advanceThrowableInput,
    planThrowableEquipStep,
    sanitizeMouseDistance,
} from "./bot/inputSafety.ts";
import { movementInputFromDirection } from "./bot/movementInput.ts";

const cases: Array<[unknown, number]> = [
    [255, 64],
    [120, 64],
    [64, 64],
    [50, 50],
    [-5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [undefined, 0],
];

for (const [input, expected] of cases) {
    assert.equal(sanitizeMouseDistance(input), expected);

    const msg = new InputMsg();
    msg.toMouseLen = sanitizeMouseDistance(input);
    const stream = new MsgStream(new ArrayBuffer(256));
    stream.serializeMsg(MsgType.Input, msg);
    assert.ok(stream.stream.byteIndex > 0);
}

assert.deepEqual(movementInputFromDirection({ x: 0, y: 1 }), {
    up: true,
    down: false,
    left: false,
    right: false,
});
assert.deepEqual(movementInputFromDirection({ x: 0, y: -1 }), {
    up: false,
    down: true,
    left: false,
    right: false,
});
assert.deepEqual(movementInputFromDirection({ x: 1, y: 0 }), {
    up: false,
    down: false,
    left: false,
    right: true,
});

const pinPull = advanceThrowableInput({
    phase: undefined,
    timestamp: 1000,
    cookMs: 420,
});
assert.deepEqual(
    {
        phase: pinPull.phase,
        releaseAt: pinPull.releaseAt,
        shootStart: pinPull.shootStart,
        shootHold: pinPull.shootHold,
    },
    {
        phase: "holding",
        releaseAt: 1420,
        shootStart: true,
        shootHold: true,
    },
);
const held = advanceThrowableInput({
    phase: pinPull.phase,
    timestamp: 1300,
    releaseAt: pinPull.releaseAt,
    cookMs: 420,
});
assert.equal(held.shootStart, false);
assert.equal(held.shootHold, true);
assert.equal(held.releasedNow, false);
const released = advanceThrowableInput({
    phase: held.phase,
    timestamp: 1420,
    releaseAt: held.releaseAt,
    cookMs: 420,
});
assert.equal(released.phase, "released");
assert.equal(released.shootStart, false);
assert.equal(released.shootHold, false);
assert.equal(released.releasedNow, true);

const legalFastStrobe = advanceThrowableInput({
    phase: undefined,
    timestamp: 2000,
    cookMs: 55,
});
assert.equal(
    legalFastStrobe.releaseAt,
    2100,
    "strobe input must respect the server's 100 ms throwable cook floor",
);

const equipMirv = planThrowableEquipStep({
    currentSlot: 0,
    throwableSlot: 3,
    currentType: "mirv",
    desiredType: "mirv",
    timestamp: 3000,
});
assert.equal(equipMirv.command, "input");
assert.equal(equipMirv.reason, "equip-slot");
assert.equal(
    planThrowableEquipStep({
        currentSlot: 0,
        throwableSlot: 3,
        currentType: "mirv",
        desiredType: "mirv",
        timestamp: 3040,
        requestedAt: 3000,
        requestedFromSlot: 0,
        requestedFromType: "mirv",
    }).command,
    "wait",
    "a delayed slot acknowledgement must not emit a second EquipThrowable packet",
);
assert.equal(
    planThrowableEquipStep({
        currentSlot: 3,
        throwableSlot: 3,
        currentType: "mirv",
        desiredType: "mirv",
        timestamp: 3060,
        requestedAt: 3000,
        requestedFromSlot: 0,
        requestedFromType: "mirv",
    }).command,
    "ready",
);
assert.equal(
    planThrowableEquipStep({
        currentSlot: 3,
        throwableSlot: 3,
        currentType: "smoke",
        desiredType: "mirv",
        timestamp: 3100,
        requestedAt: 3000,
        requestedFromSlot: 0,
        requestedFromType: "mirv",
    }).reason,
    "cycle-type",
);

console.log("SmartBot input safety smoke test passed: mouse distance, movement and hold-before-release throwable input are valid.");
