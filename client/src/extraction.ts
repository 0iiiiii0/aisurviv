import $ from "jquery";
import { AchievementDefs, type AchievementId, isAchievementId } from "../../shared/defs/achievementDefs.ts";
import { esc, sessionToken } from "./extractionStashUi.ts";

/**
 * 独立「搜打撤」页（/extraction）：排行榜 + 查看他人仓库。
 * 排行榜数据来自 /api/leaderboard（需登录），查看跳转到
 * /view-stash?name=<账号名> 的独立仓库查看界面。
 */

interface LeaderboardEntry {
    name: string;
    coins: number;
    score: number;
    level: number;
    achievements: AchievementId[];
}

function achievementBadges(ids: unknown): string {
    if (!Array.isArray(ids)) return "";
    return ids
        .filter(isAchievementId)
        .map((id) => {
            const def = AchievementDefs[id];
            return `<img class='storage-achievement-badge' src='${esc(def.icon)}' alt='${esc(def.name)}' title='成就：${
                esc(def.name)
            } — ${esc(def.description)}'>`;
        })
        .join("");
}

async function leaderboardApi<T>(
    url: string,
    body: Record<string, unknown>,
): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return (await response.json()) as T;
}

async function loadLeaderboard(): Promise<void> {
    const list = $("#leaderboard-list");
    list.html("<div class=\"storage-leaderboard-loading\">加载中…</div>");
    try {
        const data = await leaderboardApi<{
            ok?: boolean;
            err?: string;
            players?: LeaderboardEntry[];
        }>("/api/leaderboard", { token: sessionToken() });
        if (!data.ok || !data.players) throw new Error(data.err || "加载失败");
        if (data.players.length === 0) {
            list.html("<div class=\"storage-leaderboard-empty\">暂无排行数据</div>");
            return;
        }
        list.html(
            data.players
                .map(
                    (p, i) =>
                        `<div class='storage-leaderboard-row ${i === 0 ? "rank-first" : ""}'>
                            <span class='storage-leaderboard-rank'>${i + 1}</span>
                            <span class='storage-leaderboard-name'><span>${
                            esc(p.name)
                        }</span><span class='storage-achievements'>${achievementBadges(p.achievements)}</span></span>
                            <span class='storage-leaderboard-level'>Lv.${p.level}</span>
                            <span class='storage-leaderboard-score'>${p.score.toLocaleString()}</span>
                            <button type='button' class='shop-btn storage-leaderboard-view'
                                data-name='${esc(p.name)}'>查看</button>
                        </div>`,
                )
                .join(""),
        );
        list.off("click", ".storage-leaderboard-view");
        list.on("click", ".storage-leaderboard-view", (event) => {
            const name = $(event.currentTarget).attr("data-name") || "";
            if (name) {
                window.location.href = `/view-stash?name=${encodeURIComponent(name)}`;
            }
        });
    } catch (error) {
        list.html(
            `<div class='storage-leaderboard-error'>${
                esc(
                    error instanceof Error ? error.message : "加载失败",
                )
            }</div>`,
        );
    }
}

function init(): void {
    if (!sessionToken()) {
        $("#leaderboard-list").html(
            `<div class='storage-leaderboard-error'>请先登录后查看排行榜</div>`,
        );
        return;
    }
    $("#leaderboard-search-btn").on("click", () => {
        const name = String($("#leaderboard-search-input").val() ?? "").trim();
        if (name) {
            window.location.href = `/view-stash?name=${encodeURIComponent(name)}`;
        }
    });
    $("#leaderboard-search-input").on("keydown", (event) => {
        if (event.key === "Enter") {
            const name = String($("#leaderboard-search-input").val() ?? "").trim();
            if (name) {
                window.location.href = `/view-stash?name=${encodeURIComponent(name)}`;
            }
        }
    });
    void loadLeaderboard();
}

init();
