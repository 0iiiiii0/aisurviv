import assert from "assert";
import { BitStream, DropItemMsg } from "../../shared/net/net.ts";

import {
    emptyFlareDropDecision,
    factionUnarmedCombatPolicy,
    lootSourceAssociationRadius,
    lootSourceMemoryMs,
} from "./bot/resourceCombatPolicy.ts";
import { stabilizeMovementDirection } from "./bot/movementInput.ts";
import {
    ammoGiftEmoteForType,
    isAmmoGiftEmote,
    isAmmoRequestEmote,
    shouldDeliverTeamEmote,
} from "./game/teamEmoteVisibility.ts";

assert.equal(isAmmoRequestEmote("emote_ammo556mm"), true);
assert.equal(isAmmoRequestEmote("emote_medical"), false);
assert.equal(isAmmoGiftEmote("ping_help"), true);
assert.equal(isAmmoGiftEmote("ping_coming"), false);
assert.equal(ammoGiftEmoteForType("556mm"), "ping_help");
assert.equal(ammoGiftEmoteForType("308sub"), "ping_help");
assert.equal(
    shouldDeliverTeamEmote({
        type: "emote_ammo",
        teamOnly: true,
        isPing: false,
        hasItemType: true,
        senderVisible: false,
        sameGroup: false,
        sameFaction: true,
        senderIsFactionLeader: false,
    }),
    true,
);
assert.equal(
    shouldDeliverTeamEmote({
        type: "emote_medical",
        teamOnly: true,
        isPing: false,
        hasItemType: false,
        senderVisible: true,
        sameGroup: false,
        sameFaction: true,
        senderIsFactionLeader: false,
    }),
    false,
);
assert.equal(
    shouldDeliverTeamEmote({
        type: "ping_help",
        teamOnly: false,
        isPing: true,
        hasItemType: false,
        senderVisible: false,
        sameGroup: true,
        sameFaction: false,
        senderIsFactionLeader: false,
    }),
    true,
    "gift markers must reach the requesting squad through smoke or camera edges",
);
assert.equal(
    shouldDeliverTeamEmote({
        type: "ping_help",
        teamOnly: false,
        isPing: true,
        hasItemType: false,
        senderVisible: true,
        sameGroup: false,
        sameFaction: false,
        senderIsFactionLeader: false,
    }),
    false,
    "gift markers must not be shown to enemies",
);
assert.equal(
    shouldDeliverTeamEmote({
        type: "ping_coming",
        teamOnly: false,
        isPing: true,
        hasItemType: false,
        senderVisible: false,
        sameGroup: false,
        sameFaction: true,
        senderIsFactionLeader: true,
    }),
    true,
    "a leader gather ping must reach the entire faction even across squads and outside vision",
);

const dropWrite = new BitStream(new ArrayBuffer(32));
const outgoingDrop = new DropItemMsg();
outgoingDrop.item = "556mm";
outgoingDrop.weapIdx = 0;
outgoingDrop.recipientId = 4321;
outgoingDrop.serialize(dropWrite);
const incomingDrop = new DropItemMsg();
incomingDrop.deserialize(new BitStream(dropWrite.buffer));
assert.equal(incomingDrop.item, "556mm");
assert.equal(incomingDrop.recipientId, 4321);

const publicDropWrite = new BitStream(new ArrayBuffer(32));
const publicDrop = new DropItemMsg();
publicDrop.item = "762mm";
publicDrop.serialize(publicDropWrite);
const publicDropRead = new DropItemMsg();
publicDropRead.deserialize(new BitStream(publicDropWrite.buffer));
assert.equal(publicDropRead.recipientId, 0);

let policy = factionUnarmedCombatPolicy({
    factionMode: true,
    usableGunCount: 0,
    enemyDistance: 12,
    enemyUsesMelee: false,
    enemyMeleeReach: 0,
});
assert.equal(policy.prioritizeWeaponSearch, true);
assert.equal(policy.allowCombat, false);
policy = factionUnarmedCombatPolicy({
    factionMode: true,
    usableGunCount: 0,
    enemyDistance: 3,
    enemyUsesMelee: true,
    enemyMeleeReach: 4.5,
});
assert.equal(policy.immediateMeleeThreat, true);
assert.equal(policy.allowCombat, false);

assert.equal(lootSourceMemoryMs("military-airdrop"), 45_000);
assert.equal(lootSourceAssociationRadius("military-airdrop"), 32);
assert.equal(lootSourceMemoryMs("crate"), 5_200);

let flare = emptyFlareDropDecision(
    { key: "", firstEmptyAt: 0, retryAt: 0 },
    "1:flare_gun",
    1000,
);
assert.equal(flare.shouldDrop, false, "a newly picked empty flare gun gets an ammo pickup grace period");
flare = emptyFlareDropDecision(flare.next, "1:flare_gun", 1900, {
    pairedAmmoNearby: true,
});
assert.equal(flare.shouldDrop, false, "nearby paired flare ammo must prevent dropping the gun");
flare = emptyFlareDropDecision(flare.next, "1:flare_gun", 3800);
assert.equal(flare.shouldDrop, true, "a persistently empty unpaired flare gun is eventually dropped");
flare = emptyFlareDropDecision(flare.next, "1:flare_gun", 4500);
assert.equal(flare.shouldDrop, false, "drop retries are rate limited while inventory state settles");

const held = stabilizeMovementDirection(
    { x: 1, y: 0.1 },
    { x: -1, y: 0.1 },
    { timestamp: 1200, lockUntil: 1400, holdMs: 300, allowImmediate: false },
);
assert.ok(held.direction.x < 0, "horizontal direction should remain committed during lock");
const emergency = stabilizeMovementDirection(
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { timestamp: 1200, lockUntil: 1400, holdMs: 300, allowImmediate: true },
);
assert.ok(emergency.direction.x > 0, "emergency movement should bypass hysteresis");

console.log("V22 resource/combat smoke test passed");
