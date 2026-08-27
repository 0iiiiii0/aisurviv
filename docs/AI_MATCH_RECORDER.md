# AI 对局记录器

本版本默认启用本地 AI 对局记录。记录器只保存服务器 AI 已经获得的信息、AI 的决策输出以及地图消息，不会上传任何内容。

## 保存位置

正常从 `server` 目录启动时，文件保存在：

```text
server/ai-match-recordings/<时间_pid>/
```

每个会话目录包含：

```text
manifest.json
README.txt
match-<对局ID>/
  map.json
  events-001.jsonl
  frames-001.jsonl
```

- `map.json`：地图名称、种子、尺寸、河流、地点、静态物体和地面区域。
- `events-*.jsonl`：AI 状态/意图切换、隐藏目标、受伤、投掷、盲射和比赛结束事件。
- `frames-*.jsonl`：周期采样的 AI 位置、生命、武器、移动、瞄准、目标记忆、附近玩家、障碍物、烟雾、毒圈和空袭信息。

返回记录时，请压缩并发送整个时间会话目录，不要只发送其中一个 JSONL 文件。

## 配置

| 环境变量 | 默认值 | 作用 |
|---|---:|---|
| `BOT_MATCH_RECORDING` | `1` | 设为 `0` 关闭记录器。 |
| `BOT_RECORD_DIR` | `./ai-match-recordings` | 修改本地保存目录。 |
| `BOT_RECORD_SAMPLE_MS` | `500` | 行为帧采样间隔，范围 100–5000 毫秒。 |
| `BOT_RECORD_PART_MB` | `64` | 单个 JSONL 分卷大小，范围 4–1024 MB。 |

记录目录已加入 `.gitignore`，不会被普通 Git 提交意外上传。

## 遮蔽物战术记录重点

分析烟雾、灌木、厕所和集装箱问题时，重点提供：

- `hidden_contact_selected`
- `concealment_grenade_queued`
- `throw_released`
- `concealment_fire_burst`
- `damage_taken`
- 对应时间附近的 `frames-*.jsonl`

AI 只根据目标最后一次可见位置、进入方向和区域范围做判断。目标隐藏后，记录器不会向普通 AI 提供实时隐藏坐标。
