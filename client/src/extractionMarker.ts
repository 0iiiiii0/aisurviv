import {
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
    EXTRACTION_SECRET_OPEN_SECONDS,
} from "../../shared/defs/extractionDefs.ts";

/**
 * 撤离点标记显示状态（纯函数，便于测试）：
 * - 非对局中（未 playing）→ 隐藏；
 * - 绝密模式撤离点未开放（开局 5 分钟内）→ 隐藏并提示剩余时间；
 * - 其余（含观战者）→ 显示被观战者/自己的撤离点圈。
 * 观战者不隐藏：服务端已按 0.2s 间隔同步被观战者的撤离点索引，
 * 客户端继续绘制其撤离点圈；HUD 进度文字由调用方按观战状态隐藏。
 */
export type ExtractionMarkerState =
    | { kind: "hidden-not-playing" }
    | { kind: "hidden-secret-closed"; remainForOpen: number }
    | { kind: "shown"; remainForOpen: number };

export function extractionMarkerState(input: {
    playing: boolean;
    secretMode: boolean;
    matchStartedTime: number;
}): ExtractionMarkerState {
    if (!input.playing) return { kind: "hidden-not-playing" };
    const remainForOpen = input.matchStartedTime < 0
        ? EXTRACTION_MATCH_TIME_LIMIT_SECONDS
        : Math.max(
            0,
            EXTRACTION_MATCH_TIME_LIMIT_SECONDS
                - Math.floor(input.matchStartedTime),
        );
    if (input.secretMode && remainForOpen > EXTRACTION_SECRET_OPEN_SECONDS) {
        return { kind: "hidden-secret-closed", remainForOpen };
    }
    return { kind: "shown", remainForOpen };
}
