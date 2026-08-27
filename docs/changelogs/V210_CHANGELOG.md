# V210 仓库多进程一致性（锁 + 读前重载 + 唯一临时文件）

## 问题

生产多进程（API / Game / 房间 worker）各自缓存整份仓库快照并重写同一
JSON：配装保存看不到、撤离后显示旧数据、并发写相互覆盖、共享 .tmp
竞争、失败清 dirty 不重试。

## 修复（server/src/stash/stashManager.ts）

- **跨进程互斥锁**：原子 mkdir 锁目录（带 owner 标记），
  15s stale 检测自动恢复崩溃残留；busy-wait 轮询（最长约 5s）；
- **读前重载**：每次操作前从磁盘读取最新快照
  （API 保存的配装、其他房间的撤离立即可见）；
- **唯一临时文件**：`file.pid.timestamp.tmp` + rename 原子写，
  消除多进程 .tmp 竞争；
- **失败自动重试**：持久化失败保留错误，下次任何写操作自然重写
  （不再清除 dirty）；
- **嵌套安全**：grant→remove 等内部调用不重复加锁/重载，
  避免覆盖外层未落盘修改；
- 移除 300ms debounce，改为每次写操作后立即原子持久化。

## 验证

- 多实例（模拟多进程）并发测试：
  - 第二实例立即可见写入（重载）✓
  - 20 次交替写入不覆盖（bandage/soda 累计正确）✓
  - 无 .tmp 残留 ✓
- server tsc / test:extraction / test:admin / test:all-modes：PASS
