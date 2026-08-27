import $ from "jquery";
import { type MapDefKey, MapDefs } from "../../shared/defs/mapDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import type { SiteInfoRes } from "../../shared/types/api.ts";
import { api } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import { device } from "./device.ts";
import type { Localization } from "./ui/localization.ts";

export type ExtendedSiteInfoRes = Omit<SiteInfoRes, "modes"> & {
    modes: Array<SiteInfoRes["modes"][number] & { title?: string }>;
    duelRoomEnabled?: boolean;
    sandevistan?: { worldTimeScale?: number };
    announcement?: {
        heading: string;
        updatedAt: string;
        date?: string;
        title: string;
        body: string;
    };
    extractionSecret?: { enabled: boolean };
};

export class SiteInfo {
    info = {} as ExtendedSiteInfoRes;
    loaded = false;
    private regionsPopulated = false;

    constructor(
        public config: ConfigManager,
        public localization: Localization,
    ) {
    }

    load(onLoaded?: () => void) {
        if (!this.regionsPopulated) {
            const mainSelector = $("#server-opts");
            const teamSelector = $("#team-server-opts");
            for (const region in GAME_REGIONS) {
                const data = GAME_REGIONS[region];
                const name = this.localization.translate(data.l10n);
                const elm = `<option value='${region}' data-l10n='${data.l10n}' data-label='${name}'>${name}</option>`;
                mainSelector.append(elm);
                teamSelector.append(elm);
            }
            this.regionsPopulated = true;
        }

        this.refresh(onLoaded);
    }

    refresh(onLoaded?: () => void) {
        const locale = this.localization.getLocale();

        const siteInfoUrl = api.resolveUrl(
            `/api/site_info?language=${locale}&_=${Date.now()}`,
        );
        fetch(siteInfoUrl).then(res => res.json()).then((data: ExtendedSiteInfoRes) => {
            this.info = data || {};
            this.loaded = true;
            this.updatePageFromInfo();
            onLoaded?.();
        });
    }

    getGameModeStyles() {
        const availableModes = [];
        const modes = this.info.modes || [];
        for (let i = 0; i < modes.length; i++) {
            const mode = modes[i];
            const mapDef = (MapDefs[mode.mapName as MapDefKey] || MapDefs.main)
                .desc;
            const buttonText = mapDef.buttonText
                ? mapDef.buttonText
                : GameConfig.TeamModeToString[mode.teamMode];
            const showTeamSuffix = Boolean(
                mapDef.buttonText
                    && modes.filter((candidate) => candidate.mapName === mode.mapName).length > 1,
            );
            availableModes.push({
                mapName: mode.mapName,
                title: mode.title || mapDef.name,
                icon: mapDef.icon,
                buttonCss: mapDef.buttonCss,
                buttonText,
                teamMode: mode.teamMode,
                teamButtonText: GameConfig.TeamModeToString[mode.teamMode],
                showTeamSuffix,
                enabled: mode.enabled,
            });
        }
        return availableModes;
    }

    updatePageFromInfo() {
        if (this.loaded) {
            this.renderAnnouncement();
            const getGameModeStyles = this.getGameModeStyles();
            const extraModeButtons = $("#extra-mode-buttons");
            const allModesList = $("#all-modes-list");
            extraModeButtons.empty();
            allModesList.empty();
            // Rebuild mode-specific visibility from the new snapshot. This is
            // required when an administrator flips a mode while the page is open.
            $("#extraction-mode-section, #extraction-secret-section, #btn-zombie-lobby")
                .hide();
            // These buttons are present in the original static HTML. Hide them
            // first so a closed playlist disappears just like a closed event
            // playlist; enabled entries are shown again below.
            $("#btn-start-mode-0, #btn-start-mode-1, #btn-start-mode-2, #btn-start-mode-3").hide();
            // Private room mode is controlled independently from public random 1v1.
            $("#btns-duel-start").toggle(this.info.duelRoomEnabled !== false);
            $("#btn-team-queue-mode-1, #btn-team-queue-mode-2").hide();
            const renderedSpecialEntries = new Set<string>();
            for (let i = 0; i < getGameModeStyles.length; i++) {
                const style = getGameModeStyles[i];
                // Keep all zombie team-size indices available to the dedicated
                // lobby even while those public buttons are unlisted.
                if (style.mapName === "zombie") {
                    if (style.teamButtonText === "solo") {
                        $("#btn-zombie-lobby-solo").data("game-mode-index", i);
                    } else if (style.teamButtonText === "duo") {
                        $("#btn-zombie-lobby-duo").data("game-mode-index", i);
                    } else if (style.teamButtonText === "squad") {
                        $("#btn-zombie-lobby-squad").data("game-mode-index", i);
                    }
                }
                // The all-modes chooser intentionally includes disabled
                // playlists, while extraction stays on its dedicated UI.
                if (
                    style.mapName !== "extraction"
                    && style.mapName !== "extraction_secret"
                ) {
                    const specialLobby = style.mapName === "duel"
                            || style.mapName === "zombie"
                        ? style.mapName
                        : "";
                    const shouldRenderEntry = !specialLobby
                        || !renderedSpecialEntries.has(specialLobby);
                    if (shouldRenderEntry) {
                        if (specialLobby) renderedSpecialEntries.add(specialLobby);
                        const selectorTeamLabel = this.localization.translate(
                            `index-${style.teamButtonText}`,
                        );
                        const entry = $("<a>", {
                            class: "btn-darken menu-option all-modes-entry",
                        });
                        entry.attr("data-game-mode-index", i);
                        entry.attr("data-team-mode", style.teamMode);
                        if (specialLobby) entry.attr("data-special-lobby", specialLobby);
                        const entryLabel = specialLobby === "duel"
                            ? "1v1大厅"
                            : specialLobby === "zombie"
                            ? "僵尸模式"
                            : style.mapName === "faction"
                            ? "50v50"
                            : `${style.title || style.mapName} · ${selectorTeamLabel}`;
                        entry.append(
                            $("<span>", { class: "all-modes-entry-label" }).text(
                                entryLabel,
                            ),
                        );
                        allModesList.append(entry);
                        // 1v1 and zombie each open a dedicated lobby, so their
                        // remaining team variants are intentionally omitted.
                    }
                }
                if (!style.enabled) continue;
                // Sandevistan is exposed as a single Solo playlist; the badge
                // is the whole button label.
                if (
                    style.mapName === "sandevistan"
                    && style.teamButtonText !== "solo"
                ) {
                    continue;
                }
                // 搜打撤 gets its own dedicated menu section (start / invite
                // team / stash), so it must not also render a generic playlist
                // button here.
                if (style.mapName === "extraction") {
                    if (style.teamButtonText === "solo") {
                        $("#btn-extraction-start").data("game-mode-index", i);
                        $("#extraction-mode-section").css("display", "flex");
                    } else if (style.teamButtonText === "duo") {
                        $("#btn-extraction-team").data("extraction-duo-index", i);
                    } else if (style.teamButtonText === "squad") {
                        $("#btn-extraction-squad-team").data(
                            "extraction-squad-index",
                            i,
                        );
                    }
                    continue;
                }
                // 绝密搜打撤 has its own dedicated red entry in the same menu
                // section, so it must not render a generic playlist button.
                if (style.mapName === "extraction_secret") {
                    if (style.teamButtonText === "solo") {
                        $("#btn-extraction-secret-start").data("game-mode-index", i);
                        $("#extraction-mode-section").css("display", "flex");
                        $("#extraction-secret-section").css("display", "flex");
                    } else if (style.teamButtonText === "duo") {
                        $("#btn-extraction-secret-team").data(
                            "extraction-secret-duo-index",
                            i,
                        );
                    } else if (style.teamButtonText === "squad") {
                        $("#btn-extraction-secret-squad-team").data(
                            "extraction-secret-squad-index",
                            i,
                        );
                    }
                    continue;
                }
                // 僵尸模式：主菜单只显示一个"僵尸模式"入口，点击打开大厅
                // 选择单人 / 双人 / 四人（类似 1v1 大厅）。
                if (style.mapName === "zombie") {
                    if (style.teamButtonText === "solo") {
                        $("#btn-zombie-lobby").show();
                    }
                    continue;
                }
                const selector = `index-play-${style.buttonText}`;
                let btn = $(`#btn-start-mode-${i}`);
                if (!btn.length) {
                    btn = $("<a>", {
                        id: `btn-start-mode-${i}`,
                        class: "btn-green btn-darken menu-option quick-play-mode-button",
                    });
                    btn.attr("data-game-mode-index", i);
                    extraModeButtons.append(btn);
                }
                btn.show();
                btn.data("l10n", selector);
                btn.data("game-mode-index", i);
                const teamLabel = this.localization.translate(`index-${style.teamButtonText}`);
                const playLabel = this.localization.translate(selector);
                const fullPlayLabel = style.mapName === "sandevistan"
                    ? ""
                    : style.mapName === "main"
                    ? playLabel
                    : style.mapName === "duel"
                    ? "随机1v1"
                    : style.mapName === "duel_ai"
                    ? "私人1v1"
                    : style.mapName === "potato" || style.mapName === "faction"
                    ? style.showTeamSuffix
                        ? `${playLabel} · ${teamLabel}`
                        : playLabel
                    : `${style.title} · ${teamLabel}`;
                btn.data("label", fullPlayLabel);
                btn.html(fullPlayLabel);
                if (style.mapName === "sandevistan") {
                    btn.prepend(
                        "<span class='sandevistan-mode-badge' aria-hidden='true'><i>2</i><i>0</i><i>7</i><i>7</i></span>",
                    );
                }
                if (style.icon || style.buttonCss) {
                    if (i == 0) {
                        btn.addClass("btn-custom-mode-no-indent");
                    } else {
                        btn.addClass("btn-custom-mode-main");
                    }
                    btn.addClass(style.buttonCss);
                    btn.css({
                        "background-image": `url(${style.icon})`,
                    });
                }
                const l = $(`#btn-team-queue-mode-${i}`);
                if (l.length) {
                    l.show();
                    const c = `index-${style.buttonText}`;
                    l.data("l10n", c);
                    const queueLabel = this.localization.translate(c);
                    l.html(style.showTeamSuffix ? `${queueLabel} · ${teamLabel}` : queueLabel);
                    if (style.icon) {
                        l.addClass("btn-custom-mode-select");
                        l.css({
                            "background-image": `url(${style.icon})`,
                        });
                    }
                }

                btn.toggle(style.enabled);
                btn.removeClass("btn-disabled-main");
            }
            const supportsTeam = this.info.modes.some((s) => s.enabled && s.teamMode > 1);
            $("#btn-join-team, #btn-create-team").toggle(supportsTeam);

            // Avoid leaving an empty flex row when both original team queues are closed.
            $("#btns-quick-start").toggle(
                getGameModeStyles.slice(1, 3).some((style) => style.enabled),
            );

            // Region pops
            const pops = this.info.pops;
            if (pops) {
                const regions = Object.keys(pops);

                for (let i = 0; i < regions.length; i++) {
                    const region = regions[i];
                    const data = pops[region];
                    const sel = $("#server-opts").children(`option[value="${region}"]`);
                    const players = this.localization.translate("index-players");
                    sel.text(`${sel.data("label")} [${data.playerCount} ${players}]`);
                }
            }
            let hasTwitchStreamers = false;
            const featuredStreamersElem = $("#featured-streamers");
            const streamerList = $(".streamer-list");
            if (!device.mobile && this.info.twitch) {
                streamerList.empty();
                for (let i = 0; i < this.info.twitch.length; i++) {
                    const streamer = this.info.twitch[i];
                    const template = $("#featured-streamer-template").clone();
                    template
                        .attr("class", "featured-streamer streamer-tooltip")
                        .attr("id", "");
                    const link = template.find("a");
                    const text = this.localization.translate(
                        streamer.viewers == 1 ? "index-viewer" : "index-viewers",
                    );
                    link.html(
                        `${streamer.name} <span>${streamer.viewers} ${text}</span>`,
                    );
                    link.css("background-image", `url(${streamer.img})`);
                    link.attr("href", streamer.url);
                    streamerList.append(template);
                    hasTwitchStreamers = true;
                }
            }
            featuredStreamersElem.css(
                "visibility",
                hasTwitchStreamers ? "visible" : "hidden",
            );

            const featuredYoutuberElem = $("#featured-youtuber");
            const displayYoutuber = this.info.youtube;
            if (displayYoutuber) {
                $(".btn-youtuber")
                    .attr("href", this.info.youtube.link)
                    .html(this.info.youtube.name);
            }
            featuredYoutuberElem.css("display", displayYoutuber ? "block" : "none");

            const mapDef = MapDefs[this.info.clientTheme];
            if (mapDef) {
                this.config.set("cachedBgImg", mapDef.desc.backgroundImg);
                const bg = document.getElementById("background");
                if (bg) {
                    bg.style.backgroundImage = `url(${mapDef.desc.backgroundImg})`;
                }
            }
        }
    }

    private renderAnnouncement() {
        const announcement = this.info.announcement;
        if (!announcement) return;

        // 主页只显示后台编辑的公告。清掉旧客户端 HTML 或曾经由
        // news.json 注入的自动更新日志，避免它和后台 What's New! 混在一起。
        const news = $("#news");
        news.children().not("#news-announcement").remove();
        let block = $("#news-announcement");
        if (block.length === 0) {
            block = $("<div/>", {
                id: "news-announcement",
                class: "news-announcement",
            })
                .css("border-bottom", "1px solid rgba(255,255,255,0.15)")
                .css("margin-bottom", "12px")
                .css("padding-bottom", "10px");
            news.prepend(block);
        }
        block.empty();
        block.append($("<h3/>", { class: "news-header", text: announcement.heading }));
        const current = $("<div/>", {
            id: "news-current",
            "data-date": announcement.updatedAt,
        });
        if (announcement.date) {
            current.append($("<small/>", { class: "news-date", text: announcement.date }));
        }
        current.append(
            $("<p/>", { class: "news-paragraph" }).append(
                $("<strong/>", { text: announcement.title }),
            ),
        );
        for (const paragraph of announcement.body.split(/\n{2,}/)) {
            current.append(
                $("<p/>", {
                    class: "news-paragraph news-paragraph-custom",
                    text: paragraph,
                }),
            );
        }
        block.append(current);
    }
}
