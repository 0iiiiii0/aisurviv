# V117 验证报告

## 变更范围

- `client/src/objects/sandevistanPostFilter.ts`：修复 GLSL `clamp()` 尾逗号
  语法错误（shader 编译失败的根因），恢复完整效果与 tint 块。
- `client/src/game.ts`：保留 `resolution = 1`（2x 滤镜纹理在该 renderer 下
  输出损坏），不修改业务逻辑。
- `client/src/main.ts`：移除临时调试钩子 `__survivDbg`。

## 根因结论

GLSL 尾逗号 → shader 编译失败 → 滤镜输出异常 → 激活后只剩草地。
V116 曾把自定义 NDC vertex 当作修复，实际属于过度修复，会缩小采样区域；
本次同时恢复默认 vertex shader。

## 自动化测试

- client tsc --noEmit：PASS
- client vite build：PASS
- test:sandevistan：PASS
- test:v41-suite：PASS

## headless Edge（WebGL2）实测

- 进入真实 Normal 单人对局，强制激活斯安威斯坦（调试钩子验证期间）：
  - 未激活：green=79.8%、other=19.2%
  - 激活后：green=68.2%、other=31.8%（树/房子/标线可见，带冷色调滤镜）
  - 修复前对照：green=96.5%、other=3.5%（只剩草地）
- 激活时 uAmount=1.0、stage filters 挂载、技能倒计时 5.0s 生效。
- console 无 "Could not initialize shader" / GLSL 编译错误。

## 说明

- 动态修改 `filter.resolution`（运行期）会损坏该 renderer 的滤镜状态，
  生产代码只在构造时设置一次，不受影响。
- 测试环境服务器偶发重启导致部分自动化进房失败，属测试环境问题，
  与本次滤镜修复无关。
