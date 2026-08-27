import assert from "assert/strict";
import fs from "fs";
import path from "path";
import {
    ConcealmentTracker,
    concealmentBlocksVisualContact,
    type ConcealmentZone,
} from "./bot/concealmentIntelligence.ts";

const smokeZone: ConcealmentZone = {
    key: "smoke:test",
    kind: "smoke",
    center: { x: 100, y: 100 },
    radius: 6,
    layer: 0,
    objectId: 1,
    buildingId: 0,
    destructible: false,
    healthT: 1,
    ceilingDead: false,
    ceilingDamaged: false,
    occupied: false,
    supportIds: [],
};

// 1) The one-way smoke vision model: an outside observer cannot see a target
// inside smoke, but a shooter inside smoke can see out.
{
    const observerOutside = { x: 140, y: 100 };
    const targetInside = { x: 103, y: 100 };
    assert.equal(
        concealmentBlocksVisualContact(observerOutside, targetInside, smokeZone),
        true,
        "an outside bot must not see the human inside smoke",
    );
    const observerInside = { x: 102, y: 100 };
    const targetOutside = { x: 140, y: 100 };
    assert.equal(
        concealmentBlocksVisualContact(observerInside, targetOutside, smokeZone),
        false,
        "a human inside smoke sees out (one-way advantage)",
    );
    assert.equal(
        concealmentBlocksVisualContact(targetInside, targetInside, smokeZone),
        false,
        "two players inside the same smoke see each other",
    );
}

// 2) injectSmokeContact creates a smoke contact for the hidden-area standoff.
{
    const tracker = new ConcealmentTracker();
    tracker.injectSmokeContact({
        enemyId: 42,
        zone: smokeZone,
        estimatedPos: { x: 102, y: 100 },
        timestamp: 1000,
    });
    assert.equal(tracker.hasContactInZone("smoke:test"), true, "the smoke zone must hold a contact");
    const contacts = tracker.all(1000);
    assert.equal(contacts.length, 1, "one hidden contact must be produced");
    assert.equal(contacts[0].enemyId, 42);
    assert.equal(contacts[0].kind, "smoke");
    assert.ok(contacts[0].confidence >= 0.5, "the bridged contact must be confident enough to engage");

    // Continuous fire refreshes the contact instead of dropping it.
    tracker.injectSmokeContact({
        enemyId: 42,
        zone: smokeZone,
        estimatedPos: { x: 102, y: 100 },
        timestamp: 4000,
    });
    const refreshed = tracker.all(4000);
    assert.equal(refreshed.length, 1, "repeated fire must keep the ambush hypothesis alive");
    assert.ok(refreshed[0].expiresAt > 4000 + 4000, "the contact expiry must be extended");
}

// 3) refreshSmokeContact keeps a live smoke contact from a fresh known enemy
// position (last visual memory / per-second extraction human hint) and tracks
// the player's latest position inside the cloud.
{
    const tracker = new ConcealmentTracker();
    tracker.refreshSmokeContact({
        enemyId: 7,
        zone: smokeZone,
        estimatedPos: { x: 101, y: 100 },
        timestamp: 1000,
    });
    assert.equal(
        tracker.hasContactInZone("smoke:test"),
        true,
        "a fresh memory inside smoke must create a smoke contact",
    );
    let contacts = tracker.all(1000);
    assert.equal(contacts.length, 1, "one hidden contact must be produced");
    assert.equal(contacts[0].kind, "smoke");
    assert.equal(contacts[0].enemyId, 7);
    assert.ok(contacts[0].confidence >= 0.5, "the memory-bridged contact must be confident enough to engage");

    // The player moves deeper inside the cloud; a refreshed memory sample
    // must update the estimated position so the sweep follows them.
    tracker.refreshSmokeContact({
        enemyId: 7,
        zone: smokeZone,
        estimatedPos: { x: 104, y: 100 },
        timestamp: 1800,
    });
    contacts = tracker.all(1800);
    assert.equal(contacts.length, 1, "refresh must keep a single contact");
    assert.ok(
        contacts[0].estimatedPos.x > 102,
        "the estimated position must track the latest known player position",
    );
    assert.ok(contacts[0].expiresAt > 1800 + 4000, "refresh must extend the contact expiry");
}

// 4) Source guarantees for the bot wiring.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(smartBotSource, /bridgeBallisticThreatToSmokeContact\(/, "the bot must bridge ballistic threats into smoke");
assert.match(smartBotSource, /bridgeMemoryToSmokeContacts\(/, "the bot must bridge fresh memories/hints into smoke");
assert.match(smartBotSource, /injectSmokeContact\(\{/, "the bridge must inject a smoke contact");
assert.match(smartBotSource, /"smoke_ambush_bridged"/, "smoke ambushes must be recorded for analysis");
assert.match(smartBotSource, /"smoke_ambush_memory_bridged"/, "memory-bridged smoke ambushes must be recorded");
assert.match(smartBotSource, /smokeDangerAvoidance\(/, "the bot must steer away from dangerous smoke");
assert.match(smartBotSource, /hasContactInZone\(zone\.key\)/, "smoke avoidance must only react to tracked ambushes");
assert.match(
    smartBotSource,
    /config\.extractionSecret && this\.isExtractionBot\(/,
    "secret-extraction AI must be defined as teammates (no friendly fire)",
);
assert.match(smartBotSource, /extractionHumanIds/, "the bot must track broadcast human ids to tell AI from humans");
const trackerSource = fs.readFileSync(path.join(__dirname, "bot", "concealmentIntelligence.ts"), "utf8");
assert.match(trackerSource, /injectSmokeContact\(/, "the tracker must own the smoke-contact bridge");
assert.match(trackerSource, /refreshSmokeContact\(/, "the tracker must own the memory-bridged smoke contact");
assert.match(trackerSource, /hasContactInZone\(/, "the tracker must expose zone contact queries");

console.log("Smoke handling smoke test passed: one-way vision is understood, shot-from-smoke and memory-bridged ambushes are bridged and suppressed; secret-extraction AI are teammates (normal is free-for-all).");
