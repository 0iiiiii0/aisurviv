import * as PIXI from "pixi.js-legacy";
import highResAtlasDefs from "virtual-atlases-high";
import { GearDefs } from "../../shared/defs/gameObjects/gearDefs.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { OutfitDefs } from "../../shared/defs/gameObjects/outfitDefs.ts";

interface StorageLoadout {
    guns: string[];
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
}

/**
 * Renders the same player character seen in-game (PIXI sprites assembled from
 * the loadout atlas: body / hands / feet / helmet / chest / backpack / weapon)
 * so the stash screen shows the actual game avatar instead of a CSS dummy.
 */
export class StoragePlayer {
    private readonly app: PIXI.Application;
    private readonly root: PIXI.Container;
    private readonly body: PIXI.Sprite;
    private readonly handL: PIXI.Sprite;
    private readonly handR: PIXI.Sprite;
    private readonly footL: PIXI.Sprite;
    private readonly footR: PIXI.Sprite;
    private readonly chest: PIXI.Sprite;
    private readonly helmet: PIXI.Sprite;
    private readonly backpack: PIXI.Sprite;
    private readonly weapon: PIXI.Sprite;
    readonly ready: Promise<void>;

    /**
     * 比例完全参照游戏内实际渲染（zoom=1 时身体屏幕直径 68px）：
     * 展示按 k = 展示身体直径 / 68 放大，所有部件 scale 与挂点
     * 都是游戏内数值 × k。
     */
    private static readonly gameBodyPx = 68;
    private static readonly bodyPx = 150;
    private static readonly k = StoragePlayer.bodyPx / StoragePlayer.gameBodyPx; // ≈2.206
    private static readonly bodyScale = StoragePlayer.bodyPx / 136; // ≈1.103
    private static readonly handScale = 0.175 * StoragePlayer.k;
    private static readonly handRadius = (74 / 2) * StoragePlayer.handScale;
    private static readonly chestScale = 0.215 * StoragePlayer.k;
    private static readonly helmetScale = 0.15 * StoragePlayer.k;
    private static readonly backpackScale = 0.215 * StoragePlayer.k;
    private static readonly pose = {
        // fists（空手）：双手挂在身体右前缘，上下各一
        fistsHandL: {
            x: 14 * StoragePlayer.k,
            y: -12.25 * StoragePlayer.k,
        },
        fistsHandR: {
            x: 14 * StoragePlayer.k,
            y: 12.25 * StoragePlayer.k,
        },
        // rifle（持枪）：双手在身体边缘握枪
        rifleHandL: {
            x: 28 * StoragePlayer.k,
            y: 5.25 * StoragePlayer.k,
        },
        rifleHandR: {
            x: 14 * StoragePlayer.k,
            y: 1.75 * StoragePlayer.k,
        },
    };

    constructor(parent: HTMLElement) {
        this.app = new PIXI.Application({
            width: 280,
            height: 230,
            backgroundAlpha: 0,
            antialias: true,
            autoStart: true,
        });
        parent.appendChild(this.app.view as HTMLCanvasElement);

        this.root = new PIXI.Container();
        this.app.stage.addChild(this.root);

        this.body = new PIXI.Sprite();
        this.handL = new PIXI.Sprite();
        this.handR = new PIXI.Sprite();
        this.footL = new PIXI.Sprite();
        this.footR = new PIXI.Sprite();
        this.chest = new PIXI.Sprite();
        this.helmet = new PIXI.Sprite();
        this.backpack = new PIXI.Sprite();
        this.weapon = new PIXI.Sprite();

        for (
            const sprite of [
                this.footL,
                this.footR,
                // 游戏内层级：脚 → 背包（身后）→ 身体 → 胸甲 → 武器 → 手 → 头盔
                this.backpack,
                this.body,
                this.chest,
                this.weapon,
                this.handL,
                this.handR,
                this.helmet,
            ]
        ) {
            sprite.anchor.set(0.5, 0.5);
            sprite.visible = false;
            this.root.addChild(sprite);
        }

        this.ready = this.loadLoadoutAtlas().then(() => {
            // Default outfit.
            const outfit = OutfitDefs.outfitBase;
            const skin = outfit.skinImg;
            this.body.texture = PIXI.Texture.from(skin.baseSprite);
            this.body.tint = skin.baseTint;
            this.body.scale.set(
                StoragePlayer.bodyScale,
                StoragePlayer.bodyScale,
            );
            for (const hand of [this.handL, this.handR]) {
                hand.texture = PIXI.Texture.from(skin.handSprite);
                hand.tint = skin.handTint;
                hand.scale.set(
                    StoragePlayer.handScale,
                    StoragePlayer.handScale,
                );
            }
            for (const foot of [this.footL, this.footR]) {
                foot.texture = PIXI.Texture.from(skin.footSprite);
                foot.tint = skin.footTint;
                foot.scale.set(
                    0.45 * StoragePlayer.k,
                    0.45 * StoragePlayer.k,
                );
                foot.rotation = Math.PI * 0.5;
            }
            // 站立时游戏内不显示脚部贴图（身体已含腿部）。
            this.footL.visible = false;
            this.footR.visible = false;
            this.body.visible = true;
            this.handL.visible = false;
            this.handR.visible = false;
            this.fitToFrame();
        });
    }

    /**
     * Scales and centers the whole character so the entire body (including
     * hands, feet and the equipped weapon, whose length varies by gun) fits
     * inside the canvas with a small margin.
     */
    private fitToFrame(): void {
        const margin = 14;
        this.root.scale.set(1, 1);
        this.root.position.set(0, 0);
        let bounds;
        try {
            bounds = this.root.getBounds();
        } catch {
            return;
        }
        if (
            !bounds
            || bounds.width <= 0
            || bounds.height <= 0
            || !Number.isFinite(bounds.width)
        ) {
            return;
        }
        const availW = Math.max(1, this.app.screen.width - margin * 2);
        const availH = Math.max(1, this.app.screen.height - margin * 2);
        // 展示用途：角色最多占画布的 62%，避免过大。
        const maxFill = 0.62;
        const scale = Math.min(
            maxFill,
            availW / bounds.width,
            availH / bounds.height,
        );
        this.root.scale.set(scale, scale);
        this.root.position.set(
            this.app.screen.width / 2 - (bounds.x + bounds.width / 2) * scale,
            this.app.screen.height / 2 - (bounds.y + bounds.height / 2) * scale,
        );
    }

    private loadLoadoutAtlas(): Promise<void> {
        const defs = highResAtlasDefs as unknown as Record<
            string,
            PIXI.ISpritesheetData[]
        >;
        const loadOne = (data: PIXI.ISpritesheetData): Promise<void> =>
            new Promise((resolve, reject) => {
                const baseTex = PIXI.Texture.from(data.meta.image!).baseTexture;
                const parse = (): void => {
                    const sheet = new PIXI.Spritesheet(baseTex, data);
                    void sheet.parse().then(() => resolve(), reject);
                };
                if (baseTex.valid) {
                    parse();
                    return;
                }
                baseTex.once("loaded", parse);
                baseTex.once("error", reject);
            });
        const sheets = [...(defs.loadout ?? []), ...(defs.shared ?? [])];
        return Promise.all(sheets.map(loadOne)).then(() => undefined);
    }

    updateLoadout(loadout: StorageLoadout): void {
        void this.ready.then(() => {
            const guns = loadout.guns ?? [];
            const armor = loadout.armor ?? {};

            // Chest armor.
            const chestType = armor.chest;
            const chestDef = chestType
                ? (GearDefs as Record<string, { skinImg?: { baseSprite?: string; baseTint?: number } }>)[chestType]
                : undefined;
            if (chestDef?.skinImg?.baseSprite) {
                this.chest.texture = PIXI.Texture.from(chestDef.skinImg.baseSprite);
                this.chest.tint = chestDef.skinImg.baseTint ?? 0xffffff;
                this.chest.scale.set(
                    StoragePlayer.chestScale,
                    StoragePlayer.chestScale,
                );
                this.chest.visible = true;
            } else {
                this.chest.visible = false;
            }

            // Helmet (circle sprite above the head, same as in-game).
            const helmetType = armor.helmet;
            const helmetDef = helmetType
                ? (GearDefs as Record<string, { skinImg?: { baseSprite?: string; baseTint?: number } }>)[helmetType]
                : undefined;
            if (helmetDef?.skinImg?.baseSprite) {
                this.helmet.texture = PIXI.Texture.from(helmetDef.skinImg.baseSprite);
                this.helmet.tint = helmetDef.skinImg.baseTint ?? 0xffffff;
                // 游戏内：位置 (-3.33, 0)，缩放 0.15（zoom=1）。
                this.helmet.scale.set(
                    StoragePlayer.helmetScale,
                    StoragePlayer.helmetScale,
                );
                this.helmet.position.set(-3.33 * StoragePlayer.k, 0);
                this.helmet.visible = true;
            } else {
                this.helmet.visible = false;
            }

            // Backpack (circle sprite behind the body, in-game style).
            const backpackType = armor.backpack;
            if (backpackType) {
                this.backpack.texture = PIXI.Texture.from(
                    "player-circle-base-01.img",
                );
                this.backpack.tint = OutfitDefs.outfitBase.skinImg.backpackTint;
                // 背包挂在身体左后缘（贴边缘），尺寸随身体基准缩放。
                this.backpack.scale.set(
                    StoragePlayer.backpackScale,
                    StoragePlayer.backpackScale,
                );
                // 游戏内：位置 (-10.25, 0)（身体左后，1 级包）。
                this.backpack.position.set(-10.25 * StoragePlayer.k, 0);
                this.backpack.visible = true;
            } else {
                this.backpack.visible = false;
            }

            // 武器槽固定 2 槽位（空槽为空串）：优先显示 1 号位（主武器），
            // 空槽回退到 2 号位；双枪形态（"_dual"）按该武器定义渲染。
            const gunType = guns[0] || guns[1] || "";
            const gunDef = gunType
                ? (GunDefs as Record<
                    string,
                    { worldImg?: { sprite?: string; tint?: number; scale?: { x: number; y: number } } }
                >)[gunType]
                : undefined;
            if (gunDef?.worldImg?.sprite) {
                this.weapon.texture = PIXI.Texture.from(gunDef.worldImg.sprite);
                this.weapon.tint = gunDef.worldImg.tint ?? 0xffffff;
                const gunScale = gunDef.worldImg.scale ?? { x: 0.5, y: 0.435 };
                // 与身体同一基准：游戏内枪相对身体 68px 的比例，
                // 按展示身体尺寸等比换算（worldImg.scale × bodyScale）。
                this.weapon.scale.set(
                    gunScale.x * StoragePlayer.bodyScale,
                    gunScale.y * StoragePlayer.bodyScale,
                );
                // 游戏内持枪：枪在左手（HandL rifle 骨骼），贴图旋转 90° 水平。
                // anchor(0.5, 1)：枪托在手上，枪身向身体外（右）延伸。
                this.weapon.anchor.set(0.5, 1);
                this.weapon.rotation = Math.PI * 0.5;
                this.weapon.position.set(
                    StoragePlayer.pose.rifleHandL.x,
                    StoragePlayer.pose.rifleHandL.y,
                );
                this.weapon.visible = true;
                // 双手握枪（rifle 骨骼）。
                this.handL.position.set(
                    StoragePlayer.pose.rifleHandL.x,
                    StoragePlayer.pose.rifleHandL.y,
                );
                this.handR.position.set(
                    StoragePlayer.pose.rifleHandR.x,
                    StoragePlayer.pose.rifleHandR.y,
                );
                this.handL.visible = true;
                this.handR.visible = true;
            } else {
                this.weapon.visible = false;
                // 空手：fists 骨骼。
                this.handL.position.set(
                    StoragePlayer.pose.fistsHandL.x,
                    StoragePlayer.pose.fistsHandL.y,
                );
                this.handR.position.set(
                    StoragePlayer.pose.fistsHandR.x,
                    StoragePlayer.pose.fistsHandR.y,
                );
                this.handL.visible = true;
                this.handR.visible = true;
            }
            this.fitToFrame();
        });
    }

    destroy(): void {
        this.app.destroy(true, { children: true });
    }
}
