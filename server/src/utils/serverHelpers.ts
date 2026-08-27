import type { HttpRequest, HttpResponse } from "uWebSockets.js";
import { Config } from "../config.ts";

/**
 * Apply CORS headers to a response.
 * @param res The response sent by the server.
 */
export function cors(res: HttpResponse): void {
    if (res.aborted) return;
    try {
        res.writeHeader("Access-Control-Allow-Origin", "*")
            .writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            .writeHeader(
                "Access-Control-Allow-Headers",
                "origin, content-type, accept, authorization, x-admin-session, x-requested-with",
            )
            .writeHeader("Access-Control-Max-Age", "3600");
    } catch {
        // Response may have been aborted concurrently; never crash the server.
    }
}

export function forbidden(res: HttpResponse): void {
    try {
        res.writeStatus("403 Forbidden").end("403 Forbidden");
    } catch {
        // Response may have been aborted concurrently; never crash the server.
    }
}

export function returnJson(res: HttpResponse, data: Record<string, unknown>): void {
    try {
        res.cork(() => {
            if (res.aborted) return;
            res.writeHeader("Content-Type", "application/json")
                .writeHeader("Cache-Control", "no-store, no-cache, must-revalidate")
                .writeHeader("Pragma", "no-cache")
                .end(JSON.stringify(data));
        });
    } catch {
        // uWS can abort the response between the aborted check and the cork
        // callback; never let that take down the whole server.
    }
}

/**
 * Read the body of a POST request.
 * @link https://github.com/uNetworking/uWebSockets.js/blob/master/examples/JsonPost.js
 * @param res The response from the client.
 * @param cb A callback containing the request body.
 * @param err A callback invoked whenever the request cannot be retrieved.
 */
export function readPostedJSON<T>(
    res: HttpResponse,
    cb: (json: T) => void,
    err: () => void,
): void {
    let buffer: Buffer | Uint8Array;
    /* Register data cb */
    res.onData((ab, isLast) => {
        const chunk = Buffer.from(ab);
        if (isLast) {
            let json: T;
            if (buffer) {
                try {
                    // @ts-expect-error JSON.parse can accept a Buffer as an argument
                    json = JSON.parse(Buffer.concat([buffer, chunk]));
                } catch (_e) {
                    /* res.close calls onAborted */
                    res.close();
                    return;
                }
                cb(json);
            } else {
                try {
                    // @ts-expect-error JSON.parse can accept a Buffer as an argument
                    json = JSON.parse(chunk);
                } catch (_e) {
                    /* res.close calls onAborted */
                    res.close();
                    return;
                }
                cb(json);
            }
        } else {
            if (buffer) {
                buffer = Buffer.concat([buffer, chunk]);
            } else {
                buffer = Buffer.concat([chunk]);
            }
        }
    });

    /* Register error cb */
    res.onAborted(err);
}

// credits: https://github.com/Blank-Cheque/Slurs
const badWordsFilter = [
    /(s[a4]nd)?n[ila4o10íĩî|!][gq]{1,2}(l[e3]t|[e3]r|[a4]|n[o0]g)?s?/,
    /f[a@4](g{1,2}|qq)([e3i1líĩî|!o0]t{1,2}(ry|r[i1líĩî|!]e)?)?/,
    /k[il1y]k[e3](ry|rie)?s?/,
    /tr[a4]n{1,2}([i1líĩî|!][e3]|y|[e3]r)s?/,
    /c[o0]{2}ns?/,
    /ch[i1líĩî|!]nks?/,
];

export function checkForBadWords(name: string) {
    name = name.toLowerCase();
    for (const regex of badWordsFilter) {
        if (name.match(regex)) return true;
    }
    return false;
}

const textDecoder = new TextDecoder();

/**
 * Get an IP from an uWebsockets HTTP response
 */
export function isLoopbackAddress(ip: string): boolean {
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Resolve the actual client address. uWebSockets only populates
 * getProxiedRemoteAddressAsText when PROXY protocol is enabled; a normal Nginx
 * HTTP proxy instead forwards X-Forwarded-For/X-Real-IP headers. Trust those
 * headers only when the direct peer is loopback, so public clients cannot spoof
 * another address and bypass rate limits.
 */
export function getIp(res: HttpResponse, req?: HttpRequest) {
    const ip = textDecoder.decode(res.getRemoteAddressAsText());
    const proxyIp = textDecoder.decode(res.getProxiedRemoteAddressAsText());
    if (proxyIp) return proxyIp;

    if (req && isLoopbackAddress(ip)) {
        const forwarded = req.getHeader("x-forwarded-for");
        const firstForwarded = forwarded.split(",", 1)[0]?.trim();
        if (firstForwarded) return firstForwarded;

        const realIp = req.getHeader("x-real-ip").trim();
        if (realIp) return realIp;
    }

    return ip;
}

// modified version of https://github.com/uNetworking/uWebSockets.js/blob/master/examples/RateLimit.js
// also wraps simultaneous connections rate limit not just messages
export class WebSocketRateLimit {
    // for messages rate limit
    private _last = Symbol();
    private _count = Symbol();

    private _now = 0;
    private limit: number;

    // for simultaneous connections rate limit
    private _IPsData = new Map<
        string,
        {
            connections: number;
            /** 最近一次连接/断开/检查时间，用于清理长时间无活动的零连接记录。 */
            lastActive: number;
        }
    >();
    readonly maxConnections: number;

    constructor(limit: number, interval: number, maxConnections: number) {
        this.limit = limit;
        this.maxConnections = maxConnections;

        setInterval(() => ++this._now, interval);

        // 每小时只清理"已断开（connections<=0）且超过一小时未活动"的记录，
        // 绝不能把仍存活连接的计数清零，否则同一 IP 可绕过 maxConnections，
        // 且老连接断开后会把新连接的计数减成负数。
        setInterval(
            () => {
                const now = Date.now();
                for (const [ip, data] of this._IPsData) {
                    if (
                        data.connections <= 0
                        && now - data.lastActive > 1000 * 60 * 60
                    ) {
                        this._IPsData.delete(ip);
                    }
                }
            },
            1000 * 60 * 60,
        );
    }

    /**
     * Returns true if a websocket is being rate limited by sending too many messages
     */
    isRateLimited(wsData: Record<symbol, number>) {
        if (!Config.rateLimitsEnabled) return false;
        if (wsData[this._last] != this._now) {
            wsData[this._last] = this._now;
            wsData[this._count] = 1;
        } else {
            return ++wsData[this._count] > this.limit;
        }
    }

    /**
     * returns true if the IP has exceeded the max simultaneous connections
     * false otherwise
     */
    isIpRateLimited(ip: string): boolean {
        let data = this._IPsData.get(ip);
        if (!data) {
            data = {
                connections: 0,
                lastActive: Date.now(),
            };
            this._IPsData.set(ip, data);
        }
        if (!Config.rateLimitsEnabled) return false;

        data.lastActive = Date.now();
        if (data.connections + 1 > this.maxConnections) {
            return true;
        }
        return false;
    }

    ipConnected(ip: string) {
        let data = this._IPsData.get(ip);
        if (!data) {
            data = {
                connections: 0,
                lastActive: Date.now(),
            };
            this._IPsData.set(ip, data);
        }
        data.connections++;
        data.lastActive = Date.now();
    }

    ipDisconnected(ip: string) {
        const data = this._IPsData.get(ip);
        if (!data) return;
        // 防御：计数不为 0 才减，避免重复断开/清空竞态把计数减成负数。
        if (data.connections > 0) data.connections--;
        data.lastActive = Date.now();
    }
}

export class HTTPRateLimit {
    private _IPsData = new Map<
        string,
        {
            last: number;
            count: number;
        }
    >();

    private _now = 0;

    limit: number;
    private readonly alwaysEnabled: boolean;

    constructor(limit: number, interval: number, alwaysEnabled = false) {
        this.limit = limit;
        this.alwaysEnabled = alwaysEnabled;
        setInterval(() => ++this._now, interval);

        // clear ips every hour to not leak memory ig
        // probably not an issue but why not /shrug
        setInterval(
            () => {
                this._IPsData.clear();
            },
            1000 * 60 * 60,
        );
    }

    /**
     * Checks if an IP is rate limited
     */
    isRateLimited(ip: string) {
        if (!Config.rateLimitsEnabled && !this.alwaysEnabled) return false;
        let ipData = this._IPsData.get(ip);
        if (!ipData) {
            ipData = { last: this._now, count: 0 };
            this._IPsData.set(ip, ipData);
        }

        if (ipData.last != this._now) {
            ipData.last = this._now;
            ipData.count = 1;
        } else {
            return ++ipData.count > this.limit;
        }
    }
}
