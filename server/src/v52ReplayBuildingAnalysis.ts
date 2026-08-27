import fs from "fs";
import path from "path";
import { MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import { collider } from "../../shared/utils/collider.ts";
import { v2 } from "../../shared/utils/v2.ts";

type Point = { x: number; y: number };
type Region = { min: Point; max: Point };

const root = process.argv[2];
if (!root) throw new Error("Usage: v52ReplayBuildingAnalysis <recording-directory>");

const files = (dir: string, pattern: RegExp): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...files(full, pattern));
        else if (pattern.test(entry.name)) out.push(full);
    }
    return out;
};

const mapPath = files(root, /^map\.json$/)[0];
if (!mapPath) throw new Error("No map.json found");
const map = JSON.parse(fs.readFileSync(mapPath, "utf8")).map;

const buildingRegions: Region[][] = [];
for (const object of map.objects as Array<Record<string, any>>) {
    const def = MapObjectDefs[String(object.type ?? "")] as any;
    if (def?.type !== "building") continue;
    const raws: any[] = [];
    if (Array.isArray(def.ceiling?.collision) && def.ceiling.collision.length) {
        raws.push(...def.ceiling.collision);
    } else if (Array.isArray(def.floor?.surfaces)) {
        for (const surface of def.floor.surfaces) {
            if (Array.isArray(surface?.collision)) raws.push(...surface.collision);
        }
    }
    const regions = raws.map((raw) => {
        const world = collider.toAabb(
            collider.transform(
                raw,
                v2.create(object.pos.x, object.pos.y),
                (Number(object.ori ?? 0) % 4) * Math.PI * 0.5,
                Math.max(0.05, Number(object.scale ?? 1)),
            ),
        );
        return { min: world.min, max: world.max };
    });
    if (regions.length) buildingRegions.push(regions);
}

const inside = (point: Point, region: Region, margin = -0.1): boolean =>
    point.x >= region.min.x - margin &&
    point.x <= region.max.x + margin &&
    point.y >= region.min.y - margin &&
    point.y <= region.max.y + margin;
const inAnyBuilding = (point: Point): boolean =>
    buildingRegions.some((regions) => regions.some((region) => inside(point, region)));

let frames = 0;
let indoorFrames = 0;
let indoorMissingBuildingId = 0;
let indoorExactMatched = 0;
let indoorMissingButExactMatched = 0;
let playerTargetShots = 0;
let zeroLegalShotPackets = 0;
const framesByBot = new Map<number, Array<{ at: number; indoors: boolean }>>();

for (const file of files(root, /^frames-.*\.jsonl(?:\.part)?$/)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        let frame: any;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.type !== "frame" || !frame.self?.pos) continue;
        frames += 1;
        const botId = Number(frame.botId ?? 0);
        const indoors = Boolean(frame.self.indoors);
        const list = framesByBot.get(botId) ?? [];
        list.push({ at: Number(frame.at ?? 0), indoors });
        framesByBot.set(botId, list);
        if (indoors) {
            indoorFrames += 1;
            const missing = Number(frame.navigation?.currentBuildingId ?? 0) === 0;
            if (missing) indoorMissingBuildingId += 1;
            const exact = inAnyBuilding(frame.self.pos);
            if (exact) indoorExactMatched += 1;
            if (missing && exact) indoorMissingButExactMatched += 1;
        }
        const control = frame.control ?? {};
        if ((control.transmittedShootStart || control.transmittedShootHold) && frame.target) {
            playerTargetShots += 1;
            if (Number(frame.engagementRecovery?.legalShotForMs ?? 0) <= 0) {
                zeroLegalShotPackets += 1;
            }
        }
    }
}
for (const list of framesByBot.values()) list.sort((a, b) => a.at - b.at);

let recoveryEvents = 0;
let indoorRecoveryEvents = 0;
let weaponSearchAbandoned = 0;
let indoorWeaponSearchAbandoned = 0;
const nearestIndoor = (botId: number, at: number): boolean => {
    const list = framesByBot.get(botId) ?? [];
    let best: { at: number; indoors: boolean } | undefined;
    for (const frame of list) {
        if (frame.at > at + 600) break;
        if (!best || Math.abs(frame.at - at) < Math.abs(best.at - at)) best = frame;
    }
    return Boolean(best && Math.abs(best.at - at) <= 900 && best.indoors);
};
for (const file of files(root, /^events-.*\.jsonl(?:\.part)?$/)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "path_recovery_triggered") {
            recoveryEvents += 1;
            if (nearestIndoor(Number(event.botId ?? 0), Number(event.at ?? 0))) indoorRecoveryEvents += 1;
        }
        if (event.type === "weapon_search_abandoned") {
            weaponSearchAbandoned += 1;
            if (nearestIndoor(Number(event.botId ?? 0), Number(event.at ?? 0))) indoorWeaponSearchAbandoned += 1;
        }
    }
}

const result = {
    format: "V52 replay building analysis",
    mapName: map.mapName,
    buildingDefinitionsWithRegions: buildingRegions.length,
    frames,
    indoorFrames,
    indoorMissingBuildingId,
    indoorMissingBuildingIdPercent: indoorFrames ? indoorMissingBuildingId / indoorFrames * 100 : 0,
    indoorExactMatched,
    indoorExactMatchedPercent: indoorFrames ? indoorExactMatched / indoorFrames * 100 : 0,
    indoorMissingButExactMatched,
    recoveryEvents,
    indoorRecoveryEvents,
    indoorRecoveryPercent: recoveryEvents ? indoorRecoveryEvents / recoveryEvents * 100 : 0,
    weaponSearchAbandoned,
    indoorWeaponSearchAbandoned,
    playerTargetShots,
    zeroLegalShotPackets,
};
console.log(JSON.stringify(result, null, 2));
