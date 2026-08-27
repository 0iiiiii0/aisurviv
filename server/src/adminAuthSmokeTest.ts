import assert from "assert";
import fs from "fs";
import { Config, getServerDataFilePath } from "./config.ts";
import { AdminAuthError, AdminAuthManager } from "./adminAuth.ts";

const originalCredentialFile = Config.admin.credentialFile;
const originalPassword = process.env["SURVIV_ADMIN_PASSWORD"];
const testFile = `survivio-admin-auth-smoke-${process.pid}.json`;
const testPath = getServerDataFilePath(testFile);

try {
    Config.admin.credentialFile = testFile;
    process.env["SURVIV_ADMIN_PASSWORD"] = "SmokeTest-Admin-Password";
    const auth = new AdminAuthManager();
    assert.throws(() => auth.login("wrong-password"), AdminAuthError);
    const login = auth.login("SmokeTest-Admin-Password");
    const sessions = (
        auth as unknown as {
            sessions: Map<string, { expiresAt: number }>;
        }
    ).sessions;
    const activeSession = sessions.get(login.sessionToken);
    assert.ok(activeSession);
    activeSession.expiresAt = Date.now() + 1_000;
    const expiryBeforeUse = activeSession.expiresAt;
    assert.equal(auth.authorize(login.sessionToken), true);
    assert.ok(
        activeSession.expiresAt > expiryBeforeUse + 60_000,
        "active admin requests must slide the session expiry forward",
    );
    auth.logout(login.sessionToken);
    assert.equal(auth.authorize(login.sessionToken), false);

    const second = auth.login("SmokeTest-Admin-Password");
    auth.changePassword("SmokeTest-Admin-Password", "Changed-Smoke-Password");
    assert.equal(auth.authorize(second.sessionToken), false);
    assert.throws(() => auth.login("SmokeTest-Admin-Password"), AdminAuthError);
    assert.equal(auth.authorize(auth.login("Changed-Smoke-Password").sessionToken), true);
    assert.equal(fs.existsSync(testPath), true);
    const stored = JSON.parse(fs.readFileSync(testPath, "utf8"));
    assert.equal(stored.version, 2);
    assert.equal(stored.password, "Changed-Smoke-Password");
    console.log("Admin auth smoke test passed: plain-text password storage, login sessions, logout, password rotation and session invalidation.");
} finally {
    Config.admin.credentialFile = originalCredentialFile;
    if (originalPassword === undefined) delete process.env["SURVIV_ADMIN_PASSWORD"];
    else process.env["SURVIV_ADMIN_PASSWORD"] = originalPassword;
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
}
