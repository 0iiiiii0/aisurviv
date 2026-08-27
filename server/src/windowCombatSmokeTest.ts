import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousSecret = { ...Config.extractionSecret };

function joinHuman(game: Game, name: string): Player {
    game.addJoinToken(`wc-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `wc-${name}`;
    msg.name = name;
    const p = game.playerBarn.addPlayer(`${name}-sock`, msg);
    if (!p) throw new Error(`failed to join ${name}`);
    return p;
}

/** 在 Boss 与目标之间的固定位置放置一块障碍（bounds 为局部坐标）。 */
function placeBlocker(
    game: Game,
    type: string,
): { object: unknown; remove(): void } {
    const object = {
        __type: ObjectType.Obstacle,
        dead: false,
        collidable: true,
        layer: 0,
        pos: { x: 312.5, y: 300 },
        type,
        bounds: { min: { x: -2, y: -5 }, max: { x: 3, y: 5 } },
    };
    game.objectRegister.objects.push(object as never);
    return {
        object,
        remove() {
            const idx = game.objectRegister.objects.indexOf(object as never);
            if (idx >= 0) game.objectRegister.objects.splice(idx, 1);
        },
    };
}

void (async () => {
    try {
        Config.extractionSecret.enabled = true;
        Config.extractionBoss.enabled = true;
        Config.extractionBoss.maxHealth = 800;
        Config.extractionBoss.bossDefaultPerks = ["steelskin", "flak_jacket", "gotw"];
        Config.extractionBoss.bossPerks = ["firepower"];
        Config.extractionBoss.bossPositions = {};
        Config.extractionBoss.weapons = [{ type: "m249", count: 1 }];
        Config.extractionBoss.dropItems = [];

        const game = new Game(
            `window-combat-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction_secret", teamMode: TeamMode.Solo },
            () => {},
            () => {},
        );
        await game.init();
        const boss = (
            game.playerBarn.players.filter(
                (p) => (p as unknown as { isBoss?: boolean }).isBoss === true,
            ) as Player[]
        )[0];
        assert.ok(boss, "boss must spawn");
        boss.pos.x = 300;
        boss.pos.y = 300;
        boss.layer = 0;
        boss.aimLayer = 0;
        (boss as unknown as { bossPatrolCenter: { x: number; y: number } }).bossPatrolCenter = {
            x: 300,
            y: 300,
        };
        // 清障：测试区域（295-335 方块）内真实障碍标记 dead，保证视线干净。
        for (const obj of game.objectRegister.objects) {
            const o = obj as unknown as {
                __type?: number;
                dead?: boolean;
                collidable?: boolean;
                pos?: { x: number; y: number };
                bounds?: { min?: { x: number; y: number }; max?: { x: number; y: number } };
            };
            const isSolid =
                o.collidable === true ||
                o.__type === ObjectType.Building ||
                o.__type === ObjectType.Structure;
            if (!isSolid) continue;
            if (o.bounds?.min && o.bounds?.max) {
                const wMin = {
                    x: o.bounds.min.x + (o.pos?.x ?? 0),
                    y: o.bounds.min.y + (o.pos?.y ?? 0),
                };
                const wMax = {
                    x: o.bounds.max.x + (o.pos?.x ?? 0),
                    y: o.bounds.max.y + (o.pos?.y ?? 0),
                };
                if (wMin.x < 335 && wMax.x > 295 && wMin.y < 335 && wMax.y > 295) {
                    o.dead = true;
                }
            }
        }
        stashManager.addItem("WinTarget", "m4a1", 1);
        stashManager.setLoadout("WinTarget", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human = joinHuman(game, "WinTarget");
        human.pos.x = 325;
        human.pos.y = 300;
        human.layer = 0;
        const updateBossAI = () =>
            (
                game as unknown as {
                    updateBossAI(dt: number): void;
                }
            ).updateBossAI(1 / 30);

        // 基线：无遮挡 → Boss 直接开枪。
        updateBossAI();
        assert.equal(boss.shootStart, true, "baseline: boss must fire at an open human");
        assert.ok(Math.abs(boss.dir.x - 1) < 0.01, "boss must aim at the human");

        // 场景 A：窗户（house_window_01，1hp 玻璃，一发碎后穿透）→ 必须隔窗开枪。
        const win = placeBlocker(game, "house_window_01");
        updateBossAI();
        assert.equal(
            boss.shootStart,
            true,
            "boss must attack an enemy through an intact window (bullet shatters it)",
        );
        win.remove();

        // 场景 B：玻璃墙（glass_wall_10，50hp 实心玻璃）→ 不开枪傻射（需打碎/绕行）。
        const glassWall = placeBlocker(game, "glass_wall_10");
        updateBossAI();
        assert.equal(
            boss.shootStart,
            false,
            "boss must NOT waste fire on a glass wall that blocks bullets",
        );
        glassWall.remove();

        // 场景 C：木墙（实心）→ 不开枪。
        const wood = placeBlocker(game, "wall_wood_01");
        updateBossAI();
        assert.equal(boss.shootStart, false, "boss must not fire through a solid wall");
        wood.remove();

        // 拆墙后恢复开枪。
        updateBossAI();
        assert.equal(boss.shootStart, true, "boss must resume fire after blocker removal");

        console.log(
            "Window combat smoke test passed: fire through window, hold fire on glass wall/solid wall",
        );
    } finally {
        Config.extractionBoss = previousBoss;
        Config.extractionSecret = previousSecret;
        stashManager.removePlayer("WinTarget");
    }
})();
