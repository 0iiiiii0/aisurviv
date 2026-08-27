import assert from "node:assert/strict";

import { isFindGameRequestAuthorized } from "./findGameAuthorization.ts";

const accounts = {
    profile(token: unknown) {
        return token === "valid-session" ? { username: "smoke" } : null;
    },
};
const apiKey = "server-only-region-key";

assert.equal(isFindGameRequestAuthorized(false, {}, apiKey, accounts), true);
assert.equal(
    isFindGameRequestAuthorized(true, { accountToken: "valid-session" }, apiKey, accounts),
    true,
);
assert.equal(
    isFindGameRequestAuthorized(true, { apiKey }, apiKey, accounts, true),
    true,
    "the token-free internal region hop must remain authorized",
);
assert.equal(
    isFindGameRequestAuthorized(true, { apiKey: "wrong-key" }, apiKey, accounts),
    false,
);
assert.equal(
    isFindGameRequestAuthorized(true, { apiKey }, apiKey, accounts, false),
    false,
    "a remote client must not be able to spoof the internal region hop",
);
assert.equal(
    isFindGameRequestAuthorized(true, { apiKey: "" }, "", accounts),
    false,
    "an empty configured key must never authorize an internal hop",
);

console.log(
    "Find game authorization smoke test passed: secret extraction teams survive the trusted internal region hop.",
);
