#!/usr/bin/env python3
"""Generate per-bot spectator reports from surviv.io AI match recordings.

Usage:
  python tools/ai_spectator_analyzer.py <recording-root> [output-prefix]

The tool reads every manifest/map/events/frames file, groups records by worker,
match and bot id, and writes both Markdown and HTML reports. It never modifies
recordings.
"""
from __future__ import annotations

import argparse
import collections
import html
import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

VOLUNTARY_STATES = {"loot", "break-crate", "regroup", "special", "explore", "cover", "hide"}
SURVIVAL_STATES = {"gas", "airstrike"}
COMBAT_STATES = {"combat", "counterfire", "flush", "retreat", "hide"}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"{path}:{line_no}: {exc}") from exc
    return rows


def distance(a: dict[str, float] | None, b: dict[str, float] | None) -> float:
    if not a or not b:
        return math.inf
    return math.hypot(float(a.get("x", 0)) - float(b.get("x", 0)), float(a.get("y", 0)) - float(b.get("y", 0)))


def has_gun(frame: dict[str, Any]) -> bool:
    for weapon in frame.get("self", {}).get("weapons", []):
        if weapon.get("slot") in (0, 1) and str(weapon.get("type") or ""):
            return True
    return False


def movement_commanded(frame: dict[str, Any]) -> bool:
    movement = frame.get("control", {}).get("movement", {})
    return any(bool(movement.get(k)) for k in ("up", "down", "left", "right"))


def fmt_ms(ms: int | float | None) -> str:
    if ms is None:
        return "未获得"
    seconds = max(0.0, float(ms) / 1000)
    if seconds < 60:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m{seconds % 60:04.1f}s"


def rel_time(at: int, start: int) -> str:
    return fmt_ms(at - start)


def dominant(counter: collections.Counter[str], count: int = 4) -> str:
    total = sum(counter.values()) or 1
    return "、".join(f"{name or 'none'} {value / total:.0%}" for name, value in counter.most_common(count))


@dataclass
class Episode:
    kind: str
    start: int
    end: int
    detail: str
    severity: str = "medium"

    @property
    def duration(self) -> int:
        return max(0, self.end - self.start)


@dataclass
class BotReport:
    key: str
    session: str
    match: str
    bot_id: int
    mode: str
    difficulty: str
    role: str
    start: int
    end: int
    frame_count: int
    first_gun_ms: int | None
    armed_ratio: float
    states: collections.Counter[str]
    intents: collections.Counter[str]
    recoveries: int
    abandons: int
    ammo_sent: int
    ammo_confirmed: int
    episodes: list[Episode] = field(default_factory=list)
    score: float = 100.0

    @property
    def duration_ms(self) -> int:
        return max(1, self.end - self.start)

    @property
    def grade(self) -> str:
        if self.score >= 85:
            return "稳定"
        if self.score >= 70:
            return "可接受"
        if self.score >= 50:
            return "明显异常"
        return "严重异常"


def contiguous_episodes(
    frames: list[dict[str, Any]],
    predicate,
    detail_fn,
    kind: str,
    min_ms: int,
    severity: str,
) -> list[Episode]:
    episodes: list[Episode] = []
    current_start: int | None = None
    current_last = 0
    current_detail = ""
    for frame in frames:
        if predicate(frame):
            if current_start is None:
                current_start = int(frame["at"])
                current_detail = detail_fn(frame)
            current_last = int(frame["at"])
        else:
            if current_start is not None and current_last - current_start >= min_ms:
                episodes.append(Episode(kind, current_start, current_last, current_detail, severity))
            current_start = None
    if current_start is not None and current_last - current_start >= min_ms:
        episodes.append(Episode(kind, current_start, current_last, current_detail, severity))
    return episodes


def analyze_bot(
    session: str,
    match: str,
    bot_id: int,
    frames: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> BotReport:
    frames.sort(key=lambda row: int(row["at"]))
    events.sort(key=lambda row: int(row["at"]))
    start, end = int(frames[0]["at"]), int(frames[-1]["at"])
    states = collections.Counter(str(frame.get("state") or "none") for frame in frames)
    intents = collections.Counter(str((frame.get("intent") or {}).get("kind") or "none") for frame in frames)
    mode = collections.Counter(str(frame.get("modeSystem") or "unknown") for frame in frames).most_common(1)[0][0]
    difficulty = collections.Counter(str(frame.get("difficulty") or "unknown") for frame in frames).most_common(1)[0][0]
    role = collections.Counter(str(frame.get("role") or "unknown") for frame in frames).most_common(1)[0][0]
    armed_frames = [frame for frame in frames if has_gun(frame)]
    first_gun_ms = int(armed_frames[0]["at"] - start) if armed_frames else None
    report = BotReport(
        key=f"{session}|{match[:8]}|bot{bot_id}",
        session=session,
        match=match,
        bot_id=bot_id,
        mode=mode,
        difficulty=difficulty,
        role=role,
        start=start,
        end=end,
        frame_count=len(frames),
        first_gun_ms=first_gun_ms,
        armed_ratio=len(armed_frames) / max(1, len(frames)),
        states=states,
        intents=intents,
        recoveries=sum(1 for event in events if event.get("type") == "path_recovery_triggered"),
        abandons=sum(1 for event in events if event.get("type") == "resource_target_abandoned"),
        ammo_sent=sum(1 for event in events if event.get("type") == "ammo_share_drop_sent"),
        ammo_confirmed=sum(1 for event in events if event.get("type") == "ammo_share_confirmed"),
    )

    if first_gun_ms is None:
        report.episodes.append(Episode("长期无枪", start, end, "整段记录未获得可用枪械", "critical"))
    elif first_gun_ms > 30_000:
        report.episodes.append(Episode("拿枪过慢", start, start + first_gun_ms, f"出生后 {fmt_ms(first_gun_ms)} 才获得枪械", "critical"))
    elif first_gun_ms > 15_000:
        report.episodes.append(Episode("拿枪偏慢", start, start + first_gun_ms, f"出生后 {fmt_ms(first_gun_ms)} 才获得枪械", "high"))

    # Commanded movement without physical progress. Use a 2–5 second sliding
    # window: episodes shorter than 2s (brief pauses / weapon switching) are
    # not treated as stuck, and the window is capped at 5s per frame pair.
    stuck: list[Episode] = []
    anchor = 0
    for index, frame in enumerate(frames):
        while anchor < index and int(frame["at"]) - int(frames[anchor]["at"]) > 5_000:
            anchor += 1
        if int(frame["at"]) - int(frames[anchor]["at"]) < 2_000:
            continue
        if not all(movement_commanded(row) for row in frames[anchor : index + 1]):
            continue
        if any(str(row.get("state")) in ("waiting", "heal", "revive") for row in frames[anchor : index + 1]):
            continue
        moved = distance(frames[anchor].get("self", {}).get("pos"), frame.get("self", {}).get("pos"))
        if moved <= 1.2:
            intent = (frame.get("intent") or {}).get("kind") or "none"
            target = (frame.get("intent") or {}).get("targetKey") or (frame.get("resourcePursuit") or {}).get("key") or "none"
            episode = Episode(
                "移动无进展",
                int(frames[anchor]["at"]),
                int(frame["at"]),
                f"状态={frame.get('state')}，意图={intent}，目标={target}，位移={moved:.2f}",
                "high",
            )
            if not stuck or episode.start > stuck[-1].end:
                stuck.append(episode)
            else:
                # 重叠区间合并为并集（最早起点、最晚终点），避免按 duration
                # 替换而截断真实的长时间卡死区间导致漏检。
                prev = stuck[-1]
                severity_rank = {"critical": 3, "high": 2, "medium": 1, "low": 0}
                prev_rank = severity_rank.get(prev.severity, 1)
                cur_rank = severity_rank.get(episode.severity, 1)
                stuck[-1] = Episode(
                    prev.kind,
                    min(prev.start, episode.start),
                    max(prev.end, episode.end),
                    prev.detail if prev_rank >= cur_rank else episode.detail,
                    prev.severity if prev_rank >= cur_rank else episode.severity,
                )
    report.episodes.extend(stuck)

    # Resource pursuit episodes from recorder state.
    current: dict[str, Any] | None = None
    pursuits: list[dict[str, Any]] = []
    for frame in frames:
        pursuit = frame.get("resourcePursuit") or {}
        key = str(pursuit.get("key") or "")
        at = int(frame["at"])
        if key:
            if current and current["key"] == key and at - current["last"] <= 1_500:
                current["last"] = at
                current["max_no_progress"] = max(current["max_no_progress"], int(pursuit.get("noProgressMs") or 0))
                current["recoveries"] = max(current["recoveries"], int(pursuit.get("sameTargetRecoveryCount") or 0))
            else:
                if current:
                    pursuits.append(current)
                current = {
                    "key": key,
                    "start": at,
                    "last": at,
                    "max_no_progress": int(pursuit.get("noProgressMs") or 0),
                    "recoveries": int(pursuit.get("sameTargetRecoveryCount") or 0),
                }
        elif current and at - current["last"] > 1_500:
            pursuits.append(current)
            current = None
    if current:
        pursuits.append(current)
    for pursuit in pursuits:
        duration = pursuit["last"] - pursuit["start"]
        if duration >= 8_000 or pursuit["max_no_progress"] >= 4_000 or pursuit["recoveries"] >= 3:
            report.episodes.append(Episode(
                "目标追逐过久",
                pursuit["start"],
                pursuit["last"],
                f"目标={pursuit['key']}，无进展最大={fmt_ms(pursuit['max_no_progress'])}，同目标恢复={pursuit['recoveries']}",
                "high",
            ))

    # Visible armed enemy ignored while a voluntary task remains active.
    report.episodes.extend(contiguous_episodes(
        frames,
        lambda frame: bool((frame.get("target") or {}).get("visible"))
        and has_gun(frame)
        and distance(frame.get("self", {}).get("pos"), (frame.get("target") or {}).get("pos")) <= 30
        and str(frame.get("state")) in VOLUNTARY_STATES
        and not bool(frame.get("control", {}).get("shootStart"))
        and not bool(frame.get("control", {}).get("shootHold")),
        lambda frame: f"状态={frame.get('state')}，敌距={distance(frame.get('self', {}).get('pos'), frame.get('target', {}).get('pos')):.1f}",
        "可见敌人未中断任务",
        1_000,
        "critical",
    ))

    # Gas danger mismatch. Dead/waiting samples are excluded.
    report.episodes.extend(contiguous_episodes(
        frames,
        lambda frame: bool((frame.get("gasDecision") or {}).get("danger"))
        and str(frame.get("state")) not in SURVIVAL_STATES | {"waiting"},
        lambda frame: f"危险原因={(frame.get('gasDecision') or {}).get('reason')}，仍处于 {frame.get('state')}",
        "生存危险未接管",
        1_000,
        "critical",
    ))

    # State A-B-A oscillations from compressed sampled timeline.
    compressed: list[tuple[int, str]] = []
    for frame in frames:
        state = str(frame.get("state") or "none")
        if not compressed or compressed[-1][1] != state:
            compressed.append((int(frame["at"]), state))
    oscillations: list[Episode] = []
    for index in range(2, len(compressed)):
        a, b, c = compressed[index - 2 : index + 1]
        if a[1] == c[1] and a[1] != b[1] and c[0] - a[0] <= 2_500:
            oscillations.append(Episode("状态抖动", a[0], c[0], f"{a[1]} → {b[1]} → {c[1]}", "medium"))
    if len(oscillations) > 6:
        report.episodes.extend(oscillations[:8])

    # Add representative recovery events, especially high repeated counts.
    recovery_events = [event for event in events if event.get("type") == "path_recovery_triggered"]
    worst_recovery = sorted(
        recovery_events,
        key=lambda event: (int(event.get("sameTargetRecoveryCount") or 0), int(event.get("level") or 0)),
        reverse=True,
    )[:3]
    for event in worst_recovery:
        if int(event.get("sameTargetRecoveryCount") or 0) < 3 and int(event.get("level") or 0) < 4:
            continue
        report.episodes.append(Episode(
            "重复卡路恢复",
            int(event["at"]),
            int(event["at"]),
            f"目标={event.get('targetKey')}，恢复等级={event.get('level')}，同目标次数={event.get('sameTargetRecoveryCount')}",
            "high",
        ))

    # Scoring is intentionally conservative; it is a review ordering aid, not a
    # claim about win probability.
    score = 100.0
    if first_gun_ms is None:
        score -= 32
    elif first_gun_ms > 30_000:
        score -= min(28, first_gun_ms / 5_000)
    elif first_gun_ms > 15_000:
        score -= 10
    weights = {"critical": 8.0, "high": 4.0, "medium": 1.5}
    for episode in report.episodes:
        score -= weights.get(episode.severity, 1.0)
    score -= min(15, report.recoveries * 0.18)
    report.score = max(0.0, round(score, 1))
    report.episodes.sort(key=lambda episode: (episode.start, episode.kind))
    return report


def discover(root: Path) -> tuple[list[BotReport], dict[str, int]]:
    reports: list[BotReport] = []
    stats = collections.Counter()
    for session_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        manifest_path = session_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        stats["sessions"] += 1
        for match_dir in sorted(session_dir.glob("match-*")):
            stats["match_dirs"] += 1
            match = match_dir.name.removeprefix("match-")
            frames: list[dict[str, Any]] = []
            events: list[dict[str, Any]] = []
            for path in sorted(match_dir.glob("frames-*.jsonl")):
                rows = load_jsonl(path)
                stats["frame_files"] += 1
                stats["frames"] += len(rows)
                frames.extend(rows)
            for path in sorted(match_dir.glob("events-*.jsonl")):
                rows = load_jsonl(path)
                stats["event_files"] += 1
                stats["events"] += len(rows)
                events.extend(rows)
            by_bot: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
            events_by_bot: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
            for frame in frames:
                if frame.get("botId") is not None:
                    by_bot[int(frame["botId"])].append(frame)
            for event in events:
                if event.get("botId") is not None:
                    events_by_bot[int(event["botId"])].append(event)
            for bot_id, bot_frames in sorted(by_bot.items()):
                reports.append(analyze_bot(
                    session_dir.name,
                    match,
                    bot_id,
                    bot_frames,
                    events_by_bot.get(bot_id, []),
                ))
    stats["bots"] = len(reports)
    return reports, dict(stats)


def recommendations(report: BotReport) -> list[str]:
    kinds = {episode.kind for episode in report.episodes}
    recs: list[str] = []
    if "长期无枪" in kinds or "拿枪过慢" in kinds or "拿枪偏慢" in kinds:
        recs.append("出生阶段锁定可达武器；无进展时快速切换资源区，禁止集合任务抢占。")
    if "移动无进展" in kinds or "重复卡路恢复" in kinds:
        recs.append("同一战略目标连续恢复后退避该目标，改走另一入口或重新抽取路线。")
    if "目标追逐过久" in kinds:
        recs.append("对资源目标设置总时限、无进展时限和指数拉黑，避免立即重新选择。")
    if "可见敌人未中断任务" in kinds:
        recs.append("近距离可见敌人应中断送弹、空投、集合和拾取；无枪时先撤离并寻枪。")
    if "生存危险未接管" in kinds:
        recs.append("毒圈/空袭危险使用不可被普通任务覆盖的最高优先级状态。")
    if "状态抖动" in kinds:
        recs.append("增加意图承诺时间与切换边际，并避免目标身份每帧变化。")
    return recs or ["未发现明显长期异常；继续观察战斗命中、掩体选择和资源收益。"]


def write_markdown(reports: list[BotReport], stats: dict[str, int], path: Path) -> None:
    lines: list[str] = []
    lines += [
        "# V28 单 AI 观众视角决策报告",
        "",
        "> 本报告逐行读取全部记录，以工作进程、对局和 botId 作为唯一 AI 标识。评分仅用于排序审查优先级，不代表胜率。",
        "",
        "## 数据完整性",
        "",
        f"- 会话目录：{stats.get('sessions', 0)}",
        f"- 对局目录：{stats.get('match_dirs', 0)}",
        f"- 行为帧：{stats.get('frames', 0):,}",
        f"- 事件：{stats.get('events', 0):,}",
        f"- 有行为帧的 AI：{stats.get('bots', 0)}",
        "",
        "## 总览",
        "",
        "| AI | 模式 | 难度/角色 | 观战评分 | 首次枪械 | 持枪帧 | 卡路恢复 | 主要结论 |",
        "|---|---|---|---:|---:|---:|---:|---|",
    ]
    for report in sorted(reports, key=lambda item: (item.score, item.match, item.bot_id)):
        top = "；".join(episode.kind for episode in report.episodes[:3]) or "未见明显异常"
        lines.append(
            f"| `{report.key}` | {report.mode} | {report.difficulty}/{report.role} | {report.score:.1f}（{report.grade}） | {fmt_ms(report.first_gun_ms)} | {report.armed_ratio:.0%} | {report.recoveries} | {top} |"
        )

    lines += ["", "## 逐个 AI 观战记录", ""]
    for index, report in enumerate(sorted(reports, key=lambda item: (item.match, item.session, item.bot_id)), 1):
        lines += [
            f"### {index}. `{report.key}`",
            "",
            f"- 模式：`{report.mode}`；难度：`{report.difficulty}`；角色：`{report.role}`",
            f"- 记录时长：{fmt_ms(report.duration_ms)}；帧数：{report.frame_count:,}",
            f"- 首次枪械：{fmt_ms(report.first_gun_ms)}；持枪帧占比：{report.armed_ratio:.1%}",
            f"- 状态分布：{dominant(report.states)}",
            f"- 意图分布：{dominant(report.intents)}",
            f"- 卡路恢复：{report.recoveries}；资源放弃：{report.abandons}；送弹：{report.ammo_confirmed}/{report.ammo_sent} 确认",
            f"- 观战结论：**{report.score:.1f} / 100，{report.grade}**",
            "",
        ]
        if report.episodes:
            lines += ["关键时间线：", ""]
            for episode in sorted(report.episodes, key=lambda item: (item.severity != "critical", item.severity != "high", -item.duration))[:12]:
                end_text = rel_time(episode.end, report.start)
                span = rel_time(episode.start, report.start)
                if episode.end != episode.start:
                    span += f"–{end_text}"
                lines.append(f"- `{span}` **{episode.kind}**：{episode.detail}")
        else:
            lines.append("- 未检测到持续时间达到阈值的明显异常。")
        lines += ["", "改进建议：", ""]
        for rec in recommendations(report):
            lines.append(f"- {rec}")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_html(reports: list[BotReport], stats: dict[str, int], path: Path) -> None:
    payload = []
    for report in sorted(reports, key=lambda item: (item.match, item.session, item.bot_id)):
        payload.append({
            "key": report.key,
            "mode": report.mode,
            "difficulty": report.difficulty,
            "role": report.role,
            "score": report.score,
            "grade": report.grade,
            "duration": fmt_ms(report.duration_ms),
            "firstGun": fmt_ms(report.first_gun_ms),
            "armedRatio": f"{report.armed_ratio:.1%}",
            "states": dominant(report.states, 6),
            "intents": dominant(report.intents, 6),
            "recoveries": report.recoveries,
            "abandons": report.abandons,
            "ammo": f"{report.ammo_confirmed}/{report.ammo_sent}",
            "episodes": [
                {
                    "time": rel_time(ep.start, report.start) + (f"–{rel_time(ep.end, report.start)}" if ep.end != ep.start else ""),
                    "kind": ep.kind,
                    "detail": ep.detail,
                    "severity": ep.severity,
                }
                for ep in report.episodes[:18]
            ],
            "recommendations": recommendations(report),
        })
    data = json.dumps(payload, ensure_ascii=False)
    template = f"""<!doctype html>
<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>V28 单 AI 观战报告</title>
<style>
body{{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#101318;color:#e8edf2}}header{{position:sticky;top:0;background:#161b22;padding:16px 22px;border-bottom:1px solid #30363d;z-index:5}}h1{{font-size:20px;margin:0 0 10px}}input,select{{background:#0d1117;color:#e8edf2;border:1px solid #30363d;border-radius:6px;padding:8px;margin-right:8px}}main{{padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}}article{{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px}}.meta{{color:#9da7b3;font-size:13px}}.score{{font-size:24px;font-weight:700}}.critical{{border-left:4px solid #f85149}}.high{{border-left:4px solid #d29922}}.medium{{border-left:4px solid #58a6ff}}li{{margin:7px 0;padding-left:8px}}details{{margin-top:10px}}code{{font-size:12px;color:#79c0ff}}.bad{{color:#ff7b72}}.good{{color:#56d364}}</style></head>
<body><header><h1>V28 单 AI 观众视角报告</h1><div class=\"meta\">{stats.get('bots',0)} 个 AI；{stats.get('frames',0):,} 帧；{stats.get('events',0):,} 事件</div><div style=\"margin-top:10px\"><input id=\"q\" placeholder=\"搜索 bot / 模式 / 问题\"><select id=\"grade\"><option value=\"\">全部等级</option><option>严重异常</option><option>明显异常</option><option>可接受</option><option>稳定</option></select></div></header><main id=\"list\"></main>
<script>const bots={data};const list=document.getElementById('list');function render(){{const q=document.getElementById('q').value.toLowerCase();const grade=document.getElementById('grade').value;list.innerHTML='';for(const b of bots){{const text=JSON.stringify(b).toLowerCase();if(q&&!text.includes(q))continue;if(grade&&b.grade!==grade)continue;const a=document.createElement('article');const cls=b.score<50?'bad':b.score>=85?'good':'';a.innerHTML=`<div class=\"score ${{cls}}\">${{b.score}} / 100 · ${{b.grade}}</div><code>${{b.key}}</code><p class=\"meta\">${{b.mode}} · ${{b.difficulty}}/${{b.role}} · ${{b.duration}}</p><p>首次枪械：${{b.firstGun}}；持枪：${{b.armedRatio}}；恢复：${{b.recoveries}}</p><p class=\"meta\">状态：${{b.states}}<br>意图：${{b.intents}}</p><details open><summary>关键时间线（${{b.episodes.length}}）</summary><ul>${{b.episodes.map(e=>`<li class=\"${{e.severity}}\"><b>${{e.time}} ${{e.kind}}</b>：${{e.detail}}</li>`).join('')||'<li>未检测到持续异常</li>'}}</ul></details><details><summary>改进建议</summary><ul>${{b.recommendations.map(x=>`<li>${{x}}</li>`).join('')}}</ul></details>`;list.appendChild(a);}}}}document.getElementById('q').oninput=render;document.getElementById('grade').onchange=render;render();</script></body></html>"""
    path.write_text(template, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("recording_root", type=Path)
    parser.add_argument("output_prefix", nargs="?", type=Path, default=Path("AI_SPECTATOR_REPORT"))
    args = parser.parse_args()
    if not args.recording_root.is_dir():
        parser.error(f"recording root not found: {args.recording_root}")
    reports, stats = discover(args.recording_root)
    prefix = args.output_prefix
    md = prefix.with_suffix(".md")
    html_path = prefix.with_suffix(".html")
    json_path = prefix.with_suffix(".json")
    write_markdown(reports, stats, md)
    write_html(reports, stats, html_path)
    json_path.write_text(json.dumps({"stats": stats, "bots": [report.__dict__ | {"states": dict(report.states), "intents": dict(report.intents), "episodes": [episode.__dict__ for episode in report.episodes]} for report in reports]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"markdown": str(md), "html": str(html_path), "json": str(json_path), "stats": stats}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
