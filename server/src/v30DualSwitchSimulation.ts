import assert from "assert";
import { evaluateDualSwitch } from "./bot/dualSwitch.ts";

type Gun = {
    type: string;
    ammo: number;
    cooldown: number;
    fireDelay: number;
    switchDelay: number;
    maxClip: number;
};

function runSimulation(durationSeconds: number) {
    const guns: Gun[] = [
        { type: "mosin", ammo: 100, cooldown: 0, fireDelay: 1.75, switchDelay: 1, maxClip: 5 },
        { type: "sv98", ammo: 100, cooldown: 0, fireDelay: 1.5, switchDelay: 1, maxClip: 10 },
    ];
    let active = 0;
    let freeSwitchTimer = -0.01;
    let time = 0;
    const shots: Array<{ at: number; slot: number; type: string }> = [];
    const switches: Array<{ at: number; from: number; to: number; delay: number }> = [];
    const dt = 0.005;

    while (time < durationSeconds) {
        for (const gun of guns) gun.cooldown -= dt;
        freeSwitchTimer -= dt;
        const gun = guns[active];
        if (gun.cooldown <= 0 && gun.ammo > 0) {
            gun.ammo -= 1;
            gun.cooldown = gun.fireDelay;
            shots.push({ at: time, slot: active, type: gun.type });

            const otherSlot = active ^ 1;
            const other = guns[otherSlot];
            const decision = evaluateDualSwitch({
                difficulty: "forbidden",
                currentType: gun.type,
                otherType: other.type,
                currentCooldown: gun.cooldown,
                otherCooldown: Math.max(0, other.cooldown),
                otherAmmo: other.ammo,
                otherInRange: true,
                currentFireMode: "single",
                otherFireMode: "single",
                currentFireDelay: gun.fireDelay,
                otherFireDelay: other.fireDelay,
                currentMaxClip: gun.maxClip,
                switchDelay: other.switchDelay,
                shotConfirmed: true,
            });
            if (decision.useful) {
                const delay = freeSwitchTimer < 0 ? 0.25 : other.switchDelay;
                if (freeSwitchTimer < 0) freeSwitchTimer = 1;
                other.cooldown = delay;
                switches.push({ at: time, from: active, to: otherSlot, delay });
                active = otherSlot;
            }
        }
        time += dt;
    }

    return { shots, switches };
}

const result = runSimulation(20);
assert(result.shots.length >= 25, "Mosin/SV-98 cycling should materially improve the legal shot cadence");
assert(result.switches.length >= 20, "each confirmed slow-gun shot should normally arm the other slot");
for (let i = 1; i < result.shots.length; i++) {
    assert.notEqual(
        result.shots[i].slot,
        result.shots[i - 1].slot,
        "the committed slot must fire before the cycle switches back",
    );
}
const intervals = result.shots.slice(1).map((shot, i) => shot.at - result.shots[i].at);
const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
assert(averageInterval < 0.85, "the two-gun cycle should beat either rifle's standalone cadence");

const output = {
    durationSeconds: 20,
    shots: result.shots.length,
    switches: result.switches.length,
    averageShotIntervalMs: Math.round(averageInterval * 1000),
    firstTenShots: result.shots.slice(0, 10),
    firstTenSwitches: result.switches.slice(0, 10),
};
console.log(JSON.stringify(output, null, 2));
