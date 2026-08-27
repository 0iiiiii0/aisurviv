import assert from "assert";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
    path.join(__dirname, "game/gameProcessManager.ts"),
    "utf8",
);
assert.match(source, /reusable = false;/, "a room process needs an explicit reusable state");
assert.match(
    source,
    /if \(p\.stopped && p\.reusable\)/,
    "a process still creating its first room must not be reused",
);
assert.match(
    source,
    /if \(this\.stopped\) \{[\s\S]{0,140}this\.reusable = true;[\s\S]{0,100}else \{[\s\S]{0,100}this\.reusable = false;/,
    "only a child-reported stopped room may become reusable",
);
assert.match(
    source,
    /async createGame\(config: ServerGameConfig\)[\s\S]*?if \(game\.stopped\)[\s\S]*?onCreatedCbs\.push/,
    "private room creation must wait for the child-created acknowledgement before minting join tokens",
);
assert.match(
    source,
    /Timed out waiting for game process[\s\S]*?process\.once\("exit", onExit\)/,
    "private room creation must fail rather than hang when the child times out or exits",
);
console.log("Game-process reuse smoke test passed");
