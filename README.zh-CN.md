# xdraft

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F.svg)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#打包)

[English](./README.md) | **简体中文**

xdraft 是基于开源线框图工具 [mydraft.cc](https://mydraft.cc)（作者 Sebastian Stehle，仓库 [mydraft-cc/ui](https://github.com/mydraft-cc/ui)）二次开发的版本：Electron 桌面封装 + 离线优先改造，可运行于 **Windows、Linux（x64 / arm64，含 UOS、Deepin 等国产系统）与 macOS**。

> **致谢与尊重**：本项目的全部基础能力来自原开源项目 [mydraft-cc/ui](https://github.com/mydraft-cc/ui)（MIT 许可证）。这是由 [@YOUR_NAME](https://github.com/YOUR_NAME) 个人维护的**非官方**发行版，与原项目及其作者无关联、未获其背书；mydraft 名称与品牌归原权利人所有。

![xdraft 编辑器](./docs/screenshot.png)

## 功能特性

- **桌面应用** —— Windows（NSIS 安装包 / 便携版）、Linux（deb / AppImage）、macOS（dmg，见下文）
- **离线优先** —— 图标字体（Font Awesome / Material Icons）以 base64 内联进应用：零 CDN 请求，离线机器不白屏、图标不丢失；导出 PNG 时字体 CSS 同步写入 SVG，导出结果同样完整
- **流程连线增强** —— 线型（实线 / 虚线 / 点线）、自定义颜色、箭头样式（无 / 单侧 / 双箭头）
- **UOS 友好** —— 提供 `slim-build.sh` 精简打包脚本，针对 UOS 等 Debian 系 arm64 系统优化体积
- 保留原工具全部线框能力：形状库、图标面板、导出 PNG / HTML、中英文界面

## 开发

需要 Node.js ≥ 18。

```bash
npm install            # 安装依赖
npm run start          # 浏览器开发模式 (vite)
npm run electron:dev   # 桌面开发模式 (vite + electron)
npm run build          # 生产构建 (tsc + vite)
```

> 离线 / 弱网环境：`npm install` 前 set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，避免 Electron 二进制下载缓慢或失败。

## 打包

| 平台 | 命令 | 产物 |
|---|---|---|
| Linux arm64（UOS / Deepin） | `npm run electron:build:linux-arm64` 或 `bash slim-build.sh` | deb（xz 重压缩） |
| Linux x64 | `npm run electron:build:linux-x64` | deb |
| Windows | `npm run electron:build:win` | NSIS 安装包 / 便携版 |
| macOS | `npx electron-builder --mac` | dmg |

说明：

- `slim-build.sh` 会先重新生成内联图标字体数据，再以不打包 `node_modules` 的方式构建，并用 `xz -9` 重压 deb —— **UOS 上推荐走这条路径**。
- macOS 暂无专用 npm script：先 `ELECTRON=true npm run build`，再 `npx electron-builder --mac`。需要的话可在 `electron-builder-optimized.yml` 补 `mac`（dmg target）配置。
- 构建产物输出到 `release-slim/`（见 `electron-builder-optimized.yml`）。

## 许可证

[MIT](./LICENSE) —— 版权 (c) mydraft.cc (Sebastian Stehle) and contributors，以及 (c) 2026 YOUR_NAME（xdraft edition）。
