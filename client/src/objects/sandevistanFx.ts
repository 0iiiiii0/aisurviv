import * as PIXI from "pixi.js-legacy";
import { GameConfig } from "../../../shared/gameConfig.ts";
import type { Player } from "./player.ts";
import type { SandevistanPostFilter } from "./sandevistanPostFilter.ts";

/**
 * Sandevistan implant client effects: a small state machine plus a pooled
 * 2D-sprite afterimage system and activation/deactivation flashes. Driven by
 * the authoritative server state (localData.sandevistanActive/Remaining/
 * Cooldown). Post-processing (chromatic aberration / distortion / motion
 * blur) is a later batch; the config keys already exist and the light CSS
 * fallback lives in index.html / game.css.
 */

type FxState =
    | "idle"
    | "activating"
    | "active"
    | "deactivating"
    | "cooldown"
    | "interrupted";

interface AfterimageSlot {
    root: PIXI.Container;
    main: PIXI.Container;
    edge: PIXI.Container;
    inUse: boolean;
    age: number;
    screenX: number;
    screenY: number;
    dirX: number;
    dirY: number;
    stretch: number;
    screenScale: number;
}

/** Remove and destroy every child of a container (shared textures survive). */
function clearContainerChildren(container: PIXI.Container): void {
    for (let i = container.children.length - 1; i >= 0; i--) {
        const child = container.children[i];
        container.removeChild(child);
        if (child instanceof PIXI.DisplayObject) {
            child.destroy({ children: true });
        }
    }
}

/** Recursively tint every sprite in a cloned tree. */
function tintTree(container: PIXI.Container, color: number): void {
    for (const child of container.children) {
        if (child instanceof PIXI.Sprite) {
            child.tint = color;
        } else if (child instanceof PIXI.Container) {
            tintTree(child, color);
        }
    }
}

/** Recursively clone a PIXI container tree into a static snapshot. */
function cloneDisplayTree(src: PIXI.Container): PIXI.Container {
    const safeChildren = (() => {
        try {
            return src.children.slice();
        } catch (_) {
            return [];
        }
    })();
    const out = new PIXI.Container();
    out.position.copyFrom(src.position);
    out.scale.copyFrom(src.scale);
    out.rotation = src.rotation;
    out.alpha = src.alpha;
    out.visible = src.visible;
    for (let i = 0; i < safeChildren.length; i++) {
        const child = safeChildren[i];
        if (child instanceof PIXI.Sprite) {
            const s = new PIXI.Sprite(child.texture);
            s.position.copyFrom(child.position);
            s.scale.copyFrom(child.scale);
            s.rotation = child.rotation;
            s.alpha = child.alpha;
            s.anchor.copyFrom(child.anchor);
            s.tint = child.tint;
            s.blendMode = child.blendMode;
            s.visible = child.visible;
            out.addChild(s);
        } else if (child instanceof PIXI.Container) {
            out.addChild(cloneDisplayTree(child));
        }
    }
    return out;
}

export class SandevistanFx {
    /** Afterimages live below the player in the character layer. */
    readonly afterimageContainer = new PIXI.Container();
    /** Activation flash / edge tint overlay (above world, below HUD). */
    readonly overlayContainer = new PIXI.Container();

    state: FxState = "idle";
    stateAge = 0;

    private poolSlots: AfterimageSlot[] = [];
    private spawnAccumulator = 0;
    private lastScreenX = 0;
    private lastScreenY = 0;
    private lastWorldX = 0;
    private lastWorldY = 0;
    private hasLastPos = false;
    private prevActive = false;
    private prevDowned = false;
    private postFilterTogglesInitialized = false;
    /** Exponential-moving-average world speed (units/s) used as the movement gate. */
    private emaSpeed = 0;

    private flash = new PIXI.Graphics();
    private flashAge = 999;
    private overlayPunch = 1;
    private overlayPunchAge = 999;
    /** Flash alpha multiplier; scaled by how strongly the world is slowed. */
    private flashIntensity = 1;
    /** Live worldTimeScale (0.1 = max slowdown). Falls back to the shared default. */
    private currentWorldScale = Number(GameConfig.player.sandevistan.worldTimeScale) || 0.1;

    constructor(
        private postFilter: SandevistanPostFilter | null = null,
        private stage: PIXI.Container | null = null,
        private screen: PIXI.Rectangle | null = null,
    ) {
        this.afterimageContainer.interactiveChildren = false;
        this.overlayContainer.interactiveChildren = false;

        this.flash.visible = false;
        this.flash.blendMode = PIXI.BLEND_MODES.ADD;
        this.overlayContainer.addChild(this.flash);

        // Pre-allocate the afterimage object pool (cyan main + purple edge).
        const slotCount = Math.max(4, Math.min(32, GameConfig.player.sandevistan.afterimageMaxCount || 14));
        for (let i = 0; i < slotCount; i++) {
            const root = new PIXI.Container();
            const main = new PIXI.Container();
            const edge = new PIXI.Container();
            root.addChild(edge, main);
            root.visible = false;
            root.interactiveChildren = false;
            this.afterimageContainer.addChild(root);
            this.poolSlots.push({
                root,
                main,
                edge,
                inUse: false,
                age: 0,
                screenX: 0,
                screenY: 0,
                dirX: 1,
                dirY: 0,
                stretch: 0,
                screenScale: 1,
            });
        }
    }

    /** Immediate cleanup for death / spectate / map switch / disconnect. */
    reset(): void {
        for (const slot of this.poolSlots) {
            slot.inUse = false;
            slot.age = 0;
            slot.root.visible = false;
            clearContainerChildren(slot.main);
            clearContainerChildren(slot.edge);
        }
        if (this.stage) {
            this.stage.filters = null;
        }
        this.hideFlash();
        this.overlayContainer.scale.set(1, 1);
        this.state = "idle";
        this.stateAge = 0;
        this.prevActive = false;
        this.prevDowned = false;
        this.hasLastPos = false;
        this.emaSpeed = 0;
    }

    update(
        dt: number,
        player: Player | null,
        playing: boolean,
        sandevistanMode: boolean,
        worldScale = this.currentWorldScale,
    ): void {
        const cfg = GameConfig.player.sandevistan;
        if (Number.isFinite(worldScale) && worldScale > 0 && worldScale <= 1) {
            this.currentWorldScale = worldScale;
        }

        if (
            !playing
            || !player
            || !sandevistanMode
            || player.m_netData.m_dead
            || player.m_netData.m_downed
        ) {
            if (this.state !== "idle" && this.state !== "interrupted") {
                this.state = "interrupted";
                this.reset();
            }
            return;
        }

        const sand = player.m_localData;
        const active = Boolean(sand.m_sandevistanActive);
        const cooldown = Math.max(0, Number(sand.m_sandevistanCooldown) || 0);

        // Downed while active: force interrupt (no fake control).
        if (player.m_netData.m_downed && !this.prevDowned) {
            this.reset();
        }
        this.prevDowned = Boolean(player.m_netData.m_downed);

        // Edge transitions from server state.
        if (active && !this.prevActive) {
            this.beginActivating(cfg);
        } else if (!active && this.prevActive) {
            this.beginDeactivating(cfg);
        }
        this.prevActive = active;
        this.stateAge += dt;

        // State progression.
        switch (this.state) {
            case "activating":
                if (this.stateAge >= cfg.activationDuration) this.state = "active";
                break;
            case "deactivating":
                if (this.stateAge >= cfg.deactivationDuration) {
                    this.state = cooldown > 0 ? "cooldown" : "idle";
                    this.hideFlash();
                }
                break;
            case "active":
                if (!active) this.beginDeactivating(cfg);
                break;
            case "cooldown":
                if (cooldown <= 0 && !active) this.state = "idle";
                break;
            case "interrupted":
                if (!active && cooldown <= 0) this.state = "idle";
                break;
            default:
                break;
        }

        try {
            this.updatePostFilter(dt, player, active, cfg);
            this.updateAfterimages(dt, player, active, cfg);
            this.updateFlash(dt, cfg);
            this.updatePunch(dt);
        } catch (error) {
            // Visual effects must never crash the game loop.
            console.error("Sandevistan fx step failed:", error);
        }
    }

    private beginActivating(cfg: typeof GameConfig.player.sandevistan): void {
        this.state = "activating";
        this.stateAge = 0;
        // Short cyan pulse + slight punch-in.
        const intensity = this.slowIntensity();
        this.flashIntensity = Math.max(0.35, intensity);
        this.drawFlash(
            cfg.afterimageColor,
            Math.max(6, cfg.cameraShakeStrength * 7 * this.flashIntensity),
            cfg.activationDuration,
        );
        this.overlayPunch = 1 + cfg.cameraFovBoost * Math.max(0.3, intensity);
        this.overlayPunchAge = 0;
        this.hasLastPos = false;
        if (cfg.activationSound) {
            // Audio slot reserved; assets land in batch 3.
        }
    }

    private beginDeactivating(cfg: typeof GameConfig.player.sandevistan): void {
        this.state = "deactivating";
        this.stateAge = 0;
        this.overlayPunch = 1 - cfg.cameraFovBoost * 0.6 * Math.max(0.3, this.slowIntensity());
        this.overlayPunchAge = 0;
        if (cfg.deactivationSound) {
            // Audio slot reserved.
        }
    }

    private drawFlash(color: number, radius: number, duration: number): void {
        this.flash.clear();
        this.flash.beginFill(color, 1);
        this.flash.drawCircle(0, 0, radius);
        this.flash.endFill();
        this.flash.visible = true;
        this.flash.x = this.lastScreenX;
        this.flash.y = this.lastScreenY;
        this.flashAlpha = duration;
    }

    private flashAlpha = 0;

    private hideFlash(): void {
        this.flash.visible = false;
        this.flashAlpha = 0;
    }

    private updateFlash(dt: number, cfg: typeof GameConfig.player.sandevistan): void {
        if (this.flashAlpha <= 0) return;
        this.flashAlpha -= dt;
        const t = Math.max(0, this.flashAlpha);
        this.flash.alpha = Math.max(0, Math.min(0.5, t / (cfg.activationDuration || 0.2)))
            * this.flashIntensity;
        const s = Math.max(0.6, 2.2 - t * 6);
        this.flash.scale.set(s, s);
        if (this.flashAlpha <= 0) this.hideFlash();
    }

    private updatePunch(dt: number): void {
        if (this.overlayPunchAge > 0.22) {
            this.overlayPunch = 1;
            return;
        }
        this.overlayPunchAge += dt;
        const k = Math.max(0, 1 - this.overlayPunchAge / 0.22);
        const target = this.state === "deactivating"
            ? 1 - (1 - this.overlayPunch) * k
            : 1 + (this.overlayPunch - 1) * k;
        this.overlayContainer.scale.set(target, target);
    }

    private updatePostFilter(
        dt: number,
        player: Player,
        active: boolean,
        cfg: typeof GameConfig.player.sandevistan,
    ): void {
        if (!this.postFilter) return;
        if (!this.postFilterTogglesInitialized) {
            this.postFilter.setToggles(
                cfg.chromaticAberrationEnabled,
                cfg.distortionEnabled,
                cfg.motionBlurEnabled,
            );
            this.postFilterTogglesInitialized = true;
        }
        // Target strength by state: full while active, fading during
        // deactivation, zero otherwise.
        const intensity = this.slowIntensity();
        const target = this.state === "activating" || this.state === "active"
            ? 1
            : this.state === "deactivating"
            ? 0.35
            : 0;
        // Dizziness scales with how strongly the world is slowed: a 10x
        // slow-motion hits at full strength, a milder slow-motion feels softer.
        const scaledTarget = target * (0.45 + 0.55 * intensity);
        const current = this.postFilter.setAmount(scaledTarget, dt);
        const mounted = Boolean(this.stage?.filters && this.stage.filters.length > 0);
        if (current > 0.001 && !mounted && this.stage && this.screen) {
            this.stage.filterArea = this.screen;
            this.stage.filters = [this.postFilter];
        } else if (current <= 0.001 && mounted && this.stage) {
            this.stage.filters = null;
        }
        this.postFilter.advance(dt);
        void active;
    }

    /**
     * 0..1 dizziness factor derived from the current world slow-motion:
     * worldTimeScale 0.1 (10%) → 1.0 (strongest), 1.0 (no slow) → 0.
     */
    private slowIntensity(): number {
        const scale = this.currentWorldScale;
        return Math.max(0, Math.min(1, (1 - scale) / 0.9));
    }

    private updateAfterimages(
        dt: number,
        player: Player,
        active: boolean,
        cfg: typeof GameConfig.player.sandevistan,
    ): void {
        const px = Number(player.container.position.x) || 0;
        const py = Number(player.container.position.y) || 0;
        const wx = Number(player.m_pos?.x);
        const wy = Number(player.m_pos?.y);
        const worldX = Number.isFinite(wx) ? wx : px;
        const worldY = Number.isFinite(wy) ? wy : py;

        // Spawn while active and moving. Server positions arrive at ~33Hz while
        // the client renders at 60Hz, so the raw per-frame speed alternates
        // between a jump (new position) and zero (no new position). A plain
        // per-frame speed gate would reset the spawn accumulator every other
        // frame and no afterimage would ever spawn. Track an exponential
        // moving average instead: a moving player stays reliably above
        // afterimageMinDistance, a stopped player decays below it quickly, and
        // the fixed afterimageSpawnInterval cadence is preserved.
        if (active && cfg.afterimageEnabled && cfg.afterimageMaxCount > 0) {
            const travelled = this.hasLastPos
                ? Math.hypot(worldX - this.lastWorldX, worldY - this.lastWorldY)
                : 0;
            const instSpeed = dt > 0.0001 ? travelled / dt : 0;
            const tau = Math.max(0.1, cfg.afterimageSpawnInterval);
            const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
            this.emaSpeed = instSpeed * k + this.emaSpeed * (1 - k);
            const moving = this.emaSpeed >= cfg.afterimageMinDistance;
            if (moving) {
                this.spawnAccumulator += dt;
            } else {
                this.spawnAccumulator = 0;
            }
            if (
                this.hasLastPos
                && moving
                && this.spawnAccumulator >= cfg.afterimageSpawnInterval
            ) {
                this.spawnAfterimage(player, px, py, cfg);
                this.spawnAccumulator = 0;
            }
            this.lastWorldX = worldX;
            this.lastWorldY = worldY;
            this.lastScreenX = px;
            this.lastScreenY = py;
            this.hasLastPos = true;
        } else if (this.state !== "deactivating") {
            this.hasLastPos = false;
            this.emaSpeed = 0;
        }

        // Age + dissolve every pooled afterimage; recycle fully faded slots.
        for (const slot of this.poolSlots) {
            if (!slot.inUse) continue;
            slot.age += dt;
            const t = slot.age / Math.max(0.05, cfg.afterimageLifetime);
            if (t >= 1) {
                slot.inUse = false;
                slot.root.visible = false;
                clearContainerChildren(slot.main);
                clearContainerChildren(slot.edge);
                continue;
            }
            const fade = Math.pow(1 - t, cfg.afterimageFadeCurve);
            slot.root.alpha = fade * cfg.afterimageOpacity;
            // Directional stretch along the recorded movement, on top of the
            // camera screen scale so afterimages stay the player's size.
            const stretch = 1 + slot.stretch * (1 - t);
            slot.root.scale.set(
                slot.screenScale * (Math.abs(slot.dirX) > 0.6 ? stretch : 1),
                slot.screenScale * (Math.abs(slot.dirY) > 0.6 ? stretch : 1),
            );
        }
    }

    private spawnAfterimage(player: Player, px: number, py: number, cfg: typeof GameConfig.player.sandevistan): void {
        // Acquire a free pooled slot, otherwise steal the oldest in-use one.
        let slot = this.poolSlots.find((candidate) => !candidate.inUse) ?? null;
        if (!slot) {
            let oldestAge = -1;
            for (const candidate of this.poolSlots) {
                if (candidate.inUse && candidate.age > oldestAge) {
                    oldestAge = candidate.age;
                    slot = candidate;
                }
            }
        }
        if (!slot) return;

        clearContainerChildren(slot.main);
        clearContainerChildren(slot.edge);

        // Cyan-blue main body snapshot (full pose at generation time).
        const mainClone = cloneDisplayTree(player.bodyContainer);
        tintTree(mainClone, cfg.afterimageColor);
        slot.main.addChild(mainClone);

        // Purple/magenta edge layer (slightly enlarged, dissolving rim).
        if (cfg.afterimageEdgeColor && cfg.afterimageDissolveStrength > 0) {
            const edgeClone = cloneDisplayTree(player.bodyContainer);
            tintTree(edgeClone, cfg.afterimageEdgeColor);
            edgeClone.scale.set(1.04, 1.04);
            edgeClone.alpha = Math.min(0.55, cfg.afterimageDissolveStrength);
            slot.edge.addChild(edgeClone);
            slot.edge.visible = true;
        } else {
            slot.edge.visible = false;
        }

        const baseScale = Number(player.container.scale.x) || 1;
        slot.root.position.set(px, py);
        slot.root.scale.set(baseScale, baseScale);
        slot.root.rotation = player.container.rotation;
        slot.root.alpha = cfg.afterimageOpacity;
        slot.root.visible = true;
        slot.inUse = true;
        slot.age = 0;
        slot.screenX = px;
        slot.screenY = py;
        slot.screenScale = baseScale;

        const stretch = Math.min(0.45, Math.hypot(px - this.lastScreenX, py - this.lastScreenY) * 0.04);
        const dirX = px - this.lastScreenX;
        const dirY = py - this.lastScreenY;
        const len = Math.hypot(dirX, dirY) || 1;
        slot.dirX = dirX / len;
        slot.dirY = dirY / len;
        slot.stretch = stretch;
    }
}
