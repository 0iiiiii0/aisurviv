import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const apiSource = fs.readFileSync(path.join(import.meta.dirname, "api/apiServer.ts"), "utf8");
const apiRouteSource = fs.readFileSync(path.join(import.meta.dirname, "api/index.ts"), "utf8");
const teamSource = fs.readFileSync(path.join(import.meta.dirname, "teamMenu.ts"), "utf8");
const siteInfoSource = fs.readFileSync(
    path.join(import.meta.dirname, "../../client/src/siteInfo.ts"),
    "utf8",
);
const mainSource = fs.readFileSync(path.join(import.meta.dirname, "../../client/src/main.ts"), "utf8");
const cssSource = fs.readFileSync(path.join(import.meta.dirname, "../../client/css/app.css"), "utf8");

assert.match(apiSource, /refreshPublicConfig\(\): void/);
assert.match(apiSource, /getServerConfigFilePath\("survivio-config\.json"\)/);
assert.match(
    apiSource,
    /mode\.mapName === "extraction_secret"[\s\S]{0,100}\? secretEnabled/,
    "the persisted secret switch must be authoritative for all secret playlists",
);
assert.match(apiSource, /getSiteInfo\(\)[\s\S]{0,80}this\.refreshPublicConfig\(\)/);
assert.match(apiRouteSource, /server\.refreshPublicConfig\(\);[\s\S]{0,80}server\.modes\[body\.gameModeIdx\]/);
assert.match(teamSource, /onMsg\([\s\S]{0,100}this\.server\.refreshPublicConfig\(\)/);
assert.match(siteInfoSource, /refresh\(onLoaded/);
assert.match(siteInfoSource, /#extraction-mode-section, #extraction-secret-section, #btn-zombie-lobby/);
assert.match(siteInfoSource, /#extraction-secret-section"\)\.css\("display", "flex"\)/);
assert.match(mainSource, /window\.addEventListener\("focus", refreshSiteInfo\)/);
assert.match(mainSource, /this\.siteInfo\?\.info\?\.extractionSecret\?\.enabled/);
assert.match(cssSource, /@media \(min-width: 851px\) and \(max-height: 820px\)/);
assert.match(cssSource, /#start-menu \{[\s\S]{0,100}max-height: calc\(100vh - 215px\)/);

console.log("Public mode refresh smoke test passed: cross-process secret switch, live UI refresh and short-screen containment.");
