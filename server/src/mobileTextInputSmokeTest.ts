import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const ui2 = fs.readFileSync(path.join(root, "client/src/ui/ui2.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "client/src/ui/ui.ts"), "utf8");
const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "client/css/game.css"), "utf8");

assert.match(
    ui2,
    /isTextEntryTarget\(target\)[\s\S]*?isTextEntryTarget\(document\.activeElement\)[\s\S]*?insideInputBlocker[\s\S]*?return;[\s\S]*?canvas\.focus\(\);/,
    "a ghost mobile mouseup must not move focus from an active editor to the canvas",
);
assert.match(
    html,
    /id='ui-spectator-chat-input'[\s\S]{0,260}?inputmode='text'[\s\S]{0,260}?enterkeyhint='send'[\s\S]{0,260}?data-game-input-blocker/,
    "spectator chat must expose a native mobile text editor and send action",
);
assert.match(
    ui,
    /class: "ui-equipment-return",[\s\S]{0,120}?"data-game-input-blocker": ""/,
    "the equipment-return form must opt out of gameplay touch handling",
);
assert.match(
    ui,
    /class: "ui-equipment-return-reason"[\s\S]{0,260}?inputmode: "text"[\s\S]{0,260}?enterkeyhint: "done"/,
    "the return reason must expose a native mobile textarea",
);
assert.match(
    ui,
    /reason\.on\("keydown keyup keypress", \(event\) => event\.stopPropagation\(\)\);/,
    "typing a return reason must not trigger global game binds",
);
assert.match(
    css,
    /#ui-spectator-chat-input[\s\S]*?user-select:\s*text;[\s\S]*?\.ui-equipment-return-reason[\s\S]*?font-size:\s*16px;/,
    "mobile editors must allow selection and avoid iOS focus zoom",
);

console.log(
    "Mobile text input smoke test passed: chat and equipment-return editors keep focus and open the software keyboard.",
);
