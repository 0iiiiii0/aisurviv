import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig } from "../../shared/gameConfig.ts";
import {
    factionMedicSelfReviveDecision,
    isSelfRevivingFactionMedic,
} from "./bot/specialRoleStrategy.ts";
import { ownsReviveTarget, shouldApplyAreaRevive } from "./game/revivePolicy.ts";

const none = GameConfig.Action.None;
const revive = GameConfig.Action.Revive;

assert.equal(
    factionMedicSelfReviveDecision({
        factionMode: true,
        downed: true,
        role: "medic",
        actionType: none,
        noneActionType: none,
        reviveActionType: revive,
    }),
    "start",
    "a downed 50v50 medic with no action must start self-revive",
);

assert.equal(
    factionMedicSelfReviveDecision({
        factionMode: true,
        downed: true,
        role: "medic",
        actionType: revive,
        noneActionType: none,
        reviveActionType: revive,
    }),
    "hold",
    "an active revive must be held instead of spamming another revive input",
);

for (const sample of [
    { factionMode: false, downed: true, role: "medic", actionType: none },
    { factionMode: true, downed: false, role: "medic", actionType: none },
    { factionMode: true, downed: true, role: "leader", actionType: none },
]) {
    assert.equal(
        factionMedicSelfReviveDecision({
            ...sample,
            noneActionType: none,
            reviveActionType: revive,
        }),
        "none",
    );
}

assert.equal(
    isSelfRevivingFactionMedic({
        factionMode: true,
        downed: true,
        role: "medic",
        actionType: revive,
        reviveActionType: revive,
    }),
    true,
);

assert.equal(
    shouldApplyAreaRevive({
        actorHasAoeHeal: true,
        actorId: 10,
        targetId: 10,
        targetRevivedById: 10,
    }),
    true,
    "a medic's legitimate self-revive may apply the medic area revive",
);

assert.equal(
    shouldApplyAreaRevive({
        actorHasAoeHeal: true,
        actorId: 10,
        targetId: 20,
        targetRevivedById: 10,
    }),
    true,
    "a medic actively reviving a teammate may apply area revive",
);

assert.equal(
    shouldApplyAreaRevive({
        actorHasAoeHeal: false,
        actorId: 10,
        targetId: 20,
        targetRevivedById: 10,
    }),
    false,
    "a non-medic reviver must only revive the direct target",
);

assert.equal(
    ownsReviveTarget({
        actorId: 20,
        targetId: 20,
        targetRevivedById: 10,
    }),
    false,
    "a downed medic being revived by someone else does not own the action",
);
assert.equal(
    shouldApplyAreaRevive({
        actorHasAoeHeal: true,
        actorId: 20,
        targetId: 20,
        targetRevivedById: 10,
    }),
    false,
    "the rescued medic's aoe perk must not convert another player's revive into area rescue",
);

const playerSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "game/objects/player.ts"),
    "utf8",
);
const botSource = fs.readFileSync(path.resolve(import.meta.dirname, "smartBot.ts"), "utf8") + "\n"
    + fs.readFileSync(path.join(import.meta.dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(playerSource, /playerToRevive\.revivedBy = this/);
assert.match(playerSource, /this\.playerBeingRevived\.revivedBy\?\.__id/);
assert.match(playerSource, /if \(!this\.revivedBy \|\| this\.playerBeingRevived === this\.revivedBy\)/);
assert.match(playerSource, /kill\(params: DamageParams\): void \{[\s\S]*?this\.cancelAction\(\)/);
assert.match(botSource, /factionMedicSelfReviveDecision/);
assert.match(botSource, /this\.addInput\(GameConfig\.Input\.Revive\)/);

console.log("V51 faction medic revive smoke test passed");
