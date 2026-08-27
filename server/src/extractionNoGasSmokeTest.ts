import assert from "node:assert/strict";
import {
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
} from "../../shared/defs/extractionDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

async function verify(teamMode: TeamMode, label: string): Promise<void> {
    const game = new Game(
        `extraction-nogas-${label}`,
        { mapName: "extraction", teamMode },
        () => {},
        () => {},
    );
    await game.init();

    // 撤离点：每个模式都有可用的撤离点。
    const points = game.extraction().points;
    assert.ok(points.length >= 3, `${label} must have extraction points`);

    // 毒圈：初始 Inactive，且推进多帧后仍不运行（保持 stage 0 / 全图安全区）。
    assert.equal(game.gas.mode, GameConfig.GasMode.Inactive, `${label} gas starts inactive`);
    const started = game as unknown as { started: boolean };
    started.started = true;
    for (let i = 0; i < 30; i++) {
        game.update();
    }
    assert.equal(game.gas.mode, GameConfig.GasMode.Inactive, `${label} gas must never run`);
    assert.equal(game.gas.stage, 0, `${label} gas stage must stay 0`);

    // 倒计时：startedTime 随对局推进，整局限时存在（10 分钟）。
    const startedTime = (game as unknown as { startedTime: number }).startedTime;
    assert.ok(startedTime > 0, `${label} match clock must advance`);
    assert.equal(EXTRACTION_MATCH_TIME_LIMIT_SECONDS, 600, "match limit is 10 minutes");

    game.stop();
}

void (async () => {
    await verify(TeamMode.Solo, "solo");
    await verify(TeamMode.Duo, "duo");
    await verify(TeamMode.Squad, "squad");
    console.log(
        "Extraction no-gas smoke test passed: solo/duo/squad all have extraction points, no gas (stage 0), and a 10-minute match clock.",
    );
})();
