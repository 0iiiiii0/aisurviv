import assert from "assert/strict";
import {
    isFreshCombatObservation,
    lastSeenBlindFireDurationMs,
    shouldActivateHighTierCombatController,
    shouldInterruptCombatReload,
    shouldPullTrigger,
    shouldStartLastSeenBlindFire,
    shouldStopForPrecisionShot,
    triggerCadenceReady,
    usesMaximumTriggerCadence,
} from "./bot/combatExecution.ts";
import { chooseUnseenDamageResponse } from "./bot/combatIntelligence.ts";
import {
    coverGeometry,
    obstacleBlocksBody,
    obstacleBlocksFullBody,
} from "./bot/combatTactics.ts";
import { assessHealSafety } from "./bot/healSafety.ts";
import { blocksBulletCollision } from "./bot/obstaclePolicy.ts";

function testDuelTriggerDiscipline(): void {
    const readyHighTierContext = {
        difficulty: "legit",
        duelMode: false,
        contextFresh: true,
        contextMatchesBot: true,
        contextMatchesGame: true,
        perceptionMatches: true,
        hasBotSnapshot: true,
        hasLiveEnemy: true,
    };
    assert.equal(
        shouldActivateHighTierCombatController(readyHighTierContext),
        true,
        "LEGIT must use its high-tier combat planner against a live enemy in an ordinary match",
    );
    assert.equal(
        shouldActivateHighTierCombatController({ ...readyHighTierContext, hasLiveEnemy: false }),
        false,
        "without a live enemy, normal looting and exploration must retain control",
    );
    assert.equal(
        shouldActivateHighTierCombatController({ ...readyHighTierContext, contextFresh: false }),
        false,
        "an ordinary match must never fight from a stale server snapshot",
    );
    assert.equal(
        shouldActivateHighTierCombatController({
            ...readyHighTierContext,
            duelMode: true,
            contextFresh: false,
            hasLiveEnemy: false,
        }),
        true,
        "duel mode preserves last-seen search and startup waiting behaviour",
    );
    assert.equal(
        shouldActivateHighTierCombatController({ ...readyHighTierContext, difficulty: "pro" }),
        false,
        "ordinary difficulties continue through the regular combat controller",
    );

    assert.equal(
        shouldStopForPrecisionShot({
            stopToShoot: true,
            meleeWeapon: false,
            targetDistance: 34,
            weaponRange: 22,
            lineClear: true,
            healthSafe: true,
            recentlyDamaged: false,
            underAirstrike: false,
            nearbyEnemyCount: 0,
        }),
        false,
        "a precision weapon must not root the bot outside its actual range",
    );

    assert.equal(
        shouldStopForPrecisionShot({
            stopToShoot: true,
            meleeWeapon: false,
            targetDistance: 18,
            weaponRange: 22,
            lineClear: true,
            healthSafe: true,
            recentlyDamaged: false,
            underAirstrike: false,
            nearbyEnemyCount: 0,
        }),
        true,
        "a safe clear in-range precision shot may stop movement",
    );

    assert.equal(
        shouldPullTrigger({
            duelMode: true,
            reactionReady: true,
            inRange: true,
            lineClear: true,
            ammoReady: true,
            shootConfidence: 0,
            randomRoll: 0.999,
        }),
        true,
        "1v1 must fire deterministically once all hard checks pass",
    );


    assert.equal(
        shouldPullTrigger({
            duelMode: false,
            reactionReady: true,
            inRange: true,
            lineClear: true,
            ammoReady: true,
            shootConfidence: 0,
            randomRoll: 0.999,
        }),
        true,
        "ordinary AI must not stare at an aligned visible target because of a random no-fire roll",
    );

    assert.equal(
        isFreshCombatObservation(72, 180, 4),
        true,
        "a recent target sample inside the current scope may be used at long range",
    );
    assert.equal(
        isFreshCombatObservation(72, 500, 8),
        false,
        "a stale long-range object coordinate must not be treated as current scope vision",
    );
    assert.equal(
        isFreshCombatObservation(12, 900, 1),
        true,
        "close threats may tolerate a slightly older packet",
    );
    assert.equal(usesMaximumTriggerCadence("normal"), false);
    for (const difficulty of ["hard", "pro", "legit", "forbidden"]) {
        assert.equal(
            usesMaximumTriggerCadence(difficulty),
            true,
            `${difficulty} must pre-arm semi-automatic fire`,
        );
        assert.equal(
            triggerCadenceReady({
                difficulty,
                automatic: false,
                duelMode: true,
                elapsedSinceRequestMs: 1,
                fireDelaySeconds: 0.4,
            }),
            true,
            `${difficulty} semi-automatic input must be continuously armed`,
        );
    }
    assert.equal(
        triggerCadenceReady({
            difficulty: "normal",
            automatic: false,
            duelMode: true,
            elapsedSinceRequestMs: 399,
            fireDelaySeconds: 0.4,
        }),
        false,
        "normal AI may retain a human-like semi-automatic cadence",
    );
    assert.equal(
        triggerCadenceReady({
            difficulty: "normal",
            automatic: false,
            duelMode: true,
            elapsedSinceRequestMs: 400,
            fireDelaySeconds: 0.4,
        }),
        true,
    );
    assert.equal(
        shouldStartLastSeenBlindFire({
            difficulty: "hard",
            targetId: 9,
            sameLayer: true,
            observationAgeMs: 80,
            lastSeenPointInViewport: true,
            aimPoint: { x: 147, y: 126 },
        }),
        true,
        "a just-lost target may start a burst at its copied last-visible point",
    );
    assert.equal(
        shouldStartLastSeenBlindFire({
            difficulty: "pro",
            targetId: 9,
            sameLayer: true,
            observationAgeMs: 600,
            lastSeenPointInViewport: true,
            aimPoint: { x: 149, y: 100 },
        }),
        false,
        "stale memory must not start a new off-screen burst",
    );
    assert.equal(
        shouldStartLastSeenBlindFire({
            difficulty: "legit",
            targetId: 9,
            sameLayer: true,
            observationAgeMs: 90,
            lastSeenPointInViewport: false,
            aimPoint: { x: 500, y: 500 },
        }),
        false,
        "a point that was never in the active viewport cannot seed blind fire",
    );
    assert.equal(
        shouldStartLastSeenBlindFire({
            difficulty: "forbidden",
            targetId: 9,
            sameLayer: true,
            observationAgeMs: 10,
            lastSeenPointInViewport: true,
            aimPoint: { x: 100, y: 100 },
        }),
        false,
        "HACKER uses its authoritative combat path rather than last-seen blind fire",
    );
    assert.ok(
        lastSeenBlindFireDurationMs("legit") >
            lastSeenBlindFireDurationMs("pro") &&
            lastSeenBlindFireDurationMs("pro") >
                lastSeenBlindFireDurationMs("normal"),
        "stronger public AI may sustain a longer last-seen burst without live tracking",
    );
    assert.equal(
        shouldInterruptCombatReload({
            reloadActive: true,
            clipAmmo: 7,
            targetVisible: true,
            targetInRange: true,
            lineClear: true,
        }),
        true,
        "a visible legal shot must interrupt an optional partial reload",
    );
    assert.equal(
        shouldInterruptCombatReload({
            reloadActive: true,
            clipAmmo: 0,
            targetVisible: true,
            targetInRange: true,
            lineClear: true,
        }),
        false,
        "an empty gun must finish reloading or switch instead of dry firing",
    );

    for (const blocked of [
        { reactionReady: false, inRange: true, lineClear: true, ammoReady: true },
        { reactionReady: true, inRange: false, lineClear: true, ammoReady: true },
        { reactionReady: true, inRange: true, lineClear: false, ammoReady: true },
        { reactionReady: true, inRange: true, lineClear: true, ammoReady: false },
    ]) {
        assert.equal(
            shouldPullTrigger({
                duelMode: true,
                ...blocked,
                shootConfidence: 1,
                randomRoll: 0,
            }),
            false,
            "duel trigger must still respect reaction, range, line-of-sight, and ammo",
        );
    }
}

function testHealingSafety(): void {
    const base = {
        health: 35,
        outsideGas: false,
        underAirstrike: false,
        ballisticPressure: false,
        millisecondsSinceDamage: 4_000,
    };

    const exposed = assessHealSafety({
        ...base,
        enemyDistance: 30,
        enemyHasLineOfSight: true,
        inHardCover: false,
        indoors: false,
    });
    assert.equal(exposed.canHeal, false);
    assert.equal(exposed.mustSeekCover, true);
    assert.equal(exposed.reason, "enemy-line-of-sight");

    const covered = assessHealSafety({
        ...base,
        enemyDistance: 30,
        enemyHasLineOfSight: false,
        inHardCover: true,
        indoors: false,
    });
    assert.equal(covered.canHeal, true, "hard cover with a damage-free window permits healing");

    const indoor = assessHealSafety({
        ...base,
        enemyDistance: 48,
        enemyHasLineOfSight: false,
        inHardCover: false,
        indoors: true,
    });
    assert.equal(
        indoor.canHeal,
        false,
        "being in the same building is not cover when an enemy is still nearby",
    );
    assert.equal(indoor.mustSeekCover, true);

    const quietIndoor = assessHealSafety({
        ...base,
        enemyDistance: Infinity,
        enemyHasLineOfSight: false,
        inHardCover: false,
        indoors: true,
        millisecondsSinceDamage: 8_000,
    });
    assert.equal(quietIndoor.canHeal, true, "a quiet building may be used after combat has ended");

    const faceHeal = assessHealSafety({
        ...base,
        health: 8,
        enemyDistance: 12,
        enemyHasLineOfSight: true,
        inHardCover: false,
        indoors: true,
    });
    assert.equal(faceHeal.canHeal, false, "critical HP must not permit healing in an enemy's face");
    assert.equal(faceHeal.reason, "point-blank-threat");

    const closeCovered = assessHealSafety({
        ...base,
        health: 18,
        enemyDistance: 12,
        enemyHasLineOfSight: false,
        inHardCover: true,
        indoors: false,
        millisecondsSinceDamage: 2_000,
    });
    assert.equal(
        closeCovered.canHeal,
        true,
        "a low-health bot behind real hard cover must stop retreating and use medicine",
    );

    const recentlyHit = assessHealSafety({
        ...base,
        enemyDistance: 30,
        enemyHasLineOfSight: false,
        inHardCover: true,
        indoors: false,
        millisecondsSinceDamage: 400,
    });
    assert.equal(recentlyHit.canHeal, false, "a new healing action needs a short no-damage window");
    assert.equal(recentlyHit.reason, "recent-damage");

    const interrupted = assessHealSafety({
        ...base,
        enemyDistance: 24,
        enemyHasLineOfSight: true,
        inHardCover: false,
        indoors: false,
        actionAlreadyActive: true,
    });
    assert.equal(interrupted.cancelActiveAction, true, "enemy line-of-sight must cancel active medicine");
}

function testUnseenDamageResponse(): void {
    assert.equal(
        chooseUnseenDamageResponse({
            millisecondsSinceDamage: 80,
            visibleAttacker: false,
            environmentalDamage: false,
            ballisticConfidence: 0.34,
            ballisticAgeMs: 40,
            rememberedThreatAgeMs: Infinity,
        }),
        "trajectory-counterfire",
        "a confirmed hit must promote a fresh client-visible bullet bearing",
    );
    assert.equal(
        chooseUnseenDamageResponse({
            millisecondsSinceDamage: 220,
            visibleAttacker: false,
            environmentalDamage: false,
            ballisticConfidence: 0,
            ballisticAgeMs: Infinity,
            rememberedThreatAgeMs: 900,
        }),
        "remembered-cover",
        "without a bullet bearing, a fresh last-seen hostile should drive cover selection",
    );
    assert.equal(
        chooseUnseenDamageResponse({
            millisecondsSinceDamage: 120,
            visibleAttacker: false,
            environmentalDamage: false,
            ballisticConfidence: 0,
            ballisticAgeMs: Infinity,
            rememberedThreatAgeMs: Infinity,
        }),
        "blind-juke",
        "a truly unknown hit still requires immediate evasive movement",
    );
    for (const protectedContext of [
        { visibleAttacker: true, environmentalDamage: false },
        { visibleAttacker: false, environmentalDamage: true },
    ]) {
        assert.equal(
            chooseUnseenDamageResponse({
                millisecondsSinceDamage: 60,
                ...protectedContext,
                ballisticConfidence: 0.8,
                ballisticAgeMs: 20,
                rememberedThreatAgeMs: 20,
            }),
            "none",
            "visible combat and environmental survival keep their dedicated handlers",
        );
    }
}

function testDynamicHealingCoverAnchor(): void {
    const obstaclePos = { x: 0, y: 0 };
    const eastAnchor = coverGeometry({
        obstaclePos,
        obstacleRadius: 1.8,
        enemyPos: { x: -10, y: 0 },
        playerRadius: 0.72,
    }).anchor;
    assert.ok(eastAnchor.x > 2.5 && Math.abs(eastAnchor.y) < 0.001);
    assert.equal(
        obstacleBlocksBody({ x: -10, y: 0 }, eastAnchor, obstaclePos, 1.8, 0.72),
        true,
        "the locked stone must cover the first live enemy bearing",
    );

    const northAnchor = coverGeometry({
        obstaclePos,
        obstacleRadius: 1.8,
        enemyPos: { x: 0, y: -10 },
        playerRadius: 0.72,
    }).anchor;
    assert.ok(northAnchor.y > 2.5 && Math.abs(northAnchor.x) < 0.001);
    assert.equal(
        obstacleBlocksBody({ x: 0, y: -10 }, northAnchor, obstaclePos, 1.8, 0.72),
        true,
        "a flanking enemy must rotate the anchor around the same stone",
    );
    assert.equal(
        obstacleBlocksFullBody({ x: -10, y: 0 }, eastAnchor, obstaclePos, 1.8, 0.72),
        true,
        "a centered far-side anchor must hide both edges of the player collider",
    );
    const tangentBody = { x: 2.5, y: 2 };
    assert.equal(
        obstacleBlocksBody({ x: -10, y: 0 }, tangentBody, obstaclePos, 1.8, 0.72),
        true,
        "the legacy centre-line approximation demonstrates the tangent false positive",
    );
    assert.equal(
        obstacleBlocksFullBody({ x: -10, y: 0 }, tangentBody, obstaclePos, 1.8, 0.72),
        false,
        "a centre-line graze must not authorize healing with half the body exposed",
    );
    const containerAnchor = coverGeometry({
        obstaclePos,
        obstacleRadius: 1.1,
        obstacleHalfExtents: { x: 2.75, y: 6 },
        enemyPos: { x: -10, y: 0 },
        playerRadius: 0.72,
    }).anchor;
    assert.ok(
        containerAnchor.x > 2.75 + 0.72 && Math.abs(containerAnchor.y) < 0.001,
        "a rectangular container anchor must clear its real AABB and the player collider",
    );
    assert.equal(
        blocksBulletCollision({
            type: "saloon_bar_small",
            definition: { type: "obstacle", collidable: true, height: 0.2 },
            runtime: { dead: false, healthT: 1 },
            bulletHeight: 0.25,
        }),
        false,
        "a low bar that server bullets pass over is not hard healing cover",
    );
    assert.equal(
        blocksBulletCollision({
            type: "stone_01",
            definition: { type: "obstacle", collidable: true, height: 2 },
            runtime: { dead: false, healthT: 1 },
            bulletHeight: 0.25,
        }),
        true,
    );
}

function main(): void {
    testDuelTriggerDiscipline();
    testHealingSafety();
    testUnseenDamageResponse();
    testDynamicHealingCoverAnchor();
    console.log(
        "Bot combat/heal smoke test passed: deterministic firing, fixed-point last-seen blind fire, current-scope freshness, no out-of-range rooting, and cover-gated healing.",
    );
}

main();
