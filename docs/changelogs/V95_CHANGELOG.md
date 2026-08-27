# V95 修复：地图渲染异常 / 中键无响应 / 旧键位不生效

## 问题

1. 未开启斯安威斯坦时地图渲染出现异常（V94 把后处理滤镜常驻挂在
   PIXI stage 上，Canvas 渲染器不支持 Filter，且常驻离屏渲染本身有风险）。
2. 鼠标中键激活无响应。
3. 用户端按键绑定未生效（旧存档覆盖新默认）。

## 修复

### 1. 地图渲染异常（client/src/game.ts + sandevistanFx.ts）
- 后处理滤镜改为**仅在激活期间挂载**到 stage：`uAmount` 从 0 升时挂载、
  归零时自动卸载；空闲时 stage 无任何滤镜，恢复正常渲染。
- **Canvas 渲染器不创建滤镜**（`renderer.type !== WEBGL` 时
  `postFilter = null`），只有 WebGL 且 `qualityLevel > 0` 才启用后处理；
  残影/闪光/收束等 Sprite 特效在两种渲染器下均正常。
- fx.reset / game.free 时显式卸载 stage 滤镜。

### 2. 鼠标中键无响应（client/src/input.ts）
- `onMouseDown` 对中键（button==1）调用 `preventDefault()`，
  阻止浏览器自动滚动手势，确保中键作为游戏按键可靠触发。

### 3. 旧键位不生效（client/src/inputBinds.ts）
- 旧版本保存的按键布局（base64）比当前按键目录短，新增按键
  （Sandevistan）加载后为空导致中键无效。
- `fromArray` 解析旧布局后，把**新增枚举**（`parsedCount` 之后的绑定）
  自动填充为默认值（Sandevistan → 鼠标中键），无需手动恢复默认。

## 测试

- client / server 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。