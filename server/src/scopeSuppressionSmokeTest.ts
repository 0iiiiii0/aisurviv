import assert from "assert/strict";
import fs from "fs";
import path from "path";
import {
    decideScopeAction,
    highestOwnedScopeBelow,
    scopeCloseBreakpoint,
} from "./bot/scopeSuppressionStrategy.ts";

// 拆箱/资源交互不受超视距/穿墙拦截：AI 站在箱子旁挥击必须真正发出去，
// 否则会误报 gunfire_viewport_blocked(no-target) 并放弃拆箱（"AI 不会拆箱子"）。
{
    const smartBotSource = fs.readFileSync(
        path.join(__dirname, "smartBot.ts"),
        "utf8",
    );
    assert.match(
        smartBotSource,
        /breakingResource = this\.currentCrateId > 0/,
        "crate-breaking must bypass the combat viewport/wall gunfire gates",
    );
    assert.match(
        smartBotSource,
        /reason: "break-crate"/,
        "crate-breaking fire must be marked as a legitimate resource interaction",
    );
}

const base = {
    scopeLevel: 8,
    enemyDistance: Infinity,
    enemyVisible: false,
    enemyOnScreen: false,
    recentlyDamaged: false,
    closeThreat: false,
    maxOwnedScopeLevel: 8,
    timestamp: 1000,
    lastScopeSwitchAt: 0,
    scopeDropUntil: 0,
};

// 1) A close attacker suppresses the scoped vision -> drop the scope.
{
    assert.ok(scopeCloseBreakpoint(8) > 20, "8x breakpoint must exceed shotgun range");
    const decision = decideScopeAction({ ...base, enemyDistance: 12 });
    assert.equal(decision.action, "drop-scope", "close enemy must drop the magnification");
    assert.equal(decision.reason, "close-enemy");
}

// 2) A visible target kept outside the narrow scoped viewport -> drop.
{
    const decision = decideScopeAction({ ...base, enemyVisible: true, enemyOnScreen: false, enemyDistance: 60 });
    assert.equal(decision.action, "drop-scope", "an off-screen visible target suppresses the scope");
    assert.equal(decision.reason, "off-screen-target");
}

// 3) Taking close fire suppresses the scoped vision -> drop.
{
    const decision = decideScopeAction({ ...base, recentlyDamaged: true, enemyDistance: 80 });
    assert.equal(decision.action, "drop-scope");
    assert.equal(decision.reason, "under-fire");
    const threat = decideScopeAction({ ...base, closeThreat: true, enemyDistance: 80 });
    assert.equal(threat.action, "drop-scope", "a close inbound threat must drop the scope");
}

// 4) A 1x scope has nothing to drop and never drops.
{
    const decision = decideScopeAction({ ...base, scopeLevel: 1, enemyDistance: 8, recentlyDamaged: true });
    assert.notEqual(decision.action, "drop-scope", "1x has no magnification to drop");
}

// 4b) A configured arena scope cannot be dropped unless a lower scope is
// actually present in inventory (duel loadouts commonly own only the 4x).
{
    assert.equal(highestOwnedScopeBelow(4, [4]), null);
    assert.equal(highestOwnedScopeBelow(8, [1, 4, 8]), 4);
}

// 5) Once the suppression clears and the fight is long-range, restore the best scope.
{
    const decision = decideScopeAction({
        ...base,
        scopeLevel: 1,
        maxOwnedScopeLevel: 8,
        enemyDistance: 90,
        timestamp: 3000,
        scopeDropUntil: 2000,
    });
    assert.equal(decision.action, "raise-scope", "a safe long-range fight must re-scope");
    assert.equal(decision.reason, "safe-long-range");
}

// 6) Re-scope only happens after the drop grace period and at a safe distance.
{
    const tooSoon = decideScopeAction({
        ...base,
        scopeLevel: 1,
        maxOwnedScopeLevel: 8,
        enemyDistance: 90,
        timestamp: 1500,
        scopeDropUntil: 3000,
    });
    assert.equal(tooSoon.action, "none", "re-scope must wait out the grace period");
    const tooClose = decideScopeAction({
        ...base,
        scopeLevel: 1,
        maxOwnedScopeLevel: 8,
        enemyDistance: 14,
        timestamp: 3000,
        scopeDropUntil: 2000,
    });
    assert.equal(tooClose.action, "none", "re-scope must wait for a long-range fight");
}

// 7) Suppressed but on the switch cooldown -> hold the current scope.
{
    const decision = decideScopeAction({ ...base, enemyDistance: 12, timestamp: 1000, lastScopeSwitchAt: 1200 });
    assert.equal(decision.action, "none", "scope switches are rate limited");
}

// 8) Source guarantees for the bot wiring.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(smartBotSource, /decideScopeAction\(/, "the bot must use the scope strategy module");
assert.match(smartBotSource, /GameConfig\.Input\.EquipPrevScope/, "the bot must drop the scope on suppression");
assert.match(smartBotSource, /GameConfig\.Input\.EquipNextScope/, "the bot must restore the scope at long range");
assert.match(smartBotSource, /this\.manageScopedVision\(myPos, target, timestamp\);/, "combat must run the scope strategy");
assert.match(smartBotSource, /this\.manageScopedVision\(myPos, null, timestamp\);/, "ballistic counterfire must run the scope strategy");
assert.match(smartBotSource, /"scope_suppression_dropped"/, "scope drops must be recorded for analysis");

console.log("Scoped-vision suppression smoke test passed: close/off-screen/under-fire targets drop the scope; safe long-range fights restore it.");
