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
storage.setItem("surviv_player_session", "expired-token");
storage.setItem("surviv_player_display_name", "Old player");

let resolveProfile!: (response: Response) => void;
const delayedProfile = new Promise<Response>((resolve) => {
    resolveProfile = resolve;
});

const jsonResponse = (body: unknown): Response =>
    ({
        ok: true,
        json: async () => body,
    }) as Response;

(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/account/profile") return delayedProfile;
    if (path === "/api/account/login") {
        return jsonResponse({
            ok: true,
            token: "new-valid-token",
            username: "new_player",
            displayName: "New player",
        });
    }
    throw new Error(`Unexpected request: ${path}`);
}) as typeof fetch;

async function main(): Promise<void> {
    const account = new PlayerAccount();
    const restore = account.restoreSession();
    await account.login("new_player", "test-password");

    resolveProfile(jsonResponse({ ok: false, err: "session_expired" }));
    assert.equal(await restore, true, "the newer login should remain active");
    assert.equal(account.token, "new-valid-token");
    assert.equal(account.username, "new_player");
    assert.equal(account.displayName, "New player");
    assert.equal(storage.getItem("surviv_player_session"), "new-valid-token");

    console.log(
        "Player account session race smoke test passed: a delayed restore cannot clear a newer login.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
