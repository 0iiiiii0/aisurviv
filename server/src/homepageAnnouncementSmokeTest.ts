import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "client/src/main.ts"), "utf8");
const siteInfo = fs.readFileSync(path.join(root, "client/src/siteInfo.ts"), "utf8");
const clientPackage = JSON.parse(
    fs.readFileSync(path.join(root, "client/package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const adminHtml = fs.readFileSync(
    path.join(root, "client/public/admin/index.html"),
    "utf8",
);
const adminServer = fs.readFileSync(
    path.join(root, "server/src/adminServer.ts"),
    "utf8",
);

assert.match(html, /<div id='news'><\/div>/, "homepage keeps an empty backend-announcement mount");
assert.doesNotMatch(html, /Free Fryer|Out of breath|Sound the charge|Stay classy/);
assert.doesNotMatch(main, /initNewsPanel/, "homepage no longer loads generated changelog news");
assert.equal(
    clientPackage.scripts?.build,
    "tsc --noEmit && vite build",
    "production builds must not regenerate the removed homepage changelog",
);
assert.match(
    siteInfo,
    /news\.children\(\)\.not\("#news-announcement"\)\.remove\(\)/,
    "backend announcement rendering clears legacy/generated changelog nodes",
);
assert.match(siteInfo, /id: "news-announcement"/);
assert.match(siteInfo, /announcement\.heading/);
assert.match(adminHtml, /id="announcement-form"/);
assert.match(adminServer, /app\.post\("\/admin-api\/announcement"/);

console.log(
    "Homepage announcement smoke test passed: generated changelog is hidden and the admin-authored What's New panel remains editable.",
);
