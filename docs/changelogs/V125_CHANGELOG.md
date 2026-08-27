# V125 取消仓库"移除一个"功能

## 需求

- 取消仓库物品卡片上的"移除一个"（×）按钮。

## 实现

- `client/src/extractionStashUi.ts`：
  - `renderRight` 移除 × 按钮。
  - 移除 `.stash-item-remove` 点击处理器与 `removeStashItem()` 函数。
  - 移除物品点击事件里对移除按钮的跳过判断。
- `client/public/css/storage.css`：删除 `.stash-item-remove` 样式。
- `server/src/apiServer.ts`：删除 `/api/extraction/stash/remove` 接口。

## 说明

- 仓库物品仍可通过"右键卸下/放回"管理配装；仓库本身不再有直接移除入口。
- `StashManager.removeItem` 仍保留（内部发放/结算使用）。

## 验证

- client `tsc`、`vite build` 通过；server `tsc` 通过。
- `test:extraction`、`test:admin` 通过。
