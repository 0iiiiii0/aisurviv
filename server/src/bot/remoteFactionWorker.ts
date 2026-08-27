import { formatHostPort, isLocalNetworkAddress } from "../../../shared/utils/networkAddress.ts";

export const REMOTE_FACTION_WORKER_PROTOCOL = 1;

export interface RemoteFactionWorkerSettings {
    enabled: boolean;
    controlUrl: string;
    token: string;
    advertisedGameHost: string;
    fallbackToLocal: boolean;
    requestTimeoutMs: number;
}

export interface RemoteFactionBotJob {
    protocolVersion: typeof REMOTE_FACTION_WORKER_PROTOCOL;
    jobId: string;
    gameId: string;
    mapName: "faction";
    buildVersion: string;
    environment: Record<string, string>;
}

export interface RemoteFactionJobStatus {
    jobId: string;
    state: "running" | "exited" | "missing";
    pid?: number;
    exitCode?: number | null;
    signal?: string | null;
}

interface RemoteWorkerResponse {
    ok?: boolean;
    error?: string;
    jobId?: string;
    pid?: number;
    stopped?: number;
    jobs?: RemoteFactionJobStatus[];
}

export interface RemoteFactionOutboundCommand {
    requestId: string;
    pathname: string;
    body: unknown;
}

interface OutboundSession {
    queue: RemoteFactionOutboundCommand[];
    pollWaiters: Array<(command: RemoteFactionOutboundCommand | null) => void>;
    responses: Map<string, {
        resolve: (response: RemoteWorkerResponse) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }>;
    lastSeenAt: number;
}

const outboundSessions = new Map<string, OutboundSession>();
let outboundRequestSequence = 0;

function outboundNodeId(controlUrl: string): string | undefined {
    try {
        const parsed = new URL(controlUrl);
        return parsed.protocol === "outbound:" ? parsed.hostname : undefined;
    } catch {
        return undefined;
    }
}

export function registerRemoteFactionOutboundSession(nodeId: string): void {
    const existing = outboundSessions.get(nodeId);
    if (existing) {
        existing.lastSeenAt = Date.now();
        return;
    }
    outboundSessions.set(nodeId, {
        queue: [],
        pollWaiters: [],
        responses: new Map(),
        lastSeenAt: Date.now(),
    });
}

export function unregisterRemoteFactionOutboundSession(nodeId: string): void {
    const session = outboundSessions.get(nodeId);
    if (!session) return;
    outboundSessions.delete(nodeId);
    for (const waiter of session.pollWaiters.splice(0)) waiter(null);
    for (const pending of session.responses.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("remote outbound worker disconnected"));
    }
    session.responses.clear();
}

export async function pollRemoteFactionOutboundCommand(
    nodeId: string,
    timeoutMs = 20_000,
): Promise<RemoteFactionOutboundCommand | null> {
    const session = outboundSessions.get(nodeId);
    if (!session) throw new Error("远程计算节点会话不存在，请重新连接");
    session.lastSeenAt = Date.now();
    const queued = session.queue.shift();
    if (queued) return queued;
    return await new Promise((resolve) => {
        const waiter = (command: RemoteFactionOutboundCommand | null) => {
            clearTimeout(timer);
            resolve(command);
        };
        const timer = setTimeout(() => {
            const index = session.pollWaiters.indexOf(waiter);
            if (index >= 0) session.pollWaiters.splice(index, 1);
            resolve(null);
        }, Math.max(1_000, Math.min(25_000, timeoutMs)));
        session.pollWaiters.push(waiter);
    });
}

export function completeRemoteFactionOutboundCommand(
    nodeId: string,
    requestId: string,
    result: { ok: boolean; payload?: RemoteWorkerResponse; error?: string },
): void {
    const session = outboundSessions.get(nodeId);
    const pending = session?.responses.get(requestId);
    if (!session || !pending) throw new Error("远程任务响应已过期");
    session.responses.delete(requestId);
    session.lastSeenAt = Date.now();
    clearTimeout(pending.timer);
    if (!result.ok) {
        pending.reject(new Error(result.error || "remote outbound worker request failed"));
        return;
    }
    pending.resolve(result.payload ?? {});
}

async function postOutboundWorker(
    nodeId: string,
    pathname: string,
    body: unknown,
    timeoutMs: number,
): Promise<RemoteWorkerResponse> {
    const session = outboundSessions.get(nodeId);
    if (!session) throw new Error("remote outbound worker is not connected");
    const requestId = `${Date.now().toString(36)}-${(++outboundRequestSequence).toString(36)}`;
    const command = { requestId, pathname, body };
    const response = new Promise<RemoteWorkerResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
            session.responses.delete(requestId);
            reject(new Error("remote outbound worker request timed out"));
        }, Math.max(1_000, timeoutMs));
        session.responses.set(requestId, { resolve, reject, timer });
    });
    const waiter = session.pollWaiters.shift();
    if (waiter) waiter(command);
    else session.queue.push(command);
    return await response;
}

function controlEndpoint(controlUrl: string, pathname: string): URL {
    const parsed = new URL(controlUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("remote worker controlUrl must use http or https");
    }
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}${pathname}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed;
}

async function postRemoteWorker(
    settings: Pick<RemoteFactionWorkerSettings, "controlUrl" | "token" | "requestTimeoutMs">,
    pathname: string,
    body: unknown,
): Promise<RemoteWorkerResponse> {
    const nodeId = outboundNodeId(settings.controlUrl);
    if (nodeId) {
        return await postOutboundWorker(nodeId, pathname, body, settings.requestTimeoutMs);
    }
    const response = await fetch(controlEndpoint(settings.controlUrl, pathname), {
        method: "POST",
        headers: {
            authorization: `Bearer ${settings.token}`,
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.requestTimeoutMs),
    });
    const payload = await response.json().catch(() => ({})) as RemoteWorkerResponse;
    if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || `remote worker returned HTTP ${response.status}`);
    }
    return payload;
}

export function remoteFactionWorkerReady(settings: RemoteFactionWorkerSettings): boolean {
    if (!settings.enabled) return false;
    if (!settings.controlUrl.trim() || !settings.token.trim()) return false;
    if (outboundNodeId(settings.controlUrl)) return true;
    try {
        controlEndpoint(settings.controlUrl, "/health");
        return true;
    } catch {
        return false;
    }
}

/** Resolve the per-room address without ever advertising the game server's
 * loopback port to a separate compute machine. IPv6 literals are bracketed. */
export function remoteFactionGameAddress(
    advertisedGameHost: string,
    fallbackRegionAddress: string,
    gamePort: number,
): string {
    const source = advertisedGameHost.trim() || fallbackRegionAddress.trim();
    const parsed = new URL(source.includes("://") ? source : `ws://${source}`);
    if (!parsed.hostname) throw new Error("remote faction game host is empty");
    if (isLocalNetworkAddress(parsed.hostname)) {
        throw new Error(
            "remote faction game host resolves to loopback; configure advertisedGameHost with the game server LAN/VPN IP",
        );
    }
    return formatHostPort(parsed.hostname, gamePort);
}

export function remoteBotEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(
        Object.entries(environment).filter(
            (entry): entry is [string, string] => entry[0].startsWith("BOT_")
                && typeof entry[1] === "string",
        ),
    );
}

export async function startRemoteFactionJob(
    settings: RemoteFactionWorkerSettings,
    job: RemoteFactionBotJob,
): Promise<{ jobId: string; pid?: number }> {
    const result = await postRemoteWorker(settings, "/v1/jobs/start", job);
    return { jobId: result.jobId ?? job.jobId, pid: result.pid };
}

export async function stopRemoteFactionJob(
    settings: RemoteFactionWorkerSettings,
    jobId: string,
): Promise<void> {
    await postRemoteWorker(settings, "/v1/jobs/stop", { jobId });
}

export async function queryRemoteFactionJobs(
    settings: RemoteFactionWorkerSettings,
    jobIds: readonly string[],
): Promise<RemoteFactionJobStatus[]> {
    if (jobIds.length === 0) return [];
    const result = await postRemoteWorker(settings, "/v1/jobs/status", { jobIds });
    return Array.isArray(result.jobs) ? result.jobs : [];
}
