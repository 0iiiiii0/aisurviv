import assert from "assert";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const ps = fs.readFileSync(path.join(root, "start-surviv.ps1"), "utf8");
const cs = fs.readFileSync(path.join(root, "tools/SurvivLauncher/Program.cs"), "utf8");
assert.match(ps, /Port 8001 is still occupied after cleanup/);
assert.match(ps, /Port 3000 is still occupied after cleanup/);
// V113: stale port owners are cleaned up automatically on startup, and owned
// process trees are killed on exit (including the X-close fallback).
assert.match(ps, /Get-PortOwnerPids/);
assert.match(ps, /taskkill\.exe \/PID/);
assert.match(ps, /Stop-OwnedProcessTree/);
assert.match(ps, /SurvivLauncher\.Exiting/);
assert.match(ps, /node_modules\\\.vite/);
assert.match(cs, /端口 8001 已被占用/);
assert.match(cs, /端口 3000 已被占用/);
assert.match(cs, /Directory\.Delete\(viteCache, true\)/);
const clientMain = fs.readFileSync(path.join(root, "client/src/main.ts"), "utf8");
const buildPs = fs.readFileSync(path.join(root, "build-complete.ps1"), "utf8");
assert.match(ps, /Stopping the stale process tree/);
assert.match(cs, /启动 V45/);
assert.match(clientMain, /V45_INTERNAL_AIM_TARGET_PROVEN_DODGE/);
assert.match(buildPs, /V45_INTERNAL_AIM_TARGET_PROVEN_DODGE/);
// V145: the legacy START_V45.cmd wrapper is gone; the PowerShell launcher
// itself owns job creation and the crash auto-restart loop.
assert.match(ps, /Start-SurvivServerJob/);
assert.match(ps, /AUTO-RESTART/);
console.log("V45 launcher smoke test passed");
