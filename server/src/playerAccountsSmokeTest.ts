import assert from "node:assert/strict";
import fs from "node:fs";
import { getServerDataFilePath } from "./config.ts";
import { PlayerAccountError, PlayerAccounts } from "./playerAccounts.ts";

const TEST_FILE = "survivio-test-player-accounts.json";
const testPath = getServerDataFilePath(TEST_FILE);

try {
    fs.rmSync(testPath, { force: true });
} catch {
    // ignore
}

let accounts: PlayerAccounts | null = null;
try {
    accounts = new PlayerAccounts(TEST_FILE);

    // Register creates a lower-cased username key while keeping the original
    // casing as the in-game display name.
    const profile = accounts.register("Alice", "secret123");
    assert.equal(profile.username, "alice");
    assert.equal(profile.displayName, "Alice");

    // The same normalized username cannot be registered twice.
    assert.throws(
        () => accounts!.register("ALICE", "other123"),
        PlayerAccountError,
        "duplicate username must be rejected after normalization",
    );

    // Login with any casing of the username succeeds with a session token.
    const login = accounts.login("alice", "secret123");
    assert.ok(login.token.length > 0, "login must return a session token");
    assert.equal(login.profile.username, "alice");
    assert.equal(login.profile.displayName, "Alice");

    // Wrong password is rejected.
    assert.throws(
        () => accounts!.login("alice", "wrong-password"),
        PlayerAccountError,
        "wrong password must be rejected",
    );

    // Profile resolves for a valid session and disappears after logout.
    assert.equal(accounts.profile(login.token)?.displayName, "Alice");
    accounts.logout(login.token);
    assert.equal(accounts.profile(login.token), null, "logged-out token must not resolve");

    // Change password: the old password stops working, the new one logs in,
    // and the current session survives while other sessions are revoked.
    const first = accounts.login("alice", "secret123");
    const second = accounts.login("alice", "secret123");
    accounts.changePassword(first.token, "secret123", "newpass99");
    assert.equal(
        accounts.profile(second.token),
        null,
        "changing the password must revoke other sessions",
    );
    assert.equal(accounts.profile(first.token)?.displayName, "Alice");
    assert.throws(
        () => accounts!.login("alice", "secret123"),
        PlayerAccountError,
        "old password must be rejected after a change",
    );
    const relogin = accounts.login("alice", "newpass99");
    assert.equal(relogin.profile.username, "alice");
    assert.throws(
        () => accounts!.changePassword(first.token, "wrong-current", "whatever1"),
        PlayerAccountError,
        "wrong current password must be rejected",
    );
    accounts.logout(first.token);
    accounts.logout(relogin.token);

    // Validation rules.
    assert.throws(() => accounts!.register("a", "secret123"), PlayerAccountError);
    assert.throws(() => accounts!.register("validname", "123"), PlayerAccountError);
    assert.throws(
        () => accounts!.register("bad name!", "secret123"),
        PlayerAccountError,
    );
    // Two-character usernames and internal spaces are supported (imported
    // accounts like "sb" / "ba ba da wo").
    assert.equal(accounts.register("sb", "1234").username, "sb");
    assert.equal(accounts.register("ba ba da wo", "1234").displayName, "ba ba da wo");
    // The 4-digit default password passes the minimum length.
    assert.equal(accounts.login("sb", "1234").profile.username, "sb");

    // The persisted file must never contain the plain-text password and every
    // user entry must carry a salt + scrypt hash instead.
    const raw = fs.readFileSync(testPath, "utf8");
    assert.ok(!raw.includes("secret123"), "plain-text password must never be stored");
    const parsed = JSON.parse(raw) as {
        users: Record<string, { salt: string; hash: string }>;
    };
    assert.ok(parsed.users.alice?.salt, "user entry must store a salt");
    assert.ok(parsed.users.alice?.hash, "user entry must store a password hash");
    assert.ok(!("password" in parsed.users.alice), "no plain-text password field");

    // Delete account: removes the user and revokes all of its sessions.
    const toDelete = accounts.login("sb", "1234");
    accounts.deleteAccount("sb");
    assert.throws(
        () => accounts!.login("sb", "1234"),
        PlayerAccountError,
        "deleted account cannot log in",
    );
    assert.equal(
        accounts.profile(toDelete.token),
        null,
        "sessions of a deleted account are revoked",
    );
    const listed = accounts.listAccounts();
    assert.ok(!listed.some((a) => a.username === "sb"), "deleted account not listed");
    assert.ok(listed.some((a) => a.username === "alice"), "remaining account still listed");
    assert.throws(
        () => accounts!.deleteAccount("nobody"),
        PlayerAccountError,
        "deleting a missing account must throw",
    );

    // #9: 两个 PlayerAccounts 实例（API 进程 + 后台进程）并发时，
    // pruneSessions 必须走 writeExclusive（先加锁重载再落盘），
    // 不能用旧快照覆盖另一实例刚写入的新账号。
    {
        const instanceA = new PlayerAccounts(TEST_FILE);
        const loginA = instanceA.login("alice", "newpass99");
        // 实例 B 读取同一文件：能看到 alice 与她的会话。
        const instanceB = new PlayerAccounts(TEST_FILE);
        assert.equal(
            instanceB.profile(loginA.token)?.displayName,
            "Alice",
            "instance B sees the session written by instance A",
        );
        // 实例 A 在 B 加载快照之后又注册了新账号并落盘。
        instanceA.register("olduser", "secret123");
        // 实例 B 执行会话清理：修复前会直接用旧内存快照覆盖文件，丢掉 olduser。
        (instanceB as unknown as { pruneSessions(): void }).pruneSessions();
        const fresh = new PlayerAccounts(TEST_FILE);
        const freshList = fresh.listAccounts();
        assert.ok(
            freshList.some((a) => a.username === "alice"),
            "alice must survive pruneSessions",
        );
        assert.ok(
            freshList.some((a) => a.username === "olduser"),
            "olduser written by instance A must survive instance B's pruneSessions (no clobber)",
        );
    }

    console.log(
        "Player accounts smoke test passed: register/login/logout/profile, normalization, validation, scrypt hashing, list/delete accounts, multi-instance pruneSessions safety.",
    );
} finally {
    try {
        fs.rmSync(testPath, { force: true });
    } catch {
        // ignore
    }
}
