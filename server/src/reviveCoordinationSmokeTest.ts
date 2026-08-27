import assert from "assert/strict";

import { activeReviverFor } from "./bot/reviveCoordination.ts";

const actors = [
    {
        id: 1,
        dead: false,
        disconnected: false,
        actionType: 4,
        actionTargetId: 99,
        reviveTargetId: 99,
    },
    {
        id: 2,
        dead: false,
        disconnected: false,
        actionType: 0,
        actionTargetId: 0,
        reviveTargetId: 0,
    },
];
assert.equal(activeReviverFor(actors, 2, 99, 4)?.id, 1);
assert.equal(activeReviverFor(actors, 1, 99, 4), undefined, "the current rescuer keeps its own lock");
assert.equal(
    activeReviverFor([{ ...actors[0], disconnected: true }], 2, 99, 4),
    undefined,
    "a disconnected rescuer must not block takeover",
);

console.log("revive coordination smoke test passed");
