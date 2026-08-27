import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { zFindGameBody } from "../../shared/types/api.ts";
import { configPath } from "./config.ts";
import { isFindGameRequestAuthorized } from "./findGameAuthorization.ts";

const accounts = {
    profile(token: unknown) {
        return token === "valid-account-token"
            ? { username: "smoke", displayName: "Smoke" }
            : null;
    },
};
const apiKey = "0123456789abcdef";

assert.equal(
    isFindGameRequestAuthorized(false, {}, apiKey, accounts),
    true,
    "normal modes must remain available to guests",
);
assert.equal(
    isFindGameRequestAuthorized(true, {}, apiKey, accounts),
    false,
    "extraction must reject a guest without an account",
);
assert.equal(
    isFindGameRequestAuthorized(
        true,
        { accountToken: "valid-account-token" },
        apiKey,
        accounts,
    ),
    true,
    "a valid legacy account token must authorize extraction",
);

const validatedBody = zFindGameBody.parse({
    region: "local",
    zones: [],
    version: 1024,
    playerCount: 1,
    autoFill: true,
    gameModeIdx: 0,
    accountToken: "valid-account-token",
    zombieDifficulty: "hard",
});
assert.equal(validatedBody.accountToken, "valid-account-token");
assert.equal(validatedBody.zombieDifficulty, "hard");

const apiSource = fs.readFileSync(
    path.join(configPath, "server/src/api/index.ts"),
    "utf8",
);
assert.match(apiSource, /isFindGameRequestAuthorized/);
assert.match(apiSource, /error: "login_required"/);
assert.match(apiSource, /zombieDifficulty: body\.zombieDifficulty/);

const clientMain = fs.readFileSync(
    path.join(configPath, "client/src/main.ts"),
    "utf8",
);
assert.match(clientMain, /this\.duelLobby\.open\(\)/, "1v1 入口应允许游客");
assert.match(clientMain, /modeRequiresLogin\(gameModeIdx/, "客户端应按模式判断登录要求");
assert.match(
    clientMain,
    /async tryJoinTeam\([\s\S]*?modeRequiresLogin\(selectedModeIdx\)[\s\S]*?await this\.playerAccount\.validateSession\(\)/,
    "创建搜打撤队伍前必须向账号 API 复验当前会话，不能只依赖本地 token",
);
assert.doesNotMatch(
    clientMain,
    /tryQuickStartGame\([\s\S]{0,180}requireLogin\(\)/,
    "快速匹配不得再使用全模式登录门槛",
);

console.log(
    "Guest mode access smoke test passed: normal modes allow guests; extraction requires a validated account; zombie difficulty survives schema validation.",
);
