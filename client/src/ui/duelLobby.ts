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

interface DuelLobbyWeapon {
    id: string;
    name: string;
    ammo: string;
    category: string;
    categoryName: string;
    image: string;
    note: string | null;
    tier: string | null;
}
interface DuelLobbyThrowable {
    id: string;
    name: string;
    originalName: string;
    image: string;
    maxCount: number;
}
type DuelWeaponMode = "individual" | "mirrored" | "exclusive";
interface DuelLobbyLoadout {
    weapons: [string, string];
    weaponSelectionMode: DuelWeaponMode;
    adrenalineEnabled: boolean;
    boost: number;
    aiEnabled: boolean;
    aiDifficulty: "normal" | "hard" | "pro" | "legit" | "forbidden";
    helmetLevel: number;
    chestLevel: number;
    scope: "1xscope" | "2xscope" | "4xscope" | "8xscope" | "15xscope";
    throwables: Record<string, number>;
}
interface DuelLobbyPlayer {
    name: string;
    host: boolean;
    ai: boolean;
    self: boolean;
    weapons: [string, string];
    throwables: Record<string, number>;
}
interface DuelLobbySnapshot {
    code: string;
    status: "waiting" | "starting" | "playing";
    isHost: boolean;
    players: DuelLobbyPlayer[];
    myWeapons: [string, string];
    loadout: DuelLobbyLoadout;
    canStart: boolean;
    awaitingReturns: boolean;
    returnedCount: number;
    myThrowables: Record<string, number>;
    matchId: string | null;
    spectatorShareCode: string | null;
    matchData: MatchData | null;
    catalog: DuelLobbyWeapon[];
    throwableCatalog: DuelLobbyThrowable[];
    revision: number;
    updatedAt: number;
}
interface DuelLobbyResponse {
    err?: string;
    memberToken?: string;
    lobby?: DuelLobbySnapshot;
    closed?: boolean;
    matchData?: MatchData;
}
interface DuelLobbySession {
    code: string;
    memberToken: string;
}
const SESSION_KEY = "surviv-private-duel-lobby-v41";

/** Private 1v1 lobby with independent player weapons and share-code spectating. */
export class DuelLobby {
    private session: DuelLobbySession | null = null;
    private lobby: DuelLobbySnapshot | null = null;
    private pollTimer: number | null = null;
    private commonUpdateTimer: number | null = null;
    private weaponUpdateTimer: number | null = null;
    private pending = false;
    private rendering = false;
    private commonDirty = false;
    private weaponDirty = false;
    private throwableDirty = false;
    private commonUpdateInFlight = false;
    private weaponUpdateInFlight = false;
    private throwableUpdateInFlight = false;
    /** One serialized write lane prevents common rules and weapon updates from
     * overtaking each other and applying an older full-form snapshot last. */
    private mutationInFlight = false;
    private commonDraft: DuelLobbyLoadout | null = null;
    private weaponDraft: [string, string] | null = null;
    private throwableDraft: Record<string, number> | null = null;
    private throwableUpdateTimer: number | null = null;
    private copyToastTimer: number | null = null;
    private inMatch = false;
    private lastJoinedMatchId: string | null = null;

    private readonly modal = $("#duel-lobby-modal");
    private readonly entry = $("#duel-lobby-entry");
    private readonly room = $("#duel-lobby-room");
    private readonly error = $("#duel-lobby-error");
    private readonly codeInput = $<HTMLInputElement>("#duel-lobby-code-input");
    private readonly startButton = $<HTMLButtonElement>("#duel-lobby-start");

    constructor(
        private readonly getPlayerName: () => string,
        private readonly onMatchReady: (matchData: MatchData, spectator: boolean) => void,
    ) {}

    init(): void {
        this.restoreSession();
        this.bindEvents();
        const params = new URL(window.location.href).searchParams;

        // 后台“双方 AI”工具生成的是 ?duelWatch=<8位分享码>。
        // 这个入口必须优先于普通 1v1 大厅恢复：分享码不是 game token，
        // 需要先向 /api/duel-lobby 的 watch 动作兑换一个当前浏览器专属的
        // spectator join token，再直接进入对局。这样同一个分享链接可供多人观战。
        const watchCode = params.get("duelWatch")?.trim().toUpperCase();
        if (watchCode) {
            void this.watchShareCode(watchCode);
            return;
        }

        const invite = params.get("duelLobby")?.trim().toUpperCase();
        if (invite) {
            this.codeInput.val(invite.slice(0, 6));
            this.open();
            // 邀请链接直达房间：自动加入，省去点击「加入大厅」。
            if (!this.session || this.session.code !== invite) {
                void this.join();
            }
        } else if (this.session) {
            this.startPolling(true);
        }
    }

    private async watchShareCode(rawCode: string): Promise<void> {
        const shareCode = rawCode.replace(/[^A-Z0-9]/g, "").slice(0, 8);
        if (shareCode.length !== 8) {
            this.modal.prop("hidden", false);
            this.showEntry();
            this.showError("观战分享码无效");
            return;
        }

        try {
            const response = await this.request("watch", { shareCode });
            if (!response.matchData) {
                throw new Error("服务器未返回观战对局信息");
            }

            // 分享码只负责兑换 spectator token。成功后从地址栏移除，避免刷新/
            // 自动重连期间重复兑换；joinGame 会把真正的 gameId + token 写回 URL。
            const url = new URL(window.location.href);
            url.searchParams.delete("duelWatch");
            url.searchParams.delete("duelLobby");
            history.replaceState({}, document.title, url.toString());

            this.stopPolling();
            this.modal.prop("hidden", true);
            this.onMatchReady(response.matchData, true);
        } catch (error) {
            this.modal.prop("hidden", false);
            this.showEntry();
            this.showError(this.errorText(error));
        }
    }

    open(): void {
        this.modal.prop("hidden", false);
        this.showError("");
        if (this.session) this.showRoom();
        else this.showEntry();
        if (this.session) this.startPolling(true);
    }
    isInMatch(): boolean {
        return this.inMatch;
    }
    returnAfterMatch(): void {
        if (!this.inMatch || !this.session) return;
        this.inMatch = false;
        this.modal.prop("hidden", false);
        this.showRoom();
        this.startPolling(true);
    }

    private bindEvents(): void {
        $("#duel-lobby-close").on("click", () => this.modal.prop("hidden", true));
        this.modal.on("click", (event) => {
            if (event.target === this.modal[0]) this.modal.prop("hidden", true);
        });
        $("#duel-lobby-create").on("click", () => void this.create());
        $("#duel-lobby-join").on("click", () => void this.join());
        this.codeInput.on("input", () => this.normalizeCode(this.codeInput, 6));
        this.codeInput.on("keydown", (event) => {
            if (event.key === "Enter") void this.join();
        });
        $("#duel-lobby-copy-code").on("click", () => {
            if (this.lobby) void this.copyText(this.lobby.code, "房间号已复制");
        });
        $("#duel-lobby-copy-link").on("click", () => {
            if (this.lobby) void this.copyText(this.inviteUrl(this.lobby.code), "邀请链接已复制");
        });
        $("#duel-lobby-leave").on("click", () => void this.leave());
        this.startButton.on("click", () => void this.start());

        $("#duel-lobby-weapon-0, #duel-lobby-weapon-1").on("change", () => {
            if (!this.rendering) this.scheduleWeaponUpdate();
        });
        $("#duel-lobby-ai-weapon-0, #duel-lobby-ai-weapon-1, #duel-lobby-weapon-mode, #duel-lobby-adrenaline-enabled, #duel-lobby-boost, #duel-lobby-ai-enabled, #duel-lobby-ai-difficulty, #duel-lobby-helmet, #duel-lobby-chest, #duel-lobby-scope")
            .on(
                "change input",
                (event) => {
                    if (this.rendering) return;
                    if (
                        (event.currentTarget as HTMLElement).id === "duel-lobby-ai-enabled"
                        && $(event.currentTarget).prop("checked")
                    ) {
                        $("#duel-lobby-weapon-mode").val("mirrored");
                        $("#duel-lobby-ai-weapons").prop("hidden", true);
                        $("#duel-lobby-editor-note").text("AI 对手模式：强制镜像房主当前两把武器");
                    }
                    this.scheduleCommonUpdate();
                },
            );
    }

    private async create(): Promise<void> {
        await this.withPending(async () =>
            this.acceptMembership(await this.request("create", { name: this.getPlayerName() }))
        );
    }
    private async join(): Promise<void> {
        const code = String(this.codeInput.val() ?? "").trim().toUpperCase();
        if (code.length !== 6) return this.showError("请输入六位房间号");
        await this.withPending(async () =>
            this.acceptMembership(await this.request("join", { code, name: this.getPlayerName() }))
        );
    }
    private acceptMembership(response: DuelLobbyResponse): void {
        if (!response.memberToken || !response.lobby) throw new Error("大厅返回的数据不完整");
        this.session = { code: response.lobby.code, memberToken: response.memberToken };
        this.lobby = response.lobby;
        this.lastJoinedMatchId = null;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        this.setInviteQuery(response.lobby.code);
        this.showRoom();
        this.render(response.lobby);
        this.startPolling();
    }

    private async leave(): Promise<void> {
        const session = this.session;
        this.stopPolling();
        this.clearTimers();
        if (session) {
            try {
                await this.request("leave", session);
            } catch { /* room may already be gone */ }
        }
        this.clearMembership();
        this.showEntry();
    }

    private async start(): Promise<void> {
        if (!this.session || !this.lobby?.canStart || this.pending) return;
        await this.withPending(async () => {
            await this.flushUpdates();
            const response = await this.request("start", this.session!);
            if (response.lobby) this.render(response.lobby);
        });
    }

    private startPolling(immediate = false): void {
        this.stopPolling();
        if (!this.session || this.inMatch) return;
        const poll = async () => {
            if (!this.session || this.inMatch) return;
            try {
                const response = await this.request("status", this.session);
                if (response.lobby) this.render(response.lobby);
            } catch (error) {
                this.showError(this.errorText(error));
                this.clearMembership();
                return;
            }
            if (this.session && !this.inMatch) this.pollTimer = window.setTimeout(poll, 900);
        };
        this.pollTimer = window.setTimeout(poll, immediate ? 0 : 700);
    }
    private stopPolling(): void {
        if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    private render(lobby: DuelLobbySnapshot): void {
        if (this.lobby?.code === lobby.code && lobby.revision < this.lobby.revision) return;
        this.lobby = lobby;
        this.showRoom();
        this.rendering = true;
        try {
            const preserveWeaponDraft = this.weaponDirty || this.weaponUpdateInFlight
                || this.weaponUpdateTimer !== null;
            const preserveThrowableDraft = this.throwableDirty
                || this.throwableUpdateInFlight
                || this.throwableUpdateTimer !== null;
            const preserveCommonDraft = this.commonDirty || this.commonUpdateInFlight
                || this.commonUpdateTimer !== null;
            $("#duel-lobby-code").text(lobby.code);
            this.renderPlayers(lobby);
            this.populateWeaponSelects(lobby);
            if (!preserveWeaponDraft) {
                $("#duel-lobby-weapon-0").val(lobby.myWeapons[0]);
                $("#duel-lobby-weapon-1").val(lobby.myWeapons[1]);
            }
            if (!preserveCommonDraft) {
                $("#duel-lobby-ai-weapon-0").val(lobby.loadout.weapons[0]);
                $("#duel-lobby-ai-weapon-1").val(lobby.loadout.weapons[1]);
                $("#duel-lobby-weapon-mode").val(lobby.loadout.weaponSelectionMode);
                $("#duel-lobby-adrenaline-enabled").prop("checked", lobby.loadout.adrenalineEnabled);
                $("#duel-lobby-boost").val(lobby.loadout.boost);
                $("#duel-lobby-ai-enabled").prop("checked", lobby.loadout.aiEnabled);
                $("#duel-lobby-ai-difficulty").val(lobby.loadout.aiDifficulty);
                $("#duel-lobby-helmet").val(lobby.loadout.helmetLevel);
                $("#duel-lobby-chest").val(lobby.loadout.chestLevel);
                $("#duel-lobby-scope").val(lobby.loadout.scope);
            }
            this.updateWeaponImages(lobby);
            // 访客只读摘要：不显示无法更改的公共规则选择框（图片+文字说明）。
            const showCommonSummary = !lobby.isHost;
            $("#duel-lobby-basics").prop("hidden", showCommonSummary);
            $("#duel-lobby-common-summary").prop("hidden", !showCommonSummary);
            if (showCommonSummary) this.renderCommonSummary(lobby);
            // 镜像模式下访客的武器选框同样不可改 → 用图片+文字代替，
            // 并显示实际生效的（房主的）武器。
            const mirroredGuest = !lobby.isHost && lobby.loadout.weaponSelectionMode === "mirrored";
            const effectivePair = mirroredGuest
                ? lobby.players[0]?.weapons ?? lobby.myWeapons
                : lobby.myWeapons;
            for (let i = 0; i < 2; i++) {
                const weapon = lobby.catalog.find(
                    (candidate) => candidate.id === effectivePair[i],
                );
                $(`#duel-lobby-weapon-name-${i}`)
                    .text(weapon?.name ?? effectivePair[i])
                    .prop("hidden", !mirroredGuest);
                $(`#duel-lobby-weapon-${i}`).prop("hidden", mirroredGuest);
                $(`#duel-lobby-weapon-image-${i}`).attr({
                    src: weapon?.image ?? "",
                    alt: weapon?.name ?? effectivePair[i],
                });
            }
            $("#duel-lobby-boost").prop("disabled", !lobby.loadout.adrenalineEnabled || !lobby.isHost);
            // 已有真人加入后隐藏全部 AI 相关 UI（AI 对手、AI 难度、
            // AI 难度警告）。AI 武器块始终隐藏（AI 模式镜像房主武器）。
            // 服务端同时拒绝已有真人后再开启 AI。
            const realOpponentJoined = lobby.players.some(
                (candidate) => !candidate.ai && !candidate.self,
            );
            const aiSectionVisible = lobby.loadout.aiEnabled || !realOpponentJoined;
            $("#duel-lobby-ai-toggle-field, #duel-lobby-ai-difficulty-field").toggle(
                aiSectionVisible,
            );
            $("#duel-lobby-ai-weapons").prop("hidden", true);
            $("#duel-lobby-legit-warning").prop(
                "hidden",
                !aiSectionVisible || lobby.loadout.aiDifficulty !== "legit",
            );
            $("#duel-lobby-hacker-warning").prop(
                "hidden",
                !aiSectionVisible || lobby.loadout.aiDifficulty !== "forbidden",
            );
            this.renderThrowables(lobby, preserveThrowableDraft);

            const editable = lobby.status === "waiting" && !lobby.awaitingReturns;
            $("#duel-lobby-weapon-0, #duel-lobby-weapon-1").prop(
                "disabled",
                !editable || lobby.loadout.weaponSelectionMode === "mirrored" && !lobby.isHost,
            );
            $("#duel-lobby-ai-weapon-0, #duel-lobby-ai-weapon-1, #duel-lobby-adrenaline-enabled, #duel-lobby-ai-enabled, #duel-lobby-ai-difficulty, #duel-lobby-helmet, #duel-lobby-chest, #duel-lobby-scope")
                .prop("disabled", !editable || !lobby.isHost);
            $("#duel-lobby-weapon-mode").prop(
                "disabled",
                !editable || !lobby.isHost || lobby.loadout.aiEnabled,
            );
            $("#duel-lobby-throwables input, #duel-lobby-throwables button").prop("disabled", !editable);
            $("#duel-lobby-editor-note").text(
                lobby.loadout.aiEnabled
                    ? "AI 对手模式：强制镜像房主武器与投掷物"
                    : lobby.loadout.weaponSelectionMode === "mirrored"
                    ? "镜像模式：双方使用相同武器，投掷物各自选择"
                    : lobby.loadout.weaponSelectionMode === "exclusive"
                    ? "双方各自选择，四个武器槽不能重复"
                    : "双方各自选择自己的两把武器",
            );
            if (
                !this.mutationInFlight
                && !this.commonDirty
                && !this.weaponDirty
                && !this.throwableDirty
                && this.commonUpdateTimer === null
                && this.weaponUpdateTimer === null
                && this.throwableUpdateTimer === null
            ) {
                this.setSaveState(lobby.isHost ? "规则自动保存" : "你的武器和投掷物自动保存");
            }
            this.startButton.toggle(lobby.isHost).prop("disabled", !lobby.canStart || this.pending);
            this.setStatus(this.statusText(lobby));
        } finally {
            this.rendering = false;
        }
        this.handleMatch(lobby);
    }

    private renderPlayers(lobby: DuelLobbySnapshot): void {
        const wrapper = $("#duel-lobby-players").empty();
        for (let index = 0; index < 2; index++) {
            const player = lobby.players[index];
            const card = $("<div/>", { class: `duel-lobby-player${player ? " filled" : ""}` });
            card.append($("<div/>", { class: "duel-lobby-player-icon", text: index + 1 }));
            const copy = $("<div/>", { class: "duel-lobby-player-copy" });
            copy.append($("<strong/>", { text: player?.name ?? "等待玩家加入" }));
            if (!player) {
                copy.append($("<small/>", { text: "发送房间号或邀请链接" }));
            } else {
                copy.append(
                    $("<small/>", {
                        text: player.ai
                            ? "电脑"
                            : player.self
                            ? "你"
                            : player.host
                            ? "房主"
                            : "玩家",
                    }),
                );
                // 已选武器：图片 + 名称（大字号）
                const weaponsRow = $("<div/>", { class: "duel-lobby-player-weapons" });
                for (const id of player.weapons) {
                    const weapon = lobby.catalog.find((candidate) => candidate.id === id);
                    weaponsRow.append(
                        $("<span/>", { class: "duel-lobby-player-weapon" }).append(
                            $("<img/>", {
                                src: weapon?.image ?? "",
                                alt: weapon?.name ?? id,
                            }),
                            $("<b/>", { text: weapon?.name ?? id }),
                        ),
                    );
                }
                copy.append(weaponsRow);
                // 投掷物：图片 + 名称×数量
                const throwablesRow = $("<div/>", { class: "duel-lobby-player-throwables" });
                const throwableItems = lobby.throwableCatalog.filter(
                    (item) => (player.throwables?.[item.id] ?? 0) > 0,
                );
                if (throwableItems.length === 0) {
                    throwablesRow.append(
                        $("<span/>", {
                            class: "duel-lobby-player-throwable empty",
                            text: "投掷物：无",
                        }),
                    );
                } else {
                    for (const item of throwableItems) {
                        throwablesRow.append(
                            $("<span/>", { class: "duel-lobby-player-throwable" }).append(
                                $("<img/>", { src: item.image, alt: item.name }),
                                $("<b/>", {
                                    text: `${item.name}×${player.throwables![item.id]}`,
                                }),
                            ),
                        );
                    }
                }
                copy.append(throwablesRow);
            }
            card.append(copy);
            wrapper.append(card);
        }
    }

    private populateWeaponSelects(lobby: DuelLobbySnapshot): void {
        for (
            const id of [
                "#duel-lobby-weapon-0",
                "#duel-lobby-weapon-1",
                "#duel-lobby-ai-weapon-0",
                "#duel-lobby-ai-weapon-1",
            ]
        ) {
            const select = $(id);
            if (select.find("option").length === lobby.catalog.length) continue;
            select.empty();
            let category = "";
            let group: JQuery<HTMLOptGroupElement> | null = null;
            for (const weapon of lobby.catalog) {
                if (weapon.category !== category) {
                    category = weapon.category;
                    group = $("<optgroup/>", { label: weapon.categoryName });
                    select.append(group);
                }
                group!.append(
                    $("<option/>", {
                        value: weapon.id,
                        text: `${weapon.name} · ${weapon.ammo}${weapon.note ? ` · ${weapon.note}` : ""}`,
                    }),
                );
            }
        }
    }
    private updateWeaponImages(lobby: DuelLobbySnapshot): void {
        const assignments: Array<[string, string]> = [
            ["#duel-lobby-weapon-image-0", lobby.myWeapons[0]],
            ["#duel-lobby-weapon-image-1", lobby.myWeapons[1]],
            ["#duel-lobby-ai-weapon-image-0", lobby.loadout.weapons[0]],
            ["#duel-lobby-ai-weapon-image-1", lobby.loadout.weapons[1]],
        ];
        for (const [selector, id] of assignments) {
            const weapon = lobby.catalog.find((candidate) => candidate.id === id);
            $(selector).attr({ src: weapon?.image ?? "", alt: weapon?.name ?? id });
        }
    }

    private renderCommonSummary(lobby: DuelLobbySnapshot): void {
        const modeText = lobby.loadout.weaponSelectionMode === "mirrored"
            ? "镜像同武器"
            : lobby.loadout.weaponSelectionMode === "exclusive"
            ? "独占武器（不可重复）"
            : "各自选择";
        $("#duel-lobby-summary-mode").text(modeText);
        $("#duel-lobby-summary-adrenaline").text(
            lobby.loadout.adrenalineEnabled
                ? `开启 · 初始 ${lobby.loadout.boost}`
                : "关闭",
        );
        const helmet = lobby.loadout.helmetLevel;
        $("#duel-lobby-summary-helmet-img").attr({
            src: helmet > 0 ? `/img/loot/loot-helmet-0${helmet}.svg` : "",
            alt: helmet > 0 ? `${helmet}级头盔` : "",
        });
        $("#duel-lobby-summary-helmet").text(helmet > 0 ? `${helmet}级` : "无头盔");
        const chest = lobby.loadout.chestLevel;
        $("#duel-lobby-summary-chest-img").attr({
            src: chest > 0 ? `/img/loot/loot-chest-0${chest}.svg` : "",
            alt: chest > 0 ? `${chest}级防弹衣` : "",
        });
        $("#duel-lobby-summary-chest").text(chest > 0 ? `${chest}级` : "无防弹衣");
        const scopeNames: Record<string, string> = {
            "1xscope": "1倍镜",
            "2xscope": "2倍镜",
            "4xscope": "4倍镜",
            "8xscope": "8倍镜",
            "15xscope": "15倍镜",
        };
        const scopeIndex: Record<string, number> = {
            "1xscope": 0,
            "2xscope": 1,
            "4xscope": 2,
            "8xscope": 3,
            "15xscope": 4,
        };
        const scope = lobby.loadout.scope;
        const index = scopeIndex[scope] ?? 2;
        $("#duel-lobby-summary-scope-img").attr({
            src: `/img/loot/loot-scope-0${index}.svg`,
            alt: scopeNames[scope] ?? scope,
        });
        $("#duel-lobby-summary-scope").text(scopeNames[scope] ?? scope);
    }

    private renderThrowables(lobby: DuelLobbySnapshot, preserveValues = false): void {
        const wrapper = $("#duel-lobby-throwables");
        if (wrapper.children().length !== lobby.throwableCatalog.length) {
            wrapper.empty();
            for (const item of lobby.throwableCatalog) {
                const card = $("<div/>", {
                    class: "duel-lobby-throwable",
                    "data-throwable": item.id,
                });
                const image = $("<img/>", { src: item.image, alt: item.name });
                const copy = $("<div/>", { class: "duel-lobby-throwable-copy" });
                copy.append($("<strong/>", { text: item.name }));
                copy.append($("<small/>", {
                    text: `${item.originalName} · 上限 ${item.maxCount}`,
                }));
                const stepper = $("<div/>", { class: "duel-lobby-stepper" });
                const minus = $("<button/>", {
                    type: "button",
                    class: "duel-lobby-stepper-minus",
                    text: "−",
                    title: `减少${item.name}`,
                });
                const input = $("<input/>", {
                    type: "number",
                    min: 0,
                    max: item.maxCount,
                    value: 0,
                    "aria-label": `${item.name}数量`,
                });
                const plus = $("<button/>", {
                    type: "button",
                    class: "duel-lobby-stepper-plus",
                    text: "+",
                    title: `增加${item.name}`,
                });
                const commit = (value: number) => {
                    const normalized = Math.max(0, Math.min(item.maxCount, Math.round(value) || 0));
                    input.val(normalized);
                    card.toggleClass("enabled", normalized > 0);
                    this.scheduleThrowableUpdate();
                };
                minus.on("click", () => commit(Number(input.val()) - 1));
                plus.on("click", () => commit(Number(input.val()) + 1));
                input.on("change input", () => {
                    const normalized = Math.max(0, Math.min(item.maxCount, Math.round(Number(input.val())) || 0));
                    card.toggleClass("enabled", normalized > 0);
                    this.scheduleThrowableUpdate();
                });
                stepper.append(minus, input, plus);
                card.append(image, copy, stepper);
                wrapper.append(card);
            }
        }
        if (!preserveValues) {
            const values = lobby.myThrowables
                ?? (lobby.loadout.throwables as Record<string, number> | undefined)
                ?? {};
            for (const item of lobby.throwableCatalog) {
                const card = wrapper.find(`[data-throwable='${item.id}']`);
                const value = values[item.id] ?? 0;
                card.find("input").val(value);
                card.toggleClass("enabled", value > 0);
            }
        }
    }

    private captureThrowableDraft(): Record<string, number> {
        const throwables: Record<string, number> = {};
        for (const item of this.lobby?.throwableCatalog ?? []) {
            throwables[item.id] = Math.max(
                0,
                Math.min(
                    item.maxCount,
                    Math.round(
                        Number(
                            $("#duel-lobby-throwables")
                                .find(`[data-throwable='${item.id}'] input`)
                                .val(),
                        ) || 0,
                    ),
                ),
            );
        }
        return throwables;
    }

    private scheduleThrowableUpdate(): void {
        this.throwableDraft = this.captureThrowableDraft();
        this.throwableDirty = true;
        this.setSaveState("投掷物有未保存修改");
        if (this.throwableUpdateTimer !== null) window.clearTimeout(this.throwableUpdateTimer);
        this.throwableUpdateTimer = window.setTimeout(() => void this.updateThrowables(), 180);
    }

    private async updateThrowables(): Promise<void> {
        if (!this.session || !this.lobby) return;
        this.throwableUpdateTimer = null;
        if (this.throwableUpdateInFlight || this.mutationInFlight) {
            this.throwableUpdateTimer = window.setTimeout(() => void this.updateThrowables(), 45);
            return;
        }
        const throwables = this.throwableDraft ?? this.captureThrowableDraft();
        this.throwableDraft = null;
        this.throwableDirty = false;
        this.mutationInFlight = true;
        this.throwableUpdateInFlight = true;
        this.setSaveState("正在保存投掷物…");
        let authoritative: DuelLobbySnapshot | null = null;
        try {
            const response = await this.request("update-throwables", {
                ...this.session,
                throwables,
            });
            authoritative = response.lobby ?? null;
        } catch (error) {
            this.showError(this.errorText(error));
            try {
                const response = await this.request("status", this.session);
                authoritative = response.lobby ?? null;
            } catch { /* preserve original error */ }
        } finally {
            this.throwableUpdateInFlight = false;
            this.mutationInFlight = false;
            if (this.throwableDraft) {
                this.throwableDirty = true;
                if (this.throwableUpdateTimer === null) {
                    this.throwableUpdateTimer = window.setTimeout(
                        () => void this.updateThrowables(),
                        0,
                    );
                }
            } else if (authoritative) {
                this.render(authoritative);
                this.setSaveState("投掷物已保存");
            }
        }
    }

    private scheduleWeaponUpdate(): void {
        this.weaponDraft = [
            String($("#duel-lobby-weapon-0").val()),
            String($("#duel-lobby-weapon-1").val()),
        ];
        this.weaponDirty = true;
        this.setSaveState("武器有未保存修改");
        if (this.weaponUpdateTimer !== null) window.clearTimeout(this.weaponUpdateTimer);
        this.weaponUpdateTimer = window.setTimeout(() => void this.updateWeapons(), 180);
    }

    private scheduleCommonUpdate(): void {
        if (!this.lobby?.isHost) return;
        this.commonDraft = this.captureCommonDraft();
        this.commonDirty = true;
        this.setSaveState("规则有未保存修改");
        if (this.commonUpdateTimer !== null) window.clearTimeout(this.commonUpdateTimer);
        this.commonUpdateTimer = window.setTimeout(() => void this.updateCommon(), 220);
    }

    private captureCommonDraft(): DuelLobbyLoadout {
        const aiEnabled = $("#duel-lobby-ai-enabled").prop("checked");
        const hostWeapons: [string, string] = [
            String($("#duel-lobby-weapon-0").val()),
            String($("#duel-lobby-weapon-1").val()),
        ];
        return {
            // The server enforces this too. Sending the mirrored pair makes the
            // draft internally consistent even before its response arrives.
            weapons: aiEnabled
                ? hostWeapons
                : [
                    String($("#duel-lobby-ai-weapon-0").val()),
                    String($("#duel-lobby-ai-weapon-1").val()),
                ],
            weaponSelectionMode: aiEnabled
                ? "mirrored"
                : String($("#duel-lobby-weapon-mode").val()) as DuelWeaponMode,
            adrenalineEnabled: $("#duel-lobby-adrenaline-enabled").prop("checked"),
            boost: Math.max(0, Math.min(100, Math.round(Number($("#duel-lobby-boost").val()) || 0))),
            aiEnabled,
            aiDifficulty: String($("#duel-lobby-ai-difficulty").val()) as DuelLobbyLoadout["aiDifficulty"],
            helmetLevel: Number($("#duel-lobby-helmet").val()),
            chestLevel: Number($("#duel-lobby-chest").val()),
            scope: String($("#duel-lobby-scope").val()) as DuelLobbyLoadout["scope"],
            // Throwables are per-player now; keep the shared/common value
            // unchanged in the common-rules payload (AI mode mirrors the
            // host's per-player counts server-side).
            throwables: {
                ...(this.lobby?.loadout.throwables
                    ?? ({} as Record<string, number>)),
            },
        };
    }

    private async updateWeapons(): Promise<void> {
        if (!this.session || !this.lobby) return;
        this.weaponUpdateTimer = null;
        if (this.weaponUpdateInFlight || this.mutationInFlight) {
            this.weaponUpdateTimer = window.setTimeout(() => void this.updateWeapons(), 45);
            return;
        }
        const weapons = this.weaponDraft ?? [
            String($("#duel-lobby-weapon-0").val()),
            String($("#duel-lobby-weapon-1").val()),
        ];
        this.weaponDraft = null;
        this.weaponDirty = false;
        this.mutationInFlight = true;
        this.weaponUpdateInFlight = true;
        this.setSaveState("正在保存武器…");
        let authoritative: DuelLobbySnapshot | null = null;
        try {
            const response = await this.request("update-weapons", { ...this.session, weapons });
            authoritative = response.lobby ?? null;
        } catch (error) {
            this.showError(this.errorText(error));
            try {
                const response = await this.request("status", this.session);
                authoritative = response.lobby ?? null;
            } catch { /* preserve original error */ }
        } finally {
            this.weaponUpdateInFlight = false;
            this.mutationInFlight = false;
            if (this.weaponDraft) {
                this.weaponDirty = true;
                if (this.weaponUpdateTimer === null) {
                    this.weaponUpdateTimer = window.setTimeout(() => void this.updateWeapons(), 0);
                }
            } else if (authoritative) {
                this.render(authoritative);
                this.setSaveState("武器已保存");
            }
        }
    }

    private async updateCommon(): Promise<void> {
        if (!this.session || !this.lobby?.isHost) return;
        this.commonUpdateTimer = null;
        if (this.commonUpdateInFlight || this.mutationInFlight) {
            this.commonUpdateTimer = window.setTimeout(() => void this.updateCommon(), 45);
            return;
        }
        const loadout = this.commonDraft ?? this.captureCommonDraft();
        this.commonDraft = null;
        this.commonDirty = false;
        this.mutationInFlight = true;
        this.commonUpdateInFlight = true;
        this.setSaveState("正在保存规则…");
        let authoritative: DuelLobbySnapshot | null = null;
        try {
            const response = await this.request("update", { ...this.session, loadout });
            authoritative = response.lobby ?? null;
        } catch (error) {
            this.showError(this.errorText(error));
            try {
                const response = await this.request("status", this.session);
                authoritative = response.lobby ?? null;
            } catch { /* preserve original error */ }
        } finally {
            this.commonUpdateInFlight = false;
            this.mutationInFlight = false;
            if (this.commonDraft) {
                this.commonDirty = true;
                if (this.commonUpdateTimer === null) {
                    this.commonUpdateTimer = window.setTimeout(() => void this.updateCommon(), 0);
                }
            } else if (authoritative) {
                this.render(authoritative);
                this.setSaveState("规则已保存");
            }
        }
    }

    private async flushUpdates(): Promise<void> {
        if (this.weaponUpdateTimer !== null) {
            window.clearTimeout(this.weaponUpdateTimer);
            this.weaponUpdateTimer = null;
            await this.updateWeapons();
        }
        if (this.throwableUpdateTimer !== null) {
            window.clearTimeout(this.throwableUpdateTimer);
            this.throwableUpdateTimer = null;
            await this.updateThrowables();
        }
        if (this.commonUpdateTimer !== null) {
            window.clearTimeout(this.commonUpdateTimer);
            this.commonUpdateTimer = null;
            await this.updateCommon();
        }
        while (
            this.mutationInFlight
            || this.weaponUpdateInFlight
            || this.throwableUpdateInFlight
            || this.commonUpdateInFlight
        ) {
            await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
        if (this.weaponDraft) await this.updateWeapons();
        if (this.throwableDraft) await this.updateThrowables();
        if (this.commonDraft) await this.updateCommon();
    }

    private handleMatch(lobby: DuelLobbySnapshot): void {
        if (!lobby.matchData || !lobby.matchId || lobby.matchId === this.lastJoinedMatchId) return;
        this.lastJoinedMatchId = lobby.matchId;
        this.inMatch = true;
        this.stopPolling();
        this.modal.prop("hidden", true);
        this.onMatchReady(lobby.matchData, false);
    }
    private statusText(lobby: DuelLobbySnapshot): string {
        if (lobby.status === "starting") return "正在创建竞技场…";
        if (lobby.status === "playing") return "对局进行中";
        if (lobby.awaitingReturns) {
            return `等待双方返回大厅（${lobby.returnedCount}/${lobby.players.filter((p) => !p.ai).length}）`;
        }
        if (lobby.loadout.aiEnabled) return "AI 已就绪，可立即开始";
        return lobby.players.length < 2 ? "等待好友加入" : "双方已就绪";
    }

    private async request(action: string, body: object): Promise<DuelLobbyResponse> {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch("/api/duel-lobby", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...body }),
                signal: controller.signal,
            });
            const result = await parseJsonResponse<DuelLobbyResponse>(response);
            if (!response.ok || result.err) throw new Error(result.err || `请求失败（${response.status}）`);
            return result;
        } finally {
            window.clearTimeout(timeout);
        }
    }
    private async withPending(action: () => Promise<void>): Promise<void> {
        if (this.pending) return;
        this.pending = true;
        this.showError("");
        try {
            await action();
        } catch (error) {
            this.showError(this.errorText(error));
        } finally {
            this.pending = false;
        }
    }

    private restoreSession(): void {
        try {
            const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as DuelLobbySession | null;
            if (value?.code && value.memberToken) this.session = value;
        } catch {
            sessionStorage.removeItem(SESSION_KEY);
        }
    }
    private clearMembership(): void {
        this.session = null;
        this.lobby = null;
        this.inMatch = false;
        this.lastJoinedMatchId = null;
        this.commonDraft = null;
        this.weaponDraft = null;
        this.throwableDraft = null;
        this.commonDirty = false;
        this.weaponDirty = false;
        this.throwableDirty = false;
        this.commonUpdateInFlight = false;
        this.weaponUpdateInFlight = false;
        this.throwableUpdateInFlight = false;
        this.mutationInFlight = false;
        sessionStorage.removeItem(SESSION_KEY);
        const url = new URL(window.location.href);
        url.searchParams.delete("duelLobby");
        history.replaceState({}, document.title, url.toString());
    }
    private clearTimers(): void {
        if (this.commonUpdateTimer !== null) window.clearTimeout(this.commonUpdateTimer);
        if (this.weaponUpdateTimer !== null) window.clearTimeout(this.weaponUpdateTimer);
        if (this.throwableUpdateTimer !== null) window.clearTimeout(this.throwableUpdateTimer);
        this.commonUpdateTimer = this.weaponUpdateTimer = this.throwableUpdateTimer = null;
        this.commonDraft = null;
        this.weaponDraft = null;
        this.throwableDraft = null;
        this.commonDirty = false;
        this.weaponDirty = false;
        this.throwableDirty = false;
        this.commonUpdateInFlight = false;
        this.weaponUpdateInFlight = false;
        this.throwableUpdateInFlight = false;
        this.mutationInFlight = false;
    }
    private showEntry(): void {
        this.entry.prop("hidden", false);
        this.room.prop("hidden", true);
    }
    private showRoom(): void {
        this.entry.prop("hidden", true);
        this.room.prop("hidden", false);
    }
    private showError(value: string): void {
        this.error.text(value);
    }
    private setStatus(value: string): void {
        $("#duel-lobby-status").text(value);
    }
    private setSaveState(value: string): void {
        $("#duel-lobby-save-state").text(value);
    }
    private normalizeCode(input: JQuery<HTMLInputElement>, length: number): void {
        input.val(String(input.val() ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length));
    }
    private inviteUrl(code: string): string {
        const url = new URL(window.location.href);
        url.searchParams.set("duelLobby", code);
        url.searchParams.delete("duelWatch");
        return url.toString();
    }
    private setInviteQuery(code: string): void {
        history.replaceState({}, document.title, this.inviteUrl(code));
    }
    private async copyText(value: string, success: string): Promise<boolean> {
        try {
            await navigator.clipboard.writeText(value);
            this.notifyCopied(success);
            return true;
        } catch {
            // 剪贴板 API 不可用/被拒绝（例如非 HTTPS 局域网访问）时，
            // 回退到隐藏 textarea + execCommand 复制。
            if (this.copyWithFallback(value)) {
                this.notifyCopied(success);
                return true;
            }
            // 最后兜底：弹出内容对话框，用户可手动选中复制。
            try {
                const result = window.prompt(
                    "浏览器禁止自动复制，请手动复制以下内容：",
                    value,
                );
                if (result !== null) {
                    this.notifyCopied(`${success}（请手动复制内容）`);
                    return true;
                }
            } catch {
                // prompt 不可用时继续走错误提示
            }
            this.showError("复制失败：浏览器禁止自动复制，请手动复制");
            return false;
        }
    }

    private copyWithFallback(value: string): boolean {
        try {
            const textarea = document.createElement("textarea");
            textarea.value = value;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.top = "0";
            textarea.style.left = "0";
            textarea.style.opacity = "0";
            textarea.style.pointerEvents = "none";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(textarea);
            return ok;
        } catch {
            return false;
        }
    }

    private notifyCopied(message: string): void {
        this.setStatus(message);
        const toast = $("#duel-lobby-toast");
        toast.text(message).prop("hidden", false);
        if (this.copyToastTimer !== null) window.clearTimeout(this.copyToastTimer);
        this.copyToastTimer = window.setTimeout(() => toast.prop("hidden", true), 1800);
    }
    private errorText(error: unknown): string {
        return error instanceof Error
            ? (error.name === "AbortError" ? "请求超时，请检查服务端" : error.message)
            : String(error);
    }
}
