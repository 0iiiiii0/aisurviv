(function() {
    "use strict";

    const $ = (selector) => document.querySelector(selector);
    const { parseDraftNumber, normalizeDraftNumber } = window.SurvivAdminInput;
    const state = {
        session: sessionStorage.getItem("surviv-admin-session") || "",
        data: null,
        timer: null,
        autoRefreshTimer: null,
        refreshInFlight: false,
        refreshQueued: false,
        refreshPromise: null,
        lastAncillaryRefreshAt: 0,
        modeGroupsCollapsed: new Set(JSON.parse(localStorage.getItem("surviv-admin-mode-groups") || "[]")),
        duelDraft: null,
        duelDirty: false,
        duelPickerSlot: 0,
        announcementDraft: null,
        announcementDirty: false,
        liveAnnouncement: null,
        roomPlayerLimitsDraft: null,
        roomPlayerLimitsDirty: false,
        botAutoFillDraft: null,
        botAutoFillDirty: false,
        sandevistanDraft: null,
        sandevistanFocusedKey: null,
        pureAiCatalogSignature: "",
        extractionLoadoutsDirty: false,
        extractionLoadoutsEditing: false,
        secretExtractionLoadoutsDirty: false,
        secretExtractionLoadoutsEditing: false,
        stashAdminEditing: false,
    };
    const teamNames = { 1: "单人", 2: "双人", 4: "四人" };
    const ammoNames = {
        "9mm": "9毫米",
        "9mm_cursed": "诅咒弹药",
        "45acp": ".45 ACP",
        "50AE": ".50 AE",
        "556mm": "5.56毫米",
        "762mm": "7.62毫米",
        "12gauge": "12号霰弹",
        "308sub": ".308 Subsonic",
        flare: "信号弹",
        potato_ammo: "土豆弹药",
        bugle_ammo: "号角",
    };

    const loginView = $("#login-view");
    const dashboard = $("#dashboard");
    const loginForm = $("#login-form");
    const passwordInput = $("#password-input");
    const loginError = $("#login-error");
    const refreshButton = $("#refresh-button");
    const createForm = $("#create-game-form");
    const modeSelect = $("#mode-select");
    const gamesBody = $("#games-body");
    const roomPlayerLimitsForm = $("#room-player-limits-form");
    const roomLimitSolo = $("#room-limit-solo");
    const roomLimitDuo = $("#room-limit-duo");
    const roomLimitSquad = $("#room-limit-squad");
    const roomLimitFaction = $("#room-limit-faction");
    const pureAiDuelForm = $("#pure-ai-duel-form");
    const pureAiWatchLink = $("#pure-ai-watch-link");
    const duelWeaponForm = $("#duel-weapon-form");
    const saveDuelWeapons = $("#save-duel-weapons");
    const duelAdrenalineEnabled = $("#duel-adrenaline-enabled");
    const duelAiEnabled = $("#duel-ai-enabled");
    const duelAiDifficulty = $("#duel-ai-difficulty");
    const duelBoost = $("#duel-boost");
    const duelHelmetLevel = $("#duel-helmet-level");
    const duelChestLevel = $("#duel-chest-level");
    const duelScope = $("#duel-scope");
    const duelThrowables = $("#duel-throwables");
    const announcementForm = $("#announcement-form");
    const announcementHeading = $("#announcement-heading");
    const announcementDate = $("#announcement-date");
    const announcementTitle = $("#announcement-title");
    const announcementBody = $("#announcement-body");
    const saveAnnouncement = $("#save-announcement");
    const liveAnnouncementForm = $("#live-announcement-form");
    const liveAnnouncementMessage = $("#live-announcement-message");
    const liveAnnouncementDuration = $("#live-announcement-duration");
    const liveAnnouncementStatus = $("#live-announcement-status");
    const clearLiveAnnouncement = $("#clear-live-announcement");
    const updateBlockStatusEl = $("#update-block-status");
    const updateBlockMinutes = $("#update-block-minutes");
    const btnUpdateBlockOn = $("#btn-update-block-on");
    const btnUpdateBlockOff = $("#btn-update-block-off");
    const weaponPicker = $("#weapon-picker");
    const weaponPickerTitle = $("#weapon-picker-title");
    const weaponSearch = $("#weapon-search");
    const weaponCategory = $("#weapon-category");
    const weaponCatalog = $("#weapon-catalog");
    // 通用枪械选择器状态（1v1 配装与搜打撤 AI 配装共用）。
    let weaponPickerCatalog = [];
    let weaponPickerCallback = null;
    let weaponPickerSelectedId = "";
    const botAutoFillForm = $("#bot-autofill-form");
    const botGlobalInterval = $("#bot-global-interval");
    const botMaxWorkers = $("#bot-max-workers");
    const botSoloTargetPlayerCount = $("#bot-solo-target-player-count");
    const botDuoTargetPlayerCount = $("#bot-duo-target-player-count");
    const botSquadTargetPlayerCount = $("#bot-squad-target-player-count");
    const botFactionTargetPlayerCount = $("#bot-faction-target-player-count");
    const botSecretSoloTargetPlayerCount = $("#bot-secret-solo-target-player-count");
    const botSecretDuoTargetPlayerCount = $("#bot-secret-duo-target-player-count");
    const botSecretSquadTargetPlayerCount = $("#bot-secret-squad-target-player-count");
    const botFillTargetsForm = $("#bot-fill-targets-form");
    const saveBotFillTargets = $("#save-bot-fill-targets");
    const saveBotAutoFill = $("#save-bot-autofill");
    const botRatioInputs = {
        normal: $("#bot-ratio-normal"),
        hard: $("#bot-ratio-hard"),
        pro: $("#bot-ratio-pro"),
        legit: $("#bot-ratio-legit"),
    };
    const botRatioTotal = $("#bot-ratio-total");
    const botThinkIntervalInputs = {
        normal: $("#bot-frequency-normal"),
        hard: $("#bot-frequency-hard"),
        pro: $("#bot-frequency-pro"),
        legit: $("#bot-frequency-legit"),
        forbidden: $("#bot-frequency-forbidden"),
    };
    const botFrequencySummary = $("#bot-frequency-summary");
    const changePasswordForm = $("#change-password-form");
    const currentPassword = $("#current-password");
    const newPassword = $("#new-password");
    const confirmPassword = $("#confirm-password");
    const autoRefreshInterval = $("#auto-refresh-interval");
    const roomFilter = $("#room-filter");
    const roomCount = $("#room-count");
    const modeSearch = $("#mode-search");
    const modeFilterOpen = $("#mode-filter-open");
    const modeGroupCount = $("#mode-group-count");
    const modeExpandAll = $("#mode-expand-all");
    const modeCollapseAll = $("#mode-collapse-all");
    const toast = $("#toast");
    let toastTimer;

    function headers() {
        const value = { "Content-Type": "application/json" };
        if (state.session) value["X-Admin-Session"] = state.session;
        return value;
    }

    const ADMIN_REQUEST_TIMEOUT_MS = 12_000;

    async function fetchAdmin(url, options = {}) {
        const controller = new AbortController();
        const externalSignal = options.signal;
        const relayAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort();
            else externalSignal.addEventListener("abort", relayAbort, { once: true });
        }
        const timeout = window.setTimeout(
            () => controller.abort(),
            ADMIN_REQUEST_TIMEOUT_MS,
        );
        try {
            const response = await fetch(url, {
                ...options,
                cache: "no-store",
                signal: controller.signal,
            });
            // Read the complete body before clearing the timeout. A server/proxy
            // can send headers and then stall; timing out fetch() alone would not
            // release that connection.
            const text = await response.text();
            return { response, text };
        } catch (error) {
            if (controller.signal.aborted && !externalSignal?.aborted) {
                throw new Error("管理接口响应超时，自动刷新将继续重试。");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
            externalSignal?.removeEventListener?.("abort", relayAbort);
        }
    }

    async function apiPublic(path, options = {}) {
        let response;
        let text;
        try {
            ({ response, text } = await fetchAdmin(`/admin-api${path}`, {
                ...options,
                headers: { "Content-Type": "application/json", ...options.headers },
            }));
        } catch (error) {
            if (error?.message?.includes("响应超时")) throw error;
            throw new Error("无法连接管理接口，请确认游戏服务端已启动。");
        }
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch (_) {
            body = { error: text };
        }
        if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
        return body;
    }

    async function api(path, options = {}) {
        let response;
        let text;
        try {
            ({ response, text } = await fetchAdmin(`/admin-api${path}`, {
                ...options,
                headers: { ...headers(), ...options.headers },
            }));
        } catch (error) {
            if (error?.message?.includes("响应超时")) throw error;
            throw new Error("无法连接管理接口，请确认游戏服务端已启动。");
        }
        if (response.status === 401 || response.status === 403) throw new Error("AUTH");
        if (response.status === 404) throw new Error("管理接口未启用，请检查服务端后台配置。");
        if (response.status === 503) throw new Error("生产环境尚未配置管理员令牌。");
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch (_) {
            body = { error: text };
        }
        if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
        return body;
    }

    function showLogin(message = "") {
        stopAutoRefresh();
        dashboard.hidden = true;
        loginView.hidden = false;
        loginError.textContent = message;
        passwordInput.value = "";
        setTimeout(() => passwordInput.focus(), 0);
    }

    function showDashboard() {
        loginView.hidden = true;
        dashboard.hidden = false;
    }

    function notify(message, isError = false) {
        clearTimeout(toastTimer);
        toast.textContent = message;
        toast.className = `toast visible${isError ? " error" : ""}`;
        toastTimer = setTimeout(() => {
            toast.className = "toast";
        }, 2800);
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return "—";
        return `${(bytes / 1024 / 1024).toFixed(bytes > 1024 * 1024 * 100 ? 0 : 1)} MB`;
    }

    function formatDuration(seconds) {
        seconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return hours ? `${hours}时 ${minutes}分` : minutes ? `${minutes}分 ${secs}秒` : `${secs}秒`;
    }

    function setText(selector, value) {
        $(selector).textContent = value;
    }

    function render(data) {
        state.data = data;
        const { server, summary, modes, games } = data;
        setText("#server-address", server.address);
        setText("#server-version", `v${server.version} · ${server.gitVersion}`);
        setText("#server-region", `区域 ${server.regionId}`);
        setText("#server-process", `${server.processMode === "single" ? "单进程" : "多进程"}模式`);
        setText("#server-uptime", `运行 ${formatDuration(server.uptimeSeconds)}`);
        setText("#human-player-count", summary.humanPlayerCount ?? 0);
        setText("#ai-player-count", summary.aiPlayerCount ?? 0);
        setText("#spectator-count", summary.spectatorCount ?? 0);
        setText("#game-count", summary.gameCount);
        setText("#joinable-count", summary.joinableGameCount);
        setText("#memory-rss", formatBytes(server.memoryRssBytes));
        setText("#memory-heap", formatBytes(server.heapUsedBytes));
        setText("#mode-count", modes.length);
        setText("#enabled-mode-count", modes.filter((mode) => mode.enabled).length);
        setText("#last-updated", `最后同步 ${new Date(server.now).toLocaleTimeString("zh-CN", { hour12: false })}`);
        $("#last-updated")?.classList.remove("sync-error");
        renderAnnouncement(data.announcement);
        renderLiveAnnouncement(data.liveAnnouncement);
        renderDuelConfig(data.duel);
        renderBotAutoFill(data.botAutoFill);
        renderRoomPlayerLimits(data.roomPlayerLimits);
        renderExtractionSecret(data.extractionSecret);
        renderExtractionBoss(data.extractionBoss);
        renderExtractionHunters(data.extractionHunters);
        renderUpdateBlock(data.updateBlock);
        renderPureAiControls(data.duel);
        renderModes(modes);
        renderGames(games, modes);
    }

    function renderUpdateBlock(status) {
        if (!status || !updateBlockStatusEl) return;
        const active = status.active === true;
        updateBlockStatusEl.textContent = active
            ? `维护中 · 剩余 ${formatDuration(status.remainingSeconds)}`
            : "未开启";
        updateBlockStatusEl.classList.toggle("active", active);
        if (btnUpdateBlockOn) btnUpdateBlockOn.disabled = active;
        if (btnUpdateBlockOff) btnUpdateBlockOff.disabled = !active;
    }

    function renderRoomPlayerLimits(limits) {
        if (!limits || state.roomPlayerLimitsDraft) return;
        state.roomPlayerLimitsDraft = { ...limits };
        state.roomPlayerLimitsDirty = false;
        roomLimitSolo.value = String(limits.solo);
        roomLimitDuo.value = String(limits.duo);
        roomLimitSquad.value = String(limits.squad);
        roomLimitFaction.value = String(limits.faction ?? 100);
        const status = $("#room-player-limits-status");
        if (status) {
            status.textContent = "";
            status.style.color = "";
        }
    }

    function renderExtractionSecret(config) {
        if (!config) return;
        if (extractionSecretEnabled) {
            extractionSecretEnabled.checked = config.enabled === true;
        }
        if (extractionSecretImmortalBoost) {
            extractionSecretImmortalBoost.checked = config.immortalBoost !== false;
        }
        if (extractionSecretDifficulty) {
            extractionSecretDifficulty.value = config.aiDifficulty || "normal";
        }
    }

    /** 渲染 Boss 掉落能力池（带图标的 chip，可点击删除）。 */
    function renderBossPerkPicks(el, selected) {
        if (!el) return;
        const chosen = Array.isArray(selected) ? selected : [];
        el.innerHTML = chosen.map((perk) => {
            const img = perkImage(perk);
            return (
                `<span class="boss-perk-chip boss-perk-chip-selected" title="${perk}" data-perk="${perk}">`
                + (img ? `<img src="${img}" alt="" draggable="false"/>` : "")
                + `<span>${perk}</span><b class="boss-perk-chip-x" title="移除">×</b></span>`
            );
        }).join("");
        // 点击 × 移除
        el.querySelectorAll(".boss-perk-chip-x").forEach((x) => {
            x.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const chip = x.closest("[data-perk]");
                if (!chip) return;
                const perk = chip.dataset.perk;
                const current = readBossPerkPicks(el);
                const next = current.filter((p) => p !== perk);
                renderBossPerkPicks(el, next);
            });
        });
        if (chosen.length === 0) {
            el.innerHTML = `<span class="boss-perk-picker-empty">未指定（自动从全部能力随机）</span>`;
        }
    }

    /** 读取 Boss 掉落能力池结果。 */
    function readBossPerkPicks(el) {
        if (!el) return [];
        return [...el.querySelectorAll("[data-perk]")].map((chip) => chip.dataset.perk);
    }

    /** 能力图标：优先服务端 stash-catalog 图片，缺省用 perk 图标路径。 */
    function perkImage(type) {
        if (stashCatalog) {
            for (const group of stashCatalog) {
                if (group.category !== "perks") continue;
                const entry = group.items.find((item) => item.type === type);
                if (entry && entry.image) return entry.image;
            }
        }
        const fallback = STASH_ITEM_IMAGES[type];
        if (fallback) return fallback;
        return "";
    }

    /** 弹出带图标的能力选择面板（单选池多选，复用武器选择器面板样式）。 */
    function openBossPerkPicker(targetEl = extractionBossPerks) {
        if (!targetEl) return;
        const items = [];
        if (stashCatalog) {
            const group = stashCatalog.find((g) => g.category === "perks");
            if (group) {
                for (const entry of group.items) {
                    items.push({ id: entry.type, label: entry.type, image: entry.image || "" });
                }
            }
        }
        if (items.length === 0) {
            for (const perk of BOSS_PERK_OPTIONS) {
                items.push({ id: perk, label: perk, image: perkImage(perk) });
            }
        }
        openWeaponPickerFor({
            title: "选择 Boss 能力",
            selectedId: "",
            onSelect: (perkId) => {
                const current = readBossPerkPicks(targetEl);
                if (!current.includes(perkId)) {
                    renderBossPerkPicks(targetEl, [...current, perkId]);
                }
            },
            catalog: items,
        });
    }

    /** 填充 Boss 护甲下拉（包含全部同类物品，服务端目录优先，缺省用本地列表）。
     *  幂等：下拉已有选项时跳过，避免刷新覆盖管理员正在选择的值。 */
    function populateBossArmorSelects() {
        const alreadyPopulated = (el) => el && el.querySelectorAll("option").length > 1;
        if (
            alreadyPopulated(extractionBossArmorHelmet)
            && alreadyPopulated(extractionBossArmorChest)
            && alreadyPopulated(extractionBossArmorBackpack)
            && alreadyPopulated(extractionBossArmorScope)
        ) {
            return;
        }
        const catalogMap = new Map();
        if (stashCatalog) {
            for (const group of stashCatalog) {
                catalogMap.set(
                    group.category,
                    group.items.map((entry) => entry.type),
                );
            }
        }
        const optionsFor = (types) => {
            const seen = new Set();
            const out = [];
            for (const t of types) {
                if (!t || seen.has(t)) continue;
                seen.add(t);
                out.push(`<option value="${t}">${t}</option>`);
            }
            return out.join("");
        };
        const helmets = catalogMap.get("helmets") || EXTRACTION_HELMETS;
        const chests = catalogMap.get("chests") || EXTRACTION_CHESTS;
        const backpacks = catalogMap.get("backpacks") || EXTRACTION_BACKPACKS;
        const scopes = catalogMap.get("scopes") || EXTRACTION_SCOPES;
        if (extractionBossArmorHelmet && !alreadyPopulated(extractionBossArmorHelmet)) {
            extractionBossArmorHelmet.innerHTML = `<option value="">默认（留空）</option>` + optionsFor(helmets);
        }
        if (extractionBossArmorChest && !alreadyPopulated(extractionBossArmorChest)) {
            extractionBossArmorChest.innerHTML = `<option value="">留空（不穿）</option>` + optionsFor(chests);
        }
        if (extractionBossArmorBackpack && !alreadyPopulated(extractionBossArmorBackpack)) {
            extractionBossArmorBackpack.innerHTML = `<option value="">留空（默认）</option>` + optionsFor(backpacks);
        }
        if (extractionBossArmorScope && !alreadyPopulated(extractionBossArmorScope)) {
            extractionBossArmorScope.innerHTML = `<option value="">留空（默认）</option>` + optionsFor(scopes);
        }
    }

    function renderExtractionBoss(config) {
        if (!config) return;
        populateBossArmorSelects();
        if (extractionBossEnabled) {
            extractionBossEnabled.checked = config.enabled === true;
        }
        if (extractionBossHealth) {
            extractionBossHealth.value = String(config.maxHealth ?? 600);
        }
        if (extractionBossCount) {
            extractionBossCount.value = String(config.count ?? 2);
        }
        renderBossPerkPicks(
            extractionBossDefaultPerks,
            Array.isArray(config.bossDefaultPerks) ? config.bossDefaultPerks : [],
        );
        renderBossPerkPicks(
            extractionBossPerks,
            Array.isArray(config.bossPerks) ? config.bossPerks : [],
        );
        const bossArmor = config.armor || {};
        const setArmor = (el, v) => {
            if (el) el.value = v || "";
        };
        setArmor(extractionBossArmorHelmet, bossArmor.helmet);
        setArmor(extractionBossArmorChest, bossArmor.chest);
        setArmor(extractionBossArmorBackpack, bossArmor.backpack);
        setArmor(extractionBossArmorScope, bossArmor.scope);
        extractionBossWeapons = Array.isArray(config.weapons)
            ? config.weapons.map((entry) => ({ ...entry }))
            : [];
        renderExtractionBossWeapons();
        extractionBossDrops = Array.isArray(config.dropItems)
            ? config.dropItems.map((entry) => ({ ...entry }))
            : [];
        renderExtractionBossDrops();
        extractionAiDropItems = Array.isArray(config.extractionAiDropItems)
            ? config.extractionAiDropItems.map((e) => ({
                type: String(e?.type || ""),
                count: Number(e?.count) || 1,
                weight: Number(e?.weight) || 0,
            }))
            : [];
        renderExtractionAiDropItems();
        if (extractionBossStatus) {
            extractionBossStatus.textContent = "";
            extractionBossStatus.style.color = "";
        }
    }

    function renderExtractionBossDrops() {
        if (!extractionBossDropsEditor) return;
        extractionBossDropsEditor.innerHTML = "";
        extractionBossDrops.forEach((entry, index) => {
            const row = document.createElement("div");
            row.className = "extraction-loadout-row";
            row.innerHTML =
                `<input class="boss-drop-type" data-index="${index}" type="text" placeholder="物品/能力类型" value="${
                    escAttr(entry.type || "")
                }" />`
                + `<input class="boss-drop-count" data-index="${index}" type="number" min="1" max="999" step="1" value="${
                    Number(entry.count) || 1
                }" />`
                + `<input class="boss-drop-weight" data-index="${index}" type="number" min="0" max="100" step="1" value="${
                    Number(entry.weight) || 0
                }" />`
                + `<span class="extraction-loadout-weight">掉率%</span>`
                + `<button class="ghost-button compact boss-drop-remove" data-index="${index}" type="button">移除</button>`;
            extractionBossDropsEditor.appendChild(row);
        });
        extractionBossDropsEditor
            .querySelectorAll(".boss-drop-remove")
            .forEach((btn) => {
                btn.addEventListener("click", () => {
                    const idx = Number(btn.dataset.index);
                    extractionBossDrops.splice(idx, 1);
                    renderExtractionBossDrops();
                });
            });
        extractionBossDropsEditor
            .querySelectorAll(".boss-drop-type")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.index);
                    extractionBossDrops[idx].type = input.value.trim();
                });
            });
        extractionBossDropsEditor
            .querySelectorAll(".boss-drop-count")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.index);
                    extractionBossDrops[idx].count = Math.max(
                        1,
                        Math.floor(Number(input.value) || 1),
                    );
                });
            });
        extractionBossDropsEditor
            .querySelectorAll(".boss-drop-weight")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.index);
                    extractionBossDrops[idx].weight = Math.max(
                        0,
                        Math.min(100, Math.floor(Number(input.value) || 0)),
                    );
                });
            });
    }

    function renderExtractionAiDropItems() {
        if (!extractionAiDropItemsEditor) return;
        extractionAiDropItemsEditor.innerHTML = "";
        extractionAiDropItems.forEach((entry, index) => {
            const row = document.createElement("div");
            row.className = "extraction-loadout-row";
            row.innerHTML =
                `<input class="boss-drop-type" data-ai-index="${index}" type="text" placeholder="物品/能力类型" value="${
                    escAttr(entry.type || "")
                }" />`
                + `<input class="boss-drop-count" data-ai-index="${index}" type="number" min="1" max="999" step="1" value="${
                    Number(entry.count) || 1
                }" />`
                + `<input class="boss-drop-weight" data-ai-index="${index}" type="number" min="0" max="100" step="1" value="${
                    Number(entry.weight) || 0
                }" />`
                + `<span class="extraction-loadout-weight">概率%</span>`
                + `<button class="ghost-button compact boss-drop-remove" data-ai-index="${index}" type="button">移除</button>`;
            extractionAiDropItemsEditor.appendChild(row);
        });
        extractionAiDropItemsEditor
            .querySelectorAll(".boss-drop-remove[data-ai-index]")
            .forEach((btn) => {
                btn.addEventListener("click", () => {
                    const idx = Number(btn.dataset.aiIndex);
                    extractionAiDropItems.splice(idx, 1);
                    renderExtractionAiDropItems();
                });
            });
        extractionAiDropItemsEditor
            .querySelectorAll(".boss-drop-type[data-ai-index]")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.aiIndex);
                    extractionAiDropItems[idx].type = input.value.trim();
                });
            });
        extractionAiDropItemsEditor
            .querySelectorAll(".boss-drop-count[data-ai-index]")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.aiIndex);
                    extractionAiDropItems[idx].count = Math.max(1, Math.floor(Number(input.value) || 1));
                });
            });
        extractionAiDropItemsEditor
            .querySelectorAll(".boss-drop-weight[data-ai-index]")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.aiIndex);
                    extractionAiDropItems[idx].weight = Math.max(
                        0,
                        Math.min(100, Math.floor(Number(input.value) || 0)),
                    );
                });
            });
    }

    function renderExtractionBossWeapons() {
        if (!extractionBossWeaponsEditor) return;
        const catalog = state.data?.duel?.catalog || [];
        extractionBossWeaponsEditor.innerHTML = "";
        extractionBossWeapons.forEach((entry, index) => {
            const gun = catalog.find((w) => w.id === entry.type);
            const name = gun ? gun.name : entry.type || "选择武器";
            const image = gun ? gun.image : "";
            const row = document.createElement("div");
            row.className = "extraction-boss-weapon-row";
            row.innerHTML = `<button type="button" class="extraction-gun-picker" data-boss-weapon-index="${index}">`
                + (image
                    ? `<img class="extraction-gun-picker-icon" src="${image}" alt="" />`
                    : "")
                + `<span>${String(name).replace(/"/g, "&quot;")}</span>`
                + `</button>`
                + `<input class="boss-weapon-count" data-index="${index}" type="number" min="1" max="99" step="1" value="${
                    Number(entry.count) || 1
                }" title="掉落数量" />`
                + `<button class="ghost-button compact boss-weapon-remove" data-index="${index}" type="button">移除</button>`;
            extractionBossWeaponsEditor.appendChild(row);
        });
        extractionBossWeaponsEditor
            .querySelectorAll(".boss-weapon-remove")
            .forEach((btn) => {
                btn.addEventListener("click", () => {
                    extractionBossWeapons.splice(Number(btn.dataset.index), 1);
                    renderExtractionBossWeapons();
                });
            });
        extractionBossWeaponsEditor
            .querySelectorAll(".boss-weapon-count")
            .forEach((input) => {
                input.addEventListener("input", () => {
                    const idx = Number(input.dataset.index);
                    extractionBossWeapons[idx].count = Math.max(
                        1,
                        Math.floor(Number(input.value) || 1),
                    );
                });
            });
    }

    function renderExtractionHunters(config) {
        if (!config) return;
        const set = (el, v) => {
            if (el) el.value = String(v ?? 0);
        };
        set(extractionHuntersNormalSolo, config.normal?.solo ?? 4);
        set(extractionHuntersNormalDuo, config.normal?.duo ?? 4);
        set(extractionHuntersNormalSquad, config.normal?.squad ?? 4);
        set(extractionHuntersSecretSolo, config.secret?.solo ?? 6);
        set(extractionHuntersSecretDuo, config.secret?.duo ?? 6);
        set(extractionHuntersSecretSquad, config.secret?.squad ?? 6);
        if (extractionHuntersStatus) {
            extractionHuntersStatus.textContent = "";
            extractionHuntersStatus.style.color = "";
        }
    }

    function renderPureAiControls(duel) {
        if (!duel?.catalog?.length) return;
        const signature = duel.catalog.map((weapon) => weapon.id).join("|");
        if (signature === state.pureAiCatalogSignature) return;
        state.pureAiCatalogSignature = signature;
        const ids = ["pure-ai-weapon-0-0", "pure-ai-weapon-0-1", "pure-ai-weapon-1-0", "pure-ai-weapon-1-1"];
        for (const id of ids) {
            const select = $(`#${id}`);
            select.replaceChildren(...duel.catalog.map((weapon) => {
                const option = document.createElement("option");
                option.value = weapon.id;
                option.textContent = `${weapon.name} · ${weapon.categoryName}`;
                return option;
            }));
        }
        $("#pure-ai-weapon-0-0").value = duel.weapons[0];
        $("#pure-ai-weapon-0-1").value = duel.weapons[1];
        $("#pure-ai-weapon-1-0").value = duel.weapons[1];
        $("#pure-ai-weapon-1-1").value = duel.weapons[0];
        $("#pure-ai-difficulty-0").value = "legit";
        $("#pure-ai-difficulty-1").value = "pro";
    }

    async function saveRoomPlayerLimitsConfig() {
        const payload = {
            solo: parseDraftNumber(roomLimitSolo.value, 1, 100, 1),
            duo: parseDraftNumber(roomLimitDuo.value, 2, 100, 1),
            squad: parseDraftNumber(roomLimitSquad.value, 4, 100, 1),
            faction: parseDraftNumber(roomLimitFaction.value, 2, 100, 1),
        };
        if (Object.values(payload).some((value) => value === null)) {
            throw new Error("请完整填写单排、双排、四排和50v50人数上限；空白输入不会自动补0");
        }
        await api("/room-player-limits", { method: "POST", body: JSON.stringify(payload) });
        state.roomPlayerLimitsDraft = null;
        state.roomPlayerLimitsDirty = false;
        const status = $("#room-player-limits-status");
        if (status) {
            status.textContent = "已保存";
            status.style.color = "#7dffa8";
        }
        notify("公开房间人数上限已保存；新建房间开始生效");
        await refresh(false);
    }

    async function createPureAiDuel() {
        const duel = state.data?.duel;
        if (!duel) throw new Error("1v1配置尚未加载");
        const payload = {
            difficulties: [$("#pure-ai-difficulty-0").value, $("#pure-ai-difficulty-1").value],
            contestantLoadouts: [
                { weapons: [$("#pure-ai-weapon-0-0").value, $("#pure-ai-weapon-0-1").value] },
                { weapons: [$("#pure-ai-weapon-1-0").value, $("#pure-ai-weapon-1-1").value] },
            ],
            loadout: {
                adrenalineEnabled: duel.adrenalineEnabled !== false,
                boost: duel.boost,
                helmetLevel: duel.helmetLevel,
                chestLevel: duel.chestLevel,
                scope: duel.scope,
                throwables: { ...duel.throwables },
            },
        };
        const result = await api("/pure-ai-duel", { method: "POST", body: JSON.stringify(payload) });
        const url = new URL("/", window.location.href);
        url.searchParams.set("duelWatch", result.spectatorShareCode);
        pureAiWatchLink.href = url.toString();
        pureAiWatchLink.hidden = false;
        pureAiWatchLink.textContent = `打开本局观战 · ${result.spectatorShareCode}`;
        notify("纯AI 1v1已创建，两名AI就绪后可多人观战");
        await refresh(false);
    }

    function renderAnnouncement(announcement) {
        if (!announcement) return;
        if (!state.announcementDraft || !state.announcementDirty) {
            state.announcementDraft = {
                heading: announcement.heading,
                date: announcement.date,
                title: announcement.title,
                body: announcement.body,
            };
            announcementHeading.value = announcement.heading;
            announcementDate.value = announcement.date;
            announcementTitle.value = announcement.title;
            announcementBody.value = announcement.body;
        }
        updateAnnouncementPreview();
        saveAnnouncement.disabled = !state.announcementDirty;
    }

    function updateAnnouncementPreview() {
        const draft = state.announcementDraft;
        if (!draft) return;
        setText("#announcement-preview-heading", draft.heading || "公告栏名称");
        setText("#announcement-preview-date", draft.date || "");
        setText("#announcement-preview-title", draft.title || "公告标题");
        const paragraphs = (draft.body || "公告正文将在这里显示")
            .split(/\n{2,}/)
            .map((text) => {
                const paragraph = document.createElement("p");
                paragraph.textContent = text;
                return paragraph;
            });
        $("#announcement-preview-body").replaceChildren(...paragraphs);
        setText("#announcement-character-count", `${draft.body.length} / 5000`);
    }

    function updateAnnouncementDirty() {
        const saved = state.data?.announcement;
        const draft = state.announcementDraft;
        if (!saved || !draft) return;
        state.announcementDirty = ["heading", "date", "title", "body"].some(
            (key) => draft[key] !== saved[key],
        );
        saveAnnouncement.disabled = !state.announcementDirty;
        updateAnnouncementPreview();
    }

    function readAnnouncementDraft() {
        if (!state.announcementDraft) return;
        state.announcementDraft.heading = announcementHeading.value;
        state.announcementDraft.date = announcementDate.value;
        state.announcementDraft.title = announcementTitle.value;
        state.announcementDraft.body = announcementBody.value;
        updateAnnouncementDirty();
    }

    async function persistAnnouncement() {
        if (!state.announcementDraft || !state.announcementDirty) return;
        saveAnnouncement.disabled = true;
        try {
            await api("/announcement", {
                method: "POST",
                body: JSON.stringify(state.announcementDraft),
            });
            state.announcementDirty = false;
            notify("主页公告已保存；刷新游戏主页即可看到新内容");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
            saveAnnouncement.disabled = false;
        }
    }

    function renderLiveAnnouncement(announcement) {
        state.liveAnnouncement = announcement || null;
        const active = announcement?.active === true;
        liveAnnouncementStatus.classList.toggle("active", active);
        liveAnnouncementStatus.textContent = active
            ? `正在显示 · 剩余 ${formatDuration(announcement.remainingSeconds || 0)}`
            : "当前未发布";
        clearLiveAnnouncement.disabled = !active;
    }

    async function publishLiveAnnouncement() {
        const message = liveAnnouncementMessage.value.trim();
        const durationSeconds = clampInteger(
            liveAnnouncementDuration.value,
            5,
            86400,
        );
        if (!message) {
            notify("请输入对局公告内容", true);
            return;
        }
        const button = $("#publish-live-announcement");
        button.disabled = true;
        try {
            await api("/live-announcement", {
                method: "POST",
                body: JSON.stringify({ message, durationSeconds }),
            });
            notify("公告已发布，全部对局将在数秒内显示");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    async function removeLiveAnnouncement() {
        clearLiveAnnouncement.disabled = true;
        try {
            await api("/live-announcement/clear", {
                method: "POST",
                body: "{}",
            });
            notify("对局公告已撤下");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        }
    }

    function renderDuelConfig(duel) {
        if (!duel) return;
        const resetDraft = !state.duelDraft;
        if (resetDraft) {
            state.duelDraft = {
                weapons: [...duel.weapons],
                adrenalineEnabled: duel.adrenalineEnabled !== false,
                boost: duel.boost,
                aiEnabled: duel.aiEnabled === true,
                aiDifficulty: duel.aiDifficulty || "normal",
                randomModeEnabled: duel.randomModeEnabled === true,
                roomModeEnabled: duel.roomModeEnabled !== false,
                helmetLevel: duel.helmetLevel,
                chestLevel: duel.chestLevel,
                scope: duel.scope || "4xscope",
                throwables: { ...duel.throwables },
            };
            duelAdrenalineEnabled.checked = state.duelDraft.adrenalineEnabled;
            duelAiEnabled.checked = state.duelDraft.aiEnabled;
            duelAiDifficulty.value = state.duelDraft.aiDifficulty;
            duelBoost.value = String(state.duelDraft.boost);
            duelBoost.disabled = !state.duelDraft.adrenalineEnabled;
            duelAiDifficulty.disabled = !state.duelDraft.aiEnabled;
            duelHelmetLevel.value = String(state.duelDraft.helmetLevel);
            duelChestLevel.value = String(state.duelDraft.chestLevel);
            duelScope.value = state.duelDraft.scope;
            renderDuelThrowables(duel.throwableCatalog);
        }

        const categories = new Map();
        for (const weapon of duel.catalog) categories.set(weapon.category, weapon.categoryName);
        const selectedCategory = weaponCategory.value;
        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "全部类型";
        const options = [allOption];
        for (const [id, name] of categories) {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = name;
            options.push(option);
        }
        weaponCategory.replaceChildren(...options);
        if ([...weaponCategory.options].some((option) => option.value === selectedCategory)) {
            weaponCategory.value = selectedCategory;
        }

        setText("#duel-weapon-count", `${duel.catalog.length} 种武器`);
        updateDuelWeaponCards();
        if (!weaponPicker.hidden) renderWeaponCatalog();
    }

    function findDuelWeapon(id) {
        return state.data?.duel?.catalog.find((weapon) => weapon.id === id);
    }

    function updateDuelWeaponCards() {
        if (!state.duelDraft) return;
        for (let slot = 0; slot < 2; slot++) {
            const weapon = findDuelWeapon(state.duelDraft.weapons[slot]);
            if (!weapon) continue;
            const image = $(`#duel-weapon-image-${slot}`);
            image.src = weapon.image;
            image.alt = weapon.name;
            setText(`#duel-weapon-name-${slot}`, weapon.name);
            setText(
                `#duel-weapon-meta-${slot}`,
                `等级 ${weapon.tier || "未评级"} · ${weapon.categoryName} · ${ammoNames[weapon.ammo] || weapon.ammo}`,
            );
        }
        saveDuelWeapons.disabled = !state.duelDirty;
    }

    function renderDuelThrowables(catalog) {
        const cards = [];
        for (const throwable of catalog || []) {
            const count = state.duelDraft?.throwables?.[throwable.id] || 0;
            const card = document.createElement("div");
            card.className = `duel-throwable-card${count > 0 ? " enabled" : ""}`;

            const imageWrap = document.createElement("span");
            imageWrap.className = "duel-throwable-image";
            const image = document.createElement("img");
            image.src = throwable.image;
            image.alt = "";
            imageWrap.append(image);

            const copy = document.createElement("span");
            copy.className = "duel-throwable-copy";
            const name = document.createElement("strong");
            name.textContent = throwable.name;
            const originalName = document.createElement("small");
            originalName.textContent = throwable.originalName;
            copy.append(name, originalName);

            const input = document.createElement("input");
            input.id = `duel-throwable-${throwable.id}`;
            input.className = "duel-throwable-count";
            input.type = "number";
            input.min = "0";
            input.max = String(throwable.maxCount);
            input.step = "1";
            input.inputMode = "numeric";
            input.value = String(count);
            input.setAttribute("aria-label", `${throwable.name}数量`);

            const stepper = document.createElement("div");
            stepper.className = "duel-throwable-stepper";
            const decrease = document.createElement("button");
            decrease.type = "button";
            decrease.className = "duel-throwable-step";
            decrease.textContent = "−";
            decrease.setAttribute("aria-label", `减少${throwable.name}`);
            const increase = document.createElement("button");
            increase.type = "button";
            increase.className = "duel-throwable-step";
            increase.textContent = "+";
            increase.setAttribute("aria-label", `增加${throwable.name}`);

            const setCount = (nextCount) => {
                if (!state.duelDraft) return;
                const value = clampInteger(nextCount, 0, throwable.maxCount);
                input.value = String(value);
                state.duelDraft.throwables[throwable.id] = value;
                card.classList.toggle("enabled", value > 0);
                decrease.disabled = value <= 0;
                increase.disabled = value >= throwable.maxCount;
                updateDuelDirty();
            };
            input.addEventListener("input", () => {
                setCount(input.value);
            });
            input.addEventListener("change", () => {
                setCount(input.value);
            });
            decrease.addEventListener("click", () => setCount(Number(input.value) - 1));
            increase.addEventListener("click", () => setCount(Number(input.value) + 1));
            decrease.disabled = count <= 0;
            increase.disabled = count >= throwable.maxCount;
            stepper.append(decrease, input, increase);

            card.append(imageWrap, copy, stepper);
            cards.push(card);
        }
        duelThrowables.replaceChildren(...cards);
    }

    function clampInteger(value, min, max) {
        const number = Number(value);
        return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : min));
    }

    function updateDuelDirty() {
        const saved = state.data?.duel;
        const draft = state.duelDraft;
        if (!saved || !draft) return;
        state.duelDirty = draft.weapons.some((weapon, slot) => weapon !== saved.weapons[slot])
            || draft.adrenalineEnabled !== saved.adrenalineEnabled
            || draft.boost !== saved.boost
            || draft.aiEnabled !== saved.aiEnabled
            || draft.aiDifficulty !== saved.aiDifficulty
            || draft.randomModeEnabled !== saved.randomModeEnabled
            || draft.roomModeEnabled !== saved.roomModeEnabled
            || draft.helmetLevel !== saved.helmetLevel
            || draft.chestLevel !== saved.chestLevel
            || draft.scope !== saved.scope
            || Object.keys(saved.throwables).some(
                (id) => draft.throwables[id] !== saved.throwables[id],
            );
        saveDuelWeapons.disabled = !state.duelDirty;
    }

    /** 通用枪械选择器：1v1 配装与搜打撤 AI 配装共用。 */
    function openWeaponPickerFor({ title, selectedId = "", onSelect, catalog }) {
        weaponPickerCatalog = catalog || state.data?.duel?.catalog || [];
        weaponPickerCallback = typeof onSelect === "function" ? onSelect : null;
        weaponPickerSelectedId = selectedId || "";
        weaponPickerTitle.textContent = title || "选择武器";
        weaponSearch.value = "";
        weaponCategory.value = "";
        renderWeaponCatalog();
        weaponPicker.hidden = false;
        document.body.classList.add("picker-open");
        setTimeout(() => weaponSearch.focus(), 0);
    }

    function openWeaponPicker(slot) {
        if (!state.data?.duel) return;
        openWeaponPickerFor({
            title: `选择${slot + 1}号武器`,
            selectedId: state.duelDraft?.weapons?.[slot],
            onSelect: (weaponId) => selectDuelWeapon(slot, weaponId),
            catalog: state.data.duel.catalog,
        });
    }

    function closeWeaponPicker() {
        weaponPicker.hidden = true;
        document.body.classList.remove("picker-open");
    }

    function renderWeaponCatalog() {
        if (!weaponPickerCatalog.length) {
            weaponCatalog.replaceChildren();
            return;
        }
        const query = weaponSearch.value.trim().toLocaleLowerCase();
        const category = weaponCategory.value;
        const visible = weaponPickerCatalog.filter((weapon) =>
            (!category || weapon.category === category)
            && (!query || `${weapon.name} ${weapon.id}`.toLocaleLowerCase().includes(query))
        );

        if (!visible.length) {
            const empty = document.createElement("div");
            empty.className = "weapon-catalog-empty";
            empty.textContent = "没有找到符合条件的枪械";
            weaponCatalog.replaceChildren(empty);
            return;
        }

        const groups = new Map();
        for (const weapon of visible) {
            if (!groups.has(weapon.category)) {
                groups.set(weapon.category, { name: weapon.categoryName, weapons: [] });
            }
            groups.get(weapon.category).weapons.push(weapon);
        }

        const sections = [];
        for (const group of groups.values()) {
            const section = document.createElement("section");
            section.className = "weapon-category-section";
            const title = document.createElement("h3");
            title.className = "weapon-category-title";
            title.textContent = `${group.name} · ${group.weapons.length}`;
            const grid = document.createElement("div");
            grid.className = "weapon-catalog-grid";
            for (const weapon of group.weapons) {
                const option = document.createElement("button");
                option.type = "button";
                option.className = `weapon-option${weapon.note ? " has-note" : ""}${
                    weaponPickerSelectedId === weapon.id ? " selected" : ""
                }`;
                option.setAttribute("aria-pressed", weaponPickerSelectedId === weapon.id ? "true" : "false");
                const tierLabel = weapon.tier || "未评级";
                option.setAttribute(
                    "aria-label",
                    `选择 ${weapon.name}，等级 ${tierLabel}${weapon.note ? `，${weapon.note}` : ""}`,
                );
                const tier = document.createElement("span");
                tier.className = "weapon-tier-label";
                tier.dataset.tier = weapon.tier || "unranked";
                tier.textContent = tierLabel;
                const image = document.createElement("img");
                image.src = weapon.image;
                image.alt = "";
                const name = document.createElement("strong");
                name.textContent = weapon.name;
                const meta = document.createElement("small");
                meta.textContent = ammoNames[weapon.ammo] || weapon.ammo;
                option.append(tier, image, name, meta);
                if (weapon.note) {
                    const note = document.createElement("span");
                    note.className = "weapon-option-note";
                    note.textContent = weapon.note;
                    option.append(note);
                }
                option.addEventListener("click", () => selectWeapon(weapon.id));
                grid.append(option);
            }
            section.append(title, grid);
            sections.push(section);
        }
        weaponCatalog.replaceChildren(...sections);
    }

    /** 通用确认：把选择结果交给回调并关闭面板。 */
    function selectWeapon(weaponId) {
        if (weaponPickerCallback) weaponPickerCallback(weaponId);
        closeWeaponPicker();
    }

    function selectDuelWeapon(slot, weaponId) {
        if (!state.duelDraft || !findDuelWeapon(weaponId)) return;
        state.duelDraft.weapons[slot] = weaponId;
        updateDuelDirty();
        updateDuelWeaponCards();
    }

    async function persistDuelWeapons() {
        if (!state.duelDraft || !state.duelDirty) return;
        saveDuelWeapons.disabled = true;
        try {
            await api("/duel-config", {
                method: "POST",
                body: JSON.stringify(state.duelDraft),
            });
            state.duelDirty = false;
            state.duelDraft = null;
            notify("1v1随机模式、房间模式和初始装备配置已保存");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
            saveDuelWeapons.disabled = false;
        }
    }

    function renderBotAutoFill(config) {
        if (!config) return;
        if (!state.botAutoFillDraft) {
            state.botAutoFillDraft = {
                defaultJoinIntervalMs: config.defaultJoinIntervalMs,
                soloTargetPlayerCount: config.soloTargetPlayerCount ?? config.targetPlayerCount ?? 20,
                duoTargetPlayerCount: config.duoTargetPlayerCount ?? config.targetPlayerCount ?? 20,
                squadTargetPlayerCount: config.squadTargetPlayerCount ?? config.targetPlayerCount ?? 20,
                factionTargetPlayerCount: config.factionTargetPlayerCount ?? config.targetPlayerCount ?? 20,
                extractionSecretSoloTargetPlayerCount: config.extractionSecretSoloTargetPlayerCount ?? 0,
                extractionSecretDuoTargetPlayerCount: config.extractionSecretDuoTargetPlayerCount ?? 0,
                extractionSecretSquadTargetPlayerCount: config.extractionSecretSquadTargetPlayerCount ?? 0,
                difficultyRatios: {
                    normal: config.difficultyRatios?.normal ?? 50,
                    hard: config.difficultyRatios?.hard ?? 33,
                    pro: config.difficultyRatios?.pro ?? 17,
                    legit: config.difficultyRatios?.legit ?? 0,
                },
                thinkIntervalsMs: {
                    normal: config.thinkIntervalsMs?.normal ?? 100,
                    hard: config.thinkIntervalsMs?.hard ?? 60,
                    pro: config.thinkIntervalsMs?.pro ?? 28,
                    legit: config.thinkIntervalsMs?.legit ?? config.highBudgetIntervalMs ?? 7,
                    forbidden: config.thinkIntervalsMs?.forbidden ?? config.highBudgetIntervalMs ?? 5,
                },
                highBudgetIntervalMs: config.highBudgetIntervalMs ?? 7,
                maxBotWorkers: config.maxBotWorkers ?? 16,
                modes: config.modes.map((mode) => ({ ...mode })),
            };
            botGlobalInterval.value = String(config.defaultJoinIntervalMs / 1000);
            botMaxWorkers.value = String(state.botAutoFillDraft.maxBotWorkers);
            botSoloTargetPlayerCount.value = String(state.botAutoFillDraft.soloTargetPlayerCount);
            botDuoTargetPlayerCount.value = String(state.botAutoFillDraft.duoTargetPlayerCount);
            botSquadTargetPlayerCount.value = String(state.botAutoFillDraft.squadTargetPlayerCount);
            botFactionTargetPlayerCount.value = String(state.botAutoFillDraft.factionTargetPlayerCount);
            botSecretSoloTargetPlayerCount.value = String(
                state.botAutoFillDraft.extractionSecretSoloTargetPlayerCount,
            );
            botSecretDuoTargetPlayerCount.value = String(
                state.botAutoFillDraft.extractionSecretDuoTargetPlayerCount,
            );
            botSecretSquadTargetPlayerCount.value = String(
                state.botAutoFillDraft.extractionSecretSquadTargetPlayerCount,
            );
            for (const [difficulty, input] of Object.entries(botRatioInputs)) {
                input.value = String(state.botAutoFillDraft.difficultyRatios[difficulty]);
            }
            for (const [difficulty, input] of Object.entries(botThinkIntervalInputs)) {
                input.value = String(state.botAutoFillDraft.thinkIntervalsMs[difficulty]);
            }
        }
        updateBotTuningStatus();
        const ready = !state.botAutoFillDirty || !updateBotTuningStatus();
        saveBotAutoFill.disabled = ready;
        saveBotFillTargets.disabled = ready;
    }

    function createBotNumberField(label, value, min, max, step, onChange) {
        const wrapper = document.createElement("label");
        wrapper.className = "bot-mode-field";
        const text = document.createElement("span");
        text.textContent = label;
        const input = document.createElement("input");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        input.inputMode = step < 1 ? "decimal" : "numeric";
        let committedValue = normalizeDraftNumber(value, min, min, max, step);
        const preview = () => {
            const next = parseDraftNumber(input.value, min, max, step);
            if (next === null) return;
            committedValue = next;
            onChange(next);
        };
        const commit = () => {
            const next = normalizeDraftNumber(
                input.value,
                committedValue,
                min,
                max,
                step,
            );
            committedValue = next;
            input.value = String(next);
            onChange(next);
        };
        input.addEventListener("input", preview);
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
        wrapper.append(text, input);
        return wrapper;
    }

    function updateBotAutoFillDirty() {
        const saved = state.data?.botAutoFill;
        const draft = state.botAutoFillDraft;
        if (!saved || !draft) return;
        state.botAutoFillDirty = draft.defaultJoinIntervalMs !== saved.defaultJoinIntervalMs
            || draft.soloTargetPlayerCount !== saved.soloTargetPlayerCount
            || draft.duoTargetPlayerCount !== saved.duoTargetPlayerCount
            || draft.squadTargetPlayerCount !== saved.squadTargetPlayerCount
            || draft.factionTargetPlayerCount !== saved.factionTargetPlayerCount
            || draft.extractionSecretSoloTargetPlayerCount
                !== saved.extractionSecretSoloTargetPlayerCount
            || draft.extractionSecretDuoTargetPlayerCount
                !== saved.extractionSecretDuoTargetPlayerCount
            || draft.extractionSecretSquadTargetPlayerCount
                !== saved.extractionSecretSquadTargetPlayerCount
            || draft.maxBotWorkers !== saved.maxBotWorkers
            || JSON.stringify(draft.thinkIntervalsMs) !== JSON.stringify(saved.thinkIntervalsMs)
            || JSON.stringify(draft.difficultyRatios) !== JSON.stringify(saved.difficultyRatios);
        saveBotAutoFill.disabled = !state.botAutoFillDirty || !updateBotTuningStatus();
    }

    function updateBotTuningStatus() {
        const draft = state.botAutoFillDraft;
        if (!draft) return false;
        const total = Object.values(draft.difficultyRatios).reduce(
            (sum, value) => sum + Number(value || 0),
            0,
        );
        const valid = total === 100;
        botRatioTotal.textContent = `合计 ${total}%`;
        botRatioTotal.classList.toggle("invalid", !valid);
        const values = Object.values(draft.thinkIntervalsMs).map(Number);
        botFrequencySummary.textContent = `${Math.min(...values)}–${Math.max(...values)}ms`;
        return valid;
    }

    async function persistBotAutoFill() {
        if (!state.botAutoFillDraft || !state.botAutoFillDirty) return;
        if (!updateBotTuningStatus()) {
            notify("AI 类型占比必须正好合计100%", true);
            return;
        }
        saveBotAutoFill.disabled = true;
        saveBotFillTargets.disabled = true;
        try {
            await api("/bot-autofill", {
                method: "POST",
                body: JSON.stringify({
                    defaultJoinIntervalMs: state.botAutoFillDraft.defaultJoinIntervalMs,
                    soloTargetPlayerCount: state.botAutoFillDraft.soloTargetPlayerCount,
                    duoTargetPlayerCount: state.botAutoFillDraft.duoTargetPlayerCount,
                    squadTargetPlayerCount: state.botAutoFillDraft.squadTargetPlayerCount,
                    factionTargetPlayerCount: state.botAutoFillDraft.factionTargetPlayerCount,
                    extractionSecretSoloTargetPlayerCount: state.botAutoFillDraft.extractionSecretSoloTargetPlayerCount,
                    extractionSecretDuoTargetPlayerCount: state.botAutoFillDraft.extractionSecretDuoTargetPlayerCount,
                    extractionSecretSquadTargetPlayerCount:
                        state.botAutoFillDraft.extractionSecretSquadTargetPlayerCount,
                    difficultyRatios: state.botAutoFillDraft.difficultyRatios,
                    thinkIntervalsMs: state.botAutoFillDraft.thinkIntervalsMs,
                    highBudgetIntervalMs: state.botAutoFillDraft.thinkIntervalsMs.legit,
                    maxBotWorkers: state.botAutoFillDraft.maxBotWorkers,
                }),
            });
            state.botAutoFillDirty = false;
            state.botAutoFillDraft = null;
            notify("真人+AI 补齐目标、AI加入间隔、类型占比和运行频率已保存");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
            saveBotAutoFill.disabled = false;
            saveBotFillTargets.disabled = false;
        }
    }

    function renderModes(modes) {
        const visibleModes = modes.filter((mode) => mode.mapName !== "duel");
        const selected = modeSelect.value;
        const groups = new Map();
        for (const mode of visibleModes) {
            const title = mode.title || mode.mapName;
            if (!groups.has(title)) groups.set(title, []);
            groups.get(title).push(mode);
        }
        modeSelect.replaceChildren(...[...groups.entries()].map(([title, list]) => {
            const group = document.createElement("optgroup");
            group.label = title;
            for (const mode of list) {
                const option = document.createElement("option");
                option.value = mode.index;
                option.textContent = `${mode.displayName}${mode.enabled ? "" : "（未公开）"}`;
                group.append(option);
            }
            return group;
        }));
        if ([...modeSelect.options].some((option) => option.value === selected)) modeSelect.value = selected;

        const query = (modeSearch?.value || "").trim().toLowerCase();
        const onlyOpen = Boolean(modeFilterOpen?.checked);
        const grid = $("#mode-grid");
        const groupEls = [];
        const specialGroup = buildSpecialModeGroup();
        if (specialGroup) groupEls.push(specialGroup);
        let groupCount = 0;
        let cardCount = 0;
        for (const [title, groupModes] of groups) {
            let filtered = groupModes;
            if (query) {
                filtered = filtered.filter((mode) =>
                    `${mode.title || ""} ${mode.displayName} ${mode.mapName} ${mode.teamName || ""}`.toLowerCase()
                        .includes(query)
                );
            }
            if (onlyOpen) filtered = filtered.filter((mode) => mode.enabled);
            if (filtered.length === 0) continue;
            groupCount += 1;
            cardCount += filtered.length;
            const openCount = filtered.filter((mode) => mode.enabled).length;
            const collapsed = state.modeGroupsCollapsed.has(title);
            const group = document.createElement("section");
            group.className = "mode-group";
            group.dataset.collapsed = String(collapsed);
            const head = document.createElement("button");
            head.type = "button";
            head.className = "mode-group-head";
            head.setAttribute("aria-expanded", String(!collapsed));
            const headTitle = document.createElement("span");
            headTitle.className = "mode-group-title";
            headTitle.textContent = title;
            const headMeta = document.createElement("span");
            headMeta.className = "mode-group-meta";
            headMeta.textContent = `${openCount} 开放 / ${filtered.length} 个模式`;
            const arrow = document.createElement("span");
            arrow.className = "mode-group-arrow";
            arrow.setAttribute("aria-hidden", "true");
            arrow.textContent = "▾";
            head.append(headTitle, headMeta, arrow);
            head.addEventListener("click", () => {
                if (state.modeGroupsCollapsed.has(title)) state.modeGroupsCollapsed.delete(title);
                else state.modeGroupsCollapsed.add(title);
                localStorage.setItem("surviv-admin-mode-groups", JSON.stringify([...state.modeGroupsCollapsed]));
                if (state.data) renderModes(state.data.modes);
            });
            const body = document.createElement("div");
            body.className = "mode-group-body";
            body.hidden = collapsed;
            body.append(...filtered.map((mode) => buildModeCard(mode)));
            group.append(head, body);
            groupEls.push(group);
        }
        grid.replaceChildren(...groupEls);
        if (modeGroupCount) modeGroupCount.textContent = `${groupCount} 个地图组 · ${cardCount} 个模式`;
        let emptyHint = document.getElementById("mode-empty-hint");
        if (groupEls.length === 0) {
            if (!emptyHint) {
                emptyHint = document.createElement("div");
                emptyHint.id = "mode-empty-hint";
                emptyHint.className = "empty-state";
                const icon = document.createElement("span");
                icon.textContent = "◎";
                const strong = document.createElement("strong");
                strong.textContent = "没有匹配的模式";
                const small = document.createElement("small");
                small.textContent = "调整搜索词或筛选条件后重试。";
                emptyHint.append(icon, strong, small);
                grid.after(emptyHint);
            }
            emptyHint.hidden = false;
        } else if (emptyHint) {
            emptyHint.hidden = true;
        }
    }

    function buildSpecialModeGroup() {
        const duel = state.data?.duel;
        const modes = state.data?.modes || [];
        const faction = modes.find((mode) => mode.mapName === "faction");
        const sandevistanSolo = modes.find(
            (mode) => mode.mapName === "sandevistan" && mode.teamMode === 1,
        );
        const sandevistanOpen = Boolean(sandevistanSolo?.enabled);
        const randomOpen = Boolean(duel?.randomModeEnabled);
        const roomOpen = Boolean(duel?.roomModeEnabled);
        const factionOpen = Boolean(faction?.enabled);
        const openCount = [factionOpen, sandevistanOpen, randomOpen, roomOpen].filter(Boolean).length;

        const group = document.createElement("section");
        group.className = "mode-group special-mode-group";
        const head = document.createElement("button");
        head.type = "button";
        head.className = "mode-group-head special-mode-head";
        const headTitle = document.createElement("span");
        headTitle.className = "mode-group-title";
        headTitle.textContent = "特殊模式";
        const headMeta = document.createElement("span");
        headMeta.className = "mode-group-meta";
        headMeta.textContent = `${openCount} 开放 / 4 个特殊模式`;
        const arrow = document.createElement("span");
        arrow.className = "mode-group-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "▾";
        head.append(headTitle, headMeta, arrow);
        const body = document.createElement("div");
        body.className = "mode-group-body";
        const sandevistanCard = buildSpecialModeCard(
            "2077 · 斯安威斯坦",
            "2077",
            sandevistanOpen,
            (wanted) => {
                if (!sandevistanSolo || sandevistanSolo.enabled === wanted) return;
                setModeEnabled(sandevistanSolo, null);
            },
            "开启后对局内可按鼠标中键激活斯安威斯坦；减速越狠，开启瞬间的眩晕冲击越强。",
        );
        sandevistanCard.classList.add("sandevistan-config-card");
        appendSandevistanTuning(sandevistanCard);
        body.append(
            buildSpecialModeCard("50v50", "50", factionOpen, (wanted) => {
                if (!faction || faction.enabled === wanted) return;
                setModeEnabled(faction, null);
            }),
            sandevistanCard,
            buildSpecialModeCard("1v1 随机", "随机", randomOpen, (wanted) => {
                if (!state.duelDraft) return;
                state.duelDraft.randomModeEnabled = wanted;
                updateDuelDirty();
                renderModes(state.data?.modes || []);
            }),
            buildSpecialModeCard("1v1 房间", "房间", roomOpen, (wanted) => {
                if (!state.duelDraft) return;
                state.duelDraft.roomModeEnabled = wanted;
                updateDuelDirty();
                renderModes(state.data?.modes || []);
            }),
        );
        group.append(head, body);
        return group;
    }

    function appendSandevistanTuning(card) {
        const saved = state.data?.sandevistan || { playerTimeScale: 0.5, worldTimeScale: 0.1 };
        if (!state.sandevistanDraft) state.sandevistanDraft = { ...saved };
        const form = document.createElement("form");
        form.className = "sandevistan-tuning";

        // 把 0~1 倍率格式化为干净百分数：最多两位小数、无尾随 0、
        // 无浮点伪影（例如 35.0000000001 / 0.10）。
        const formatPercent = (scale) => {
            const percent = Math.round(Number(scale) * 1000) / 10;
            return String(Math.round(percent * 100) / 100);
        };

        const makeField = (labelText, helpText, key) => {
            const field = document.createElement("div");
            field.className = "sandevistan-field";
            const copy = document.createElement("span");
            const strong = document.createElement("strong");
            const small = document.createElement("small");
            strong.textContent = labelText;
            small.textContent = helpText;
            copy.append(strong, small);
            const suffix = document.createElement("span");
            suffix.className = "number-suffix";
            const input = document.createElement("input");
            input.type = "number";
            input.min = "1";
            input.max = "100";
            input.step = "1";
            input.inputMode = "decimal";
            input.value = formatPercent(state.sandevistanDraft[key]);
            input.addEventListener("focus", () => {
                state.sandevistanFocusedKey = key;
            });
            input.addEventListener("blur", () => {
                if (state.sandevistanFocusedKey === key) {
                    state.sandevistanFocusedKey = null;
                }
                // 输入框里是百分数（1~100），失焦时直接清理格式：
                // 最多两位小数、去尾随 0、去浮点伪影；空值恢复为当前配置。
                const raw = String(input.value).trim();
                const numeric = Number(raw);
                const normalized = raw === ""
                    ? formatPercent(state.sandevistanDraft[key])
                    : String(Math.round(numeric * 100) / 100);
                if (!Number.isFinite(numeric) || input.value !== normalized) {
                    input.value = normalized;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                }
            });
            // 自动刷新重渲染会重建整张卡片；如果用户正在编辑该字段，
            // 重渲染后恢复焦点与光标，避免输入被打断/值被覆盖。
            if (state.sandevistanFocusedKey === key) {
                requestAnimationFrame(() => {
                    input.focus();
                    const length = input.value.length;
                    try {
                        input.setSelectionRange(length, length);
                    } catch (_) {
                        /* number input 兼容性兜底 */
                    }
                });
            }
            const percent = document.createElement("span");
            percent.textContent = "%";
            suffix.append(input, percent);
            field.append(copy, suffix);
            return { field, input };
        };

        const player = makeField(
            "玩家速度",
            "开启斯安威斯坦的玩家自身动作保留（射击、移动、打药、装弹）",
            "playerTimeScale",
        );
        const world = makeField(
            "对局速度",
            "其他玩家、AI、子弹、毒圈、投掷物和地图交互速度",
            "worldTimeScale",
        );
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "ghost-button compact";
        reset.textContent = "恢复默认";
        const save = document.createElement("button");
        save.type = "submit";
        save.className = "primary-button compact";
        save.textContent = "保存减速配置";
        const actions = document.createElement("div");
        actions.className = "sandevistan-actions";
        actions.append(reset, save);

        const summary = document.createElement("p");
        summary.className = "sandevistan-summary";
        const updateSummary = () => {
            const playerPercent = Number(player.input.value);
            const worldPercent = Number(world.input.value);
            const safe = (value) => (Number.isFinite(value) && value > 0 ? value : 1);
            summary.textContent = `生效后：你本人动作保留 ${safe(playerPercent)}%；`
                + `其他玩家、AI、子弹、毒圈、投掷物和地图交互保留 ${safe(worldPercent)}%。`;
        };
        const syncDraft = () => {
            const playerPercent = Number(player.input.value);
            const worldPercent = Number(world.input.value);
            state.sandevistanDraft = {
                playerTimeScale: playerPercent / 100,
                worldTimeScale: worldPercent / 100,
            };
            save.disabled = !Number.isFinite(playerPercent) || !Number.isFinite(worldPercent)
                || playerPercent < 1 || playerPercent > 100 || worldPercent < 1 || worldPercent > 100
                || (state.sandevistanDraft.playerTimeScale === saved.playerTimeScale
                    && state.sandevistanDraft.worldTimeScale === saved.worldTimeScale);
        };
        const onInput = () => {
            syncDraft();
            updateSummary();
        };
        player.input.addEventListener("input", onInput);
        world.input.addEventListener("input", onInput);
        reset.addEventListener("click", () => {
            player.input.value = "50";
            world.input.value = "10";
            onInput();
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            syncDraft();
            if (save.disabled) return;
            save.disabled = true;
            try {
                await api("/sandevistan-config", {
                    method: "POST",
                    body: JSON.stringify(state.sandevistanDraft),
                });
                state.sandevistanDraft = null;
                notify("2077 模式减速配置已保存，正在对局中也会生效");
                await refresh(false);
            } catch (error) {
                notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
                save.disabled = false;
            }
        });
        syncDraft();
        updateSummary();
        form.append(player.field, world.field, actions, summary);
        card.append(form);
    }

    function buildSpecialModeCard(label, iconText, enabled, onToggle, description = "特殊模式快捷开关") {
        const card = document.createElement("article");
        card.className = "mode-card special-mode-card-inline";
        const head = document.createElement("div");
        head.className = "mode-card-head";
        const titleWrap = document.createElement("div");
        titleWrap.className = "special-mode-title";
        const icon = document.createElement("span");
        icon.className = "special-mode-icon";
        icon.textContent = iconText;
        const title = document.createElement("h3");
        title.textContent = label;
        titleWrap.append(icon, title);
        const controls = document.createElement("div");
        controls.className = "mode-card-controls";
        const badge = document.createElement("span");
        badge.className = `mode-status ${enabled ? "is-open" : "is-closed"}`;
        badge.setAttribute("role", "status");
        const statusLight = document.createElement("span");
        statusLight.className = "mode-status-light";
        statusLight.setAttribute("aria-hidden", "true");
        const statusText = document.createElement("span");
        statusText.textContent = enabled ? "已开放" : "未开放";
        badge.append(statusLight, statusText);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = `mode-toggle-button${enabled ? " enabled" : ""}`;
        toggle.textContent = enabled ? "关闭" : "开放";
        toggle.title = "切换特殊模式开放状态";
        toggle.addEventListener("click", () => {
            onToggle(!enabled);
        });
        controls.append(badge, toggle);
        head.append(titleWrap, controls);
        const code = document.createElement("p");
        code.textContent = description;
        card.append(head, code);
        return card;
    }

    function buildModeCard(mode) {
        const card = document.createElement("article");
        card.className = "mode-card";
        const head = document.createElement("div");
        head.className = "mode-card-head";
        const title = document.createElement("h3");
        title.textContent = mode.displayName;
        const badge = document.createElement("span");
        badge.className = `mode-status ${mode.enabled ? "is-open" : "is-closed"}`;
        badge.setAttribute("role", "status");
        const statusLight = document.createElement("span");
        statusLight.className = "mode-status-light";
        statusLight.setAttribute("aria-hidden", "true");
        const statusText = document.createElement("span");
        statusText.textContent = mode.enabled ? "已开放" : "未开放";
        badge.append(statusLight, statusText);
        const controls = document.createElement("div");
        controls.className = "mode-card-controls";
        if (mode.mapName === "extraction") {
            // 搜打撤常开：不提供开关，显示常开标记。
            const alwaysOn = document.createElement("span");
            alwaysOn.className = "mode-status is-open mode-always-on";
            alwaysOn.textContent = "常开";
            alwaysOn.title = "搜打撤模式始终开放，不可关闭";
            controls.append(badge, alwaysOn);
        } else {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = `mode-toggle-button${mode.enabled ? " enabled" : ""}`;
            toggle.textContent = mode.enabled ? "关闭" : "开放";
            toggle.title = mode.enabled ? "关闭新的公开匹配" : "开放公开匹配";
            toggle.addEventListener("click", () => setModeEnabled(mode, toggle));
            controls.append(badge, toggle);
        }
        head.append(title, controls);
        const code = document.createElement("p");
        code.textContent = `${mode.mapName} · 模式 #${mode.index}`;
        const stats = document.createElement("div");
        stats.className = "mode-stats";
        stats.append(
            textSpan(`队伍 ${mode.teamName || teamNames[mode.teamMode] || mode.teamMode}`),
            textSpan(`上限 ${mode.maxPlayers} 人`),
        );
        card.append(head, code, stats);
        return card;
    }

    function textSpan(value) {
        const span = document.createElement("span");
        span.textContent = value;
        return span;
    }
    async function setModeEnabled(mode, button) {
        const enabled = !mode.enabled;
        if (button) button.disabled = true;
        try {
            await api("/mode-action", {
                method: "POST",
                body: JSON.stringify({ modeIndex: mode.index, enabled }),
            });
            const name = mode.mapName === "potato" ? "土豆模式" : mode.displayName;
            notify(enabled ? `${name}已开放` : `${name}已关闭；现有房间不受影响`);
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function renderGames(games, modes) {
        const filterValue = roomFilter?.value || "all";
        const visibleGames = filterValue === "joinable"
            ? games.filter((game) => game.canJoin)
            : filterValue === "locked"
            ? games.filter((game) => !game.canJoin)
            : games;
        if (roomCount) roomCount.textContent = `${visibleGames.length} 个房间`;
        const modeByMapAndTeam = new Map(modes.map((mode) => [`${mode.mapName}:${mode.teamMode}`, mode]));
        gamesBody.replaceChildren(...visibleGames.map((game) => {
            const mode = modeByMapAndTeam.get(`${game.mapName}:${game.teamMode}`);
            const row = document.createElement("tr");
            const idCell = document.createElement("td");
            const idWrap = document.createElement("div");
            idWrap.className = "game-id";
            const shortId = document.createElement("span");
            shortId.textContent = `${game.id.slice(0, 8)}…${game.id.slice(-4)}`;
            shortId.title = game.id;
            const copy = document.createElement("button");
            copy.className = "copy-button";
            copy.type = "button";
            copy.textContent = "▣";
            copy.title = "复制完整 ID";
            copy.addEventListener(
                "click",
                () => navigator.clipboard.writeText(game.id).then(() => notify("房间 ID 已复制")),
            );
            idWrap.append(shortId, copy);
            idCell.append(idWrap);

            const mapCell = document.createElement("td");
            const baseRoomName = mode?.displayName || game.mapName;
            const zombieDifficultyNames = { simple: "简单", normal: "普通", hard: "困难" };
            const roomName = game.mapName === "zombie"
                ? `【${zombieDifficultyNames[game.zombieDifficulty] || "普通"}】${baseRoomName}`
                : baseRoomName;
            mapCell.append(document.createTextNode(roomName));
            const team = document.createElement("small");
            team.className = "subtle";
            team.textContent = mode?.teamName || teamNames[game.teamMode] || `${game.teamMode} 人队`;
            mapCell.append(team);
            const players = document.createElement("td");
            const breakdown = document.createElement("div");
            breakdown.className = "player-breakdown";
            const humanChip = document.createElement("span");
            humanChip.className = "player-count-chip human";
            humanChip.textContent = `真人 ${
                game.humanPlayerCount ?? Math.max(0, (game.connectedCount ?? 0) - (game.serverBotCount ?? 0))
            }`;
            const aiChip = document.createElement("span");
            aiChip.className = "player-count-chip ai";
            aiChip.textContent = `AI ${game.aiPlayerCount ?? game.serverBotCount ?? 0}`;
            const spectatorChip = document.createElement("span");
            spectatorChip.className = "player-count-chip spectator";
            spectatorChip.textContent = `观众 ${game.spectatorCount ?? 0}`;
            breakdown.append(humanChip, aiChip, spectatorChip);
            const alive = document.createElement("small");
            alive.className = "subtle";
            alive.textContent = `存活 ${game.aliveCount} / ${mode?.maxPlayers ?? "—"}`;
            players.append(breakdown, alive);
            const duration = document.createElement("td");
            duration.textContent = formatDuration(game.startedTime);
            const statusCell = document.createElement("td");
            const status = document.createElement("span");
            status.className = `status-pill ${game.canJoin ? "status-joinable" : "status-locked"}`;
            status.textContent = game.canJoin ? "可加入" : "已锁定";
            statusCell.append(status);
            const action = document.createElement("td");
            const actions = document.createElement("div");
            actions.className = "room-actions";
            const spectate = document.createElement("button");
            spectate.type = "button";
            spectate.className = "ghost-button compact";
            spectate.textContent = "观战";
            spectate.disabled = game.aliveCount < 1;
            spectate.addEventListener("click", () => spectateGame(game.id, spectate));
            actions.append(spectate);
            if (game.mapName === "duel" && game.aliveCount < 2) {
                const addAi = document.createElement("button");
                addAi.type = "button";
                addAi.className = "ghost-button compact";
                addAi.textContent = "加入AI";
                addAi.addEventListener("click", () => addAiToGame(game.id));
                actions.append(addAi);
            }
            const stop = document.createElement("button");
            stop.type = "button";
            stop.className = "danger-button";
            stop.textContent = "关闭";
            stop.addEventListener("click", () => stopGame(game.id));
            actions.append(stop);
            action.append(actions);
            row.append(idCell, mapCell, players, duration, statusCell, action);
            return row;
        }));
        $("#empty-games").hidden = visibleGames.length !== 0;
        $("#empty-games").style.display = visibleGames.length ? "none" : "grid";
    }

    async function runRefresh(showError) {
        refreshButton.classList.add("loading");
        try {
            const data = await api("/status");
            showDashboard();
            render(data);
            // The room/status snapshot stays on the selected 1/2/5-second cadence.
            // Full stash/account/catalog snapshots grow with server data and used
            // to be downloaded every 2 seconds, eventually overwhelming both the
            // browser and server. Refresh those independently at a bounded cadence.
            const now = Date.now();
            if (showError || now - state.lastAncillaryRefreshAt >= 15_000) {
                state.lastAncillaryRefreshAt = now;
                await Promise.all([
                    loadExtractionAiLoadouts(),
                    loadSecretExtractionAiLoadouts(),
                    loadStashAdmin(),
                    loadEquipmentReturnRequests(),
                    loadAccounts(),
                    loadShopConfig(),
                ]);
            }
        } catch (error) {
            if (error.message === "AUTH") {
                state.session = "";
                state.data = null;
                sessionStorage.removeItem("surviv-admin-session");
                showLogin("管理员密码错误或登录会话已失效。");
            } else if (!state.data) {
                showLogin(error.message || "无法连接游戏服务器。");
            } else {
                const lastUpdated = $("#last-updated");
                if (lastUpdated) {
                    lastUpdated.textContent = `同步失败，正在重试 · ${
                        new Date().toLocaleTimeString("zh-CN", { hour12: false })
                    }`;
                    lastUpdated.classList.add("sync-error");
                }
                if (showError) notify(error.message || "无法连接游戏服务器", true);
            }
        } finally {
            refreshButton.classList.remove("loading");
        }
    }

    function refresh(showError = true) {
        if (state.refreshInFlight) {
            // Merge overlapping interval/manual refreshes into one follow-up run.
            // This keeps the browser connection pool bounded even if an endpoint
            // is temporarily slow.
            state.refreshQueued = true;
            return state.refreshPromise;
        }

        state.refreshInFlight = true;
        const promise = runRefresh(showError);
        state.refreshPromise = promise;
        void promise.finally(() => {
            if (state.refreshPromise !== promise) return;
            state.refreshInFlight = false;
            state.refreshPromise = null;
            const runAgain = state.refreshQueued;
            state.refreshQueued = false;
            if (runAgain && state.session && !dashboard.hidden) {
                window.setTimeout(() => void refresh(false), 0);
            }
        });
        return promise;
    }

    const extractionLoadoutsEditor = $("#extraction-loadouts-editor");
    const addExtractionLoadoutBtn = $("#add-extraction-loadout");
    const saveExtractionAiLoadoutsBtn = $("#save-extraction-ai-loadouts");
    const extractionAiLoadoutsStatus = $("#extraction-ai-loadouts-status");
    const extractionSecretEnabled = $("#extraction-secret-enabled");
    const extractionSecretImmortalBoost = $("#extraction-secret-immortal-boost");
    const extractionSecretDifficulty = $("#extraction-secret-difficulty");
    const saveExtractionSecretBtn = $("#save-extraction-secret");
    const extractionSecretStatus = $("#extraction-secret-status");
    const extractionBossEnabled = $("#extraction-boss-enabled");
    const extractionBossHealth = $("#extraction-boss-health");
    const extractionBossCount = $("#extraction-boss-count");
    const extractionBossDefaultPerks = $("#extraction-boss-default-perks");
    const pickExtractionBossDefaultPerkBtn = $("#pick-extraction-boss-default-perk");
    const extractionBossPerks = $("#extraction-boss-perks");
    const pickExtractionBossPerkBtn = $("#pick-extraction-boss-perk");
    const extractionBossArmorHelmet = $("#extraction-boss-armor-helmet");
    const extractionBossArmorChest = $("#extraction-boss-armor-chest");
    const extractionBossArmorBackpack = $("#extraction-boss-armor-backpack");
    const extractionBossArmorScope = $("#extraction-boss-armor-scope");
    const extractionBossWeaponsEditor = $("#extraction-boss-weapons-editor");
    const addExtractionBossWeaponBtn = $("#add-extraction-boss-weapon");
    const extractionBossDropsEditor = $("#extraction-boss-drops-editor");
    const extractionAiDropItemsEditor = $("#extraction-ai-drop-items-editor");
    const addExtractionAiDropBtn = $("#add-extraction-ai-drop-item");
    const saveExtractionAiDropItemsBtn = $("#save-extraction-ai-drop-items");
    const extractionAiDropItemsStatus = $("#extraction-ai-drop-items-status");
    const addExtractionBossDropBtn = $("#add-extraction-boss-drop");
    const saveExtractionBossBtn = $("#save-extraction-boss");
    const extractionBossStatus = $("#extraction-boss-status");
    let extractionBossDrops = [];
    let extractionAiDropItems = [];
    let extractionBossWeapons = [];
    const extractionHuntersNormalSolo = $("#extraction-hunters-normal-solo");
    const extractionHuntersNormalDuo = $("#extraction-hunters-normal-duo");
    const extractionHuntersNormalSquad = $("#extraction-hunters-normal-squad");
    const extractionHuntersSecretSolo = $("#extraction-hunters-secret-solo");
    const extractionHuntersSecretDuo = $("#extraction-hunters-secret-duo");
    const extractionHuntersSecretSquad = $("#extraction-hunters-secret-squad");
    const saveExtractionHuntersBtn = $("#save-extraction-hunters");
    const extractionHuntersStatus = $("#extraction-hunters-status");
    let extractionLoadouts = [];

    const EXTRACTION_GUNS = [
        "ak47",
        "m4a1",
        "hk416",
        "mp5",
        "ump9",
        "vector",
        "m93r",
        "glock",
        "m9",
        "deagle",
        "mosin",
        "m39",
        "sks",
        "m249",
        "dp28",
        "qbb",
        "groza",
        "famas",
        "aug",
        "scar",
        "m16a1",
        "mp220",
        "ot38",
    ];
    const EXTRACTION_AMMO = ["9mm", "762mm", "556mm", "12gauge", "50AE", "308sub", "45acp", "flare"];
    const EXTRACTION_CONSUMABLES = ["bandage", "healthkit", "soda", "painkiller"];
    const EXTRACTION_HELMETS = [
        "helmet01",
        "helmet02",
        "helmet03",
        "helmet04",
        "helmet03_leader",
        "helmet03_forest",
        "helmet03_moon",
        "helmet03_lt",
        "helmet03_lt_aged",
        "helmet03_potato",
        "helmet03_marksman",
        "helmet03_recon",
        "helmet03_grenadier",
        "helmet03_bugler",
        "helmet04_medic",
        "helmet04_last_man_red",
        "helmet04_last_man_blue",
        "helmet04_leader",
    ];
    const EXTRACTION_CHESTS = ["chest01", "chest02", "chest03", "chest04"];
    const EXTRACTION_BACKPACKS = ["backpack01", "backpack02", "backpack03", "backpack00"];
    const EXTRACTION_SCOPES = ["1xscope", "2xscope", "4xscope", "8xscope", "15xscope"];
    // 所有可佩戴能力（用于 Boss 默认天赋 / 天赋池多选）。
    const BOSS_PERK_OPTIONS = [
        "steelskin",
        "flak_jacket",
        "gotw",
        "firepower",
        "ap_rounds",
        "lifeline",
        "takedown",
        "chambered",
        "explosive",
        "small_arms",
        "splinter",
        "combat_stims",
        "leadership",
        "windwalk",
        "aoe_heal",
        "endless_ammo",
        "scavenger",
        "scavenger_adv",
        "field_medic",
        "tree_climbing",
        "martyrdom",
        "targeting",
        "bonus_45",
        "bonus_9mm",
        "bonus_assault",
        "broken_arrow",
        "fabricate",
        "self_revive",
        "inspiration",
        "final_bugle",
        "rare_potato",
        "hunted",
        "trick_nothing",
        "trick_size",
        "trick_m9",
        "trick_chatty",
        "trick_drain",
        "treat_9mm",
        "treat_12g",
        "treat_556",
        "treat_762",
        "treat_super",
        "turkey_shoot",
        "halloween_mystery",
    ];
    const EXTRACTION_AMMO_LABELS = {
        "9mm": "9mm",
        "762mm": "7.62mm",
        "556mm": "5.56mm",
        "12gauge": "12号霰弹",
        "50AE": ".50 AE",
        "308sub": ".308 亚音速",
        "45acp": ".45 ACP",
        flare: "信号弹",
    };
    const EXTRACTION_CONSUMABLE_LABELS = {
        bandage: "绷带",
        healthkit: "医疗包",
        soda: "汽水",
        painkiller: "止痛药",
    };

    function setExtractionStatus(text, color) {
        if (!extractionAiLoadoutsStatus) return;
        extractionAiLoadoutsStatus.textContent = text;
        extractionAiLoadoutsStatus.style.color = color || "";
    }

    async function loadExtractionAiLoadouts(force = false) {
        if (!extractionLoadoutsEditor) return;
        if (state.extractionLoadoutsDirty && !force) {
            setExtractionStatus(
                state.extractionLoadoutsEditing
                    ? "正在编辑，自动刷新已暂停更新此区域（未保存）"
                    : "有未保存的修改，自动刷新已暂停更新此区域",
                "#ffd166",
            );
            return;
        }
        try {
            const data = await api("/extraction/ai-loadouts");
            extractionLoadouts = data.presets ?? [];
            state.extractionLoadoutsDirty = false;
            renderExtractionLoadouts(extractionLoadoutsEditor, extractionLoadouts, "extraction");
            setExtractionStatus("");
        } catch (_) {
            setExtractionStatus("加载失败（未登录或接口不可用）", "#ff6b6b");
        }
    }

    function extractionSelect(id, options, value, placeholder) {
        const opts = options
            .map((type) => `<option value="${type}" ${type === value ? "selected" : ""}>${type}</option>`)
            .join("");
        return `<select id="${id}" class="extraction-preset-select"><option value="">${placeholder}</option>${opts}</select>`;
    }

    /** 搜打撤 AI 配装枪械选择：与 1v1 相同的选择面板（按钮 + 隐藏值）。 */
    function extractionGunPicker(id, value) {
        const gun = (state.data?.duel?.catalog || []).find((w) => w.id === value);
        const name = gun ? gun.name : value || "空";
        const image = gun ? gun.image : "";
        const safeName = String(name).replace(/"/g, "&quot;");
        return (
            `<div class="extraction-gun-picker-wrap">`
            + `<button type="button" class="extraction-gun-picker" data-extraction-gun-input="${id}" title="点击选择枪械">`
            + (image ? `<img class="extraction-gun-picker-icon" src="${image}" alt="" />` : "")
            + `<span>${safeName}</span>`
            + `</button>`
            + `<input type="hidden" id="${id}" value="${String(value || "").replace(/"/g, "&quot;")}" />`
            + `</div>`
        );
    }

    function renderExtractionLoadouts(editor, presets, prefix) {
        if (!editor) return;
        editor.innerHTML = presets
            .map((preset, index) => {
                const loadout = preset.loadout || {};
                const guns = loadout.guns || [];
                const ammo = loadout.ammo || {};
                const consumables = loadout.consumables || {};
                const armor = loadout.armor || {};
                const ammoInputs = EXTRACTION_AMMO.map(
                    (type) =>
                        `<label class="extraction-preset-field" title="${type}">${
                            EXTRACTION_AMMO_LABELS[type] || type
                        }<input type="number" min="0" step="1" inputmode="numeric" value="${
                            ammo[type] ?? 0
                        }" data-extraction-ammo="${type}" /></label>`,
                ).join("");
                const consumableInputs = EXTRACTION_CONSUMABLES.map(
                    (type) =>
                        `<label class="extraction-preset-field" title="${type}">${
                            EXTRACTION_CONSUMABLE_LABELS[type] || type
                        }<input type="number" min="0" step="1" inputmode="numeric" value="${
                            consumables[type] ?? 0
                        }" data-extraction-consumable="${type}" /></label>`,
                ).join("");
                return `
                    <div class="extraction-preset-card" data-index="${index}">
                        <div class="extraction-preset-head">
                            <span class="extraction-preset-index">方案 ${index + 1}</span>
                            <input class="extraction-preset-name" type="text" value="${
                    (preset.name || "").replace(/"/g, "&quot;")
                }" placeholder="配装名称" />
                            <label class="extraction-preset-weight">权重
                                <input type="number" min="0" step="1" inputmode="numeric" value="${
                    preset.weight ?? 0
                }" />
                            </label>
                            <button class="danger-button compact" type="button" data-extraction-remove>删除</button>
                        </div>
                        <div class="extraction-preset-row">
                            <label class="extraction-preset-field">主武器
                                ${extractionGunPicker(`${prefix}-gun-${index}-0`, guns[0])}
                            </label>
                            <label class="extraction-preset-field">副武器
                                ${extractionGunPicker(`${prefix}-gun-${index}-1`, guns[1])}
                            </label>
                        </div>
                        <div class="extraction-preset-section">
                            <span class="extraction-preset-caption">弹药</span>
                            <div class="extraction-preset-grid">${ammoInputs}</div>
                        </div>
                        <div class="extraction-preset-section">
                            <span class="extraction-preset-caption">消耗品</span>
                            <div class="extraction-preset-grid">${consumableInputs}</div>
                        </div>
                        <div class="extraction-preset-row">
                            <label class="extraction-preset-field">头盔
                                ${extractionSelect(`${prefix}-helmet-${index}`, EXTRACTION_HELMETS, armor.helmet, "无")}
                            </label>
                            <label class="extraction-preset-field">护甲
                                ${extractionSelect(`${prefix}-chest-${index}`, EXTRACTION_CHESTS, armor.chest, "无")}
                            </label>
                            <label class="extraction-preset-field">背包
                                ${
                    extractionSelect(`${prefix}-backpack-${index}`, EXTRACTION_BACKPACKS, armor.backpack, "无")
                }
                            </label>
                            <label class="extraction-preset-field">倍镜
                                ${extractionSelect(`${prefix}-scope-${index}`, EXTRACTION_SCOPES, armor.scope, "无")}
                            </label>
                        </div>
                    </div>`;
            })
            .join("");
        if (presets.length === 0) {
            editor.innerHTML = "<div class='extraction-loadouts-empty'>暂无配装方案，点击“添加配装”创建。</div>";
        }
    }

    function collectExtractionLoadouts(editor, presets, prefix) {
        const cards = editor.querySelectorAll(".extraction-preset-card");
        return Array.from(cards).map((card) => {
            const index = Number(card.dataset.index);
            const current = presets[index] || {};
            const guns = [
                card.querySelector(`#${prefix}-gun-${index}-0`)?.value || "",
                card.querySelector(`#${prefix}-gun-${index}-1`)?.value || "",
            ].filter((type) => type !== "");
            const ammo = {};
            card.querySelectorAll("[data-extraction-ammo]").forEach((input) => {
                const count = Math.max(0, Math.floor(Number(input.value) || 0));
                if (count > 0) ammo[input.dataset.extractionAmmo] = count;
            });
            const consumables = {};
            card.querySelectorAll("[data-extraction-consumable]").forEach((input) => {
                const count = Math.max(0, Math.floor(Number(input.value) || 0));
                if (count > 0) consumables[input.dataset.extractionConsumable] = count;
            });
            const armor = {};
            for (
                const [key, selector] of [
                    ["helmet", "extraction-helmet"],
                    ["chest", "extraction-chest"],
                    ["backpack", "extraction-backpack"],
                    ["scope", "extraction-scope"],
                ]
            ) {
                const value = card.querySelector(`#${prefix}-${selector.split("-")[1]}-${index}`)?.value || "";
                if (value) armor[key] = value;
            }
            return {
                name: card.querySelector(".extraction-preset-name")?.value || "未命名配装",
                weight: Math.max(
                    0,
                    Math.floor(Number(card.querySelector(".extraction-preset-weight input")?.value) || 0),
                ),
                loadout: { guns, ammo, consumables, armor },
            };
        });
    }

    if (addExtractionLoadoutBtn) {
        addExtractionLoadoutBtn.addEventListener("click", () => {
            extractionLoadouts = collectExtractionLoadouts(
                extractionLoadoutsEditor,
                extractionLoadouts,
                "extraction",
            );
            extractionLoadouts.push({
                name: "新配装",
                weight: 10,
                loadout: { guns: [], ammo: {}, consumables: {}, armor: {} },
            });
            state.extractionLoadoutsDirty = true;
            renderExtractionLoadouts(extractionLoadoutsEditor, extractionLoadouts, "extraction");
            setExtractionStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
        });
    }

    // 搜打撤 AI 配装枪械选择：复用 1v1 的武器选择面板（完整枪械目录 + 图片）。
    document.addEventListener("click", (event) => {
        const btn = event.target?.closest?.(".extraction-gun-picker");
        if (!btn) return;
        const input = document.getElementById(btn.dataset.extractionGunInput);
        if (!input) return;
        const catalog = state.data?.duel?.catalog || [];
        openWeaponPickerFor({
            title: "选择搜打撤 AI 枪械",
            selectedId: input.value,
            onSelect: (weaponId) => {
                input.value = weaponId;
                const gun = catalog.find((w) => w.id === weaponId);
                const name = gun ? gun.name : weaponId;
                const image = gun ? gun.image : "";
                btn.innerHTML = (image
                    ? `<img class="extraction-gun-picker-icon" src="${image}" alt="" />`
                    : "")
                    + `<span>${String(name).replace(/"/g, "&quot;")}</span>`;
                const secret = String(input.id).startsWith("secret-extraction-");
                if (secret) {
                    state.secretExtractionLoadoutsDirty = true;
                    setSecretLoadoutStatus(
                        "有未保存的修改，自动刷新已暂停更新此区域",
                        "#ffd166",
                    );
                } else {
                    state.extractionLoadoutsDirty = true;
                    setExtractionStatus(
                        "有未保存的修改，自动刷新已暂停更新此区域",
                        "#ffd166",
                    );
                }
            },
            catalog,
        });
    });

    if (extractionLoadoutsEditor) {
        extractionLoadoutsEditor.addEventListener("click", (event) => {
            if (!event.target?.matches?.("[data-extraction-remove]")) return;
            extractionLoadouts = collectExtractionLoadouts(
                extractionLoadoutsEditor,
                extractionLoadouts,
                "extraction",
            );
            const card = event.target.closest(".extraction-preset-card");
            const index = Number(card?.dataset.index ?? -1);
            if (index >= 0 && index < extractionLoadouts.length) {
                extractionLoadouts.splice(index, 1);
                state.extractionLoadoutsDirty = true;
                renderExtractionLoadouts(extractionLoadoutsEditor, extractionLoadouts, "extraction");
                setExtractionStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
            }
        });
        extractionLoadoutsEditor.addEventListener("input", () => {
            state.extractionLoadoutsDirty = true;
            setExtractionStatus(
                state.extractionLoadoutsEditing
                    ? "正在编辑，自动刷新已暂停更新此区域（未保存）"
                    : "有未保存的修改，自动刷新已暂停更新此区域",
                "#ffd166",
            );
        });
        extractionLoadoutsEditor.addEventListener("change", () => {
            state.extractionLoadoutsDirty = true;
            setExtractionStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
        });
        extractionLoadoutsEditor.addEventListener("focusin", () => {
            state.extractionLoadoutsEditing = true;
            if (state.extractionLoadoutsDirty) {
                setExtractionStatus("正在编辑，自动刷新已暂停更新此区域（未保存）", "#ffd166");
            }
        });
        extractionLoadoutsEditor.addEventListener("focusout", () => {
            state.extractionLoadoutsEditing = false;
            if (state.extractionLoadoutsDirty) {
                setExtractionStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
            }
        });
    }

    if (saveExtractionAiLoadoutsBtn) {
        saveExtractionAiLoadoutsBtn.addEventListener("click", async () => {
            try {
                const presets = collectExtractionLoadouts(
                    extractionLoadoutsEditor,
                    extractionLoadouts,
                    "extraction",
                );
                const result = await api("/extraction/ai-loadouts", {
                    method: "POST",
                    body: JSON.stringify(presets),
                });
                extractionLoadouts = result.presets ?? presets;
                state.extractionLoadoutsDirty = false;
                state.extractionLoadoutsEditing = false;
                renderExtractionLoadouts(extractionLoadoutsEditor, extractionLoadouts, "extraction");
                setExtractionStatus("已保存", "#7dffa8");
            } catch (error) {
                setExtractionStatus(`保存失败：${error.message || error}`, "#ff6b6b");
            }
        });
    }

    // ---- 绝密 AI 配装（独立于普通搜打撤 AI） ----
    const secretLoadoutsEditor = $("#secret-extraction-loadouts-editor");
    const addSecretLoadoutBtn = $("#add-secret-extraction-loadout");
    const saveSecretLoadoutsBtn = $("#save-secret-extraction-ai-loadouts");
    const secretLoadoutsStatus = $("#secret-extraction-ai-loadouts-status");
    let secretExtractionLoadouts = [];

    function setSecretLoadoutStatus(text, color) {
        if (!secretLoadoutsStatus) return;
        secretLoadoutsStatus.textContent = text;
        secretLoadoutsStatus.style.color = color || "";
    }

    async function loadSecretExtractionAiLoadouts(force = false) {
        if (!secretLoadoutsEditor) return;
        if (state.secretExtractionLoadoutsDirty && !force) {
            setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
            return;
        }
        try {
            const data = await api("/extraction/secret-ai-loadouts");
            secretExtractionLoadouts = data.presets ?? [];
            state.secretExtractionLoadoutsDirty = false;
            renderExtractionLoadouts(
                secretLoadoutsEditor,
                secretExtractionLoadouts,
                "secret-extraction",
            );
            setSecretLoadoutStatus("");
        } catch (_) {
            setSecretLoadoutStatus("加载失败（未登录或接口不可用）", "#ff6b6b");
        }
    }

    if (addSecretLoadoutBtn) {
        addSecretLoadoutBtn.addEventListener("click", () => {
            secretExtractionLoadouts = collectExtractionLoadouts(
                secretLoadoutsEditor,
                secretExtractionLoadouts,
                "secret-extraction",
            );
            secretExtractionLoadouts.push({
                name: "新绝密配装",
                weight: 10,
                loadout: { guns: [], ammo: {}, consumables: {}, armor: {} },
            });
            state.secretExtractionLoadoutsDirty = true;
            renderExtractionLoadouts(
                secretLoadoutsEditor,
                secretExtractionLoadouts,
                "secret-extraction",
            );
            setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
        });
    }

    if (secretLoadoutsEditor) {
        secretLoadoutsEditor.addEventListener("click", (event) => {
            if (!event.target?.matches?.("[data-extraction-remove]")) return;
            secretExtractionLoadouts = collectExtractionLoadouts(
                secretLoadoutsEditor,
                secretExtractionLoadouts,
                "secret-extraction",
            );
            const card = event.target.closest(".extraction-preset-card");
            const index = Number(card?.dataset.index ?? -1);
            if (index >= 0 && index < secretExtractionLoadouts.length) {
                secretExtractionLoadouts.splice(index, 1);
                state.secretExtractionLoadoutsDirty = true;
                renderExtractionLoadouts(
                    secretLoadoutsEditor,
                    secretExtractionLoadouts,
                    "secret-extraction",
                );
                setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
            }
        });
        secretLoadoutsEditor.addEventListener("input", () => {
            state.secretExtractionLoadoutsDirty = true;
            setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
        });
        secretLoadoutsEditor.addEventListener("change", () => {
            state.secretExtractionLoadoutsDirty = true;
            setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
        });
        secretLoadoutsEditor.addEventListener("focusin", () => {
            state.secretExtractionLoadoutsEditing = true;
            if (state.secretExtractionLoadoutsDirty) {
                setSecretLoadoutStatus("正在编辑，自动刷新已暂停更新此区域（未保存）", "#ffd166");
            }
        });
        secretLoadoutsEditor.addEventListener("focusout", () => {
            state.secretExtractionLoadoutsEditing = false;
            if (state.secretExtractionLoadoutsDirty) {
                setSecretLoadoutStatus("有未保存的修改，自动刷新已暂停更新此区域", "#ffd166");
            }
        });
    }

    if (saveSecretLoadoutsBtn) {
        saveSecretLoadoutsBtn.addEventListener("click", async () => {
            try {
                const presets = collectExtractionLoadouts(
                    secretLoadoutsEditor,
                    secretExtractionLoadouts,
                    "secret-extraction",
                );
                const result = await api("/extraction/secret-ai-loadouts", {
                    method: "POST",
                    body: JSON.stringify(presets),
                });
                secretExtractionLoadouts = result.presets ?? presets;
                state.secretExtractionLoadoutsDirty = false;
                state.secretExtractionLoadoutsEditing = false;
                renderExtractionLoadouts(
                    secretLoadoutsEditor,
                    secretExtractionLoadouts,
                    "secret-extraction",
                );
                setSecretLoadoutStatus("已保存", "#7dffa8");
            } catch (error) {
                setSecretLoadoutStatus(`保存失败：${error.message || error}`, "#ff6b6b");
            }
        });
    }

    if (saveExtractionSecretBtn) {
        saveExtractionSecretBtn.addEventListener("click", async () => {
            try {
                const result = await api("/extraction-secret-config", {
                    method: "POST",
                    body: JSON.stringify({
                        enabled: extractionSecretEnabled?.checked === true,
                        immortalBoost: extractionSecretImmortalBoost?.checked !== false,
                        aiDifficulty: extractionSecretDifficulty?.value || "normal",
                    }),
                });
                if (result.extractionSecret) {
                    extractionSecretStatus.textContent = "已保存（新开局生效）";
                    extractionSecretStatus.style.color = "#7dffa8";
                } else {
                    extractionSecretStatus.textContent = "保存失败";
                    extractionSecretStatus.style.color = "#ff6b6b";
                }
            } catch (error) {
                extractionSecretStatus.textContent = error.message === "AUTH"
                    ? "登录会话已失效"
                    : error.message || "保存失败";
                extractionSecretStatus.style.color = "#ff6b6b";
            }
        });
    }

    if (addExtractionBossDropBtn) {
        addExtractionBossDropBtn.addEventListener("click", () => {
            extractionBossDrops.push({ type: "", count: 1, weight: 100 });
            renderExtractionBossDrops();
        });
    }

    if (addExtractionBossWeaponBtn) {
        addExtractionBossWeaponBtn.addEventListener("click", () => {
            extractionBossWeapons.push({ type: "", count: 1 });
            renderExtractionBossWeapons();
        });
    }

    if (pickExtractionBossPerkBtn) {
        pickExtractionBossPerkBtn.addEventListener("click", () => {
            openBossPerkPicker(extractionBossPerks);
        });
    }

    if (pickExtractionBossDefaultPerkBtn) {
        pickExtractionBossDefaultPerkBtn.addEventListener("click", () => {
            openBossPerkPicker(extractionBossDefaultPerks);
        });
    }

    if (addExtractionAiDropBtn) {
        addExtractionAiDropBtn.addEventListener("click", () => {
            extractionAiDropItems.push({ type: "", count: 1, weight: 100 });
            renderExtractionAiDropItems();
        });
    }

    // Boss 武器选择：复用 1v1 武器面板。
    document.addEventListener("click", (event) => {
        const btn = event.target?.closest?.("[data-boss-weapon-index]");
        if (!btn) return;
        const index = Number(btn.dataset.bossWeaponIndex);
        if (!Number.isInteger(index) || !extractionBossWeapons[index]) return;
        const catalog = state.data?.duel?.catalog || [];
        openWeaponPickerFor({
            title: "选择 Boss 武器",
            selectedId: extractionBossWeapons[index].type,
            onSelect: (weaponId) => {
                extractionBossWeapons[index].type = weaponId;
                renderExtractionBossWeapons();
            },
            catalog,
        });
    });

    if (saveExtractionBossBtn) {
        saveExtractionBossBtn.addEventListener("click", async () => {
            try {
                const defaultPerks = readBossPerkPicks(extractionBossDefaultPerks);
                const perks = readBossPerkPicks(extractionBossPerks);
                const result = await api("/extraction-boss-config", {
                    method: "POST",
                    body: JSON.stringify({
                        enabled: extractionBossEnabled?.checked === true,
                        maxHealth: Number(extractionBossHealth?.value) || 600,
                        count: Number(extractionBossCount?.value) || 2,
                        bossDefaultPerks: defaultPerks.length > 0
                            ? defaultPerks
                            : ["steelskin", "flak_jacket", "gotw"],
                        bossPerks: perks,
                        weapons: extractionBossWeapons.filter(
                            (entry) => entry && String(entry.type || "").trim(),
                        ),
                        armor: {
                            helmet: extractionBossArmorHelmet?.value || "",
                            chest: extractionBossArmorChest?.value || "",
                            backpack: extractionBossArmorBackpack?.value || "",
                            scope: extractionBossArmorScope?.value || "",
                        },
                        dropItems: extractionBossDrops.filter(
                            (entry) => entry && String(entry.type || "").trim(),
                        ),
                    }),
                });

                if (saveExtractionAiDropItemsBtn) {
                    saveExtractionAiDropItemsBtn.addEventListener("click", async () => {
                        try {
                            const result = await api("/extraction-ai-drop-items", {
                                method: "POST",
                                body: JSON.stringify({
                                    dropItems: extractionAiDropItems.filter(
                                        (entry) => entry && String(entry.type || "").trim(),
                                    ),
                                }),
                            });
                            if (result.extractionAiDropItems) {
                                extractionAiDropItemsStatus.textContent = "已保存（新开局生效）";
                                extractionAiDropItemsStatus.style.color = "#7dffa8";
                            } else {
                                extractionAiDropItemsStatus.textContent = "保存失败";
                                extractionAiDropItemsStatus.style.color = "#ff6b6b";
                            }
                        } catch (error) {
                            extractionAiDropItemsStatus.textContent = error.message === "AUTH"
                                ? "登录会话已失效"
                                : (error.message || "保存失败");
                            extractionAiDropItemsStatus.style.color = "#ff6b6b";
                        }
                    });
                }
                if (result.extractionBoss) {
                    extractionBossStatus.textContent = "已保存（新开局生效）";
                    extractionBossStatus.style.color = "#7dffa8";
                    renderExtractionBoss(result.extractionBoss);
                } else {
                    extractionBossStatus.textContent = "保存失败";
                    extractionBossStatus.style.color = "#ff6b6b";
                }
            } catch (error) {
                extractionBossStatus.textContent = error.message === "AUTH"
                    ? "登录会话已失效"
                    : error.message || "保存失败";
                extractionBossStatus.style.color = "#ff6b6b";
            }
        });
    }

    if (saveExtractionHuntersBtn) {
        saveExtractionHuntersBtn.addEventListener("click", async () => {
            try {
                const result = await api("/extraction-hunters-config", {
                    method: "POST",
                    body: JSON.stringify({
                        normal: {
                            solo: Number(extractionHuntersNormalSolo?.value) || 0,
                            duo: Number(extractionHuntersNormalDuo?.value) || 0,
                            squad: Number(extractionHuntersNormalSquad?.value) || 0,
                        },
                        secret: {
                            solo: Number(extractionHuntersSecretSolo?.value) || 0,
                            duo: Number(extractionHuntersSecretDuo?.value) || 0,
                            squad: Number(extractionHuntersSecretSquad?.value) || 0,
                        },
                    }),
                });
                if (result.extractionHunters) {
                    extractionHuntersStatus.textContent = "已保存（新开局生效）";
                    extractionHuntersStatus.style.color = "#7dffa8";
                    renderExtractionHunters(result.extractionHunters);
                } else {
                    extractionHuntersStatus.textContent = "保存失败";
                    extractionHuntersStatus.style.color = "#ff6b6b";
                }
            } catch (error) {
                extractionHuntersStatus.textContent = error.message === "AUTH"
                    ? "登录会话已失效"
                    : error.message || "保存失败";
                extractionHuntersStatus.style.color = "#ff6b6b";
            }
        });
    }

    async function spectateGame(gameId, button) {
        if (button) button.disabled = true;
        try {
            const result = await api("/game-action", {
                method: "POST",
                body: JSON.stringify({ action: "spectate", gameId }),
            });
            const match = result.matchData;
            const params = new URLSearchParams({
                adminSpectate: "1",
                gameId: String(match.gameId),
                token: match.data,
                useHttps: match.useHttps ? "1" : "0",
                hosts: JSON.stringify(match.hosts || match.addrs || []),
                addrs: JSON.stringify(match.addrs || match.hosts || []),
            });
            window.open(`/?${params.toString()}`, "_blank", "noopener");
            notify("已打开观战页面");
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
            // The room may have ended between the last 2-second status refresh
            // and this click. Refresh immediately so the stale row disappears.
            if (error.message !== "AUTH") await refresh(false);
        } finally {
            if (button?.isConnected) button.disabled = false;
        }
    }

    async function addAiToGame(gameId) {
        const difficulty = state.duelDraft?.aiDifficulty || state.data?.duel?.aiDifficulty || "normal";
        try {
            await api("/game-action", {
                method: "POST",
                body: JSON.stringify({ action: "add-ai", gameId, difficulty }),
            });
            notify(`已向房间加入${difficulty === "pro" ? "Pro" : difficulty === "hard" ? "困难" : "普通"} AI`);
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        }
    }

    async function stopGame(gameId) {
        if (!confirm("确定要关闭这个房间吗？房间内玩家会断开连接。")) return;
        try {
            await api("/game-action", { method: "POST", body: JSON.stringify({ action: "stop", gameId }) });
            notify("房间已关闭");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        }
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = passwordInput.value;
        loginError.textContent = "";
        const button = loginForm.querySelector("button");
        button.disabled = true;
        try {
            const result = await apiPublic("/auth/login", {
                method: "POST",
                body: JSON.stringify({ password }),
            });
            state.session = result.sessionToken;
            sessionStorage.setItem("surviv-admin-session", state.session);
            passwordInput.value = "";
            await refresh(true);
            startAutoRefresh();
        } catch (error) {
            showLogin(error.message || "管理员密码错误");
        } finally {
            button.disabled = false;
        }
    });
    refreshButton.addEventListener("click", () => refresh(true));
    for (
        const [key, input, min] of [
            ["solo", roomLimitSolo, 1],
            ["duo", roomLimitDuo, 2],
            ["squad", roomLimitSquad, 4],
            ["faction", roomLimitFaction, 2],
        ]
    ) {
        input.addEventListener("input", () => {
            if (!state.roomPlayerLimitsDraft) return;
            const value = parseDraftNumber(input.value, min, 100, 1);
            if (value === null) return;
            state.roomPlayerLimitsDraft[key] = value;
            state.roomPlayerLimitsDirty = true;
            const status = $("#room-player-limits-status");
            if (status) {
                status.textContent = "已修改未保存（自动刷新不会覆盖）";
                status.style.color = "#ffd166";
            }
        });
    }
    roomPlayerLimitsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveRoomPlayerLimitsConfig().catch((error) =>
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true)
        );
    });
    pureAiDuelForm.addEventListener("submit", (event) => {
        event.preventDefault();
        createPureAiDuel().catch((error) => notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true));
    });
    duelWeaponForm.addEventListener("submit", (event) => {
        event.preventDefault();
        persistDuelWeapons();
    });
    announcementForm.addEventListener("submit", (event) => {
        event.preventDefault();
        persistAnnouncement();
    });
    liveAnnouncementForm.addEventListener("submit", (event) => {
        event.preventDefault();
        publishLiveAnnouncement();
    });
    clearLiveAnnouncement.addEventListener("click", removeLiveAnnouncement);
    btnUpdateBlockOn.addEventListener("click", async () => {
        const minutes = Math.max(
            1,
            Math.min(10, Math.floor(Number(updateBlockMinutes.value) || 10)),
        );
        try {
            await api("/update-block", {
                method: "POST",
                body: JSON.stringify({ minutes }),
            });
            notify(`已开启更新维护（${minutes} 分钟），玩家暂时无法开始对局。`);
            await refresh(false);
        } catch (error) {
            notify(error.message, true);
        }
    });
    btnUpdateBlockOff.addEventListener("click", async () => {
        try {
            await api("/update-block", {
                method: "POST",
                body: JSON.stringify({ clear: true }),
            });
            notify("已解除更新维护。");
            await refresh(false);
        } catch (error) {
            notify(error.message, true);
        }
    });
    liveAnnouncementMessage.addEventListener("input", () => {
        setText(
            "#live-announcement-character-count",
            `${liveAnnouncementMessage.value.length} / 300`,
        );
    });
    botAutoFillForm.addEventListener("submit", (event) => {
        event.preventDefault();
        persistBotAutoFill();
    });
    botGlobalInterval.addEventListener("input", () => {
        if (!state.botAutoFillDraft) return;
        const seconds = parseDraftNumber(botGlobalInterval.value, 0.5, 60, 0.5);
        if (seconds === null) return;
        state.botAutoFillDraft.defaultJoinIntervalMs = Math.round(seconds * 1000);
        updateBotAutoFillDirty();
    });
    const commitGlobalInterval = () => {
        if (!state.botAutoFillDraft) return;
        const seconds = normalizeDraftNumber(
            botGlobalInterval.value,
            state.botAutoFillDraft.defaultJoinIntervalMs / 1000,
            0.5,
            60,
            0.5,
        );
        botGlobalInterval.value = String(seconds);
        state.botAutoFillDraft.defaultJoinIntervalMs = Math.round(seconds * 1000);
        updateBotAutoFillDirty();
    };
    botGlobalInterval.addEventListener("change", commitGlobalInterval);
    botGlobalInterval.addEventListener("blur", commitGlobalInterval);
    botMaxWorkers.addEventListener("input", () => {
        if (!state.botAutoFillDraft) return;
        const value = parseDraftNumber(botMaxWorkers.value, 1, 64, 1);
        if (value === null) return;
        state.botAutoFillDraft.maxBotWorkers = value;
        updateBotAutoFillDirty();
    });
    botMaxWorkers.addEventListener("change", () => {
        if (!state.botAutoFillDraft) return;
        const value = normalizeDraftNumber(
            botMaxWorkers.value,
            state.botAutoFillDraft.maxBotWorkers,
            1,
            64,
            1,
        );
        botMaxWorkers.value = String(value);
        state.botAutoFillDraft.maxBotWorkers = value;
        updateBotAutoFillDirty();
    });
    botMaxWorkers.addEventListener("blur", () => {
        if (!state.botAutoFillDraft) return;
        const value = normalizeDraftNumber(
            botMaxWorkers.value,
            state.botAutoFillDraft.maxBotWorkers,
            1,
            64,
            1,
        );
        botMaxWorkers.value = String(value);
        state.botAutoFillDraft.maxBotWorkers = value;
        updateBotAutoFillDirty();
    });

    const wireBotTargetInput = (input, field, min = 1, max = 100) => {
        input.addEventListener("input", () => {
            if (!state.botAutoFillDraft) return;
            const target = parseDraftNumber(input.value, min, max, 1);
            if (target === null) return;
            state.botAutoFillDraft[field] = target;
            updateBotAutoFillDirty();
        });
        const commit = () => {
            if (!state.botAutoFillDraft) return;
            const target = normalizeDraftNumber(
                input.value,
                state.botAutoFillDraft[field],
                min,
                max,
                1,
            );
            input.value = String(target);
            state.botAutoFillDraft[field] = target;
            updateBotAutoFillDirty();
            renderBotAutoFill(state.data.botAutoFill);
        };
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
    };
    wireBotTargetInput(botSoloTargetPlayerCount, "soloTargetPlayerCount");
    wireBotTargetInput(botDuoTargetPlayerCount, "duoTargetPlayerCount");
    wireBotTargetInput(botSquadTargetPlayerCount, "squadTargetPlayerCount");
    wireBotTargetInput(botFactionTargetPlayerCount, "factionTargetPlayerCount");
    wireBotTargetInput(
        botSecretSoloTargetPlayerCount,
        "extractionSecretSoloTargetPlayerCount",
        0,
        100,
    );
    wireBotTargetInput(
        botSecretDuoTargetPlayerCount,
        "extractionSecretDuoTargetPlayerCount",
        0,
        100,
    );
    wireBotTargetInput(
        botSecretSquadTargetPlayerCount,
        "extractionSecretSquadTargetPlayerCount",
        0,
        100,
    );
    botFillTargetsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        persistBotAutoFill();
    });

    for (const [difficulty, input] of Object.entries(botRatioInputs)) {
        input.addEventListener("input", () => {
            if (!state.botAutoFillDraft) return;
            const ratio = parseDraftNumber(input.value, 0, 100, 1);
            if (ratio === null) return;
            state.botAutoFillDraft.difficultyRatios[difficulty] = ratio;
            updateBotAutoFillDirty();
        });
        const commitRatio = () => {
            if (!state.botAutoFillDraft) return;
            const ratio = normalizeDraftNumber(
                input.value,
                state.botAutoFillDraft.difficultyRatios[difficulty],
                0,
                100,
                1,
            );
            input.value = String(ratio);
            state.botAutoFillDraft.difficultyRatios[difficulty] = ratio;
            updateBotAutoFillDirty();
        };
        input.addEventListener("change", commitRatio);
        input.addEventListener("blur", commitRatio);
    }
    for (const [difficulty, input] of Object.entries(botThinkIntervalInputs)) {
        input.addEventListener("input", () => {
            if (!state.botAutoFillDraft) return;
            const interval = parseDraftNumber(input.value, 1, 250, 1);
            if (interval === null) return;
            state.botAutoFillDraft.thinkIntervalsMs[difficulty] = interval;
            state.botAutoFillDraft.highBudgetIntervalMs = state.botAutoFillDraft.thinkIntervalsMs.legit;
            updateBotAutoFillDirty();
        });
        const commitInterval = () => {
            if (!state.botAutoFillDraft) return;
            const interval = normalizeDraftNumber(
                input.value,
                state.botAutoFillDraft.thinkIntervalsMs[difficulty],
                1,
                250,
                1,
            );
            input.value = String(interval);
            state.botAutoFillDraft.thinkIntervalsMs[difficulty] = interval;
            state.botAutoFillDraft.highBudgetIntervalMs = state.botAutoFillDraft.thinkIntervalsMs.legit;
            updateBotAutoFillDirty();
        };
        input.addEventListener("change", commitInterval);
        input.addEventListener("blur", commitInterval);
    }
    const frequencyPresets = {
        balanced: { normal: 150, hard: 60, pro: 28, legit: 6, forbidden: 4 },
        fast: { normal: 95, hard: 45, pro: 20, legit: 5, forbidden: 3 },
        "low-cpu": { normal: 170, hard: 90, pro: 45, legit: 12, forbidden: 8 },
    };
    document.querySelectorAll("[data-bot-frequency-preset]").forEach((button) => {
        button.addEventListener("click", () => {
            if (!state.botAutoFillDraft) return;
            const preset = frequencyPresets[button.dataset.botFrequencyPreset];
            if (!preset) return;
            state.botAutoFillDraft.thinkIntervalsMs = { ...preset };
            state.botAutoFillDraft.highBudgetIntervalMs = preset.legit;
            for (const [difficulty, input] of Object.entries(botThinkIntervalInputs)) {
                input.value = String(preset[difficulty]);
            }
            updateBotAutoFillDirty();
        });
    });
    changePasswordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (newPassword.value !== confirmPassword.value) {
            notify("两次输入的新密码不一致", true);
            return;
        }
        if (newPassword.value.length < 8) {
            notify("新密码至少需要8个字符", true);
            return;
        }
        const button = changePasswordForm.querySelector("button");
        button.disabled = true;
        try {
            await api("/auth/change-password", {
                method: "POST",
                body: JSON.stringify({
                    currentPassword: currentPassword.value,
                    newPassword: newPassword.value,
                }),
            });
            currentPassword.value = "";
            newPassword.value = "";
            confirmPassword.value = "";
            state.session = "";
            sessionStorage.removeItem("surviv-admin-session");
            showLogin("密码修改成功，请使用新密码重新登录。");
        } catch (error) {
            notify(error.message === "AUTH" ? "当前密码错误或会话已失效" : error.message, true);
        } finally {
            button.disabled = false;
        }
    });
    [announcementHeading, announcementDate, announcementTitle, announcementBody].forEach(
        (input) => input.addEventListener("input", readAnnouncementDraft),
    );
    duelAdrenalineEnabled.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.adrenalineEnabled = duelAdrenalineEnabled.checked;
        duelBoost.disabled = !duelAdrenalineEnabled.checked;
        updateDuelDirty();
    });
    duelAiEnabled.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.aiEnabled = duelAiEnabled.checked;
        duelAiDifficulty.disabled = !duelAiEnabled.checked;
        updateDuelDirty();
    });
    duelAiDifficulty.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.aiDifficulty = duelAiDifficulty.value;
        updateDuelDirty();
    });
    duelBoost.addEventListener("input", () => {
        if (!state.duelDraft) return;
        const boost = parseDraftNumber(duelBoost.value, 0, 100, 1);
        if (boost === null) return;
        state.duelDraft.boost = boost;
        updateDuelDirty();
    });
    const commitDuelBoost = () => {
        if (!state.duelDraft) return;
        const boost = normalizeDraftNumber(
            duelBoost.value,
            state.duelDraft.boost,
            0,
            100,
            1,
        );
        duelBoost.value = String(boost);
        state.duelDraft.boost = boost;
        updateDuelDirty();
    };
    duelBoost.addEventListener("change", commitDuelBoost);
    duelBoost.addEventListener("blur", commitDuelBoost);
    duelHelmetLevel.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.helmetLevel = clampInteger(duelHelmetLevel.value, 0, 3);
        updateDuelDirty();
    });
    duelChestLevel.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.chestLevel = clampInteger(duelChestLevel.value, 0, 3);
        updateDuelDirty();
    });
    duelScope.addEventListener("change", () => {
        if (!state.duelDraft) return;
        state.duelDraft.scope = duelScope.value;
        updateDuelDirty();
    });
    document.querySelectorAll("[data-duel-slot]").forEach((button) => {
        button.addEventListener("click", () => openWeaponPicker(Number(button.dataset.duelSlot)));
    });
    $("#close-weapon-picker").addEventListener("click", closeWeaponPicker);
    weaponSearch.addEventListener("input", renderWeaponCatalog);
    weaponCategory.addEventListener("change", renderWeaponCatalog);
    weaponPicker.addEventListener("click", (event) => {
        if (event.target === weaponPicker) closeWeaponPicker();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !weaponPicker.hidden) closeWeaponPicker();
    });
    $("#logout-button").addEventListener("click", async () => {
        try {
            await api("/auth/logout", { method: "POST", body: "{}" });
        } catch (_) {}
        stopAutoRefresh();
        state.session = "";
        sessionStorage.removeItem("surviv-admin-session");
        state.data = null;
        showLogin();
    });
    createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = createForm.querySelector("button");
        button.disabled = true;
        try {
            await api("/games", { method: "POST", body: JSON.stringify({ modeIndex: Number(modeSelect.value) }) });
            notify("新房间已创建");
            await refresh(false);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        } finally {
            button.disabled = false;
        }
    });
    const navigationItems = [...document.querySelectorAll(".nav-item")];
    const navigationSections = navigationItems
        .map((item) => {
            const href = item.getAttribute("href") || "";
            const section = href.startsWith("#") ? document.querySelector(href) : null;
            return section ? { item, section, href } : null;
        })
        .filter(Boolean);
    let navigationClickLockUntil = 0;
    let navigationFramePending = false;

    const setActiveNavigation = (href, updateHash = false) => {
        let activeItem = null;
        navigationItems.forEach((item) => {
            const active = item.getAttribute("href") === href;
            item.classList.toggle("active", active);
            if (active) activeItem = item;
        });
        activeItem?.scrollIntoView({ block: "nearest" });
        if (updateHash && window.location.hash !== href) {
            history.replaceState(null, "", href);
        }
    };

    const syncActiveNavigationFromHash = () => {
        const hash = window.location.hash || "#overview";
        setActiveNavigation(hash);
    };

    const syncActiveNavigationFromScroll = () => {
        navigationFramePending = false;
        if (!navigationSections.length || Date.now() < navigationClickLockUntil) return;
        const marker = Math.min(190, Math.max(92, window.innerHeight * 0.28));
        let active = navigationSections[0];
        for (const entry of navigationSections) {
            if (entry.section.getBoundingClientRect().top <= marker) active = entry;
            else break;
        }
        const pageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
        if (pageBottom) active = navigationSections[navigationSections.length - 1];
        setActiveNavigation(active.href, true);
    };

    const queueNavigationScrollSync = () => {
        if (navigationFramePending) return;
        navigationFramePending = true;
        requestAnimationFrame(syncActiveNavigationFromScroll);
    };

    navigationItems.forEach((item) =>
        item.addEventListener("click", () => {
            navigationClickLockUntil = Date.now() + 650;
            setActiveNavigation(item.getAttribute("href") || "#overview");
        })
    );
    window.addEventListener("hashchange", syncActiveNavigationFromHash);
    window.addEventListener("scroll", queueNavigationScrollSync, { passive: true });
    window.addEventListener("resize", queueNavigationScrollSync);
    syncActiveNavigationFromHash();
    queueNavigationScrollSync();

    // ---- 玩家仓库管理 ----
    const stashPlayerSelect = $("#stash-player-select");
    const stashPlayerSearch = $("#stash-player-search");
    const stashAdminBody = $("#stash-admin-body");
    const stashAdminRefreshBtn = $("#stash-admin-refresh");
    // 物品类型 → 图片 URL（与局内 loot 图标一致；路径以 /img 开头，适用于 /admin 页面）
    const STASH_ITEM_IMAGES = {
        "mp5": "/img/loot/loot-weapon-mp5.svg",
        "mac10": "/img/loot/loot-weapon-mac10.svg",
        "ump9": "/img/loot/loot-weapon-ump9.svg",
        "vector": "/img/loot/loot-weapon-vector.svg",
        "vector45": "/img/loot/loot-weapon-vector45.svg",
        "scorpion": "/img/loot/loot-weapon-scorpion.svg",
        "vss": "/img/loot/loot-weapon-vss.svg",
        "famas": "/img/loot/loot-weapon-famas.svg",
        "hk416": "/img/loot/loot-weapon-hk416.svg",
        "m4a1": "/img/loot/loot-weapon-m4a1.svg",
        "mk12": "/img/loot/loot-weapon-mk12.svg",
        "l86": "/img/loot/loot-weapon-l86.svg",
        "m249": "/img/loot/loot-weapon-m249.svg",
        "qbb97": "/img/loot/loot-weapon-qbb97.svg",
        "scout_elite": "/img/loot/loot-weapon-scout.svg",
        "ak47": "/img/loot/loot-weapon-ak.svg",
        "scar": "/img/loot/loot-weapon-scar.svg",
        "scarssr": "/img/loot/loot-weapon-scarssr.svg",
        "an94": "/img/loot/loot-weapon-an94.svg",
        "groza": "/img/loot/loot-weapon-groza.svg",
        "grozas": "/img/loot/loot-weapon-grozas.svg",
        "dp28": "/img/loot/loot-weapon-dp28.svg",
        "bar": "/img/loot/loot-weapon-bar.svg",
        "pkp": "/img/loot/loot-weapon-pkp.svg",
        "model94": "/img/loot/loot-weapon-model94.svg",
        "mkg45": "/img/loot/loot-weapon-mkg45.svg",
        "blr": "/img/loot/loot-weapon-blr.svg",
        "mosin": "/img/loot/loot-weapon-mosin.svg",
        "sv98": "/img/loot/loot-weapon-sv98.svg",
        "awc": "/img/loot/loot-weapon-awc.svg",
        "m39": "/img/loot/loot-weapon-m39.svg",
        "svd": "/img/loot/loot-weapon-svd.svg",
        "garand": "/img/loot/loot-weapon-garand.svg",
        "m870": "/img/loot/loot-weapon-m870.svg",
        "m1100": "/img/loot/loot-weapon-m1100.svg",
        "mp220": "/img/loot/loot-weapon-mp220.svg",
        "saiga": "/img/loot/loot-weapon-saiga.svg",
        "spas12": "/img/loot/loot-weapon-spas12.svg",
        "m1014": "/img/loot/loot-weapon-m1014.svg",
        "usas": "/img/loot/loot-weapon-usas.svg",
        "m9": "/img/loot/loot-weapon-m9.svg",
        "m9_dual": "/img/loot/loot-weapon-m9-dual.svg",
        "m9_cursed": "/img/loot/loot-weapon-m9-cursed.svg",
        "m93r": "/img/loot/loot-weapon-m93r.svg",
        "m93r_dual": "/img/loot/loot-weapon-m93r-dual.svg",
        "glock": "/img/loot/loot-weapon-glock.svg",
        "glock_dual": "/img/loot/loot-weapon-glock-dual.svg",
        "p30l": "/img/loot/loot-weapon-p30l.svg",
        "p30l_dual": "/img/loot/loot-weapon-p30l-dual.svg",
        "ot38": "/img/loot/loot-weapon-ot38.svg",
        "ot38_dual": "/img/loot/loot-weapon-ot38-dual.svg",
        "ots38": "/img/loot/loot-weapon-ots38.svg",
        "ots38_dual": "/img/loot/loot-weapon-ots38-dual.svg",
        "colt45": "/img/loot/loot-weapon-colt45.svg",
        "colt45_dual": "/img/loot/loot-weapon-colt45-dual.svg",
        "m1911": "/img/loot/loot-weapon-m1911.svg",
        "m1911_dual": "/img/loot/loot-weapon-m1911-dual.svg",
        "m1a1": "/img/loot/loot-weapon-m1a1.svg",
        "deagle": "/img/loot/loot-weapon-deagle.svg",
        "deagle_dual": "/img/loot/loot-weapon-deagle-dual.svg",
        "flare_gun": "/img/loot/loot-weapon-flare-gun.svg",
        "flare_gun_dual": "/img/loot/loot-weapon-flare-gun-dual.svg",
        "potato_cannon": "/img/loot/loot-weapon-potato-cannon.svg",
        "potato_smg": "/img/loot/loot-weapon-potato-smg.svg",
        "bugle": "/img/loot/loot-weapon-bugle.svg",
        "9mm": "/img/emotes/ammo-9mm.svg",
        "762mm": "/img/emotes/ammo-762mm.svg",
        "556mm": "/img/emotes/ammo-556mm.svg",
        "12gauge": "/img/emotes/ammo-12gauge.svg",
        "50AE": "/img/emotes/ammo-50AE.svg",
        "308sub": "/img/emotes/ammo-308sub.svg",
        "flare": "/img/emotes/ammo-flare.svg",
        "45acp": "/img/emotes/ammo-45acp.svg",
        "potato_ammo": "/img/emotes/ammo-box.svg",
        "bandage": "/img/loot/loot-medical-bandage.svg",
        "healthkit": "/img/loot/loot-medical-healthkit.svg",
        "soda": "/img/loot/loot-medical-soda.svg",
        "painkiller": "/img/loot/loot-medical-pill.svg",
        "backpack00": "/img/loot/loot-pack-00.svg",
        "backpack01": "/img/loot/loot-pack-01.svg",
        "backpack02": "/img/loot/loot-pack-02.svg",
        "backpack03": "/img/loot/loot-pack-03.svg",
        "helmet01": "/img/loot/loot-helmet-01.svg",
        "helmet02": "/img/loot/loot-helmet-02.svg",
        "helmet03": "/img/loot/loot-helmet-03.svg",
        "helmet04": "/img/loot/loot-helmet-03.svg",
        "chest01": "/img/loot/loot-chest-01.svg",
        "chest02": "/img/loot/loot-chest-02.svg",
        "chest03": "/img/loot/loot-chest-03.svg",
        "chest04": "/img/loot/loot-chest-03.svg",
        "1xscope": "/img/loot/loot-scope-00.svg",
        "2xscope": "/img/loot/loot-scope-01.svg",
        "4xscope": "/img/loot/loot-scope-02.svg",
        "8xscope": "/img/loot/loot-scope-03.svg",
        "15xscope": "/img/loot/loot-scope-04.svg",
        "helmet03_leader": "/img/loot/loot-helmet-03.svg",
        "helmet03_forest": "/img/loot/player-helmet-forest.svg",
        "helmet03_moon": "/img/loot/loot-helmet-03.svg",
        "helmet03_lt": "/img/loot/loot-helmet-03.svg",
        "helmet03_lt_aged": "/img/loot/player-helmet-lieutenant.svg",
        "helmet03_potato": "/img/loot/player-helmet-potato.svg",
        "helmet03_marksman": "/img/loot/player-helmet-marksman.svg",
        "helmet03_recon": "/img/loot/player-helmet-recon.svg",
        "helmet03_grenadier": "/img/loot/player-helmet-grenadier.svg",
        "helmet03_bugler": "/img/loot/player-helmet-bugler.svg",
        "helmet04_medic": "/img/loot/player-helmet-medic.svg",
        "helmet04_last_man_red": "/img/loot/player-helmet-last-man-01.svg",
        "helmet04_last_man_blue": "/img/loot/player-helmet-last-man-02.svg",
        "helmet04_leader": "/img/loot/player-helmet-leader.svg",
        "frag": "/img/loot/loot-throwable-frag.svg",
        "mirv": "/img/loot/loot-throwable-mirv.svg",
        "mirv_mini": "/img/loot/loot-throwable-frag.svg",
        "martyr_nade": "/img/loot/loot-throwable-frag.svg",
        "smoke": "/img/loot/loot-throwable-smoke.svg",
        "strobe": "/img/loot/loot-throwable-strobe.svg",
        "snowball": "/img/loot/loot-throwable-snowball.svg",
        "snowball_heavy": "/img/loot/loot-throwable-snowball.svg",
        "potato": "/img/loot/loot-throwable-potato.svg",
        "potato_heavy": "/img/loot/loot-throwable-potato.svg",
        "potato_cannonball": "/img/loot/loot-throwable-potato.svg",
        "potato_smgshot": "/img/loot/loot-throwable-potato.svg",
        "bomb_iron": "/img/loot/loot-throwable-frag.svg",
        "fists": "/img/loot/loot-weapon-fists.svg",
        "knuckles": "/img/loot/loot-melee-knuckles-rusted.svg",
        "karambit": "/img/loot/loot-melee-karambit-rugged.svg",
        "bayonet": "/img/loot/loot-melee-bayonet-rugged.svg",
        "huntsman": "/img/loot/loot-melee-huntsman-rugged.svg",
        "bowie": "/img/loot/loot-melee-bowie-vintage.svg",
        "machete": "/img/loot/loot-melee-machete-taiga.svg",
        "saw": "/img/loot/loot-melee-bonesaw-rusted.svg",
        "woodaxe": "/img/loot/loot-melee-woodaxe.svg",
        "fireaxe": "/img/loot/loot-melee-fireaxe.svg",
        "katana": "/img/loot/loot-melee-katana.svg",
        "naginata": "/img/loot/loot-melee-naginata.svg",
        "stonehammer": "/img/loot/loot-melee-stonehammer.svg",
        "hook": "/img/loot/loot-melee-hook-silver.svg",
        "pan": "/img/loot/loot-melee-pan-black.svg",
        "spade": "/img/loot/loot-melee-spade-assault.svg",
        "crowbar": "/img/loot/loot-melee-crowbar-recon.svg",
        "knuckles_rusted": "/img/loot/loot-melee-knuckles-rusted.svg",
        "knuckles_heroic": "/img/loot/loot-melee-knuckles-heroic.svg",
        "karambit_rugged": "/img/loot/loot-melee-karambit-rugged.svg",
        "karambit_prismatic": "/img/loot/loot-melee-karambit-prismatic.svg",
        "karambit_drowned": "/img/loot/loot-melee-karambit-drowned.svg",
        "bayonet_rugged": "/img/loot/loot-melee-bayonet-rugged.svg",
        "bayonet_woodland": "/img/loot/loot-melee-bayonet-woodland.svg",
        "huntsman_rugged": "/img/loot/loot-melee-huntsman-rugged.svg",
        "huntsman_burnished": "/img/loot/loot-melee-huntsman-burnished.svg",
        "bowie_vintage": "/img/loot/loot-melee-bowie-vintage.svg",
        "bowie_frontier": "/img/loot/loot-melee-bowie-frontier.svg",
        "machete_taiga": "/img/loot/loot-melee-machete-taiga.svg",
        "kukri_trad": "/img/loot/loot-melee-kukri-trad.svg",
        "bonesaw_rusted": "/img/loot/loot-melee-bonesaw-rusted.svg",
        "woodaxe_bloody": "/img/loot/loot-melee-woodaxe-bloody.svg",
        "katana_rusted": "/img/loot/loot-melee-katana-rusted.svg",
        "katana_orchid": "/img/loot/loot-melee-katana-orchid.svg",
        "sledgehammer": "/img/loot/loot-melee-sledgehammer.svg",
        "crowbar_scout": "/img/loot/loot-melee-crowbar-recon.svg",
        "crowbar_recon": "/img/loot/loot-melee-crowbar-recon.svg",
        "kukri_sniper": "/img/loot/loot-melee-kukri-sniper.svg",
        "bonesaw_healer": "/img/loot/loot-melee-bonesaw-healer.svg",
        "katana_demo": "/img/loot/loot-melee-katana-demo.svg",
        "spade_assault": "/img/loot/loot-melee-spade-assault.svg",
        "warhammer_tank": "/img/loot/loot-melee-warhammer-tank.svg",
        "leadership": "/img/loot/loot-perk-leadership.svg",
        "firepower": "/img/loot/loot-perk-firepower.svg",
        "gotw": "/img/loot/loot-perk-gotw.svg",
        "windwalk": "/img/loot/loot-perk-windwalk.svg",
        "rare_potato": "/img/loot/loot-perk-rare-potato.svg",
        "aoe_heal": "/img/loot/loot-perk-aoe-heal.svg",
        "endless_ammo": "/img/loot/loot-perk-endless-ammo.svg",
        "steelskin": "/img/loot/loot-perk-steelskin.svg",
        "lifeline": "/img/loot/loot-perk-lifeline.svg",
        "combat_stims": "/img/loot/loot-perk-combat-stims.svg",
        "ap_rounds": "/img/loot/loot-perk-ap-rounds.svg",
        "splinter": "/img/loot/loot-perk-splinter.svg",
        "small_arms": "/img/loot/loot-perk-small-arms.svg",
        "takedown": "/img/loot/loot-perk-takedown.svg",
        "field_medic": "/img/loot/loot-perk-field-medic.svg",
        "tree_climbing": "/img/loot/loot-perk-tree-climbing.svg",
        "scavenger": "/img/loot/loot-perk-scavenger.svg",
        "scavenger_adv": "/img/loot/loot-perk-scavenger_adv.svg",
        "hunted": "/img/loot/loot-perk-hunted.svg",
        "chambered": "/img/loot/loot-perk-chambered.svg",
        "martyrdom": "/img/loot/loot-perk-martyrdom.svg",
        "targeting": "/img/loot/loot-perk-targeting.svg",
        "bonus_45": "/img/loot/loot-perk-bonus-45.svg",
        "broken_arrow": "/img/loot/loot-perk-broken-arrow.svg",
        "fabricate": "/img/loot/loot-perk-fabricate.svg",
        "self_revive": "/img/loot/loot-perk-self-revive.svg",
        "bonus_9mm": "/img/loot/loot-perk-bonus-9mm.svg",
        "flak_jacket": "/img/loot/loot-perk-flak-jacket.svg",
        "explosive": "/img/loot/loot-perk-explosive.svg",
        "bonus_assault": "/img/loot/loot-perk-bonus-assault.svg",
        "inspiration": "/img/loot/loot-perk-inspiration.svg",
        "final_bugle": "/img/loot/loot-perk-final-bugle.svg",
        "halloween_mystery": "/img/loot/loot-perk-halloween-mystery.svg",
        "trick_nothing": "/img/loot/loot-perk-trick-nothing.svg",
        "trick_size": "/img/loot/loot-perk-trick-size.svg",
        "trick_m9": "/img/loot/loot-perk-trick-m9.svg",
        "trick_chatty": "/img/loot/loot-perk-trick-chatty.svg",
        "trick_drain": "/img/loot/loot-perk-trick-drain.svg",
        "treat_9mm": "/img/loot/loot-perk-treat-9mm.svg",
        "treat_12g": "/img/loot/loot-perk-treat-12g.svg",
        "treat_556": "/img/loot/loot-perk-treat-556.svg",
        "treat_762": "/img/loot/loot-perk-treat-762.svg",
        "treat_super": "/img/loot/loot-perk-treat-super.svg",
        "turkey_shoot": "/img/loot/loot-perk-turkey_shoot.svg",
    };

    // 仓库管理「完整清单」：每个类别列出全部物品（未拥有的显示 0）。
    const STASH_ITEMS_BY_CATEGORY = {
        guns: [
            "ak47",
            "m4a1",
            "hk416",
            "mp5",
            "ump9",
            "vector",
            "vector45",
            "mac10",
            "scorpion",
            "vss",
            "famas",
            "mk12",
            "l86",
            "m249",
            "qbb97",
            "scar",
            "scarssr",
            "an94",
            "groza",
            "grozas",
            "dp28",
            "bar",
            "pkp",
            "model94",
            "mkg45",
            "blr",
            "mosin",
            "sv98",
            "awc",
            "m39",
            "svd",
            "garand",
            "m870",
            "m1100",
            "mp220",
            "saiga",
            "spas12",
            "m1014",
            "usas",
            "m9",
            "m93r",
            "glock",
            "p30l",
            "ot38",
            "ots38",
            "colt45",
            "m1911",
            "m1a1",
            "deagle",
            "flare_gun",
            "potato_cannon",
            "potato_smg",
            "bugle",
        ],
        melee: [
            "pan",
            "fists",
            "knuckles",
            "karambit",
            "bayonet",
            "huntsman",
            "bowie",
            "machete",
            "woodaxe",
            "fireaxe",
            "katana",
            "naginata",
            "stonehammer",
            "hook",
            "spade",
            "crowbar",
            "sledgehammer",
            "kukri_trad",
            "saw",
        ],
        ammo: ["9mm", "762mm", "556mm", "12gauge", "50AE", "308sub", "45acp", "flare"],
        consumables: ["bandage", "healthkit", "soda", "painkiller"],
        helmets: ["helmet01", "helmet02", "helmet03"],
        chests: ["chest01", "chest02", "chest03"],
        backpacks: ["backpack01", "backpack02", "backpack03"],
        scopes: ["1xscope", "2xscope", "4xscope", "8xscope", "15xscope"],
        throwables: ["frag", "smoke", "strobe", "mirv", "snowball"],
        perks: [
            "endless_ammo",
            "ap_rounds",
            "steelskin",
            "small_arms",
            "firepower",
            "combat_stims",
            "splinter",
            "lifeline",
            "gotw",
            "windwalk",
            "flak_jacket",
            "broken_arrow",
            "self_revive",
            "scavenger",
            "scavenger_adv",
            "field_medic",
            "takedown",
            "chambered",
            "targeting",
            "explosive",
            "inspiration",
            "final_bugle",
            "rare_potato",
            "aoe_heal",
            "leadership",
            "martyrdom",
            "tree_climbing",
            "fabricate",
            "bonus_9mm",
            "bonus_45",
            "bonus_assault",
        ],
    };
    // 后台「添加物品」的类型建议（全部有效物品 id）。
    const STASH_SUGGESTED_TYPES = Object.values(STASH_ITEMS_BY_CATEGORY).flat();

    const stashCategoryLabels = {
        guns: "枪械",
        melee: "近战",
        ammo: "弹药",
        consumables: "药品",
        helmets: "头盔",
        chests: "护甲",
        backpacks: "背包",
        scopes: "倍镜",
        throwables: "投掷物",
        perks: "能力",
    };
    let stashPlayers = [];
    /** 服务端完整物品目录（按类别），后台仓库调整展示全部物品。 */
    let stashCatalog = null;
    const escAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

    // 最近一次仓库操作（加/减/设置/添加）时间：用于自动刷新保护——
    // 正在编辑或刚操作过时，自动刷新只更新数据、不重绘，避免打断。
    let stashAdminLastActionAt = 0;

    function stashAdminHasActiveEditor() {
        if (stashAdminBody?.querySelector("input:focus, textarea:focus, select:focus")) {
            return true;
        }
        return Date.now() - stashAdminLastActionAt < 1500;
    }

    // 与游戏内携带步长一致：弹药默认 30 发（信号弹 1 发、.308 5 发），
    // 绷带一次 5 个，其余（枪械/护甲/投掷物等）一次 1 个。
    function stashAdminStep(type, category) {
        if (category === "ammo") {
            if (type === "flare") return 1;
            if (type === "308sub") return 5;
            return 30;
        }
        if (category === "consumables" && type === "bandage") return 5;
        return 1;
    }

    function updateStashRefreshTime() {
        const el = $("#stash-refresh-time");
        if (el) el.textContent = `刷新 ${new Date().toLocaleTimeString()}`;
    }

    async function loadStashAdmin() {
        try {
            const [data, catalogData] = await Promise.all([
                api("/extraction/stash"),
                api("/stash-catalog").catch(() => null),
            ]);
            stashPlayers = data.players || [];
            if (catalogData?.catalog) stashCatalog = catalogData.catalog;
            // 自动刷新：始终更新玩家数据；正在编辑输入框时保留用户输入不重绘，
            // 非编辑状态重绘下拉框与物品列表（保留当前选中玩家）。
            updateStashRefreshTime();
            if (stashAdminHasActiveEditor()) return;
            renderStashAdmin();
        } catch (error) {
            if (error.message === "AUTH") return;
            const el = $("#stash-player-count");
            if (el) el.textContent = "仓库加载失败";
            updateStashRefreshTime();
        }
    }

    function renderStashAdmin() {
        if (!stashPlayerSelect) return;
        const countEl = $("#stash-player-count");
        const selected = stashPlayerSelect.value;
        const searchTerm = String(stashPlayerSearch?.value || "").trim().toLowerCase();
        const visible = searchTerm
            ? stashPlayers.filter((p) => String(p.name).toLowerCase().includes(searchTerm))
            : stashPlayers;
        stashPlayerSelect.innerHTML = "";
        for (const p of visible) {
            const opt = document.createElement("option");
            opt.value = p.name;
            opt.textContent = p.name;
            stashPlayerSelect.appendChild(opt);
        }
        if (visible.some((p) => p.name === selected)) {
            stashPlayerSelect.value = selected;
        }
        const player = visible.find((p) => p.name === stashPlayerSelect.value) || visible[0];
        if (countEl) {
            countEl.textContent = searchTerm
                ? `${visible.length} / ${stashPlayers.length} 名玩家`
                : `${stashPlayers.length} 名玩家`;
        }
        if (!stashAdminBody) return;
        if (!player) {
            stashAdminBody.innerHTML = `<p class='config-status'>${
                searchTerm
                    ? `没有匹配「${searchTerm}」的玩家`
                    : "仓库为空（玩家首次进仓库后才会创建）"
            }</p>`;
            return;
        }
        const items = player.stash?.items || {};
        const sections = [];
        const currentCoins = Math.max(0, Math.floor(Number(player.stash?.coins) || 0));
        sections.push(
            `<div class="stash-admin-add stash-admin-coins">`
                + `<span class="stash-admin-add-all-label">金币余额：<b>${currentCoins.toLocaleString()}</b></span>`
                + `<input class="admin-input" id="stash-admin-coin-amount" type="number" min="1" max="1000000000" step="1" value="1000" title="本次发放数量（1 到 10 亿）" />`
                + `<button class="primary-button compact" id="stash-admin-grant-coins-btn" type="button">发放金币</button>`
                + `</div>`,
        );
        for (const [cat, label] of Object.entries(stashCategoryLabels)) {
            const owned = items[cat] || {};
            // 完整清单：优先用服务端目录（含全部物品/能力），失败回退本地列表。
            const catalogGroup = stashCatalog
                ? stashCatalog.find((g) => g.category === cat)
                : null;
            const catalogItems = catalogGroup
                ? catalogGroup.items
                : (STASH_ITEMS_BY_CATEGORY[cat] || []).map((type) => ({
                    type,
                    image: STASH_ITEM_IMAGES[type] || "",
                }));
            const catalogImages = new Map(
                catalogItems.map((entry) => [entry.type, entry.image || ""]),
            );
            const types = new Set([
                ...Object.keys(owned),
                ...catalogItems.map((entry) => entry.type),
            ]);
            const entries = [...types]
                .map((type) => [type, Number(owned[type] || 0)])
                .sort((a, b) => {
                    // 拥有的（数量 > 0）在前，未拥有的（0）在后；同类按名称。
                    const aOwned = a[1] > 0 ? 0 : 1;
                    const bOwned = b[1] > 0 ? 0 : 1;
                    if (aOwned !== bOwned) return aOwned - bOwned;
                    return String(a[0]).localeCompare(String(b[0]));
                });
            sections.push(
                `<div class="stash-admin-cat"><div class="stash-admin-cat-title">${label}</div><div class="stash-admin-items">`
                    + entries
                        .map(([type, count]) => {
                            const enc = escAttr(type);
                            const image = catalogImages.get(type)
                                || STASH_ITEM_IMAGES[type]
                                || "";
                            const step = stashAdminStep(type, cat);
                            return (
                                `<div class="stash-admin-item ${Number(count) > 0 ? "" : "zero"}" data-type="${enc}">`
                                + (image
                                    ? `<img class="stash-admin-item-icon" src="${image}" alt="" draggable="false" loading="lazy" />`
                                    : "")
                                + `<span class="stash-admin-item-name" title="${enc}">${escAttr(type)}</span>`
                                + `<button class="ghost-button compact stash-admin-btn" data-action="remove" data-step="${step}" title="减少 ${step}">−${step}</button>`
                                + `<input class="admin-input stash-admin-set" type="number" min="0" value="${
                                    Number(count) || 0
                                }" />`
                                + `<button class="ghost-button compact stash-admin-btn" data-action="add" data-step="${step}" title="增加 ${step}">+${step}</button>`
                                + `</div>`
                            );
                        })
                        .join("")
                    + `</div></div>`,
            );
        }
        sections.push(
            `<div class="stash-admin-add">`
                + `<input class="admin-input" id="stash-admin-add-type" list="stash-item-types" placeholder="物品类型，如 ak47 / 9mm / bandage" />`
                + `<datalist id="stash-item-types"></datalist>`
                + `<input class="admin-input" id="stash-admin-add-count" type="number" min="1" value="1" title="数量" />`
                + `<button class="primary-button compact" id="stash-admin-add-btn" type="button">添加</button>`
                + `</div>`,
        );
        sections.push(
            `<div class="stash-admin-add stash-admin-add-all">`
                + `<span class="stash-admin-add-all-label">给全体玩家添加</span>`
                + `<input class="admin-input" id="stash-admin-add-all-type" list="stash-item-types" placeholder="物品类型，如 ak47 / 762mm / bandage" />`
                + `<input class="admin-input" id="stash-admin-add-all-count" type="number" min="1" value="1" title="每人数量" />`
                + `<button class="primary-button compact" id="stash-admin-add-all-btn" type="button">给全体玩家添加</button>`
                + `</div>`,
        );
        stashAdminBody.innerHTML = sections.join("");
        const types = new Set();
        for (const cat of Object.keys(stashCategoryLabels)) {
            for (const t of Object.keys(items[cat] || {})) types.add(t);
        }
        if (stashCatalog) {
            for (const group of stashCatalog) {
                for (const entry of group.items) types.add(entry.type);
            }
        } else {
            for (const t of STASH_SUGGESTED_TYPES) types.add(t);
        }
        const dl = $("#stash-item-types");
        if (dl) dl.innerHTML = [...types].map((t) => `<option value="${escAttr(t)}">`).join("");
    }

    async function stashAdminAction(action, type, count) {
        const name = stashPlayerSelect?.value;
        if (!name || !type) return;
        stashAdminLastActionAt = Date.now();
        try {
            const result = await api("/extraction/stash", {
                method: "POST",
                body: JSON.stringify({ name, type, action, count }),
            });
            if (!result.ok) {
                notify(result.reason || "操作失败", true);
                return;
            }
            stashPlayers = result.players || stashPlayers;
            renderStashAdmin();
            const verb = action === "add" ? "添加" : action === "remove" ? "移除" : "设置";
            notify(`${verb} ${type}`);
        } catch (error) {
            notify(error.message || "操作失败", true);
        }
    }

    async function addItemToAllPlayers(type, count) {
        try {
            stashAdminLastActionAt = Date.now();
            const result = await api("/extraction/stash/all", {
                method: "POST",
                body: JSON.stringify({ type, count }),
            });
            if (!result.ok) {
                notify(result.reason || "操作失败", true);
                return;
            }
            notify(`已给 ${result.updatedCount} 名玩家各添加 ${count} 个 ${type}`);
            await loadStashAdmin();
        } catch (error) {
            notify(error.message || "操作失败", true);
        }
    }

    async function grantCoinsToPlayer(name, amount) {
        try {
            stashAdminLastActionAt = Date.now();
            const result = await api("/extraction/stash/coins", {
                method: "POST",
                body: JSON.stringify({ name, amount }),
            });
            if (!result.ok) {
                notify(result.reason || "金币发放失败", true);
                return;
            }
            stashPlayers = result.players || stashPlayers;
            renderStashAdmin();
            notify(
                `已给 ${result.name || name} 发放 ${Number(result.amount || amount).toLocaleString()} 金币，余额 ${
                    Number(result.coins || 0).toLocaleString()
                }`,
            );
        } catch (error) {
            notify(error.message || "金币发放失败", true);
        }
    }

    stashAdminRefreshBtn?.addEventListener("click", () => void loadStashAdmin());
    stashPlayerSelect?.addEventListener("change", () => renderStashAdmin());
    stashPlayerSearch?.addEventListener("input", () => renderStashAdmin());
    stashAdminBody?.addEventListener("click", (event) => {
        const btn = event.target.closest?.(".stash-admin-btn");
        if (btn) {
            const item = btn.closest(".stash-admin-item");
            const type = item?.dataset.type;
            if (!type) return;
            // 加减号按游戏内步长（枪 1、普通子弹 30、信号弹 1、.308 5、绷带 5）。
            const step = Math.max(1, Math.floor(Number(btn.dataset.step) || 1));
            void stashAdminAction(btn.dataset.action, type, step);
            return;
        }
        if (event.target.id === "stash-admin-add-btn") {
            const type = String($("#stash-admin-add-type")?.value || "").trim();
            const count = Math.max(1, Math.floor(Number($("#stash-admin-add-count")?.value) || 1));
            if (type) void stashAdminAction("add", type, count);
            return;
        }
        if (event.target.id === "stash-admin-grant-coins-btn") {
            const name = stashPlayerSelect?.value;
            const rawAmount = Number($("#stash-admin-coin-amount")?.value);
            if (!name) {
                notify("请先选择玩家", true);
                return;
            }
            if (!Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > 1_000_000_000) {
                notify("金币数量必须是 1 到 10 亿之间的整数", true);
                return;
            }
            if (!confirm(`确定给玩家 ${name} 发放 ${rawAmount.toLocaleString()} 金币？`)) {
                return;
            }
            void grantCoinsToPlayer(name, rawAmount);
            return;
        }
        if (event.target.id === "stash-admin-add-all-btn") {
            const type = String($("#stash-admin-add-all-type")?.value || "").trim();
            const count = Math.max(1, Math.floor(Number($("#stash-admin-add-all-count")?.value) || 1));
            if (!type) {
                notify("请填写物品类型", true);
                return;
            }
            if (!confirm(`确定给全体 ${stashPlayers.length} 名玩家各添加 ${count} 个 ${type}？`)) {
                return;
            }
            void addItemToAllPlayers(type, count);
        }
    });
    stashAdminBody?.addEventListener("change", (event) => {
        const input = event.target;
        if (!input?.classList?.contains("stash-admin-set")) return;
        const item = input.closest(".stash-admin-item");
        const count = Math.max(0, Math.floor(Number(input.value) || 0));
        void stashAdminAction("set", item?.dataset.type, count);
    });

    // ---- 带入装备返还审批 ----
    const equipmentReturnBody = $("#equipment-return-body");
    const equipmentReturnCount = $("#equipment-return-count");
    const equipmentReturnFilter = $("#equipment-return-filter");
    const equipmentReturnRefresh = $("#equipment-return-refresh");
    let equipmentReturnRequests = [];

    const escHtml = (value) => escAttr(value).replace(/>/g, "&gt;").replace(/'/g, "&#39;");

    function equipmentReturnItems(grant = {}) {
        const items = [];
        const addRecord = (record, prefix = "") => {
            for (const [type, rawCount] of Object.entries(record || {})) {
                const count = Math.max(0, Math.floor(Number(rawCount) || 0));
                if (count > 0) items.push(`${prefix}${type} ×${count}`);
            }
        };
        addRecord(grant.guns);
        if (grant.melee) items.push(`${grant.melee} ×1`);
        addRecord(grant.ammo);
        addRecord(grant.consumables);
        addRecord(grant.throwables);
        for (const type of grant.perks || []) items.push(`${type} ×1`);
        const oneTimeCounts = {};
        for (const type of grant.oneTimePerks || []) {
            oneTimeCounts[type] = (oneTimeCounts[type] || 0) + 1;
        }
        addRecord(oneTimeCounts, "一次性技能 ");
        for (const type of Object.values(grant.armor || {})) {
            if (type) items.push(`${type} ×1`);
        }
        return items;
    }

    function equipmentReturnStatus(status) {
        return ({
            eligible: "尚未提交",
            pending: "待审批",
            approved: "已批准",
            rejected: "已拒绝",
            "auto-refunded": "卡顿自动返还",
        })[status] || status;
    }

    function renderEquipmentReturnRequests() {
        if (!equipmentReturnBody) return;
        const filter = equipmentReturnFilter?.value || "pending";
        const pendingCount = equipmentReturnRequests.filter(
            (request) => request.status === "pending",
        ).length;
        const visible = filter === "all"
            ? equipmentReturnRequests
            : equipmentReturnRequests.filter((request) => request.status === filter);
        if (equipmentReturnCount) {
            equipmentReturnCount.textContent = `${pendingCount} 条待审批 / ${equipmentReturnRequests.length} 条记录`;
        }
        if (visible.length === 0) {
            equipmentReturnBody.innerHTML = `<p class="config-status">当前没有${
                filter === "pending" ? "待审批" : "匹配状态的"
            }申请</p>`;
            return;
        }
        equipmentReturnBody.innerHTML = visible.map((request) => {
            const timestamp = request.submittedAt || request.createdAt;
            const items = equipmentReturnItems(request.grant);
            const adminNote = String(request.adminNote || "").trim();
            const adminNoteHistory = adminNote
                ? `<div class="equipment-return-admin-note saved"><b>后台留言</b><span>${
                    escHtml(adminNote)
                }</span></div>`
                : "";
            const actions = request.status === "pending"
                ? `<div class="equipment-return-admin-note">`
                    + `<label>给玩家留言（可选）</label>`
                    + `<textarea class="admin-input equipment-return-note-input" maxlength="300" rows="3" placeholder="例如：已核查日志，本局装备已返还。"></textarea>`
                    + `</div>`
                    + `<div class="equipment-return-actions">`
                    + `<button class="primary-button compact" type="button" data-return-decision="approve">批准并返仓</button>`
                    + `<button class="danger-button compact" type="button" data-return-decision="reject">拒绝</button>`
                    + `</div>`
                : adminNoteHistory;
            return `<article class="equipment-return-card" data-return-id="${escAttr(request.id)}">`
                + `<div class="equipment-return-head">`
                + `<div><strong>${escHtml(request.playerName)}</strong><span>${
                    escHtml(request.mapName || "未知地图")
                }</span></div>`
                + `<span class="equipment-return-status ${escAttr(request.status)}">${
                    escHtml(equipmentReturnStatus(request.status))
                }</span>`
                + `</div>`
                + `<div class="equipment-return-meta">`
                + `<span title="${escAttr(request.matchId)}">对局 ${escHtml(request.matchId)}</span>`
                + `<span>${timestamp ? new Date(timestamp).toLocaleString() : "—"}</span>`
                + `</div>`
                + `<div class="equipment-return-reason"><b>申请原因</b><span>${
                    escHtml(request.reason || "玩家尚未提交")
                }</span></div>`
                + `<div class="equipment-return-items">${
                    items.length
                        ? items.map((item) => `<span>${escHtml(item)}</span>`).join("")
                        : `<em>本局没有可返还项目</em>`
                }</div>`
                + actions
                + `</article>`;
        }).join("");
    }

    async function loadEquipmentReturnRequests() {
        try {
            const data = await api("/extraction/equipment-return");
            equipmentReturnRequests = data.requests || [];
            renderEquipmentReturnRequests();
        } catch (error) {
            if (error.message === "AUTH") return;
            if (equipmentReturnCount) equipmentReturnCount.textContent = "申请加载失败";
        }
    }

    async function reviewEquipmentReturnRequest(id, decision, adminNote = "") {
        try {
            const result = await api("/extraction/equipment-return/review", {
                method: "POST",
                body: JSON.stringify({ id, decision, adminNote }),
            });
            if (!result.ok) {
                notify(result.reason === "already-reviewed" ? "该申请已被处理" : result.reason || "审批失败", true);
                await loadEquipmentReturnRequests();
                return;
            }
            equipmentReturnRequests = result.requests || equipmentReturnRequests;
            renderEquipmentReturnRequests();
            if (decision === "approve") await loadStashAdmin();
            notify(decision === "approve" ? "已批准，带入装备已返回玩家仓库" : "已拒绝该申请");
        } catch (error) {
            notify(error.message || "审批失败", true);
        }
    }

    equipmentReturnRefresh?.addEventListener("click", () => void loadEquipmentReturnRequests());
    equipmentReturnFilter?.addEventListener("change", renderEquipmentReturnRequests);
    equipmentReturnBody?.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-return-decision]");
        const card = button?.closest?.("[data-return-id]");
        if (!button || !card) return;
        const decision = button.dataset.returnDecision;
        const request = equipmentReturnRequests.find((entry) => entry.id === card.dataset.returnId);
        if (!request) return;
        const noteInput = card.querySelector?.(".equipment-return-note-input");
        const adminNote = String(noteInput?.value || "").trim().slice(0, 300);
        const message = decision === "approve"
            ? `确定批准 ${request.playerName} 的申请并返还本局带入装备？`
            : `确定拒绝 ${request.playerName} 的装备返还申请？`;
        if (confirm(message)) void reviewEquipmentReturnRequest(request.id, decision, adminNote);
    });

    // ---- 玩家账号管理 ----
    const accountSearch = $("#account-search");
    const accountBody = $("#account-body");
    const accountRefreshBtn = $("#account-refresh");
    let accounts = [];

    async function loadAccounts() {
        try {
            const data = await api("/player-accounts");
            accounts = data.accounts || [];
            renderAccounts();
        } catch (error) {
            if (error.message === "AUTH") return;
            const el = $("#account-count");
            if (el) el.textContent = "账号加载失败";
        }
    }

    function renderAccounts() {
        if (!accountBody) return;
        const countEl = $("#account-count");
        const query = String(accountSearch?.value || "").trim().toLowerCase();
        const visible = query
            ? accounts.filter((account) =>
                `${account.username} ${account.displayName}`
                    .toLowerCase()
                    .includes(query)
            )
            : accounts;
        if (countEl) {
            countEl.textContent = query
                ? `${visible.length} / ${accounts.length} 个账号`
                : `${accounts.length} 个账号`;
        }
        if (visible.length === 0) {
            accountBody.innerHTML = "<p class='config-status'>暂无账号</p>";
            return;
        }
        accountBody.innerHTML = visible
            .map(
                (account) =>
                    `<div class="account-admin-item" data-username="${escAttr(account.username)}">`
                    + `<span class="account-admin-name" title="${escAttr(account.displayName)}">${
                        escAttr(account.displayName)
                    }</span>`
                    + `<span class="account-admin-user">${escAttr(account.username)}</span>`
                    + `<span class="account-admin-time">${new Date(account.createdAt).toLocaleString()}</span>`
                    + `<button class="danger-button compact" type="button" data-account-delete>删除</button>`
                    + `</div>`,
            )
            .join("");
    }

    async function deleteAccount(username) {
        if (
            !window.confirm(
                `确定删除账号「${username}」？\n将同时清除该账号的所有登录会话与对应仓库。`,
            )
        ) {
            return;
        }
        try {
            const result = await api("/player-accounts/delete", {
                method: "POST",
                body: JSON.stringify({ username }),
            });
            accounts = result.accounts || [];
            renderAccounts();
            notify(`已删除账号 ${username}`);
        } catch (error) {
            notify(error.message === "AUTH" ? "登录会话已失效" : error.message, true);
        }
    }

    accountRefreshBtn?.addEventListener("click", () => void loadAccounts());
    accountSearch?.addEventListener("input", () => renderAccounts());
    accountBody?.addEventListener("click", (event) => {
        const btn = event.target.closest?.("[data-account-delete]");
        if (!btn) return;
        const username = btn.closest(".account-admin-item")?.dataset.username;
        if (username) void deleteAccount(username);
    });

    // ---- 商店设置（经济系统） ----
    const shopConfigForm = $("#shop-config-form");
    const shopPriceTable = $("#shop-price-table");
    const shopItemFilter = $("#shop-item-filter");
    const SHOP_CATEGORY_LABELS = {
        guns: "枪械",
        ammo: "弹药",
        consumables: "药品",
        throwables: "投掷物",
        melee: "近战",
        helmets: "头盔",
        chests: "护甲",
        backpacks: "背包",
        scopes: "倍镜",
    };
    let shopCatalogItems = [];
    let shopPrices = {};

    function applyShopItemFilter() {
        if (!shopPriceTable) return;
        const query = String(shopItemFilter?.value || "").trim().toLocaleLowerCase();
        for (const row of shopPriceTable.querySelectorAll(".shop-admin-item")) {
            const searchText = String(row.dataset.search || "");
            row.hidden = Boolean(query) && !searchText.includes(query);
        }
        for (const category of shopPriceTable.querySelectorAll(".shop-admin-cat")) {
            category.hidden = !category.querySelector(".shop-admin-item:not([hidden])");
        }
    }

    function renderShopPriceTable() {
        if (!shopPriceTable) return;
        shopPriceTable.innerHTML = "";
        const order = [
            "guns",
            "ammo",
            "consumables",
            "throwables",
            "melee",
            "helmets",
            "chests",
            "backpacks",
            "scopes",
        ];
        for (const category of order) {
            const items = shopCatalogItems.filter((item) => item.category === category);
            if (items.length === 0) continue;
            const wrap = document.createElement("div");
            wrap.className = "shop-admin-cat";
            wrap.innerHTML = `<div class="stash-admin-cat-title">${SHOP_CATEGORY_LABELS[category] || category}</div>`
                + `<div class="shop-admin-items"></div>`;
            const list = wrap.querySelector(".shop-admin-items");
            for (const item of items) {
                const row = document.createElement("div");
                row.className = "shop-admin-item" + (item.sellOnly ? " sell-only" : "");
                row.dataset.search = `${item.name} ${item.type}`.toLocaleLowerCase();
                row.innerHTML =
                    `<span class="shop-admin-item-name" title="${escAttr(item.type)}">${escAttr(item.name)}</span>`
                    + `<div class="shop-admin-side"><label class="shop-admin-toggle"><input class="shop-buy-enabled" type="checkbox" data-type="${
                        escAttr(item.type)
                    }" ${
                        item.buyEnabled ? "checked" : ""
                    } /><span>购买</span></label><input class="admin-input shop-buy-input" type="number" min="1" step="1" data-type="${
                        escAttr(item.type)
                    }" placeholder="${item.defaultBuy ?? "无建议价"}" ${item.buyEnabled ? "" : "disabled"} /></div>`
                    + `<div class="shop-admin-side"><label class="shop-admin-toggle"><input class="shop-sell-enabled" type="checkbox" data-type="${
                        escAttr(item.type)
                    }" ${
                        item.sellEnabled ? "checked" : ""
                    } /><span>出售</span></label><input class="admin-input shop-sell-input" type="number" min="1" step="1" data-type="${
                        escAttr(item.type)
                    }" placeholder="${item.defaultSell ?? "无建议价"}" ${item.sellEnabled ? "" : "disabled"} /></div>`
                    + `<span class="shop-admin-default">默认 ${item.defaultBuyEnabled ? "可买" : "禁买"} ${
                        item.defaultBuy ?? "—"
                    } / ${item.defaultSellEnabled ? "可卖" : "禁卖"} ${item.defaultSell ?? "—"}</span>`;
                list.appendChild(row);
            }
            shopPriceTable.appendChild(wrap);
        }
        // 填入当前覆盖值（与默认不同的显示实际值）。
        for (const [type, override] of Object.entries(shopPrices)) {
            if (!override) continue;
            if (typeof override.buy === "number") {
                const input = shopPriceTable.querySelector(
                    `.shop-buy-input[data-type="${type}"]`,
                );
                if (input) input.value = override.buy;
            }
            if (typeof override.sell === "number") {
                const input = shopPriceTable.querySelector(
                    `.shop-sell-input[data-type="${type}"]`,
                );
                if (input) input.value = override.sell;
            }
        }
        shopPriceTable.querySelectorAll(".shop-buy-enabled, .shop-sell-enabled").forEach(
            (checkbox) => {
                checkbox.addEventListener("change", () => {
                    const type = checkbox.dataset.type;
                    const side = checkbox.classList.contains("shop-buy-enabled")
                        ? "buy"
                        : "sell";
                    const input = shopPriceTable.querySelector(
                        `.shop-${side}-input[data-type="${type}"]`,
                    );
                    if (input) input.disabled = !checkbox.checked;
                });
            },
        );
        applyShopItemFilter();
    }

    shopItemFilter?.addEventListener("input", applyShopItemFilter);

    async function loadShopConfig() {
        try {
            const data = await api("/shop/config");
            shopCatalogItems = data.catalog || [];
            shopPrices = data.prices || {};
            renderShopPriceTable();
            const statusEl = $("#shop-status");
            if (statusEl) {
                statusEl.textContent = data.enabled === false ? "已停用" : "已启用";
            }
        } catch (error) {
            if (error.message === "AUTH") return;
            const statusEl = $("#shop-status");
            if (statusEl) statusEl.textContent = "商店设置加载失败";
        }
    }

    shopConfigForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const prices = {};
        for (const item of shopCatalogItems) {
            const override = {};
            const buyEnabled = shopPriceTable.querySelector(
                `.shop-buy-enabled[data-type="${item.type}"]`,
            )?.checked === true;
            const sellEnabled = shopPriceTable.querySelector(
                `.shop-sell-enabled[data-type="${item.type}"]`,
            )?.checked === true;
            if (buyEnabled !== item.defaultBuyEnabled) {
                override.buyEnabled = buyEnabled;
            }
            if (sellEnabled !== item.defaultSellEnabled) {
                override.sellEnabled = sellEnabled;
            }
            const buyInput = shopPriceTable.querySelector(
                `.shop-buy-input[data-type="${item.type}"]`,
            );
            if (buyInput && String(buyInput.value).trim() !== "") {
                const num = Math.max(0, Math.floor(Number(buyInput.value) || 0));
                if (num > 0) override.buy = num;
            }
            const sellInput = shopPriceTable.querySelector(
                `.shop-sell-input[data-type="${item.type}"]`,
            );
            if (sellInput && String(sellInput.value).trim() !== "") {
                const num = Math.max(0, Math.floor(Number(sellInput.value) || 0));
                if (num > 0) override.sell = num;
            }
            if (
                override.buyEnabled !== undefined
                || override.sellEnabled !== undefined
                || override.buy !== undefined
                || override.sell !== undefined
            ) {
                prices[item.type] = override;
            }
        }
        try {
            const result = await api("/shop/config", {
                method: "POST",
                body: JSON.stringify({
                    prices,
                }),
            });
            shopCatalogItems = result.catalog || [];
            shopPrices = result.prices || {};
            renderShopPriceTable();
            notify("商店设置已保存");
        } catch (error) {
            notify(error.message || "保存失败", true);
        }
    });

    const AUTO_REFRESH_STORAGE_KEY = "surviv-admin-auto-refresh-seconds-v2";
    function startAutoRefresh() {
        stopAutoRefresh();
        const seconds = Number(autoRefreshInterval?.value || 0);
        if (seconds <= 0 || !state.session) return;
        // Self-scheduling timeout: wait for the current refresh to settle before
        // arming the next tick. setInterval used to create unbounded overlapping
        // refreshes when any endpoint was slow or the tab resumed from sleep.
        state.autoRefreshTimer = window.setTimeout(async () => {
            state.autoRefreshTimer = null;
            if (!state.session) return;
            await refresh(false);
            startAutoRefresh();
        }, seconds * 1000);
    }
    function stopAutoRefresh() {
        if (state.autoRefreshTimer) {
            window.clearTimeout(state.autoRefreshTimer);
            state.autoRefreshTimer = null;
        }
    }
    autoRefreshInterval?.addEventListener("change", () => {
        localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, autoRefreshInterval.value);
        startAutoRefresh();
        notify(autoRefreshInterval.value === "0" ? "自动刷新已关闭" : `自动刷新：每 ${autoRefreshInterval.value} 秒`);
    });
    const savedRefreshSeconds = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    if (autoRefreshInterval) {
        // 默认开启自动刷新（2 秒）。用户显式保存过的选择（包括“关”）优先。
        autoRefreshInterval.value = savedRefreshSeconds || "2";
    }

    function resumeAutoRefresh() {
        if (!state.session || document.hidden) return;
        stopAutoRefresh();
        void refresh(false).finally(startAutoRefresh);
    }
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) resumeAutoRefresh();
    });
    window.addEventListener("pageshow", resumeAutoRefresh);
    window.addEventListener("online", resumeAutoRefresh);

    roomFilter?.addEventListener("change", () => {
        if (state.data) renderGames(state.data.games, state.data.modes);
    });
    modeSearch?.addEventListener("input", () => {
        if (state.data) renderModes(state.data.modes);
    });
    modeFilterOpen?.addEventListener("change", () => {
        if (state.data) renderModes(state.data.modes);
    });
    modeExpandAll?.addEventListener("click", () => {
        state.modeGroupsCollapsed.clear();
        localStorage.setItem("surviv-admin-mode-groups", "[]");
        if (state.data) renderModes(state.data.modes);
    });
    modeCollapseAll?.addEventListener("click", () => {
        const titles = new Set();
        for (const mode of state.data?.modes || []) {
            if (mode.mapName === "duel") continue;
            titles.add(mode.title || mode.mapName);
        }
        state.modeGroupsCollapsed = new Set(titles);
        localStorage.setItem("surviv-admin-mode-groups", JSON.stringify([...state.modeGroupsCollapsed]));
        if (state.data) renderModes(state.data.modes);
    });

    if (state.session) {
        void refresh(false).finally(startAutoRefresh);
    } else {
        showLogin();
    }
})();
