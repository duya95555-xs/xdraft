# mydraft — UOS Desktop Edition

> **English**: A desktop (Electron) port of [mydraft.cc](https://github.com/mydraft-cc/ui) — the open-source wireframing tool — targeted at UOS / Linux (arm64) and Windows, with offline-first improvements.

mydraft 是一款优秀的开源线框图工具（TypeScript + React + Redux），原项目地址：**https://github.com/mydraft-cc/ui** ，作者 Sebastian Stehle（mydraft.cc），MIT 许可证。

本仓库是个人维护的**桌面增强版**：在原项目基础上完成 Electron 桌面封装、离线化改造与若干功能增强，面向 UOS（arm64）与 Windows 环境。

**致谢与尊重**：本项目的全部基础能力来自原项目 [mydraft-cc/ui](https://github.com/mydraft-cc/ui)，没有他们的开源贡献就没有这个发行版。许可证见 [LICENSE](./LICENSE)（MIT，保留原版权声明）。

---

## 相对上游的主要改动

### 平台与打包
- **Electron 桌面封装**：主进程 / preload 通道、本地静态服务、窗口生命周期管理（含未保存确认的关窗防抖与 5 秒兜底）
- **UOS（arm64）适配**：国产操作系统离线环境的打包与运行支持

### 离线化
- **图标字体内联**：Material Icons / Font Awesome 从 CDN 改为 base64 内联（`src/fonts/`），彻底解决离线启动白屏、图标不显示的问题；导出 PNG 时字体同步写入 SVG `<defs>`，修复导出丢图标
- 附带字体再生成脚本 `tools/fetch-icon-fonts.sh`

### 功能增强
- **流程连线线型**：连线新增「实线 / 虚线 / 点线」样式，颜色与箭头（无 / 单侧 / 双箭头）支持自定义
- 修复选中连线时颜色 / 线宽修改不生效的问题（appearance 修改目标集与变换目标集分离）
- 颜色解析支持 `transparent`

### 缺陷修复
- 修复切换侧栏导致画布视口重置的跳位问题（`hasResetRef` 一次性初始化）
- 修复关窗确认弹窗进行中快速双击标题栏 X 绕过确认直接关窗的竞态
- 导出前等待图标字体加载增加 3 秒超时兜底，避免异常时导出挂死

> 说明：本发行版为**无 AI 模块**的精简线（`1.0.2`），聚焦离线桌面场景。

## 开发与构建

```bash
npm install        # 安装依赖
npm run start      # 浏览器开发模式 (vite)
npm run build      # 生产构建 (tsc + vite build)
```

## 原项目

- 仓库：https://github.com/mydraft-cc/ui
- 在线版：https://mydraft.cc
- 作者：Sebastian Stehle（https://github.com/SebastianStehle）

感谢所有原项目贡献者。
