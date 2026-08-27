# V116 验证报告

## 变更范围

- client/src/objects/sandevistanPostFilter.ts：增强滤镜效果强度（色差/扭曲/模糊/冷色调），
  保持整体 vec4 采样结构（不黑屏）。

## 自动化测试

- client tsc + vite build：PASS
- test:sandevistan：PASS
- test:v41-suite：PASS

## headless Edge（WebGL2）实测

- 强制激活：技能倒计时 5.0s、蓝调滤镜 active、技能槽可见。
- 激活后真实截图像素分析：black=0.0%、green=96.8% —— 画面正常，无黑屏。
- 对比未激活：black=0.9%、green=86.5%。

## 说明

- 用户侧若仍出现黑屏：先硬刷新（Ctrl+F5）排除旧缓存；
  若与 WebGL1 环境相关，请提供浏览器与 GPU 信息以便复现。