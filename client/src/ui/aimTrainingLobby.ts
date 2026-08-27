import $ from "jquery";
import type { MatchData } from "../main.ts";

/**
 * Parse a JSON response without crashing on empty/non-JSON bodies (for
 * example a dev-server proxy 500 while the game server is restarting).
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text.trim()) {
        throw new Error(`服务器返回了空响应（${response.status}），请稍后再试`);
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`服务器返回异常（${response.status}），请稍后再试`);
    }
}

interface TrainingWeapon {
    id: string;
    name: string;
    ammo: string;
    category: string;
    categoryName: string;
    image: string;
    note: string | null;
    tier: string | null;
}

interface BoostOption {
    level: number;
    speedBonus: number;
    baseSpeed: number;
    resultingBaseSpeed: number;
    percentBonus: number;
}

interface TrainingThrowable {
    id: string;
    name: string;
    image: string;
}

export interface TrainingSettings {
    weapon0: string;
    weapon1: string;
    throwable: string;
    infiniteMagazine: boolean;
    targetBoost: number;
    helmetLevel: number;
    chestLevel: number;
    normalHealth: boolean;
    distance: number;
    verticalRandomMovement: boolean;
    omnidirectionalRandomMovement: boolean;
    dodgeBullets: boolean;
    resetStats?: boolean;
}

interface CatalogResponse {
    err?: string;
    weapons: TrainingWeapon[];
    throwables: TrainingThrowable[];
    boostLevels: BoostOption[];
    distances: number[];
    defaults: TrainingSettings;
}

interface StartResponse {
    err?: string;
    matchData?: MatchData;
    settings?: TrainingSettings;
}

const STORAGE_KEY = "surviv-aim-training-settings";

export class AimTrainingLobby {
    private catalog: CatalogResponse | null = null;
    private loading = false;
    private inGame = false;
    private readonly modal = $("#aim-training-modal");
    private readonly error = $("#aim-training-error");
    private readonly start = $<HTMLButtonElement>("#aim-training-start");
    private readonly entry = $<HTMLButtonElement>("#btn-aim-training");

    constructor(
        private readonly getPlayerName: () => string,
        private readonly onMatchReady: (matchData: MatchData) => void,
        private readonly onSettingsApply: (settings: TrainingSettings) => void,
    ) {}

    init(): void {
        // The original lobby modal lives under start-menu-wrapper, which is
        // hidden as soon as a match begins. Move the reusable settings panel to
        // body so it remains available inside the practice range.
        this.modal.appendTo(document.body);
        $("#aim-training-close").on("click", () => this.close());
        this.modal.on("click", (event) => {
            if (event.target === this.modal[0]) this.close();
        });
        $(
            "#aim-training-weapon-0, #aim-training-weapon-1, #aim-training-throwable, "
                + "#aim-training-distance, #aim-training-boost, #aim-training-helmet, "
                + "#aim-training-chest, #aim-training-normal-health, "
                + "#aim-training-vertical-random, #aim-training-omni-random, "
                + "#aim-training-dodge-bullets, #aim-training-infinite-magazine",
        ).on(
            "change input",
            (event) => {
                const target = event.currentTarget as HTMLInputElement;
                if (target.id === "aim-training-omni-random" && target.checked) {
                    $("#aim-training-vertical-random").prop("checked", false);
                } else if (target.id === "aim-training-vertical-random" && target.checked) {
                    $("#aim-training-omni-random").prop("checked", false);
                }
                this.renderSelection();
                this.persist();
            },
        );
        this.start.on("click", () => void this.begin());
        $("#aim-training-clear-stats").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.onSettingsApply({ ...this.settings(), resetStats: true });
        });
        window.addEventListener("aim-training-settings-sync", (event) => {
            const settings = (event as CustomEvent<TrainingSettings>).detail;
            if (settings) this.writeSettings(settings);
        });
    }

    async open(): Promise<void> {
        if (this.loading) return;
        this.inGame = false;
        this.showError("");
        if (!this.catalog) await this.loadCatalog();
        if (this.catalog) {
            await this.begin();
        } else {
            this.modal.prop("hidden", false);
        }
    }

    async openSettings(): Promise<void> {
        if (this.loading) return;
        this.inGame = true;
        this.showError("");
        if (!this.catalog) await this.loadCatalog();
        if (!this.catalog) return;
        $("#aim-training-title").text("靶场设置");
        $("#aim-training-subtitle").text("所有选项即时生效，无需退出或重开靶场");
        this.start.text("应用设置");
        this.modal.prop("hidden", false);
    }

    close(): void {
        if (!this.loading) this.modal.prop("hidden", true);
    }

    private async loadCatalog(): Promise<void> {
        this.setLoading(true, "正在加载武器…");
        try {
            const data = await this.request<CatalogResponse>({ action: "catalog" });
            this.catalog = data;
            this.renderCatalog(data);
            this.start.prop("disabled", false);
        } catch (error) {
            this.showError(this.errorText(error));
            if (!this.inGame) {
                $("#aim-training-title").text("无法进入靶场");
                $("#aim-training-subtitle").text("检查错误信息后可以直接重试");
                this.start.text("重试");
                this.modal.prop("hidden", false);
            }
        } finally {
            this.setLoading(false);
        }
    }

    private renderCatalog(catalog: CatalogResponse): void {
        for (const selector of ["#aim-training-weapon-0", "#aim-training-weapon-1"]) {
            const weaponSelect = $<HTMLSelectElement>(selector).empty();
            let category = "";
            let group: JQuery<HTMLOptGroupElement> | null = null;
            for (const weapon of catalog.weapons) {
                if (weapon.category !== category) {
                    category = weapon.category;
                    group = $("<optgroup/>", { label: weapon.categoryName });
                    weaponSelect.append(group);
                }
                group!.append($("<option/>", {
                    value: weapon.id,
                    text: `${weapon.name} · ${weapon.ammo}${weapon.tier ? ` · 等级 ${weapon.tier}` : ""}`,
                }));
            }
        }
        const throwableSelect = $<HTMLSelectElement>("#aim-training-throwable").empty();
        for (const throwable of catalog.throwables) {
            throwableSelect.append($("<option/>", { value: throwable.id, text: throwable.name }));
        }

        const distanceSelect = $<HTMLSelectElement>("#aim-training-distance").empty();
        for (const distance of catalog.distances) {
            distanceSelect.append($("<option/>", { value: distance, text: `${distance} 游戏单位` }));
        }

        const saved = { ...catalog.defaults, ...this.restore() };
        this.writeSettings(saved);
        this.renderSelection();
    }

    private writeSettings(settings: TrainingSettings): void {
        $("#aim-training-weapon-0").val(settings.weapon0);
        $("#aim-training-weapon-1").val(settings.weapon1);
        $("#aim-training-throwable").val(settings.throwable);
        $("#aim-training-infinite-magazine").prop("checked", settings.infiniteMagazine);
        const boostIndex = Math.max(
            0,
            this.catalog?.boostLevels.findIndex((item) => item.level === settings.targetBoost) ?? 0,
        );
        $("#aim-training-boost").val(boostIndex);
        $("#aim-training-helmet").val(settings.helmetLevel);
        $("#aim-training-chest").val(settings.chestLevel);
        $("#aim-training-normal-health").prop("checked", settings.normalHealth);
        $("#aim-training-distance").val(String(settings.distance));
        $("#aim-training-vertical-random").prop("checked", settings.verticalRandomMovement);
        $("#aim-training-omni-random").prop("checked", settings.omnidirectionalRandomMovement);
        $("#aim-training-dodge-bullets").prop("checked", settings.dodgeBullets);
        this.renderSelection();
    }

    private renderSelection(): void {
        const catalog = this.catalog;
        if (!catalog) return;
        for (const slot of [0, 1]) {
            const weapon = catalog.weapons.find(
                (item) => item.id === String($(`#aim-training-weapon-${slot}`).val()),
            );
            $(`#aim-training-weapon-image-${slot}`).attr({
                src: weapon?.image ?? "",
                alt: weapon?.name ?? `武器 ${slot + 1}`,
            });
            $(`#aim-training-weapon-note-${slot}`).text(
                weapon ? `${weapon.name} · ${weapon.ammo}${weapon.note ? ` · ${weapon.note}` : ""}` : "",
            );
        }
        const boostIndex = Number($("#aim-training-boost").val()) || 0;
        const boost = catalog.boostLevels[boostIndex] ?? catalog.boostLevels[0];
        const stageNames = ["无", "一级", "二级", "三级", "满级"];
        $("#aim-training-boost-value").text(stageNames[boostIndex] ?? "无");
        $("#aim-training-speed-note").text(
            boost.level > 0
                ? `肾上腺素固定为 ${boost.level}，不会衰减或停在效果临界值。`
                : "标靶不使用肾上腺素加速。",
        );
        $("#aim-training-magazine-note").text(
            $("#aim-training-infinite-magazine").prop("checked")
                ? "弹匣内子弹不会减少，无需换弹。"
                : "仅备用弹药无限，仍需按正常弹匣容量换弹。",
        );
    }

    private settings(): TrainingSettings {
        return {
            weapon0: String($("#aim-training-weapon-0").val()),
            weapon1: String($("#aim-training-weapon-1").val()),
            throwable: String($("#aim-training-throwable").val()),
            infiniteMagazine: $("#aim-training-infinite-magazine").prop("checked"),
            targetBoost: this.catalog?.boostLevels[Number($("#aim-training-boost").val()) || 0]?.level ?? 0,
            helmetLevel: Number($("#aim-training-helmet").val()),
            chestLevel: Number($("#aim-training-chest").val()),
            normalHealth: $("#aim-training-normal-health").prop("checked"),
            distance: Number($("#aim-training-distance").val()),
            verticalRandomMovement: $("#aim-training-vertical-random").prop("checked"),
            omnidirectionalRandomMovement: $("#aim-training-omni-random").prop("checked"),
            dodgeBullets: $("#aim-training-dodge-bullets").prop("checked"),
        };
    }

    private async begin(): Promise<void> {
        if (this.loading || !this.catalog) return;
        if (this.inGame) {
            const settings = this.settings();
            this.onSettingsApply(settings);
            this.persist();
            this.modal.prop("hidden", true);
            return;
        }
        this.getPlayerName();
        this.setLoading(true, "正在创建靶场并等待移动标靶连接…");
        this.showError("");
        try {
            const data = await this.request<StartResponse>({
                action: "start",
                settings: this.settings(),
            });
            if (!data.matchData) throw new Error("服务器没有返回靶场连接信息");
            this.persist();
            this.modal.prop("hidden", true);
            this.onMatchReady(data.matchData);
        } catch (error) {
            this.showError(this.errorText(error));
            $("#aim-training-title").text("无法进入靶场");
            $("#aim-training-subtitle").text("检查错误信息后可以直接重试");
            this.start.text("重试");
            this.modal.prop("hidden", false);
        } finally {
            this.setLoading(false);
        }
    }

    private async request<T>(body: Record<string, unknown>): Promise<T> {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        try {
            const response = await fetch("/api/aim-training", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const data = await parseJsonResponse<T & { err?: string }>(response);
            if (!response.ok || data.err) throw new Error(data.err || `请求失败 (${response.status})`);
            return data;
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new Error("移动标靶连接超时；请检查8001端口、Node进程和防火墙");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    private persist(): void {
        if (!this.catalog) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings()));
    }

    private restore(): TrainingSettings | null {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as TrainingSettings | null;
        } catch {
            return null;
        }
    }

    private setLoading(loading: boolean, text = ""): void {
        this.loading = loading;
        this.start.prop("disabled", loading || !this.catalog);
        $("#aim-training-status").text(text);
        this.entry.prop("disabled", loading);
        this.entry.text(loading && !this.inGame ? "正在进入靶场…" : "瞄准练习");
    }

    private showError(message: string): void {
        this.error.text(message);
    }

    private errorText(error: unknown): string {
        return error instanceof Error ? error.message : "瞄准练习操作失败";
    }
}
