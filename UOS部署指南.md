# xdraft 1.0.4 — UOS (arm64) 部署指南（GitHub 测试仓库版）

> 测试仓库：https://github.com/duya95555-xs/xdraft-test
> 账号：admin1。整套流程只用 git + npm，不再传压缩包。

---

## 方式一：CI 出 deb 安装包（推荐，最省事）

不用装 Node、不用 npm install，装完即用。

1. **Windows 侧打测试标签**（跟我说一声即可，我来执行）：

   ```bash
   git tag v1.0.4-test.1
   git push origin v1.0.4-test.1
   ```

2. **2~5 分钟后**，浏览器打开仓库 Releases 页下载 arm64 deb：
   `https://github.com/duya95555-xs/xdraft-test/releases`
   （直连慢加前缀：`https://ghproxy.net/https://github.com/...`）

3. **UOS 安装**：

   ```bash
   sudo dpkg -i xdraft_*_arm64.deb
   # 缺依赖就补一下：
   sudo apt -f install
   xdraft        # 启动，或在启动器里搜 xdraft
   ```

> 标签规则：`v1.0.4-test.N`，N 递增（test.2、test.3…）。`v1.0.4` 留给正式仓库，别在测试仓库打。

---

## 方式二：源码开发模式跑（调试 / 逐条改代码用）

```bash
# ① 装 Node 20+（UOS arm64）
sudo apt install -y nodejs npm git
node -v    # 需要 v20 以上

# ② 克隆测试仓库（直连慢就加 ghproxy 前缀）
git clone https://github.com/duya95555-xs/xdraft-test.git
# git clone https://ghproxy.net/https://github.com/duya95555-xs/xdraft-test.git
cd xdraft-test

# ③ 装依赖（首次一次即可；走国内镜像快很多）
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# ④ 跑起来（二选一）
npm run start:full      # 浏览器模式：http://localhost:5173
npm run electron:dev    # 桌面窗口模式
```

**日常同步**（Windows 改完推了，UOS 拉最新）：

```bash
git pull
```

---

## 本次测试重点清单

| 模块 | 验证点 |
|---|---|
| 组合（原 UOS 死机） | 多选 → 组合 → 嵌套组合 → 拖动/改尺寸 → 解组 → 撤销/重做 → 保存后重开 |
| 我的形状 | 右键「添加到我的形状」→ 面板拖拽/双击插入 → 改名/删除 → 重启后还在 |
| 样式记忆 | 改形状样式 → 再拖同类型 → 自动套用 → 「恢复默认样式」可还原 |
| 指定保存目录 | 「最近」面板设置目录 → 保存落盘位置正确 → 重启仍生效 |
| 字号输入 | 属性面板字号可直接敲数字 |
| 日志面板 | 右上角打开 → 全程有记录 → 可复制/下载 |
| 问题输入框 | 顶部输入问题 → 灯泡按钮回看 |

遇到问题：右上角日志面板「复制全部」→ 描述现象发我。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| git clone 超时 | 加 `https://ghproxy.net/` 前缀 |
| npm install 卡在 electron 下载 | 确认 `ELECTRON_MIRROR` 已 export，重跑 `npm install` |
| electron:dev 白屏 | 优先用 `npm run start:full` 浏览器模式排查；详见 README.electron.md |
| 模板库空白 | `templates/` 目录不带在仓库里，需要时把模板数据放到项目根 `templates/` 再跑 `node tools/local-server.mjs`；没有不影响其他功能 |
| deb 装不上 | `sudo apt -f install` 补依赖后重试 |
