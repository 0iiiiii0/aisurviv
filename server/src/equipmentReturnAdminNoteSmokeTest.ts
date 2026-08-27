import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const adminJs = fs.readFileSync(path.join(projectRoot, "client/public/admin/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(projectRoot, "client/public/admin/admin.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(projectRoot, "client/public/admin/index.html"), "utf8");
const clientMain = fs.readFileSync(path.join(projectRoot, "client/src/main.ts"), "utf8");
const clientUi = fs.readFileSync(path.join(projectRoot, "client/src/ui/ui.ts"), "utf8");
const adminServer = fs.readFileSync(path.join(projectRoot, "server/src/adminServer.ts"), "utf8");
const stashManager = fs.readFileSync(path.join(projectRoot, "server/src/stash/stashManager.ts"), "utf8");

assert.match(adminJs, /给玩家留言（可选）/);
assert.match(adminJs, /equipment-return-note-input/);
assert.match(adminJs, /maxlength="300"/);
assert.match(adminJs, /JSON\.stringify\(\{ id, decision, adminNote \}\)/);
assert.match(adminJs, /后台留言/);
assert.match(adminCss, /\.equipment-return-admin-note/);
assert.match(adminHtml, /审批时可选填写给玩家的留言/);
assert.match(adminServer, /adminNote\?: unknown/);
assert.match(adminServer, /slice\(0, 300\)/);
assert.match(stashManager, /adminNote\?: string/);
assert.match(stashManager, /request\.adminNote = normalizedAdminNote/);
assert.match(clientMain, /后台留言（\$\{label\}）/);
assert.match(clientUi, /后台留言：\$\{adminNote\}/);

console.log("equipment return admin note smoke test passed");
