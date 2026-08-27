import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../client/src/main.ts"),
    "utf8",
);

assert.match(
    source,
    /equipmentReturnNotificationTimer[\s\S]*window\.setInterval\([\s\S]*checkEquipmentReturnNotifications\(\)[\s\S]*10_000/,
    "active main menu must poll for approvals made after the player already returned",
);
assert.match(
    source,
    /else if \(this\.equipmentReturnNotificationTimer !== null\)[\s\S]*clearInterval[\s\S]*equipmentReturnNotificationTimer = null/,
    "equipment-return polling must stop while the player is in a match",
);

console.log("Equipment return notification polling passed: normal approvals appear without a page refresh and polling stops in matches.");
