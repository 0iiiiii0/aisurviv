import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ZOMBIE_MISSION_INTERACT_RADIUS } from "../../shared/defs/zombieDefs.ts";
import { ZombieMissionPhase } from "../../shared/net/zombieMissionMsg.ts";
import { getZombieMissionInteractionTarget } from "../../shared/zombieMissionInteraction.ts";
import { v2 } from "../../shared/utils/v2.ts";

const snapshot = {
    phase: ZombieMissionPhase.Collecting,
    groundMask: 0b111,
    carriedElement: 0xff,
    devicePos: v2.create(100, 100),
    elementPositions: [v2.create(10, 10), v2.create(20, 20), v2.create(30, 30)],
};

assert.deepEqual(
    getZombieMissionInteractionTarget(snapshot, v2.create(10, 10)),
    { kind: "pickup", elementIndex: 0 },
    "standing by a ground element must expose the mobile pickup interaction",
);
assert.equal(
    getZombieMissionInteractionTarget(
        snapshot,
        v2.create(10 + ZOMBIE_MISSION_INTERACT_RADIUS + 0.001, 10),
    ),
    null,
    "the mobile interaction must hide immediately outside server range",
);

snapshot.groundMask = 0b110;
assert.equal(
    getZombieMissionInteractionTarget(snapshot, v2.create(10, 10)),
    null,
    "an element that is carried or placed must not expose a stale pickup button",
);

snapshot.carriedElement = 1;
assert.deepEqual(
    getZombieMissionInteractionTarget(snapshot, v2.create(100, 100)),
    { kind: "place", elementIndex: 1 },
    "a carrier beside the console must expose the mobile placement interaction",
);
assert.equal(
    getZombieMissionInteractionTarget(snapshot, v2.create(20, 20)),
    null,
    "a carrier must not be offered a second pickup interaction",
);

snapshot.phase = ZombieMissionPhase.Countdown;
assert.equal(
    getZombieMissionInteractionTarget(snapshot, v2.create(100, 100)),
    null,
    "the interaction button must hide once the mission leaves collecting phase",
);

const root = path.resolve(import.meta.dirname, "../..");
const gameSource = fs.readFileSync(path.join(root, "client/src/game.ts"), "utf8");
const ui2Source = fs.readFileSync(path.join(root, "client/src/ui/ui2.ts"), "utf8");
const uiSource = fs.readFileSync(path.join(root, "client/src/ui/ui.ts"), "utf8");
assert.match(
    gameSource,
    /getZombieMissionInteractionTarget\(\s*msg,\s*this\.m_activePlayer\.m_pos,?\s*\)/,
    "the live zombie HUD must publish proximity to the interaction UI",
);
assert.match(
    ui2Source,
    /interactionType\s*=\s*InteractionType\.ZombieMission/,
    "the normal hidden-until-needed interaction widget must accept mission targets",
);
assert.match(
    uiSource,
    /interactionElems\.on\("touchstart",[\s\S]*?interactionTouched\s*=\s*true/,
    "the visible interaction widget must remain touch-enabled",
);
assert.match(
    gameSource,
    /interactionTouched\)[\s\S]{0,160}?addInput\(Input\.Interact\)/,
    "tapping the mobile mission prompt must send the authoritative Interact input",
);

console.log("zombie mobile interaction smoke test passed");
