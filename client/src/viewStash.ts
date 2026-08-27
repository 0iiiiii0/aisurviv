import $ from "jquery";
import { esc, itemImage, itemName, sessionToken } from "./extractionStashUi.ts";

/**
 * 独立「查看他人仓库」页（/view-stash?name=<账号名>）：
 * 只加载被查看账号的仓库（只读），与 /storage 自己的仓库页完全无关。
 * 玩家用「账号名称」标识（仓库按账号名称存储），与游戏内昵称无关。
 */

interface PublicStashView {
    name: string;
    coins: number;
    score: number;
    level: number;
    items: Record<string, Record<string, number>>;
    /** 购买后入库、进局使用后消耗的独立能力库存。 */
    oneTimePerks?: string[];
}

async function loadStashView(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const accountName = (params.get("name") ?? "").trim();
    const grid = $("#stash-view-full-grid");
    const title = $("#stash-view-full-title");
    const sub = $("#stash-view-full-sub");

    if (!sessionToken()) {
        title.text("查看仓库");
        sub.text("");
        grid.html(
            "<div class=\"storage-leaderboard-error\">请先登录后查看他人仓库</div>",
        );
        return;
    }
    if (!accountName) {
        title.text("查看仓库");
        sub.text("");
        grid.html(
            "<div class=\"storage-leaderboard-error\">缺少玩家账号参数</div>",
        );
        return;
    }

    title.text(`查看 ${accountName} 的仓库`);
    sub.text("加载中…");
    grid.html("<div class=\"storage-leaderboard-loading\">加载中…</div>");
    try {
        const response = await fetch("/api/stash/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: sessionToken(), name: accountName }),
        });
        const data = (await response.json()) as {
            ok?: boolean;
            err?: string;
            stash?: PublicStashView;
        };
        if (!response.ok || !data.ok || !data.stash) {
            throw new Error(data.err || "未找到该玩家的仓库");
        }
        const stash = data.stash;
        // 校验返回的账号名与请求一致，绝不错显示。
        if (
            String(stash.name ?? "")
                .trim()
                .toLowerCase() !== accountName.toLowerCase()
        ) {
            throw new Error("仓库数据校验失败，请重试");
        }
        title.text(`${stash.name} 的仓库`);
        sub.text(
            `Lv.${stash.level} · 身价 ${stash.score.toLocaleString()} · 金币 ${stash.coins.toLocaleString()}`,
        );
        grid.html(renderPublicStash(stash));
    } catch (error) {
        grid.html(
            `<div class='storage-leaderboard-error'>${
                esc(
                    error instanceof Error ? error.message : "加载失败",
                )
            }</div>`,
        );
    }
}

function renderPublicStash(stash: PublicStashView): string {
    const oneTimePerks: Record<string, number> = {};
    for (const type of stash.oneTimePerks ?? []) {
        oneTimePerks[type] = (oneTimePerks[type] ?? 0) + 1;
    }
    const sections: Array<[string, Record<string, number> | undefined]> = [
        ["枪械", stash.items?.guns],
        ["近战", stash.items?.melee],
        ["头盔", stash.items?.helmets],
        ["护甲", stash.items?.chests],
        ["背包", stash.items?.backpacks],
        ["倍镜", stash.items?.scopes],
        ["弹药", stash.items?.ammo],
        ["药品", stash.items?.consumables],
        ["投掷物", stash.items?.throwables],
        ["能力", stash.items?.perks],
        ["一次性能力（仅限一局）", oneTimePerks],
    ];
    const parts: string[] = [];
    for (const [label, record] of sections) {
        const entries = Object.entries(record ?? {}).filter(
            ([, count]) => Number(count) > 0,
        );
        if (entries.length === 0) continue;
        const cells = entries
            .map(([type, count]) => {
                try {
                    return `<div class='stash-view-item' title='${esc(itemName(type))}'>
                        <img src='${itemImage(type)}' alt='' draggable='false'/>
                        <span>${esc(itemName(type))}</span>
                        <em>×${count}</em>
                    </div>`;
                } catch {
                    return "";
                }
            })
            .join("");
        parts.push(
            `<div class='stash-section'><h3>${label}</h3><div class='stash-grid'>${cells}</div></div>`,
        );
    }
    return (
        parts.join("")
        || "<div class=\"storage-leaderboard-empty\">仓库是空的</div>"
    );
}

void loadStashView();
