# V156 搜打撤剩余 2 分 30 秒提醒

## 需求

对局剩余时间到达 2 分 30 秒时提醒玩家（尽快撤离）。

## 实现

### 共享常量（shared/defs/extractionDefs.ts）
- 新增 `EXTRACTION_TIME_WARNING_SECONDS = 150`（2 分 30 秒），
  与时限 600 秒并列，便于统一调整。

### 客户端（client/src/game.ts）
- 新增 `matchTimeReminderShown` 标记；
- 倒计时更新时，剩余时间首次 ≤150 秒触发一次屏幕中央公告：
  「对局剩余 2 分 30 秒，请尽快撤离！」（复用现有
  `displayAnnouncement` 淡入/停留/淡出效果）；
- 未开局（未收到 MatchTime）时重置标记，保证每局只提醒一次；
- 既有倒计时条（MM:SS）与最后 60 秒变红逻辑保持不变。

## 验证

- client tsc + vite build：PASS
- server tsc / test:extraction（solo/duo/squad 集成）：PASS
- 提醒只在搜打撤模式、对局中、玩家视角下触发（沿用
  `updateExtraction` 的模式/观战守卫）
