V260.1 HOTFIX - 绝密搜打撤真人/AI组队隔离

基于 V260 完整项目。

修复：
- 四人/双人搜打撤开启“自动补齐队友”时，真人不会再被分进 BossGuard / smartBot 等 serverBot 小队。
- 真人仍可正常自动补齐真人队友。
- AI 也不能反向占用真人小队空位。
- 保留 V258 共享组队 token 席位预留修复、V259 核爆成就修复、V260 AI 战斗优化。
- 加固破坏性 smoke test：未显式指定安全的 SURVIV_DATA_DIR 时拒绝清理目录。

验证文档：docs/validation/V260_1_EXTRACTION_TEAM_ISOLATION.md
