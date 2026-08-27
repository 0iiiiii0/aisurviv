import { GameConfig } from "../../gameConfig.ts";
import { collider } from "../../utils/collider.ts";
import { util } from "../../utils/util.ts";
import { v2, type Vec2 } from "../../utils/v2.ts";
import type { MapDef } from "../mapDefs.ts";
import { RawMapObjectDefs } from "../mapObjectDefs.ts";
import { MapObjectDefs } from "../register.ts";
import type { BuildingDef, MapObjectDef, StructureDef } from "../mapObjectsTyping.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";

/**
 * 航天基地 (Space City) — Delta Force inspired launch facility.
 * Custom water moat, multi-level H1-H4 buildings, launch pad platform.
 */

type ArenaObject = NonNullable<NonNullable<typeof Main.arena>>["objects"][number];
type BuildingObject = BuildingDef["mapObjects"][number];

const MAP_SIZE = 800;
const CENTER = MAP_SIZE / 2;
const WALL_STEP = 10;

// ─── Custom object registration ────────────────────────────────────────────
function register(name: string, def: MapObjectDef): void {
    if (RawMapObjectDefs[name]) {
        throw new Error(`[航天基地] 对象名冲突: ${name}`);
    }
    RawMapObjectDefs[name] = def;
    MapObjectDefs.addType(name);
}

// Water surface building
function waterBuilding(name: string, w: number, h: number): void {
    const box = collider.createAabbExtents(v2.create(0, 0), v2.create(w / 2, h / 2));
    register(name, {
        type: "building",
        zIdx: 0,
        map: { display: true, shapes: [{ collider: box, color: 0x173b4a }] },
        terrain: { grass: false, beach: false },
        mapObstacleBounds: [],
        floor: { surfaces: [{ type: "water", collision: [box] }], imgs: [] },
        ceiling: { zoomRegions: [], imgs: [], collision: [] },
        mapObjects: [],
    });
}

// Concrete platform (bridges, launch pad)
function platformBuilding(name: string, w: number, h: number, color = 0x56636a): void {
    const box = collider.createAabbExtents(v2.create(0, 0), v2.create(w / 2, h / 2));
    register(name, {
        type: "building",
        zIdx: 1,
        map: { display: true, shapes: [{ collider: box, color }] },
        terrain: { grass: false, beach: false },
        mapObstacleBounds: [],
        floor: { surfaces: [{ type: "tile", collision: [box], data: { isBright: true } }], imgs: [] },
        ceiling: { zoomRegions: [], imgs: [], collision: [] },
        mapObjects: [],
    });
}

// Building shell with walls and door gaps
const bo = (type: string, x: number, y: number, ori = 0, scale = 1, layer?: number): BuildingObject =>
    ({ type, pos: v2.create(x, y), ori, scale, ...(layer === undefined ? {} : { layer }) });

function wallH(y: number, x0: number, x1: number, gaps: Array<[number, number]> = []): BuildingObject[] {
    const out: BuildingObject[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 5.5) {
        if (gaps.some(([a, b]) => x >= a && x <= b)) continue;
        out.push(bo("concrete_wall_ext_6", x, y));
    }
    return out;
}
function wallV(x: number, y0: number, y1: number, gaps: Array<[number, number]> = []): BuildingObject[] {
    const out: BuildingObject[] = [];
    for (let y = y0; y <= y1 + 0.01; y += 5.5) {
        if (gaps.some(([a, b]) => y >= a && y <= b)) continue;
        out.push(bo("concrete_wall_ext_6", x, y, 1));
    }
    return out;
}
function shell(w: number, h: number, doors: { north?: Array<[number, number]>; south?: Array<[number, number]>; west?: Array<[number, number]>; east?: Array<[number, number]> } = {}): BuildingObject[] {
    const x = w / 2, y = h / 2;
    const dw = 4;
    return [
        ...wallH(-y, -x, x, doors.north ?? [[-dw / 2, dw / 2]]),
        ...wallH(y, -x, x, doors.south ?? [[-dw / 2, dw / 2]]),
        ...wallV(-x, -y, y, doors.west ?? [[-dw / 2, dw / 2]]),
        ...wallV(x, -y, y, doors.east ?? [[-dw / 2, dw / 2]]),
    ];
}

function emptyLayer(w: number, h: number, objects: BuildingObject[], color: number): BuildingDef {
    const box = collider.createAabbExtents(v2.create(0, 0), v2.create(w / 2, h / 2));
    return {
        type: "building",
        zIdx: 1,
        map: { display: true, shapes: [{ collider: box, color }] },
        terrain: { grass: true, beach: false },
        mapObstacleBounds: [box],
        floor: { surfaces: [{ type: "tile", collision: [box], data: { isBright: true } }], imgs: [] },
        ceiling: { zoomRegions: [{ zoomIn: box, zoomOut: box, zoom: 34 }], imgs: [], collision: [box] },
        mapObjects: objects,
    };
}

// Multi-level structure (ground + optional upper floor)
const VOID_LAYER = "space_city_void_layer";
register(VOID_LAYER, {
    type: "building",
    map: { display: false },
    terrain: { grass: true, beach: false },
    mapObstacleBounds: [],
    floor: { surfaces: [], imgs: [] },
    ceiling: { zoomRegions: [], imgs: [], collision: [] },
    mapObjects: [],
});

function addStructure(name: string, w: number, h: number, hasUpper: boolean, color: number, doorW = 8): void {
    const groundType = `${name}_ground`;
    register(groundType, emptyLayer(w, h, shell(w, h, {
        north: [[-doorW / 2, doorW / 2]],
        south: [[-doorW / 2, doorW / 2]],
        west: [[-doorW / 2, doorW / 2]],
        east: [[-doorW / 2, doorW / 2]],
    }), color));

    if (hasUpper) {
        const upperType = `${name}_upper`;
        register(upperType, emptyLayer(w, h, shell(w, h, {
            north: [[-doorW / 2, doorW / 2]],
            south: [[-doorW / 2, doorW / 2]],
            west: [[-doorW / 2, doorW / 2]],
            east: [[-doorW / 2, doorW / 2]],
        }), color));
    }

    const box = collider.createAabbExtents(v2.create(0, 0), v2.create(w / 2, h / 2));
    const stairs: StructureDef["stairs"] = hasUpper
        ? [{
            collision: collider.createAabbExtents(
                v2.create(-w / 2 + 6, -h / 2 + 7),
                v2.create(3.5, 5),
            ),
            downDir: v2.create(0, 1),
        }]
        : [];

    register(name, {
        type: "structure",
        terrain: { grass: true, beach: false },
        layers: [
            { type: groundType, pos: v2.create(0, 0), ori: 0 },
            ...(hasUpper ? [{ type: `${name}_upper`, pos: v2.create(0, 0), ori: 0 }] : []),
        ],
        stairs,
        mask: [box],
        mapObstacleBounds: [box],
    });
}

// ─── Register all custom objects ───────────────────────────────────────────
// Central water moat (4 segments around center)
waterBuilding("space_city_water_north", 180, 60);
waterBuilding("space_city_water_south", 180, 60);
waterBuilding("space_city_water_west", 60, 140);
waterBuilding("space_city_water_east", 60, 140);

// Bridges crossing the moat
platformBuilding("space_city_bridge_central", 14, 60, 0x6b7370);
platformBuilding("space_city_bridge_west", 60, 14, 0x6b7370);
platformBuilding("space_city_bridge_east", 60, 14, 0x6b7370);
platformBuilding("space_city_bridge_north", 14, 60, 0x6b7370);
platformBuilding("space_city_bridge_south", 14, 60, 0x6b7370);

// Launch pad platform
platformBuilding("space_city_launch_pad", 120, 100, 0x4a5559);

// H1-H4 multi-level buildings
addStructure("space_city_h1_centrifuge", 50, 40, true, 0x5a6a6a);
addStructure("space_city_h2_buoyancy", 45, 45, true, 0x5a6a6a);
addStructure("space_city_h3_blue_room", 40, 40, true, 0x4a6a8a);
addStructure("space_city_h4_black_room", 40, 40, true, 0x3a3a3a);
addStructure("space_city_ceo_office", 35, 30, true, 0x6a5a4a);
addStructure("space_city_central_command", 60, 40, true, 0x5a6a6a);
addStructure("space_city_dormitory", 55, 35, true, 0x5a6a5a);

// ─── Arena helpers ─────────────────────────────────────────────────────────
const ao = (type: string, x: number, y: number, ori = 0, scale = 1): ArenaObject => ({
    type,
    pos: v2.create(x / MAP_SIZE, y / MAP_SIZE),
    ori,
    scale,
});

// ─── Boundary polygon ──────────────────────────────────────────────────────
const BOUNDARY: ReadonlyArray<readonly [number, number]> = [
    [205, 165], [595, 165], [595, 440], [545, 440], [545, 515],
    [430, 515], [430, 655], [280, 655], [280, 580], [190, 580],
    [190, 220], [205, 220],
] as const;

const WALL_TYPE = "concrete_wall_ext_thicker_10";

function wallSegment(x0: number, y0: number, x1: number, y1: number): ArenaObject[] {
    const out: ArenaObject[] = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / WALL_STEP));
    const horizontal = Math.abs(dy) < Math.abs(dx);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        out.push(horizontal ? ao(WALL_TYPE, x, y) : ao(WALL_TYPE, x, y, 1));
    }
    return out;
}

const perimeterObjects: ArenaObject[] = [];
for (let i = 0; i < BOUNDARY.length; i++) {
    const [x0, y0] = BOUNDARY[i];
    const [x1, y1] = BOUNDARY[(i + 1) % BOUNDARY.length];
    perimeterObjects.push(...wallSegment(x0, y0, x1, y1));
}

const GATES: ReadonlyArray<{ x: number; y: number; r: number }> = [
    { x: 292, y: 337, r: 15 },
    { x: 327, y: 320, r: 12 },
    { x: 476, y: 320, r: 12 },
    { x: 489, y: 372, r: 12 },
];
const filteredPerimeter = perimeterObjects.filter((obj) => {
    const px = obj.pos.x * MAP_SIZE;
    const py = obj.pos.y * MAP_SIZE;
    return !GATES.some((g) => {
        const dx = px - g.x;
        const dy = py - g.y;
        return Math.sqrt(dx * dx + dy * dy) < g.r;
    });
});

// ─── POI positions ─────────────────────────────────────────────────────────
const POI = {
    dormitory: v2.create(256.5, 274.7),
    westernGate: v2.create(292.7, 336.7),
    centralCommand: v2.create(392.8, 215.0),
    employeePassage1: v2.create(327.4, 320.2),
    employeePassage2: v2.create(475.9, 320.2),
    centralBridge: v2.create(399.7, 268.9),
    printingRoom: v2.create(523.8, 250.4),
    assemblyRoom: v2.create(558.4, 265.2),
    hoistingRoom: v2.create(545.2, 306.5),
    buoyancyLab: v2.create(369.1, 340.2),
    testRange: v2.create(501.8, 416.5),
    centrifugeFacility: v2.create(361.5, 376.3),
    blueRoom: v2.create(434.9, 326.6),
    blackChamber: v2.create(420.4, 366.9),
    easternSuspensionBridge: v2.create(489.1, 372.5),
    horizontalTestWorkshop: v2.create(493.4, 496.3),
    launchArea: v2.create(334.5, 568.7),
    ceoOffice: v2.create(396.7, 370.5),
    waterTankStation: v2.create(537.5, 455.0),
} as const;

// ─── Water moat placement ──────────────────────────────────────────────────
const waterMoat: ArenaObject[] = [
    ao("space_city_water_north", 400, 298),
    ao("space_city_water_south", 400, 430),
    ao("space_city_water_west", 311, 364),
    ao("space_city_water_east", 489, 364),
];

// ─── Bridges ───────────────────────────────────────────────────────────────
const bridges: ArenaObject[] = [
    ao("space_city_bridge_central", 400, 290),
    ao("space_city_bridge_west", 327, 320),
    ao("space_city_bridge_east", 476, 320),
    ao("space_city_bridge_north", 400, 269),
    ao("space_city_bridge_south", 489, 372),
];

// ─── Launch pad ────────────────────────────────────────────────────────────
const launchPad: ArenaObject[] = [
    ao("space_city_launch_pad", 334, 569),
    ao("silo_01", 314, 554, 0, 0.9),
    ao("silo_01", 354, 554, 0, 0.9),
    ao("silo_01", 314, 584, 0, 0.9),
    ao("silo_01", 354, 584, 0, 0.9),
    ao("container_02", 294, 569, 1),
    ao("container_03", 374, 569, 1),
    ao("sandbags_01", 334, 544, 0),
    ao("sandbags_01", 334, 594, 0),
    ao("barrel_01", 319, 579),
    ao("barrel_01", 349, 559),
    ao("loot_tier_2", 334, 569),
    ao("loot_tier_1", 319, 559),
    ao("loot_tier_1", 349, 579),
    ao("loot_tier_2", 334, 559),
    ao("loot_tier_1", 319, 589),
];

// ─── H1-H4 Multi-level buildings ──────────────────────────────────────────
const h1Centrifuge: ArenaObject[] = [
    ao("space_city_h1_centrifuge", 361, 376),
    ao("loot_tier_2", 361, 376),
    ao("loot_tier_1", 351, 386),
    ao("loot_tier_1", 371, 366),
    ao("crate_04", 361, 386),
    ao("barrel_01", 351, 366),
    ao("safe_01", 371, 386),
];

const h2Buoyancy: ArenaObject[] = [
    ao("space_city_h2_buoyancy", 369, 340),
    ao("loot_tier_2", 369, 340),
    ao("loot_tier_1", 359, 350),
    ao("loot_tier_1", 379, 330),
    ao("crate_02", 369, 350),
    ao("barrel_01", 359, 330),
    ao("switch_02", 379, 350),
];

const h3BlueRoom: ArenaObject[] = [
    ao("space_city_h3_blue_room", 435, 327),
    ao("loot_tier_2", 435, 327),
    ao("loot_tier_1", 425, 337),
    ao("loot_tier_2", 445, 317),
    ao("safe_01", 435, 337),
    ao("crate_04", 425, 317),
    ao("barrel_01", 445, 337),
];

const h4BlackRoom: ArenaObject[] = [
    ao("space_city_h4_black_room", 420, 367),
    ao("loot_tier_2", 420, 367),
    ao("loot_tier_1", 410, 377),
    ao("loot_tier_2", 430, 357),
    ao("safe_01", 420, 377),
    ao("switch_02", 430, 357),
    ao("barrel_01", 410, 357),
];

const ceoOffice: ArenaObject[] = [
    ao("space_city_ceo_office", 397, 370),
    ao("loot_tier_2", 397, 370),
    ao("loot_tier_2", 387, 380),
    ao("safe_01", 407, 360),
    ao("crate_04", 387, 360),
    ao("barrel_01", 407, 380),
];

const centralCommand: ArenaObject[] = [
    ao("space_city_central_command", 393, 215),
    ao("loot_tier_2", 393, 215),
    ao("loot_tier_1", 383, 225),
    ao("loot_tier_2", 403, 205),
    ao("safe_01", 383, 205),
    ao("crate_01", 403, 225),
    ao("sandbags_01", 373, 215, 1),
    ao("sandbags_01", 413, 215, 1),
    ao("barrel_01", 393, 235),
    ao("switch_02", 393, 195),
];

const dormitory: ArenaObject[] = [
    ao("space_city_dormitory", 256, 275),
    ao("loot_tier_1", 256, 275),
    ao("loot_tier_2", 246, 285),
    ao("loot_tier_1", 266, 265),
    ao("crate_01", 246, 265),
    ao("crate_02", 266, 285),
    ao("barrel_01", 256, 295),
    ao("sandbags_01", 236, 275, 1),
    ao("hedgehog_01", 276, 275),
];

// ─── Single-level POIs ─────────────────────────────────────────────────────
function poiCluster(
    pos: Vec2,
    buildings: Array<{ type: string; dx: number; dy: number; ori?: number; scale?: number }>,
    loot: Array<{ type: string; dx: number; dy: number }>,
    cover: Array<{ type: string; dx: number; dy: number; ori?: number }>,
): ArenaObject[] {
    const out: ArenaObject[] = [];
    for (const b of buildings) out.push(ao(b.type, pos.x + b.dx, pos.y + b.dy, b.ori ?? 0, b.scale ?? 1));
    for (const l of loot) out.push(ao(l.type, pos.x + l.dx, pos.y + l.dy));
    for (const c of cover) out.push(ao(c.type, pos.x + c.dx, pos.y + c.dy, c.ori ?? 0));
    return out;
}

const printingRoom = poiCluster(POI.printingRoom,
    [{ type: "warehouse_03", dx: 0, dy: 0 }],
    [{ type: "loot_tier_1", dx: 0, dy: 15 }, { type: "loot_tier_1", dx: 15, dy: -5 }],
    [{ type: "crate_01", dx: -15, dy: 10 }, { type: "barrel_01", dx: 15, dy: 10 }]);

const assemblyRoom = poiCluster(POI.assemblyRoom,
    [{ type: "warehouse_02", dx: 0, dy: 0, ori: 1 }],
    [{ type: "loot_tier_2", dx: 0, dy: 20 }, { type: "loot_tier_1", dx: -15, dy: 10 }],
    [{ type: "crate_02", dx: 15, dy: 10 }, { type: "container_01", dx: 25, dy: 25 }]);

const hoistingRoom = poiCluster(POI.hoistingRoom,
    [{ type: "shack_01", dx: 0, dy: 0, ori: 1 }],
    [{ type: "loot_tier_1", dx: 0, dy: 15 }],
    [{ type: "crate_04", dx: 10, dy: 10 }, { type: "barrel_01", dx: -10, dy: 10 }]);

const testRange = poiCluster(POI.testRange,
    [{ type: "warehouse_02", dx: 0, dy: 0, ori: 1 }],
    [{ type: "loot_tier_2", dx: 0, dy: 15 }, { type: "loot_tier_1", dx: 15, dy: 0 }],
    [{ type: "sandbags_01", dx: -15, dy: 15 }, { type: "hedgehog_01", dx: 15, dy: 15 }]);

const testWorkshop = poiCluster(POI.horizontalTestWorkshop,
    [{ type: "warehouse_03", dx: 0, dy: 0 }],
    [{ type: "loot_tier_2", dx: 0, dy: 15 }, { type: "loot_tier_1", dx: 15, dy: 0 }],
    [{ type: "container_03", dx: -20, dy: 10 }, { type: "barrel_01", dx: 20, dy: 10 }]);

const waterTank = poiCluster(POI.waterTankStation,
    [{ type: "silo_01", dx: 0, dy: 0, scale: 0.8 }, { type: "silo_01", dx: 25, dy: 0, scale: 0.8 }],
    [{ type: "loot_tier_1", dx: 0, dy: 15 }],
    [{ type: "crate_01", dx: 10, dy: 15 }, { type: "barrel_01", dx: -10, dy: 15 }]);

const westernGate = poiCluster(POI.westernGate,
    [], [{ type: "loot_tier_1", dx: 0, dy: 8 }], [{ type: "hedgehog_01", dx: 8, dy: 0 }]);

const passage1 = poiCluster(POI.employeePassage1,
    [], [{ type: "loot_tier_1", dx: 0, dy: 8 }], [{ type: "sandbags_01", dx: 8, dy: 0, ori: 1 }]);

const passage2 = poiCluster(POI.employeePassage2,
    [], [{ type: "loot_tier_1", dx: 0, dy: 8 }], [{ type: "sandbags_01", dx: 8, dy: 0, ori: 1 }]);

const suspensionBridge = poiCluster(POI.easternSuspensionBridge,
    [], [{ type: "loot_tier_1", dx: 0, dy: 10 }], [{ type: "sandbags_01", dx: 10, dy: 0, ori: 1 }]);

// ─── Scattered cover ───────────────────────────────────────────────────────
const scatteredCover: ArenaObject[] = [
    ao("crate_01", 300, 190), ao("barrel_01", 330, 200),
    ao("sandbags_01", 450, 190, 1), ao("stone_04", 500, 200),
    ao("crate_02", 550, 200), ao("bush_01", 250, 200),
    ao("crate_02", 580, 350), ao("barrel_01", 570, 400),
    ao("sandbags_01", 570, 450, 1), ao("stone_04", 570, 480),
    ao("crate_01", 300, 620), ao("barrel_01", 350, 630),
    ao("sandbags_01", 400, 620, 1), ao("stone_04", 400, 640),
    ao("bush_01", 320, 640), ao("crate_04", 380, 640),
    ao("crate_04", 220, 350), ao("barrel_01", 210, 400),
    ao("sandbags_01", 220, 450, 1), ao("stone_04", 210, 480),
    ao("bush_01", 220, 500), ao("crate_01", 220, 520),
    ao("crate_02", 320, 250), ao("crate_02", 480, 250),
    ao("crate_02", 320, 450), ao("crate_02", 480, 450),
    ao("bush_01", 350, 250), ao("bush_01", 450, 250),
    ao("bush_01", 350, 450), ao("bush_01", 450, 450),
];

const allArenaObjects: ArenaObject[] = [
    ...filteredPerimeter,
    ...waterMoat,
    ...bridges,
    ...launchPad,
    ...h1Centrifuge,
    ...h2Buoyancy,
    ...h3BlueRoom,
    ...h4BlackRoom,
    ...ceoOffice,
    ...centralCommand,
    ...dormitory,
    ...printingRoom,
    ...assemblyRoom,
    ...hoistingRoom,
    ...testRange,
    ...testWorkshop,
    ...waterTank,
    ...westernGate,
    ...passage1,
    ...passage2,
    ...suspensionBridge,
    ...scatteredCover,
];

const playerSpawns = [
    v2.create(0.3, 0.25), v2.create(0.7, 0.25),
    v2.create(0.3, 0.75), v2.create(0.7, 0.75),
    v2.create(0.5, 0.22), v2.create(0.5, 0.78),
    v2.create(0.28, 0.5), v2.create(0.72, 0.5),
];

const mapPlaces = [
    { name: "宿舍楼", pos: POI.dormitory },
    { name: "中央控制楼", pos: POI.centralCommand },
    { name: "打印室", pos: POI.printingRoom },
    { name: "组装室", pos: POI.assemblyRoom },
    { name: "吊装室", pos: POI.hoistingRoom },
    { name: "浮力实验室", pos: POI.buoyancyLab },
    { name: "试验场", pos: POI.testRange },
    { name: "离心机室", pos: POI.centrifugeFacility },
    { name: "蓝室", pos: POI.blueRoom },
    { name: "黑室", pos: POI.blackChamber },
    { name: "总裁室", pos: POI.ceoOffice },
    { name: "水平试车间", pos: POI.horizontalTestWorkshop },
    { name: "发射区", pos: POI.launchArea },
    { name: "水罐站", pos: POI.waterTankStation },
].map((p) => ({ name: p.name, pos: v2.create(p.pos.x / MAP_SIZE, p.pos.y / MAP_SIZE) }));

export const SpaceCityClassic = util.mergeDeep({}, Main, {
    mapId: GameConfig.MapId.SpaceCity,
    desc: {
        name: "\u822A\u5929\u57FA\u5730",
        icon: "",
        buttonCss: "",
        buttonText: "space-city",
    },
    biome: {
        colors: {
            background: 0x1a222a,
            water: 0x173b4a,
            waterRipple: 0x5f9aaa,
            beach: 0x6b7370,
            riverbank: 0x3f4f55,
            grass: 0x50605a,
            underground: 0x172229,
            playerSubmerge: 0x173b4a,
            playerGhillie: 0x50605a,
        },
        valueAdjust: 0.88,
    },
    assets: { atlases: ["loadout", "shared", "main"] },
    gameMode: { maxPlayers: 24, killLeaderEnabled: false },
    /* STRIP_FROM_PROD_CLIENT:START */
    gameConfig: {
        planes: { timings: [], crates: [{ name: "airdrop_crate_01", weight: 10 }] },
        bagSizes: {},
        bleedDamage: 2,
        bleedDamageMult: 1,
    },
    lootTable: {
        tier_world: [
            { name: "tier_guns", count: 1, weight: 0.29 },
            { name: "tier_ammo", count: 1, weight: 0.08 },
            { name: "tier_scopes", count: 1, weight: 0.15 },
            { name: "tier_armor", count: 1, weight: 0.12 },
            { name: "tier_medical", count: 1, weight: 0.17 },
            { name: "tier_throwables", count: 1, weight: 0.05 },
            { name: "tier_packs", count: 1, weight: 0.09 },
        ],
    },
    mapGen: {
        map: {
            baseWidth: MAP_SIZE,
            baseHeight: MAP_SIZE,
            scale: { small: 1, large: 1 },
            extension: 0,
            shoreInset: 18,
            grassInset: 8,
            rivers: { lakes: [], weights: [{ weight: 1, widths: [] }], smoothness: 0.45, masks: [], spawnCabins: false },
        },
        places: mapPlaces,
        bridgeTypes: { medium: "", large: "", xlarge: "" },
        customSpawnRules: { locationSpawns: [], placeSpawns: [] },
        densitySpawns: [{}],
        fixedSpawns: [{}],
        randomSpawns: [{ spawns: [], choose: 0 }],
        spawnReplacements: [{}],
        importantSpawns: [],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
    arena: {
        playerSpawns,
        objects: allArenaObjects,
        loot: [],
    },
} satisfies PartialMapDef) as MapDef;
