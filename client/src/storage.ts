import $ from "jquery";
import * as PIXI from "pixi.js-legacy";
import highResAtlasDefs from "virtual-atlases-high";
import { loadout as loadouts } from "../../shared/utils/loadout.ts";
import { AudioManager } from "./audioManager.ts";
import { ConfigManager } from "./config.ts";
import {
    bindShopEvents,
    bindStashEvents,
    currentLoadout,
    getCookie,
    loadShop,
    loadStash,
    persistLoadout,
    renderShopSell,
    sessionDisplayName,
    sessionToken,
    setCookie,
    setCurrentName,
    setOnLoadoutChanged,
    setStatus,
} from "./extractionStashUi.ts";
import { InputHandler } from "./input.ts";
import { InputBinds } from "./inputBinds.ts";
import { StoragePlayer } from "./storagePlayer.ts";
import { LoadoutDisplay } from "./ui/opponentDisplay.ts";

/**
 * 独立全屏仓库页面（/storage）：
 * - 左栏：与主界面「示例载入」相同的方式渲染示例人物
 *   （完整 Player 渲染管线：骨骼/贴图/装备/武器），展示当前配装；
 * - 右栏：仓库全部物资（图片 + 数量）。
 */

async function loadPreviewAtlases(): Promise<void> {
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
    // All player, gear and weapon sprites live in these two atlases. Loading
    // every map/theme atlas caused duplicate-cache warnings and did no useful
    // work now that the storage preview never renders a map.
    const sheets = [...(defs.loadout ?? []), ...(defs.shared ?? [])];
    await Promise.all(sheets.map(loadOne));
}

async function createLoadoutDisplay(
    canvasHost: HTMLElement,
): Promise<LoadoutDisplay | null> {
    try {
        await loadPreviewAtlases();
    } catch (error) {
        setStatus(
            `贴图加载失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
        return null;
    }
    const pixi = new PIXI.Application({
        width: 280,
        height: 230,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: true,
    });
    canvasHost.appendChild(pixi.view as HTMLCanvasElement);

    const config = new ConfigManager();
    config.load(() => undefined);
    const audioManager = new AudioManager();
    const input = new InputHandler(document.body);
    const inputBinds = new InputBinds(input, config);
    const accountStub = {
        loadout: loadouts.defaultLoadout(),
        addEventListener: () => undefined,
    } as unknown as ConstructorParameters<typeof LoadoutDisplay>[4];

    const display = new LoadoutDisplay(
        pixi,
        audioManager,
        config,
        inputBinds,
        accountStub,
    );
    display.playerOnlyPreview = true;
    try {
        display.init();
    } catch (error) {
        console.error("LoadoutDisplay init failed:", error);
        setStatus(
            `示例人物初始化失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
        pixi.destroy(true, { children: true });
        return null;
    }
    display.show();
    // The isolated preview does not load or play UI sounds.
    display.activePlayer.playActionStartSfx = false;
    // 仓库画布使用局部坐标；人物固定在 280×230 画布正中心。
    display.previewCameraCenter = {
        x: pixi.screen.width / 2,
        y: pixi.screen.height / 2,
    };
    display.camera.m_zoom = 1.5;
    display.camera.m_targetZoom = 1.5;
    let lastWeaponDiag = "";
    pixi.ticker.add((deltaTime) => {
        try {
            display.update(deltaTime / 60, true);
            // 诊断：当前武器与枪纹理（确认换枪后渲染是否更新）
            const anyPlayer = display as unknown as {
                activePlayer?: {
                    netData?: { activeWeapon?: string };
                    gunRSprites?: {
                        gunBarrel?: {
                            texture?: { textureCacheIds?: string[] };
                        };
                    };
                };
            };
            const p2 = anyPlayer.activePlayer;
            if (p2?.netData?.activeWeapon) {
                const ids = p2.gunRSprites?.gunBarrel?.texture?.textureCacheIds ?? [];
                const signature = `${p2.netData.activeWeapon}|${ids[0] ?? "(none)"}`;
                if (signature !== lastWeaponDiag) {
                    lastWeaponDiag = signature;
                    console.log(
                        "[storage-weapon]",
                        "activeWeapon=",
                        p2.netData.activeWeapon,
                        "gunTex=",
                        ids[0] ?? "(none)",
                    );
                }
            }
        } catch (error) {
            console.error("LoadoutDisplay update failed:", error);
            setStatus(
                `示例人物更新失败：${error instanceof Error ? error.message : String(error)}`,
                true,
            );
            pixi.ticker.stop();
        }
    });
    return display;
}

function syncPreview(display: LoadoutDisplay): void {
    const loadout = currentLoadout;
    // 武器槽是固定 2 槽位（空槽为空串）：示例人物显示 1 号位（主武器），
    // 空槽回退到 2 号位；双枪形态（"_dual"）直接透传给渲染管线。
    const activeGun = loadout.guns[0] || loadout.guns[1] || "";
    display.setPreviewLook({
        outfit: "outfitBase",
        helmet: loadout.armor.helmet ?? "",
        chest: loadout.armor.chest ?? "",
        backpack: loadout.armor.backpack ?? "",
        activeWeapon: activeGun || loadout.melee || "fists",
    });
}

function init(): void {
    // 仓库身份由登录 token 决定；显示名优先取账号显示名，其次大厅 playerName，
    // 仅用于界面展示，不再作为请求身份。
    const identityConfig = new ConfigManager();
    identityConfig.load(() => undefined);
    const lobbyName = String(
        (identityConfig.config as { playerName?: string } | undefined)
            ?.playerName ?? "",
    ).trim();
    const stored = getCookie("surviv_stash_name");
    const identity = sessionDisplayName() || lobbyName || stored;
    if (identity) {
        $("#extraction-stash-name").val(identity);
        setCookie("surviv_stash_name", identity);
        $("#extraction-stash-name").prop("readonly", true);
    }
    bindStashEvents();
    bindShopEvents();

    // 仓库 / 商店 标签切换。
    const showStash = (): void => {
        $("#storage-tab-stash").addClass("active");
        $("#storage-tab-shop").removeClass("active");
        $("#shop-view").hide();
        $("#storage-stash-main").show();
        setStatus("");
    };
    const showShop = (): void => {
        $("#storage-tab-shop").addClass("active");
        $("#storage-tab-stash").removeClass("active");
        $("#storage-stash-main").hide();
        $("#shop-view").show();
        setStatus("");
        if (sessionToken()) void loadShop();
    };
    const showShopSub = (sub: "buy" | "sell"): void => {
        $("#shop-subtab-buy").toggleClass("active", sub === "buy");
        $("#shop-subtab-sell").toggleClass("active", sub === "sell");
        $("#shop-buy-view").toggle(sub === "buy");
        $("#shop-sell-view").toggle(sub === "sell");
        if (sub === "sell") renderShopSell();
    };
    $("#storage-tab-stash").on("click", showStash);
    $("#storage-tab-shop").on("click", () => {
        showShop();
        showShopSub("buy");
    });
    $("#storage-nav-buy").on("click", () => {
        showShop();
        showShopSub("buy");
    });
    $("#storage-nav-sell").on("click", () => {
        showShop();
        showShopSub("sell");
    });
    $("#shop-subtab-buy").on("click", () => showShopSub("buy"));
    $("#shop-subtab-sell").on("click", () => showShopSub("sell"));
    showShopSub("buy");
    // 进入页面默认显示仓库视图（商店面板初始带 hidden 属性，配合 CSS
    // .storage-main[hidden] 规则首帧即隐藏，这里再显式切一次兜底）。
    // 查看他人仓库已移到独立页 /view-stash?name=<账号名>（与自己的仓库页完全无关）。
    // 兼容旧链接：/storage?view=stash&name=X 重定向过去。
    const viewParam = new URLSearchParams(window.location.search).get("view");
    const viewName = new URLSearchParams(window.location.search).get("name") ?? "";
    if (viewParam === "stash" && viewName) {
        window.location.replace(
            `/view-stash?name=${encodeURIComponent(viewName)}`,
        );
        return;
    }
    showStash();

    // 确认配装：把当前配装保存到"对局将使用的身份"（大厅 playerName），
    // 避免仓库身份与入局身份不一致导致进局没有装备；然后返回游戏。
    $("#storage-confirm").on("click", (event) => {
        event.preventDefault();
        if (!sessionToken()) {
            setStatus("请先登录后确认配装", true);
            return;
        }
        const currentLobbyName = String(
            (identityConfig.config as { playerName?: string } | undefined)
                ?.playerName ?? "",
        ).trim();
        // 仓库身份始终是登录账号显示名；大厅 playerName 由主界面强制设为该显示名。
        const saveAs = sessionDisplayName() || currentLobbyName || "Player";
        $("#extraction-stash-name").val(saveAs);
        setCookie("surviv_stash_name", saveAs);
        setCurrentName(saveAs);
        // 等保存完成再返回主菜单，避免导航中断未完成的保存。
        void persistLoadout().finally(() => {
            window.location.href = "/";
        });
    });

    // 与主界面示例人物相同的完整游戏渲染。
    const canvasHost = document.getElementById("stash-player-canvas");
    if (canvasHost) {
        void createLoadoutDisplay(canvasHost).then((display) => {
            if (display) {
                setOnLoadoutChanged(() => syncPreview(display));
                syncPreview(display);
            } else {
                // 回退：手动拼装渲染（保证人物可见）。
                const player = new StoragePlayer(canvasHost);
                const syncFallback = () => player.updateLoadout(currentLoadout);
                setOnLoadoutChanged(syncFallback);
                syncFallback();
            }
        });
    }

    if (sessionToken()) {
        void loadStash();
        void loadShop();
    } else {
        setStatus("请先登录后使用仓库/商店", true);
    }
}

init();
