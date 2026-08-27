import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import {
    botNeedsMedicalSupport,
    canDonateMedicalItem,
    chooseMedicalDonation,
    isMedicalRequestEmote,
    predictedMedicalDropAmount,
} from "./bot/medicalSharing.ts";
import { FactionCoordinator } from "./bot/factionStrategy.ts";
import { SquadCoordinator } from "./bot/smartBotSupport.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { Player } from "./game/objects/player.ts";

const smartBotSource = fs.readFileSync(path.join(process.cwd(), "src/smartBot.ts"), "utf8");
assert.ok(
    smartBotSource.includes("isMedicalRequestEmote(String(emote.type"),
    "team emote path must decode emote_medical requests",
);
assert.ok(
    smartBotSource.includes("this.squad.reportBotMedicalNeed("),
    "bot health/inventory snapshot must publish medical need",
);
assert.ok(
    smartBotSource.indexOf("this.handleMedicalSharing(") <
        smartBotSource.indexOf("this.handleAmmoSharing("),
    "medical aid must be considered before routine ammo sharing",
);

function join(game: Game, token: string, name: string, _socketId: string): Player {
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = "";
    const client = game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        game.joinTokens.get(token)?.data as JoinTokenData,
        msg,
        token,
    );
    if (!client?.player) throw new Error(`failed to join ${name}`);
    return client.player;
}

assert.equal(isMedicalRequestEmote("emote_medical"), true);
assert.equal(isMedicalRequestEmote("ping_help"), false, "gift ping must not recurse as a request");
assert.equal(predictedMedicalDropAmount(1), 1);
assert.equal(predictedMedicalDropAmount(2), 1);
assert.equal(predictedMedicalDropAmount(5), 2);
assert.equal(predictedMedicalDropAmount(6), 3);
assert.equal(
    canDonateMedicalItem({ item: "bandage", inventoryCount: 6, humanEmergency: false }),
    true,
);
assert.equal(
    canDonateMedicalItem({ item: "bandage", inventoryCount: 4, humanEmergency: false }),
    false,
    "routine donors keep at least three bandages",
);
assert.equal(
    canDonateMedicalItem({ item: "healthkit", inventoryCount: 1, humanEmergency: true }),
    false,
    "a donor never gives away its last healthkit",
);
assert.equal(
    canDonateMedicalItem({ item: "healthkit", inventoryCount: 2, humanEmergency: true }),
    true,
);

assert.equal(
    botNeedsMedicalSupport({ health: 30, bandage: 0, healthkit: 0, soda: 0, painkiller: 0 }),
    true,
);
assert.equal(
    botNeedsMedicalSupport({ health: 30, bandage: 0, healthkit: 1, soda: 0, painkiller: 0 }),
    false,
    "critical bot with a medkit should use its own stock instead of requesting",
);
assert.equal(
    botNeedsMedicalSupport({ health: 72, bandage: 0, healthkit: 0, soda: 1, painkiller: 0 }),
    true,
    "boost alone does not replace direct healing for an injured bot",
);
assert.equal(
    botNeedsMedicalSupport({ health: 96, bandage: 0, healthkit: 0, soda: 0, painkiller: 0 }),
    false,
);

assert.equal(
    chooseMedicalDonation({
        inventory: { healthkit: 2, bandage: 6, soda: 4, painkiller: 2 },
        recipientHealth: 32,
        humanEmergency: true,
    }),
    "healthkit",
    "critical teammate should receive a medkit first",
);
assert.equal(
    chooseMedicalDonation({
        inventory: { healthkit: 1, bandage: 6, soda: 4, painkiller: 2 },
        recipientHealth: 68,
        humanEmergency: false,
    }),
    "bandage",
    "moderately injured teammate should receive bandages while rare medkit is preserved",
);
assert.equal(
    chooseMedicalDonation({
        inventory: { healthkit: 1, bandage: 2, soda: 4, painkiller: 1 },
        recipientHealth: 95,
        humanEmergency: false,
    }),
    "soda",
    "near-full teammate may receive spare boost instead of critical heal stock",
);

const squad = new SquadCoordinator(7, TeamMode.Squad);
squad.reportBotMedicalNeed(2, 202, true, 34, { x: 10, y: 10 }, 1_000);
const squadFirst = squad.claimMedicalShare(1, { x: 11, y: 10 }, 1_100, 50);
assert.equal(squadFirst?.key, "bot:2");
assert.equal(squadFirst?.health, 34);
assert.equal(
    squad.claimMedicalShare(3, { x: 11, y: 10 }, 1_150, 50),
    null,
    "one medical request must reserve exactly one donor",
);
squad.releaseMedicalShare("bot:2", 1);
assert.equal(squad.claimMedicalShare(3, { x: 11, y: 10 }, 1_200, 50)?.key, "bot:2");
squad.releaseMedicalShare("bot:2", 3);
squad.reportHumanMedicalRequest(303, 40, { x: 12, y: 10 }, 1_300);
assert.equal(
    squad.claimMedicalShare(4, { x: 11, y: 10 }, 1_350, 50, new Set(), true)?.key,
    "human:303:medical",
    "explicit human medical request must be claimable with human priority",
);

const faction = new FactionCoordinator({ enabled: true });
faction.reportMedicalNeed({
    key: "bot:2",
    requesterBotId: 2,
    requesterPlayerId: 202,
    teamId: 1,
    pos: { x: 10, y: 10 },
    health: 38,
    human: false,
    firstObservedAt: 1_000,
    updatedAt: 1_000,
});
assert.equal(
    faction.claimMedicalShare({
        teamId: 1,
        donorBotId: 1,
        donorPos: { x: 11, y: 10 },
        timestamp: 1_100,
        maxDistance: 58,
    })?.key,
    "bot:2",
);
assert.equal(
    faction.claimMedicalShare({
        teamId: 1,
        donorBotId: 3,
        donorPos: { x: 11, y: 10 },
        timestamp: 1_150,
        maxDistance: 58,
    }),
    null,
    "50v50 medical support also uses one donor per request",
);
faction.releaseMedicalShare(1, "bot:2", 1);
faction.reportMedicalNeed({
    key: "human:404:medical",
    requesterBotId: 0,
    requesterPlayerId: 404,
    teamId: 1,
    pos: { x: 12, y: 10 },
    health: 26,
    human: true,
    firstObservedAt: 1_200,
    updatedAt: 1_200,
});
assert.equal(
    faction.claimMedicalShare({
        teamId: 1,
        donorBotId: 4,
        donorPos: { x: 11, y: 10 },
        timestamp: 1_250,
        maxDistance: 58,
        humanOnly: true,
    })?.key,
    "human:404:medical",
);

void (async () => {
    const game = new Game(`medical-share-${Math.random().toString(36).slice(2)}`, {
        mapName: "main",
        teamMode: TeamMode.Duo,
    });
    try {
        const teamToken = `med-team-${Math.random().toString(36).slice(2)}`;
        game.addJoinToken(teamToken, false, 2, 60_000, false, true);
        const donor = join(game, teamToken, "Donor", "med-donor");
        const recipient = join(game, teamToken, "Recipient", "med-recipient");
        assert.notEqual(donor.groupId, 0);
        assert.equal(donor.groupId, recipient.groupId, "shared token must create a real teammate pair");

        donor.invManager.set("bandage", 6);
        const beforeLoot = game.lootBarn.loots.length;
        const drop = new net.DropItemMsg();
        drop.item = "bandage";
        drop.recipientId = recipient.__id;
        donor.dropItem(drop);
        const medicalLoot = game.lootBarn.loots.slice(beforeLoot).find((loot) => loot.type === "bandage");
        assert.ok(medicalLoot, "authoritative medical drop must spawn loot");
        assert.equal(medicalLoot.count, 3, "heal/boost drop splits inventory in half");
        assert.equal(medicalLoot.ownerId, recipient.__id, "gifted medicine is reserved for recipient");
        assert.ok(medicalLoot.ownerExpiresAt > Date.now() + 14_000);
        assert.equal(donor.inventory.bandage, 3);
        const giftPing = game.playerBarn.emotes.at(-1);
        assert.equal(giftPing?.type, "ping_help");
        assert.equal(giftPing?.itemType, "bandage");

        const outsiderToken = `med-outsider-${Math.random().toString(36).slice(2)}`;
        game.addJoinToken(outsiderToken, false, 1, 60_000, false, true);
        const outsider = join(game, outsiderToken, "Outsider", "med-outsider");
        assert.notEqual(outsider.groupId, donor.groupId);

        const outsiderBandagesBefore = Number(outsider.inventory.bandage ?? 0);
        outsider.pickupLoot(medicalLoot);
        assert.equal(
            Number(outsider.inventory.bandage ?? 0),
            outsiderBandagesBefore,
            "non-recipient cannot steal reserved medicine",
        );
        assert.equal(medicalLoot.destroyed, false);
        const recipientBandagesBefore = Number(recipient.inventory.bandage ?? 0);
        recipient.pickupLoot(medicalLoot);
        assert.equal(
            Number(recipient.inventory.bandage ?? 0),
            recipientBandagesBefore + 3,
            "intended teammate can pick up the reserved medicine",
        );
        assert.equal(medicalLoot.destroyed, true);

        donor.invManager.set("soda", 4);
        const beforeInvalid = game.lootBarn.loots.length;
        const invalidDrop = new net.DropItemMsg();
        invalidDrop.item = "soda";
        invalidDrop.recipientId = outsider.__id;
        donor.dropItem(invalidDrop);
        const publicLoot = game.lootBarn.loots.slice(beforeInvalid).find((loot) => loot.type === "soda");
        assert.ok(publicLoot);
        assert.equal(publicLoot.ownerId, 0, "bot cannot reserve medicine for a non-teammate");

        console.log(
            "Medical sharing smoke test passed: request arbitration, donor reserves, item choice, faction/squad reservations, and authoritative teammate-only loot ownership.",
        );
    } finally {
        game.stop();
    }
})();
