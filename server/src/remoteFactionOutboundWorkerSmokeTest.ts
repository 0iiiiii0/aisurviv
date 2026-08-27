import assert from "node:assert/strict";
import {
    completeRemoteFactionOutboundCommand,
    pollRemoteFactionOutboundCommand,
    queryRemoteFactionJobs,
    registerRemoteFactionOutboundSession,
    REMOTE_FACTION_WORKER_PROTOCOL,
    startRemoteFactionJob,
    stopRemoteFactionJob,
    unregisterRemoteFactionOutboundSession,
} from "./bot/remoteFactionWorker.ts";

const nodeId = "outbound-smoke-node-123456";
const settings = {
    enabled: true,
    controlUrl: `outbound://${nodeId}`,
    token: "outbound-smoke-token-123456789",
    advertisedGameHost: "203.0.113.10",
    fallbackToLocal: true,
    requestTimeoutMs: 2_000,
};

registerRemoteFactionOutboundSession(nodeId);
try {
    const startPromise = startRemoteFactionJob(settings, {
        protocolVersion: REMOTE_FACTION_WORKER_PROTOCOL,
        jobId: "outbound-smoke-job",
        gameId: "0123456789abcdef0123456789abcdef01234567",
        mapName: "faction",
        buildVersion: "smoke",
        environment: { BOT_COUNT: "2" },
    });
    const startCommand = await pollRemoteFactionOutboundCommand(nodeId, 1_000);
    assert.equal(startCommand?.pathname, "/v1/jobs/start");
    assert.equal((startCommand?.body as { jobId?: string }).jobId, "outbound-smoke-job");
    completeRemoteFactionOutboundCommand(nodeId, startCommand!.requestId, {
        ok: true,
        payload: { ok: true, jobId: "outbound-smoke-job", pid: 4321 },
    });
    assert.deepEqual(await startPromise, { jobId: "outbound-smoke-job", pid: 4321 });

    const statusPromise = queryRemoteFactionJobs(settings, ["outbound-smoke-job"]);
    const statusCommand = await pollRemoteFactionOutboundCommand(nodeId, 1_000);
    assert.equal(statusCommand?.pathname, "/v1/jobs/status");
    completeRemoteFactionOutboundCommand(nodeId, statusCommand!.requestId, {
        ok: true,
        payload: {
            ok: true,
            jobs: [{ jobId: "outbound-smoke-job", state: "running", pid: 4321 }],
        },
    });
    assert.equal((await statusPromise)[0]?.state, "running");

    const stopPromise = stopRemoteFactionJob(settings, "outbound-smoke-job");
    const stopCommand = await pollRemoteFactionOutboundCommand(nodeId, 1_000);
    assert.equal(stopCommand?.pathname, "/v1/jobs/stop");
    completeRemoteFactionOutboundCommand(nodeId, stopCommand!.requestId, {
        ok: true,
        payload: { ok: true, stopped: 1 },
    });
    await stopPromise;
} finally {
    unregisterRemoteFactionOutboundSession(nodeId);
}

await assert.rejects(
    queryRemoteFactionJobs(settings, ["outbound-smoke-job"]),
    /not connected/,
);

console.log("Remote 50v50 outbound worker smoke test passed: start/status/stop without inbound access.");
