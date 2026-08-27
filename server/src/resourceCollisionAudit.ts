import fs from "node:fs";
import path from "node:path";

import { RawMapObjectDefs as MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import type { ObstacleDef } from "../../shared/defs/mapObjectsTyping.ts";
import type { Vec2 } from "../../shared/utils/v2.ts";
import { colliderApproachPlan } from "./bot/interactionGeometry.ts";
import { lootBreakableProfile } from "./bot/lootStrategy.ts";

export interface ResourceCollisionAuditEntry {
    type: string;
    obstacleType: string;
    collisionType: "circle" | "aabb";
    collision: unknown;
    scale: { createMin: number; createMax: number; destroy: number };
    health: number;
    material: string;
    armorPlated: boolean;
    stonePlated: boolean;
    explosive: boolean;
    directLootEntries: number;
    destroyType: string;
    smartLoot: boolean;
    swapWeaponOnDestroy: boolean;
    airdropCrate: boolean;
    regrow: boolean;
    testedCases: number;
    maximumSurfaceError: number;
}

export interface ResourceCollisionAuditReport {
    generatedAt: string;
    summary: {
        resourceDefinitions: number;
        circleDefinitions: number;
        aabbDefinitions: number;
        testedGeometryCases: number;
        issues: number;
    };
    issues: string[];
    resources: ResourceCollisionAuditEntry[];
}

const finitePoint = (value: Vec2): boolean => Number.isFinite(value.x) && Number.isFinite(value.y);

export function buildResourceCollisionAudit(): ResourceCollisionAuditReport {
    const issues: string[] = [];
    const resources: ResourceCollisionAuditEntry[] = [];
    let testedGeometryCases = 0;

    const actorDirections: Vec2[] = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
    ];

    for (const [type, rawDef] of Object.entries(MapObjectDefs)) {
        if (rawDef.type !== "obstacle") continue;
        const def = rawDef as ObstacleDef;
        if (!def.destructible) continue;
        const profile = lootBreakableProfile(type);
        if (!profile) continue;

        const collision = def.collision as any;
        if (!collision || (collision.type !== 0 && collision.type !== 1)) {
            issues.push(`${type}: missing or unsupported collision definition`);
            continue;
        }
        if (collision.type === 0) {
            if (!finitePoint(collision.pos) || !(Number(collision.rad) > 0)) {
                issues.push(`${type}: invalid circle collision`);
                continue;
            }
        } else if (
            !finitePoint(collision.min)
            || !finitePoint(collision.max)
            || collision.min.x >= collision.max.x
            || collision.min.y >= collision.max.y
        ) {
            issues.push(`${type}: invalid AABB collision`);
            continue;
        }

        const scales = Array.from(
            new Set([
                Math.max(0.05, Number(def.scale?.createMin ?? 1)),
                Math.max(0.05, Number(def.scale?.createMax ?? 1)),
            ]),
        );
        let testedCases = 0;
        let maximumSurfaceError = 0;
        for (const scale of scales) {
            for (let ori = 0; ori < 4; ori++) {
                for (const direction of actorDirections) {
                    const objectPos = { x: 100, y: 100 };
                    const actorPos = {
                        x: objectPos.x + direction.x * 40,
                        y: objectPos.y + direction.y * 40,
                    };
                    const plan = colliderApproachPlan({
                        definition: def,
                        objectPos,
                        objectOri: ori,
                        objectScale: scale,
                        actorPos,
                        reach: 4.5,
                        standOff: 1.1,
                    });
                    testedCases++;
                    testedGeometryCases++;
                    if (
                        !finitePoint(plan.surfacePoint)
                        || !finitePoint(plan.aimPoint)
                        || !finitePoint(plan.approachPoint)
                        || !Number.isFinite(plan.surfaceDistance)
                        || plan.surfaceDistance < 0
                    ) {
                        issues.push(`${type}: non-finite geometry at scale=${scale}, ori=${ori}`);
                        continue;
                    }
                    const atApproach = colliderApproachPlan({
                        definition: def,
                        objectPos,
                        objectOri: ori,
                        objectScale: scale,
                        actorPos: plan.approachPoint,
                        reach: 4.5,
                        standOff: 1.1,
                    });
                    const error = Math.abs(atApproach.surfaceDistance - 1.1);
                    maximumSurfaceError = Math.max(maximumSurfaceError, error);
                    if (!atApproach.canReach || error > 0.025) {
                        issues.push(
                            `${type}: approach point mismatch scale=${scale}, ori=${ori}, error=${error.toFixed(4)}`,
                        );
                    }
                }
            }
        }

        resources.push({
            type,
            obstacleType: String(def.obstacleType ?? ""),
            collisionType: collision.type === 0 ? "circle" : "aabb",
            collision,
            scale: {
                createMin: Number(def.scale?.createMin ?? 1),
                createMax: Number(def.scale?.createMax ?? 1),
                destroy: Number(def.scale?.destroy ?? 1),
            },
            health: Number(def.health ?? 0),
            material: String(def.material ?? ""),
            armorPlated: Boolean(def.armorPlated),
            stonePlated: Boolean(def.stonePlated),
            explosive: Boolean(def.explosion),
            directLootEntries: Array.isArray(def.loot) ? def.loot.length : 0,
            destroyType: String(def.destroyType ?? ""),
            smartLoot: Boolean(def.smartLoot),
            swapWeaponOnDestroy: Boolean(def.swapWeaponOnDestroy),
            airdropCrate: Boolean(def.airdropCrate),
            regrow: Boolean(def.regrow),
            testedCases,
            maximumSurfaceError,
        });
    }

    resources.sort((a, b) => a.type.localeCompare(b.type));
    return {
        generatedAt: new Date().toISOString(),
        summary: {
            resourceDefinitions: resources.length,
            circleDefinitions: resources.filter((entry) => entry.collisionType === "circle").length,
            aabbDefinitions: resources.filter((entry) => entry.collisionType === "aabb").length,
            testedGeometryCases,
            issues: issues.length,
        },
        issues,
        resources,
    };
}

if (require.main === module) {
    const report = buildResourceCollisionAudit();
    const output = path.resolve(__dirname, "../../RESOURCE_COLLISION_AUDIT_V48.json");
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.issues.length > 0) process.exitCode = 1;
}
