# V197 修复示例人物区域只显示一片水

## 问题

仓库示例人物区域只看到地图水面，人物不可见。

## 根因

独立页面只加载了 **loadout** 贴图集；LoadoutDisplay 的地图
（main）与玩家渲染还依赖 **main / shared 等其它 atlas**，
纹理缺失导致地图地面异常显示为水面颜色、人物部件缺失。

## 修复（client/src/storage.ts）

- `loadLoadoutAtlas` → `loadAllAtlases`：加载 `fullResAtlasDefs` 的
  **全部 12 个贴图集**（loadout / shared / main / potato / desert /
  woods / snow / faction / halloween / cobalt / savannah / gradient）；
- 加载完成后再初始化 LoadoutDisplay，保证玩家与地图纹理齐全。

## 验证

- client tsc + vite build：PASS
- 地图与人物纹理完整，不再出现水面/缺失现象
