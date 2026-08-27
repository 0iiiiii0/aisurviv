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

interface SpectateRoom {
    gameId: string;
    mapName: string;
    teamMode: number;
    displayName: string;
    maxPlayers: number;
    aliveCount: number;
    connectedCount: number;
    humanPlayerCount: number;
    aiPlayerCount: number;
    spectatorCount: number;
    startedTime: number;
}

interface SpectateRoomsResponse {
    err?: string;
    games?: SpectateRoom[];
}

interface SpectateJoinResponse {
    err?: string;
    matchData?: MatchData;
}

const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Lobby spectator browser: lists live rooms and joins any of them as observer. */
export class SpectateLobby {
    private readonly modal = $("#spectate-lobby-modal");
    private readonly list = $("#spectate-lobby-list");
    private readonly empty = $("#spectate-lobby-empty");
    private readonly error = $("#spectate-lobby-error");
    private readonly count = $("#spectate-lobby-count");
    private readonly refreshButton = $("#spectate-lobby-refresh");
    private pollTimer: number | null = null;
    /** Room polling must never swallow a user's explicit watch request. */
    private loadingRooms = false;
    private joiningGame = false;

    constructor(
        private readonly onMatchReady: (matchData: MatchData) => void,
    ) {}

    init(): void {
        $("#btn-spectate-lobby").on("click", () => this.open());
        $("#spectate-lobby-close").on("click", () => this.close());
        this.modal.on("click", (event) => {
            if (event.target === this.modal[0]) this.close();
        });
        this.refreshButton.on("click", () => void this.load(false));
    }

    open(): void {
        this.modal.prop("hidden", false);
        this.showError("");
        void this.load(false);
        if (this.pollTimer === null) {
            this.pollTimer = window.setInterval(() => {
                if (!this.loadingRooms && !this.joiningGame) void this.load(true);
            }, POLL_INTERVAL_MS);
        }
    }

    close(): void {
        this.modal.prop("hidden", true);
        if (this.pollTimer !== null) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private async load(silent: boolean): Promise<void> {
        if (this.loadingRooms || this.joiningGame) return;
        this.loadingRooms = true;
        if (!silent) this.refreshButton.prop("disabled", true);
        const controller = new AbortController();
        const timeout = window.setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS,
        );
        try {
            const response = await fetch("/api/spectate/rooms", {
                signal: controller.signal,
            });
            const result = await parseJsonResponse<SpectateRoomsResponse>(response);
            if (!response.ok || result.err) {
                throw new Error(result.err || `请求失败：${response.status}`);
            }
            this.render(result.games ?? []);
        } catch (error) {
            if (!silent) this.showError(this.errorText(error));
        } finally {
            window.clearTimeout(timeout);
            this.loadingRooms = false;
            if (!silent && !this.joiningGame) this.refreshButton.prop("disabled", false);
        }
    }

    private render(games: SpectateRoom[]): void {
        this.count.text(`共 ${games.length} 个房间`);
        this.empty.prop("hidden", games.length > 0);
        this.list.empty();
        for (const game of games) {
            const row = $("<div>").addClass("spectate-room");
            const info = $("<div>").addClass("spectate-room-info");
            const name = $("<strong>").text(game.displayName);
            const meta = $("<small>").text(
                `存活 ${game.aliveCount} / ${game.maxPlayers} · 真人 ${game.humanPlayerCount} · AI ${game.aiPlayerCount}`,
            );
            info.append(name, meta);
            const watch = $("<button>")
                .addClass("spectate-room-watch")
                .text("观战")
                .prop("disabled", this.joiningGame)
                .on("click", () => void this.watch(game));
            row.append(info, watch);
            this.list.append(row);
        }
    }

    private async watch(game: SpectateRoom): Promise<void> {
        if (this.joiningGame) return;
        this.joiningGame = true;
        this.showError("");
        this.count.text(`正在进入 ${game.displayName}…`);
        this.refreshButton.prop("disabled", true);
        this.list.find("button").prop("disabled", true);
        const controller = new AbortController();
        const timeout = window.setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS,
        );
        try {
            const response = await fetch("/api/spectate/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameId: game.gameId }),
                signal: controller.signal,
            });
            const result = await parseJsonResponse<SpectateJoinResponse>(response);
            if (!response.ok || result.err) {
                throw new Error(result.err || `观战请求失败：${response.status}`);
            }
            if (!result.matchData) {
                throw new Error("服务器未返回对局信息");
            }
            this.close();
            this.onMatchReady(result.matchData);
        } catch (error) {
            this.showError(this.errorText(error));
            this.count.text("进入失败，请重试");
        } finally {
            window.clearTimeout(timeout);
            this.joiningGame = false;
            this.refreshButton.prop("disabled", false);
            this.list.find("button").prop("disabled", false);
        }
    }

    private showError(message: string): void {
        this.error.text(message);
    }

    private errorText(error: unknown): string {
        if (error instanceof DOMException && error.name === "AbortError") {
            return "请求超时，请重试";
        }
        return error instanceof Error ? error.message : String(error);
    }
}
