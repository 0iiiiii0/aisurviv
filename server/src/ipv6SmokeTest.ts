import assert from "assert";
import {
    formatHostPort,
    isLocalNetworkAddress,
    resolveAdvertisedAddress,
    resolveAdvertisedUrl,
} from "../../shared/utils/networkAddress.ts";
import { getListenHosts } from "./utils/listen.ts";

assert.equal(formatHostPort("::1", 8001), "[::1]:8001");
assert.equal(formatHostPort("[2001:db8::10]", 3000), "[2001:db8::10]:3000");
assert.equal(formatHostPort("192.168.1.10", 8001), "192.168.1.10:8001");

assert.equal(isLocalNetworkAddress("[::1]"), true);
assert.equal(isLocalNetworkAddress("127.0.0.1"), true);
assert.equal(isLocalNetworkAddress("2001:db8::10"), false);

assert.equal(
    resolveAdvertisedAddress("127.0.0.1:8001", "2001:db8::42"),
    "[2001:db8::42]:8001",
);
assert.equal(
    resolveAdvertisedAddress("[::1]:8001", "[fd00::25]"),
    "[fd00::25]:8001",
);
assert.equal(
    resolveAdvertisedAddress("127.0.0.1:8001", "192.168.1.25"),
    "192.168.1.25:8001",
);
assert.equal(
    resolveAdvertisedAddress("[2001:db8::99]:8001", "fd00::25"),
    "[2001:db8::99]:8001",
);
assert.equal(
    resolveAdvertisedUrl(
        "ws://127.0.0.1:9000/play?gameId=remote-test",
        "game.example.com",
    ),
    "ws://game.example.com:9000/play?gameId=remote-test",
);
assert.equal(
    resolveAdvertisedUrl(
        "wss://[::1]:9001/play?gameId=ipv6-test",
        "2001:db8::42",
    ),
    "wss://[2001:db8::42]:9001/play?gameId=ipv6-test",
);

assert.deepEqual(getListenHosts("127.0.0.1", true, "::"), ["::", "127.0.0.1"]);
assert.deepEqual(getListenHosts("0.0.0.0", false, "::"), ["0.0.0.0"]);

for (const address of ["[2001:db8::42]:8001", "192.168.1.25:8001"]) {
    assert.doesNotThrow(() => new URL(`ws://${address}/play`));
}

console.log("IPv6 smoke test passed: dual-stack hosts and URL authorities.");
