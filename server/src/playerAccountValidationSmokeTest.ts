import assert from "node:assert/strict";
import { PlayerAccount } from "../../client/src/playerAccount.ts";

class MemoryStorage {
    private readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, String(value));
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

const setStoredSession = (token: string): void => {
    storage.setItem("surviv_player_session", token);
    storage.setItem("surviv_player_display_name", "Test player");
};

setStoredSession("expired-token");
(globalThis as { fetch?: typeof fetch }).fetch = (async () =>
    new Response(JSON.stringify({ err: "登录已失效" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
const expired = new PlayerAccount();
assert.equal(await expired.validateSession(), false);
assert.equal(expired.token, null, "an authoritative 401 must clear the stale session");
assert.equal(storage.getItem("surviv_player_session"), null);

setStoredSession("network-retry-token");
(globalThis as { fetch?: typeof fetch }).fetch = (async () => {
    throw new TypeError("network unavailable");
}) as typeof fetch;
const offline = new PlayerAccount();
assert.equal(await offline.validateSession(), false);
assert.equal(
    offline.token,
    "network-retry-token",
    "a temporary network failure must preserve the session for retry",
);

setStoredSession("server-retry-token");
(globalThis as { fetch?: typeof fetch }).fetch = (async () =>
    new Response(JSON.stringify({ err: "temporary failure" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
const unavailable = new PlayerAccount();
assert.equal(await unavailable.validateSession(), false);
assert.equal(
    unavailable.token,
    "server-retry-token",
    "a server outage must preserve the session for retry",
);

console.log(
    "Player account validation smoke test passed: rejected sessions are cleared while transient failures retain retry state.",
);
