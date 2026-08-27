import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { isIP } from "node:net";
import { Config, PersistenceError } from "../../../config.ts";
import { getSecretEligibleCatalog } from "../../../duelWeapons.ts";
import {
    buyOneTimePerk,
    fusePermanentPerks,
    getShopCatalog,
    oneTimePerkCatalog,
    shopBuy,
    shopSell,
} from "../../../economy/shopManager.ts";
import {
    PLAYER_ACCOUNT_SESSION_COOKIE,
    PLAYER_ACCOUNT_SESSION_MAX_AGE_SECONDS,
    PlayerAccountError,
    PlayerAccounts,
} from "../../../playerAccounts.ts";
import { type BringInLoadout, stashManager } from "../../../stash/stashManager.ts";
import { HTTPRateLimit } from "../../../utils/rateLimit.ts";

export const legacyPlayerAccounts = new PlayerAccounts();
export const LegacyRouter = new Hono();

const accountRegisterLimit = new HTTPRateLimit(10, 60_000);
const accountLoginLimit = new HTTPRateLimit(10, 60_000);
const accountChangePasswordLimit = new HTTPRateLimit(10, 60_000);
const equipmentReturnLimit = new HTTPRateLimit(5, 10_000);
const shopLimit = new HTTPRateLimit(30, 1_000);
const leaderboardLimit = new HTTPRateLimit(15, 1_000);
const stashViewLimit = new HTTPRateLimit(20, 1_000);
const gameProxyLimit = new HTTPRateLimit(20, 1_000);

function requestIp(c: Context): string {
    const ip = Config.apiServer.proxyIPHeader
        ? c.req.header(Config.apiServer.proxyIPHeader)
        : c.env?.incoming?.socket?.remoteAddress;
    if (!ip || isIP(ip) === 0) return "unknown";
    return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
    try {
        const value = await c.req.json<unknown>();
        return value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function playerName(token: unknown): string | null {
    const profile = legacyPlayerAccounts.profile(token);
    return profile ? profile.displayName || profile.username : null;
}

function unauthorized(c: Context) {
    return c.json({ err: "未登录或登录已过期" }, 401);
}

function operationError(c: Context, error: unknown, fallback = "服务器内部错误") {
    if (error instanceof PersistenceError) {
        return c.json({ error: "数据保存失败，本次操作未完成" }, 503);
    }
    console.error("[legacy-api] request failed", error);
    return c.json({ error: fallback }, 500);
}

function setLegacySessionCookie(c: Context, token: string): void {
    setCookie(c, PLAYER_ACCOUNT_SESSION_COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        maxAge: PLAYER_ACCOUNT_SESSION_MAX_AGE_SECONDS,
    });
}

function clearLegacySessionCookie(c: Context): void {
    deleteCookie(c, PLAYER_ACCOUNT_SESSION_COOKIE, { path: "/" });
}

async function proxyGameRoute(c: Context, route: string, timeoutMs: number) {
    if (gameProxyLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }

    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);

    try {
        const protocol = Config.gameServer.ssl ? "https" : "http";
        const response = await fetch(
            `${protocol}://127.0.0.1:${Config.gameServer.port}${route}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            },
        );
        const data = await response.json() as Record<string, unknown>;
        return c.json(data, response.ok ? 200 : 502);
    } catch (error) {
        console.warn(`[legacy-api] ${route} proxy failed`, error);
        return c.json({ err: "游戏服务暂时不可用" }, 503);
    }
}

LegacyRouter.post("/account/register", async (c) => {
    if (accountRegisterLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "注册过于频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    try {
        return c.json({
            ok: true,
            ...legacyPlayerAccounts.register(body.username, body.password),
        });
    } catch (error) {
        if (error instanceof PlayerAccountError) return c.json({ err: error.message }, 400);
        return operationError(c, error, "注册失败，请稍后再试");
    }
});

LegacyRouter.post("/account/login", async (c) => {
    if (accountLoginLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "登录尝试过于频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    try {
        const result = legacyPlayerAccounts.login(body.username, body.password);
        setLegacySessionCookie(c, result.token);
        return c.json({ ok: true, token: result.token, ...result.profile });
    } catch (error) {
        if (error instanceof PlayerAccountError) return c.json({ err: error.message }, 401);
        return operationError(c, error, "登录失败，请稍后再试");
    }
});

LegacyRouter.post("/account/logout", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    try {
        legacyPlayerAccounts.logout(body.token);
        clearLegacySessionCookie(c);
        return c.json({ ok: true });
    } catch (error) {
        return operationError(c, error, "退出登录失败");
    }
});

LegacyRouter.post("/account/profile", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const token = typeof body.token === "string" ? body.token : "";
    const profile = legacyPlayerAccounts.profile(token);
    if (!profile) {
        clearLegacySessionCookie(c);
        return c.json({ err: "登录已失效" }, 401);
    }
    setLegacySessionCookie(c, token);
    return c.json({ ok: true, ...profile });
});

LegacyRouter.post("/account/change_password", async (c) => {
    if (accountChangePasswordLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作过于频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    try {
        legacyPlayerAccounts.changePassword(
            body.token,
            body.currentPassword,
            body.nextPassword,
        );
        return c.json({ ok: true });
    } catch (error) {
        if (error instanceof PlayerAccountError) return c.json({ err: error.message }, 400);
        return operationError(c, error, "修改密码失败，请稍后再试");
    }
});

LegacyRouter.get("/extraction/stash", (c) => {
    const name = playerName(c.req.query("token"));
    if (!name) return unauthorized(c);
    try {
        const stash = stashManager.getStash(name);
        return c.json({
            name,
            items: stash.items,
            loadout: stash.loadout,
            oneTimePerks: stash.oneTimePerks ?? [],
        });
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.get("/extraction/secret/eligible", (c) =>
    c.json({
        enabled: Config.extractionSecret.enabled === true,
        weapons: getSecretEligibleCatalog(),
    }));

LegacyRouter.post("/extraction/loadout", async (c) => {
    const body = await jsonBody(c);
    if (!body || !body.loadout || typeof body.loadout !== "object") {
        return c.json({ err: "请求格式无效" }, 400);
    }
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    try {
        const result = stashManager.setLoadout(name, body.loadout as BringInLoadout);
        return c.json(result.ok ? { ok: true, loadout: result.loadout } : result);
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.get("/extraction/equipment-return/notifications", (c) => {
    const name = playerName(c.req.query("token"));
    if (!name) return unauthorized(c);
    try {
        return c.json({
            ok: true,
            notifications: stashManager.listEquipmentReturnNotifications(name),
        });
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/extraction/equipment-return/notifications", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === "string")
        : [];
    try {
        return c.json({
            ok: true,
            acknowledged: stashManager.acknowledgeEquipmentReturnNotifications(name, ids),
        });
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.get("/extraction/equipment-return", (c) => {
    const name = playerName(c.req.query("token"));
    if (!name) return unauthorized(c);
    try {
        return c.json({
            ok: true,
            request: stashManager.getEquipmentReturnRequest(
                name,
                c.req.query("matchId") ?? "",
            ),
        });
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/extraction/equipment-return", async (c) => {
    if (equipmentReturnLimit.isRateLimited(requestIp(c))) {
        return c.json({ ok: false, reason: "rate-limited" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    try {
        return c.json(stashManager.submitEquipmentReturnRequest(
            name,
            String(body.matchId ?? ""),
            String(body.reason ?? ""),
        ));
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.get("/shop/catalog", (c) => {
    const name = playerName(c.req.query("token"));
    if (!name) return unauthorized(c);
    try {
        return c.json(getShopCatalog(name));
    } catch (error) {
        return operationError(c, error);
    }
});

async function shopRequest(c: Context, operation: "buy" | "sell") {
    if (shopLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    try {
        const fn = operation === "buy" ? shopBuy : shopSell;
        return c.json(fn(name, String(body.type ?? ""), Number(body.count) || 1));
    } catch (error) {
        return operationError(c, error);
    }
}

LegacyRouter.post("/shop/buy", (c) => shopRequest(c, "buy"));
LegacyRouter.post("/shop/sell", (c) => shopRequest(c, "sell"));

LegacyRouter.get("/shop/one-time-perk/catalog", (c) => {
    const name = playerName(c.req.query("token"));
    if (!name) return unauthorized(c);
    try {
        return c.json(oneTimePerkCatalog(name));
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/shop/one-time-perk/buy", async (c) => {
    if (shopLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    try {
        return c.json(buyOneTimePerk(name, String(body.type ?? "")));
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/shop/perk/fuse", async (c) => {
    if (shopLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    const name = playerName(body.token);
    if (!name) return unauthorized(c);
    try {
        return c.json(fusePermanentPerks(
            name,
            Array.isArray(body.materials)
                ? body.materials.filter((item): item is string => typeof item === "string")
                : [],
        ));
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/shop/one-time-perk/fuse", (c) =>
    c.json({
        ok: false,
        reason: "permanent-perks-only",
        endpoint: "/api/shop/perk/fuse",
    }, 400));

LegacyRouter.post("/leaderboard", async (c, next) => {
    const body = await jsonBody(c);
    if (!body || !("token" in body)) return next();
    if (leaderboardLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }
    if (!legacyPlayerAccounts.profile(body.token)) {
        return c.json({ err: "登录已失效" }, 401);
    }
    try {
        return c.json({ ok: true, players: stashManager.leaderboard(50) });
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.post("/stash/view", async (c) => {
    if (stashViewLimit.isRateLimited(requestIp(c))) {
        return c.json({ err: "操作太频繁，请稍后再试" }, 429);
    }
    const body = await jsonBody(c);
    if (!body) return c.json({ err: "请求格式无效" }, 400);
    if (!legacyPlayerAccounts.profile(body.token)) {
        return c.json({ err: "登录已失效" }, 401);
    }
    try {
        const stash = stashManager.publicStashView(String(body.name ?? "").trim());
        return stash
            ? c.json({ ok: true, stash })
            : c.json({ err: "未找到该玩家的仓库" }, 404);
    } catch (error) {
        return operationError(c, error);
    }
});

LegacyRouter.get("/sandevistan/config", (c) =>
    c.json({
        playerTimeScale: Config.sandevistan.playerTimeScale,
        worldTimeScale: Config.sandevistan.worldTimeScale,
    }));

LegacyRouter.post("/duel-lobby", (c) => {
    if (!Config.duel.roomModeEnabled) {
        return c.json({ err: "1v1房间模式当前已关闭" }, 503);
    }
    return proxyGameRoute(c, "/api/duel-lobby", 20_000);
});

LegacyRouter.post("/aim-training", (c) => proxyGameRoute(c, "/api/aim-training", 25_000));
