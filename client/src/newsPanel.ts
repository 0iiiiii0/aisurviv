import $ from "jquery";

interface NewsItem {
    version: string;
    title: string;
    summary: string;
    date: string;
}

interface NewsPayload {
    generatedAt: string;
    items: NewsItem[];
}

/**
 * Renders the lobby "What's New!" panel from client/public/news.json, which
 * is regenerated automatically from the newest changelog entries whenever the
 * client is built. Falls back silently to the static/announcement content
 * already present in the DOM when the file is unavailable.
 */
export function initNewsPanel(): void {
    fetch("news.json", { cache: "no-cache" })
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<NewsPayload>;
        })
        .then((payload) => {
            const items = Array.isArray(payload?.items)
                ? payload.items.slice(0, 5)
                : [];
            if (items.length === 0) return;

            // 保留后台"主页公告"块（#news-announcement），只清掉静态默认与上一次列表。
            const news = $("#news");
            news.children().not("#news-announcement").remove();
            news.attr("data-source", "news-json");
            news.append($("<h3/>", { class: "news-header", text: "What's New!" }));
            for (const item of items) {
                const entry = $("<div/>", { "data-date": item.date || "" });
                entry.append(
                    $("<small/>", {
                        class: "news-date",
                        text: `${item.version} · ${item.date}`,
                    }),
                );
                const title = item.title.replace(/^V\d+\s*/, "");
                entry.append(
                    $("<p/>", { class: "news-paragraph" }).append(
                        $("<strong/>", { text: title }),
                    ),
                );
                if (item.summary) {
                    entry.append(
                        $("<p/>", {
                            class: "news-paragraph news-paragraph-custom",
                            text: item.summary,
                        }),
                    );
                }
                news.append(entry);
            }
        })
        .catch(() => {
            // Keep the existing static/announcement content.
        });
}
