# 客户端重新构建

完整工程包内保留了上传项目原有的 `client/dist`。本次新增的主游戏 UI 源码位于：

- `client/index.html`
- `client/src/main.ts`
- `client/src/ui/duelLobby.ts`

管理后台静态文件已经直接同步到 `client/dist/admin/`。

在目标电脑重新安装当前平台依赖并构建：

```powershell
npm install
npm --prefix client install
npm --prefix client run build
```

Linux/macOS：

```bash
npm install
npm --prefix client install
npm --prefix client run build
```

若同时构建服务端：

```bash
npm --prefix server install
npm --prefix server run build
```

原因：Node 的 Rollup 和 Esbuild 包含平台相关的可选二进制。不要把另一操作系统的 `node_modules` 直接作为生产构建依赖使用。
