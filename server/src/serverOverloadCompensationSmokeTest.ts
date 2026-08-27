import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";

const previous = {
    window: Config.serverLagCompensationWindowMs,
    networkBytes: Config.serverNetworkBackpressureBytes,
    networkDuration: Config.serverNetworkBackpressureDurationMs,
};

const extraction = new Game(
    `overload-extraction-${Date.now()}`,
    { mapName: "extraction", teamMode: TeamMode.Solo },
    () => {},
    () => {},
);
const ordinary = new Game(
    `overload-main-${Date.now()}`,
    { mapName: "main", teamMode: TeamMode.Solo },
    () => {},
    () => {},
);

try {
    Config.serverLagCompensationWindowMs = 30_000;
    assert.equal(extraction.serverLagCompensationActive(), false);
    extraction.reportServerOverload("cpu", "smoke CPU saturation");
    assert.equal(extraction.serverLagCompensationActive(), true, "recent CPU saturation enables refund");
    assert.match(extraction.serverLagReasonSummary(), /cpu/);
    assert.equal(
        extraction.serverLagCompensationActive(Date.now() + 30_001),
        false,
        "old incidents cannot refund an unrelated later death",
    );

    Config.serverNetworkBackpressureBytes = 64 * 1024;
    Config.serverNetworkBackpressureDurationMs = 250;
    const networkState = extraction as unknown as { networkBackpressureSince: number };
    networkState.networkBackpressureSince = Date.now() - 300;
    extraction.reportNetworkBackpressure(128 * 1024);
    assert.match(extraction.serverLagReasonSummary(), /network/);
    assert.equal(extraction.serverLagCompensationActive(), true, "sustained network queue enables refund");

    ordinary.reportServerOverload("memory", "smoke memory saturation");
    assert.equal(
        ordinary.serverLagCompensationActive(),
        false,
        "server overload compensation is extraction-only",
    );
    console.log("Server overload compensation passed: extraction-only CPU/memory/network incidents use a bounded death window.");
} finally {
    extraction.stop();
    ordinary.stop();
    Config.serverLagCompensationWindowMs = previous.window;
    Config.serverNetworkBackpressureBytes = previous.networkBytes;
    Config.serverNetworkBackpressureDurationMs = previous.networkDuration;
}
