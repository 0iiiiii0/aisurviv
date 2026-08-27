import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.join(import.meta.dirname, "../..");
const clientSource = fs.readFileSync(
    path.join(projectRoot, "client/public/admin/admin.js"),
    "utf8",
);
const html = fs.readFileSync(
    path.join(projectRoot, "client/public/admin/index.html"),
    "utf8",
);
const adminServerSource = fs.readFileSync(
    path.join(import.meta.dirname, "adminServer.ts"),
    "utf8",
);
const adminAuthSource = fs.readFileSync(
    path.join(import.meta.dirname, "adminAuth.ts"),
    "utf8",
);

assert.doesNotMatch(
    clientSource,
    /setInterval\(\(\) => refresh\(false\)/,
    "admin refresh must not use an overlapping setInterval loop",
);
assert.match(clientSource, /refreshInFlight:\s*false/);
assert.match(clientSource, /if \(state\.refreshInFlight\)[\s\S]{0,320}state\.refreshQueued = true/);
assert.match(clientSource, /ADMIN_REQUEST_TIMEOUT_MS = 12_000/);
assert.match(clientSource, /new AbortController\(\)/);
assert.match(clientSource, /cache:\s*"no-store"/);
assert.match(
    clientSource,
    /const response = await fetch[\s\S]{0,520}const text = await response\.text\(\)[\s\S]{0,520}clearTimeout/,
    "the timeout must cover the complete response body, not headers only",
);
assert.match(
    clientSource,
    /window\.setTimeout\(async \(\) =>[\s\S]{0,260}await refresh\(false\);[\s\S]{0,100}startAutoRefresh\(\)/,
    "the next refresh must be armed only after the current one settles",
);
assert.match(clientSource, /visibilitychange/);
assert.match(clientSource, /window\.addEventListener\("online", resumeAutoRefresh\)/);
assert.match(clientSource, /Promise\.all\(\[/);
assert.match(clientSource, /lastAncillaryRefreshAt:\s*0/);
assert.match(clientSource, /now - state\.lastAncillaryRefreshAt >= 15_000/);
assert.match(html, /admin\.js\?v=59-console-refresh/);
assert.match(adminServerSource, /Cache-Control", "no-store, no-cache, must-revalidate"/);
assert.match(
    adminAuthSource,
    /Sliding expiry[\s\S]{0,220}session\.expiresAt\s*=/,
    "active admin sessions must use sliding expiry",
);

console.log(
    "Admin auto-refresh smoke test passed: bounded polling, timeout recovery, resume hooks, no-cache and sliding session expiry.",
);
