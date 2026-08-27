# 1v1 AI、激素开关与后台观战使用说明

## 功能概览

本版本在原有自定义 1v1 模式上增加：

- 房主可设置开局枪械、护甲、投掷物和初始激素；
- 可关闭激素模式；
- 可在房间内直接启用 AI 对手并选择难度；
- 后台可向未满的 1v1 房间加入 AI；
- 后台可观战任何仍有存活玩家的房间；
- 观战者不占玩家名额，不影响胜负与存活人数。

1v1 仍遵循房间原有规则：出生装备由房主配置，无地面物资流程，无限备用弹药与无限医疗用品由服务器规则提供；木箱、石头和沙袋仅作为战斗环境与掩体。

## 开发模式启动

在项目根目录分别启动服务端与客户端：

```powershell
npm run dev:server
npm run dev:client
```

默认地址：

- 游戏：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin/`
- 游戏服务：`http://localhost:8001/`

## 创建 1v1 + AI 房间

1. 打开游戏页面并进入 1v1 自定义大厅。
2. 选择出生武器、护甲等级与投掷物。
3. 设置“启用激素”。开启时可设置开局数值；关闭时服务器强制为 0。
4. 开启“AI 对手”。
5. 选择简单、普通或困难。
6. 房主点击开始。此时只需要一名真人，服务器会使用第二个房间令牌启动 AI。

AI 使用普通加入协议，不获得服务端内部敌人位置，也不绕过命中、伤害、毒圈、换弹或掩体规则。

## 后台加入 AI

1. 打开 `/admin/` 并登录。
2. 在房间列表找到正在运行的 1v1 房间。
3. 点击“加入AI”。

限制：

- 仅支持 `duel` 地图；
- 房间存活人数必须少于 2；
- 同一房间不能重复启动后台 AI；
- 难度取后台当前设置。

## 后台观战

1. 在后台房间列表点击“观战”。
2. 后台生成一次性、60 秒有效的观战令牌。
3. 新标签页打开游戏客户端并自动加入目标房间。
4. 客户端读取令牌后立即清除地址栏中的敏感参数。

观战者以死亡状态加入，自动跟随一名存活玩家，不增加房间的玩家配额或存活人数。

## 激素关闭的实际语义

关闭激素时由服务器执行：

- 开局 `boost = 0`；
- Soda 数量为 0；
- Painkiller 数量为 0；
- AI 使用 `prohibited` 策略，不尝试使用激素消耗品。

不会通过客户端本地写值来篡改激素，也不会人为增加移动速度。

## 配置文件

`survivio-config.json` 中的 `duel` 配置包括：

```json
{
  "duel": {
    "adrenalineEnabled": true,
    "boost": 100,
    "aiEnabled": false,
    "aiDifficulty": "normal"
  }
}
```

后台保存的默认值会写回该配置文件。

## 生产构建

```powershell
npm install
npm --prefix server install
npm --prefix client install
npm --prefix server run build
npm --prefix client run build
```

也可运行根目录的：

```powershell
.\build-complete.ps1
```

Linux/macOS：

```bash
./build-complete.sh
```

## 安全说明

- 生产环境必须给后台设置强管理员令牌。
- 观战令牌短期有效、一次性使用并绑定目标房间。
- 管理接口仍需管理员令牌认证。
- 不应把真实生产管理员令牌提交到仓库。

## AI 出现 `writeFloat` 越界时

本修复版已经把 AI 的鼠标距离统一限制在协议允许的 `0–64`，并在发送数据包前做最终校验。可运行：

```powershell
npm --prefix server run test:bot-input
```

看到 `SmartBot input safety smoke test passed` 表示输入序列化保护正常。
