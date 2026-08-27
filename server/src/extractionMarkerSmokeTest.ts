import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import {
    EXTRACTION_SECRET_OPEN_SECONDS,
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
    generateExtractionPoints,
} from "../../shared/defs/extractionDefs.ts";
import { extractionMarkerState } from "../../client/src/extractionMarker.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const prevSecret = JSON.parse(JSON.stringify(Config.extractionSecret)) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = true;

function joinHuman(game: Game, name: string): Player {
    game.addJoinToken(`em-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `em-${name}`;
    msg.name = name;
    const p = game.playerBarn.addPlayer(`${name}-sock`, msg);
    if (!p) throw new Error(`failed to join ${name}`);
    return p;
}

void (async () => {
    const game = new Game(
        "extract-marker-test",
        { mapName: "extraction_secret", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const g = game as unknown as { started: boolean; startedTime: number };
    g.started = true;
    g.startedTime = 60; // 开局 1 分钟（绝密未开放期）
    try {
        // 1) 客户端标记状态：4 个场景。
        //    a) 非 playing → 隐藏。
        assert.deepEqual(
            extractionMarkerState({ playing: false, secretMode: false, matchStartedTime: 60 }),
            { kind: "hidden-not-playing" },
        );
        //    b) 普通搜打撤 + 观战 → 显示（修复：观战不再隐藏撤离点圈）。
        assert.equal(
            extractionMarkerState({ playing: true, secretMode: false, matchStartedTime: 60 }).kind,
            "shown",
        );
        //    c) 绝密未开放（开局 1 分钟）→ 隐藏 + 剩余开放时间。
        const closed = extractionMarkerState({ playing: true, secretMode: true, matchStartedTime: 60 });
        assert.equal(closed.kind, "hidden-secret-closed");
        assert.equal(
            (closed as { remainForOpen: number }).remainForOpen,
            EXTRACTION_MATCH_TIME_LIMIT_SECONDS - 60,
        );
        //    d) 绝密已开放（开局 6 分钟）→ 显示。
        assert.equal(
            extractionMarkerState({ playing: true, secretMode: true, matchStartedTime: 360 }).kind,
            "shown",
        );
        console.log("✓ 客户端标记状态 4 场景（含观战显示修复）");

        // 2) 撤离点确定性：同地图同尺寸两次生成结果一致。
        const a = generateExtractionPoints("extraction_secret", 800, 800);
        const b = generateExtractionPoints("extraction_secret", 800, 800);
        assert.deepEqual(a, b, "撤离点确定性生成");
        assert.ok(a.length > 0);
        console.log(`✓ 撤离点确定性（${a.length} 个点）`);

        // 3) 服务端观战同步：观战者收到被观战者的撤离点索引。
        //    绝密资格校验需要合格武器配装。
        stashManager.addItem("MarkerA", "m4a1", 1);
        stashManager.setLoadout("MarkerA", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const target = joinHuman(game, "MarkerA");
        stashManager.addItem("MarkerB", "m4a1", 1);
        stashManager.setLoadout("MarkerB", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const spectator = joinHuman(game, "MarkerB");
        (spectator as unknown as { spectating: Player }).spectating = target;
        const sys = game.extraction() as unknown as {
            update(dt: number): void;
            pointIndexFor(p: Player): number;
        };
        // 跑 1.2s 让 syncTicker（0.2s）触发。
        for (let i = 0; i < 6; i++) sys.update(0.2);
        const expectedIndex = sys.pointIndexFor(target);
        const msg = spectator.msgsToSend.find(
            (m) => m.type === net.MsgType.ExtractionPoint,
        );
        assert.ok(msg, "观战者必须收到 ExtractionPointMsg");
        const pointMsg = msg.msg as net.ExtractionPointMsg;
        assert.equal(pointMsg.pointIndex, expectedIndex, "观战者收到被观战者的索引");
        console.log(`✓ 观战同步：观战者收到被观战者撤离点索引 ${pointMsg.pointIndex}`);

        console.log("\nExtraction marker test passed: client marker states (spectating fixed), deterministic points, spectator index sync");
    } finally {
        game.stop();
        Config.extractionSecret = prevSecret;
    }
})();
