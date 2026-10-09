# mydraft.cc 桌面版 - UOS ARM64 安装包构建与部署

本文档说明如何将 mydraft.cc 原型编辑器打包为 Electron 桌面应用，并部署到 UOS ARM64 系统。

## 一、目录结构

新增文件：

```
mydraft-ui/
├── electron/
│   ├── main.js          # Electron 主进程
│   ├── preload.js       # 预加载脚本（桥接渲染进程与 Node.js）
│   └── icon.png         # 应用图标（1024x1024）
├── package.json         # 已添加 electron、electron-builder、build 配置
├── vite.config.ts       # 已添加 Electron 构建模式（base + outDir）
└── README.electron.md   # 本文档
```

## 二、构建配置说明

### 2.1 package.json 关键配置

- `"main": "electron/main.js"` - Electron 入口文件
- `scripts.electron:dev` - 本地开发（vite + electron 联调）
- `scripts.electron:build:linux-arm64` - 构建 linux-arm64 平台产物
- `build` 字段 - electron-builder 配置，目标格式为 `AppImage`、`deb`、`rpm`

### 2.2 Vite 适配原理

Electron 使用 `file://` 协议加载本地文件，不能使用绝对路径 `/assets/xxx.js`。
在 `vite.config.ts` 中通过环境变量 `ELECTRON=true` 切换：

| 模式 | base   | outDir         | 协议       |
|------|--------|----------------|-----------|
| Web  | `/`    | `dist`         | http://   |
| Electron | `./` | `dist-electron` | file:// |

### 2.3 依赖

- `electron@^35` - 使用内置 Chromium 的桌面运行时
- `electron-builder@^26` - 打包为 AppImage / deb / rpm
- `cross-env@^7` - 跨平台环境变量设定
- `concurrently@^9` - 开发模式并行启动 vite + electron
- `wait-on@^9` - 开发模式等待 vite 就绪后再启动 electron

### 2.4 electron-builder 配置要点（易踩，26.x 起）

electron-builder 26 的配置是**严格 schema 校验**，字段写错会直接抛
`Invalid configuration object ... does not match the API schema`。已踩过的坑：

- **`linux.desktop` 必须是嵌套形式**：

  ```json
  "desktop": { "entry": { "Name": "mydraft", "Comment": "Diagram editor" } }
  ```

  写成平铺的 `"desktop": { "Name": ... }` 会校验失败（`configuration.linux.desktop` 报错）。
  其中 `Name` 默认取 `productName`、`Comment` 由 `description` 自动生成、
  `Categories` 由 `linux.category` 自动生成，都不需要在 `desktop.entry` 里重复写。
  另外**不要**在 `desktop.entry` 里写 `Exec`（会直接抛错），
  要改可执行文件名请用 `linux.executableName`。

- **不要写 `linux.arch`**。electron-builder 没有这个字段，架构由命令行指定：
  `electron-builder --linux --arm64`（或使用 `linux.defaultArch`）。
  写了会报 `configuration.linux` 校验失败。

- **`package.json` 顶层必须有 `description`、`homepage`、`author.email`**，
  否则打 deb/rpm 时 fpm 元数据校验会失败：
  `Please specify project homepage` / `Please specify author 'email'`。

- **窗口关联（消除 `desktopName is not set` 警告）**：Electron 会把 `package.json`
  顶层的 `desktopName` 当作窗口的 app_id / WM_CLASS，若缺失，桌面环境的任务栏/启动器
  无法把运行中的窗口与 `.desktop` 条目对应起来（表现为图标不对、多出一个孤立条目）。
  本项目已设置：

  ```json
  // package.json 顶层
  "desktopName": "mydraft.desktop",
  // build.linux 内
  "syncDesktopName": true
  ```

  `syncDesktopName` 让安装后的 `.desktop` 文件名与 `StartupWMClass` / Electron 的
  app_id 保持一致（26.x 默认为 `false`，v27 会默认 `true`）。
  `desktopName` 只能是纯文件名，**不要带路径分隔符**（会抛
  `produces an invalid .desktop filename`）。

- **fpm / AppImage 工具链不需要自己装**，electron-builder 会自动从
  `electron-userland/electron-builder-binaries` 下载（因此要配镜像）。
  只有 `rpm` 目标需要系统装 `rpm` 包（提供 `rpmbuild`）。

## 三、本地开发预览

```bash
npm install
npm run electron:dev
```

Vite dev server 在 `localhost:5173` 启动，Electron 窗口自动加载该地址。

## 四、构建 UOS ARM64 安装包

### 4.1 环境要求

- **操作系统**：Linux ARM64（因为 Electron-builder 不能跨平台打包到不同架构）
  - UOS ARM64 本身
  - 或 ARM64 服务器/虚拟机/树莓派 5
  - 或在 x64 机器上用 Docker + QEMU 用户态模拟
- **Node.js 20.19+ 或 22.12+（推荐 24 LTS），npm >= 9**
  - 本项目依赖 Vite 7，其硬性要求为 Node 20.19+ / 22.12+。
    **Node 18 会在 `npm run build` 阶段被 Vite 直接拒绝**，请勿安装。
  - 若系统未装 Node，可下载官方 arm64 预编译包：
    `curl -LO https://cdn.npmmirror.com/binaries/node/v24.21.0/node-v24.21.0-linux-arm64.tar.xz`
    `sudo tar -xJf node-v24.21.0-linux-arm64.tar.xz -C /usr/local --strip-components=1`
- **运行时不依赖额外系统库**（Electron 自带 Chromium、Node.js、V8）
- **打包工具链**：deb/AppImage 用的 `fpm` 与 AppImage 工具由 electron-builder
  自动下载，无需手工安装；**只有 `rpm` 目标需要系统装 `rpm`**（提供 `rpmbuild`）：
  `sudo apt install -y rpm`（只出 AppImage / deb 则完全不需要）

### 4.2 完整构建命令

```bash
# 1. 进入代码目录（如果是从 mydraft-deploy.zip 解压的，就是 ~/mydraft）
cd ~/mydraft

# 2. 配国内镜像（否则 electron / electron-builder 二进制会从 GitHub 龟速下载）
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1   # playwright 只是测试用，跳过浏览器下载

# 3. 安装依赖
npm install

# 4. 构建 electron 产物并打包
npm run electron:build:linux-arm64
```

> 若只想要 AppImage + deb、不装 rpm 工具链，可把第 4 步换成：
> `ELECTRON=true npm run build && npx electron-builder --linux AppImage deb --arm64`

构建产物输出到 `release/` 目录：

| 文件名                                  | 格式      | 说明                       |
|-----------------------------------------|-----------|---------------------------|
| `mydraft-1.0.0-arm64.AppImage`          | AppImage  | 免安装，双击运行            |
| `mydraft_1.0.0_arm64.deb`               | DEB       | UOS / Debian / Ubuntu 包   |
| `mydraft-1.0.0.arm64.rpm`               | RPM       | CentOS / openEuler 包      |
| `linux-arm64-unpacked/`                 | 目录      | 解压后的全部文件            |

### 4.3 仅打包不下载 Electron（离线构建）

如果已预下载 Electron 二进制到缓存目录，可跳过下载：

```bash
# 离线模式
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm run electron:build:linux-arm64
```

### 4.4 使用 Docker + QEMU 在 x64 机器交叉编译

```bash
# 启用 ARM64 用户态模拟
docker run --rm --platform linux/arm64 \
  -v "$PWD":/project -w /project \
  -e ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  -e ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  node:24 \
  bash -c "npm config set registry https://registry.npmmirror.com && apt-get update && apt-get install -y rpm fakeroot dpkg && npm install && npm run electron:build:linux-arm64"
```

## 五、UOS 系统部署

### 5.1 AppImage 安装（推荐，最简单）

```bash
# 1. 复制到 UOS 机器
scp release/mydraft-1.0.0-arm64.AppImage user@uos:~/

# 2. 在 UOS 终端中授权并运行
chmod +x mydraft-1.0.0-arm64.AppImage
./mydraft-1.0.0-arm64.AppImage
```

#### 可选：集成到启动器

```bash
# 复制到应用程序目录
mkdir -p ~/.local/share/applications
cp mydraft-1.0.0-arm64.AppImage ~/.local/bin/mydraft

# 创建 desktop 条目
cat > ~/.local/share/applications/mydraft.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=mydraft
Comment=Diagram Editor
Exec=/home/用户名/.local/bin/mydraft/mydraft-1.0.0-arm64.AppImage
Icon=/home/用户名/.local/share/icons/mydraft.png
Categories=Graphics;
EOF

# 复制图标
mkdir -p ~/.local/share/icons
cp electron/icon.png ~/.local/share/icons/mydraft.png
```

### 5.2 deb 包安装（适合系统级部署）

```bash
# 1. 复制到 UOS 机器
scp release/mydraft_1.0.0_arm64.deb user@uos:~/

# 2. 在 UOS 终端中安装
sudo dpkg -i mydraft_1.0.0_arm64.deb
# 如有依赖缺失：
sudo apt-get install -f

# 3. 启动 mydraft
mydraft
# 或在启动器菜单中搜索 "mydraft" 点击运行
```

#### 卸载

```bash
sudo apt remove mydraft
```

### 5.3 离线部署注意事项

UOS 无网络环境下应用首次启动时，确保以下文件已被正确打包进 Electron：

- Google Material Icons 字体（已提前构建在 `dist-electron/` 内）
- FontAwesome 图标（同上）
- React 应用 bundle（同上）

本应用打包后**无需网络连接**即可完整离线运行。

## 六、UOS 兼容性与系统依赖

### 6.1 Electron 35 预编译二进制所需的最低系统库

| 库              | UOS 已内置 | 最低版本       |
|-----------------|-----------|---------------|
| glibc           | 是        | 2.31          |
| libgtk-3        | 是        | 3.24          |
| libnotify       | 是        | 0.7           |
| libnss3         | 是        | 3.49          |
| libxtst         | 是        | 1.2.3         |
| xdg-utils       | 是        | 1.1.3         |

UOS ARM64 满足以上全部要求。

### 6.2 启动失败排查

```bash
# 查看详细启动日志
./mydraft-1.0.0-arm64.AppImage --enable-logging

# 强制使用软件渲染（若 GPU 兼容问题）
./mydraft-1.0.0-arm64.AppImage --disable-gpu

# 检查依赖完整性
ldd release/linux-arm64-unpacked/mydraft | grep "not found"
```

### 6.3 UOS 安全策略

若 UOS「安全中心」拦截应用执行：

1. 系统设置 → 应用安全 → 允许未签名应用
2. 或右键安装包 → 属性 → 权限 → 允许执行

## 七、迁移到 UOS 主机的文件清单

不要直接拷贝整个工程目录（`node_modules`、`dist`、`release`、`.git` 等都很大且无用）。应该发送一个只含**源码 + 构建脚本 + 配置**的精简部署包。

### 7.1 制作部署包

工程已提供 `deploy-to-uos.ps1` 脚本（Windows PowerShell）自动打 zip：

```powershell
.\deploy-to-uos.ps1
```

输出 `release/mydraft-deploy.zip`，通常只有 10-30 MB。

### 7.2 手动打包（如果不用脚本）

把以下内容拷贝到同一个 zip 中：

**顶层文件（全部）：**

```
index.html
package.json
package-lock.json
vite.config.ts
vitest.config.ts
tsconfig.json
tsconfig.node.json
.env
README.electron.md
```

**顶层目录（整体保留）：**

```
electron/        （main.js、preload.js、icon.png、mydraft.desktop）
src/             （但排除 *.spec.ts、*.stories.tsx 等测试/演示文件）
public/          （静态资源：favicon、logo 等）
```

### 7.3 必须排除的内容

| 路径/文件模式 | 原因 |
|---|---|
| `node_modules/` | 平台特定（Windows 装的无法在 UOS arm64 运行），目标机器需要 `npm install` 重新生成 |
| `dist/`、`dist-electron/`、`release/` | 构建产物，目标机会重新生成 |
| `.git/` | 版本控制数据 |
| `*/\.storybook/`、`docs/`、`screenshots/` | 文档与演示，与构建无关 |
| `*.spec.ts(x)`、`*.stories.tsx` | 测试文件，不参与应用运行 |
| `coverage/`、`.eslintcache` | 缓存与覆盖率输出 |
| `orbita/`（如存在） | 临时工程目录 |

**`package-lock.json` 必须带去**，它会锁定依赖版本，确保 UOS 上构建产物与本地一致。

### 7.4 scp 传到 UOS 并构建

```bash
# 1. 发送
scp release/mydraft-deploy.zip user@uos-host:~/

# 2. 在 UOS 上解压
ssh user@uos-host
unzip mydraft-deploy.zip -d ~/mydraft && cd ~/mydraft

# 3. 确认 Node 已就绪（未装则按 §4.1 安装）
node -v && npm -v                    # 需 >= 20.19 / 22.12，推荐 24.x

# 4. 配镜像并安装依赖
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install                          # 会在 arm64 下安装正确平台依赖

# 5. 打包
npm run electron:build:linux-arm64   # 产出 AppImage / deb / rpm
```

构建产物在 `release/` 目录，AppImage 双击即可运行，deb 用 `dpkg -i` 安装。

### 7.5 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `npm：未找到命令` | 机器上没装 Node.js | 按 §4.1 装 Node 24 LTS |
| Vite 报 `requires Node.js version 20.19+ / 22.12+` | 装了 Node 18 | 升级到 Node 24 LTS |
| electron-builder 报 `configuration.linux` 校验失败 | 写了 `linux.arch` 这类不存在的字段 | 删掉 `arch`，架构用命令行 `--arm64` 指定，见 §2.4 |
| electron-builder 报 `configuration.linux.desktop` 校验失败 | `linux.desktop` 写成平铺形式 | 改成 `{"entry": {...}}`，见 §2.4 |
| deb/rpm 报 `Please specify project homepage` / `Please specify author 'email'` | `package.json` 缺 `homepage` / `author.email` | 补齐这两个字段，见 §2.4 |
| 启动显示空白（**三个独立原因，都要排除**） | ① 主进程没找到 `dist-electron/index.html`：产物缺失，或路径拼错；② `file://` 下用了 `BrowserRouter`；③ 外链图标字体样式表阻塞首帧（离线/被墙时） | ① 确认 `npm run build` 成功；`electron/main.js` 必须写 `path.join(__dirname, '..', 'dist-electron', 'index.html')`（asar 内 `electron/` 与 `dist-electron/` 是同级目录）；② `src/index.tsx` 的 `AppRouter` 在 `file://` 下自动切换为 `HashRouter`，见 §7.6；③ 见 §7.7 |
| `shared library not found` | 系统缺少 .so | 安装对应 apt 包 |
| **AppImage 启动报 `error while loading shared libraries: libz.so`** | **arm64 上 AppImage 运行时的固有缺陷**：它链接的是不带版本号的 `libz.so`，而系统只装了 `libz.so.1`（`libz.so` 属于 `zlib1g-dev`） | 见 §7.8。**deb 完全不受影响**，最省事的做法是直接用 deb |
| AppImage 不启动 | FUSE 不可用 | 装 `libfuse2`，或加 `--appimage-extract-and-run` 解压运行 |
| 打 rpm 报缺 rpmbuild | 未装 rpm 包 | `sudo apt install -y rpm`（deb/AppImage 不需要系统工具） |
| 任务栏图标不对 / 启动器里出现重复条目 | 缺 `desktopName`，窗口的 WM_CLASS 与 `.desktop` 里的 `StartupWMClass` 不一致 | 设 `package.json` 顶层 `desktopName` + `build.linux.syncDesktopName: true`，见 §2.4 |
| 无法拖拽添加组件 | Electron 漏传 drag event | 见 preload.js，如有需要暴露对应 API |

### 7.6 白屏的第二个原因：`file://` 下不能用 BrowserRouter

这一条**不会报错**，所以最难查。现象：窗口能打开、纯白、控制台干净。

原因：`BrowserRouter` 直接读 `window.location.pathname`。打包后页面地址是

```
file:///home/.../resources/app.asar/dist-electron/index.html
```

于是 pathname 变成了这一长串磁盘路径，而路由只声明了 `/:token?`（一段），
**匹配不上 → `<Routes>` 渲染 null → 整页空白**。
另外在 `file://` 下 `history.pushState/replaceState` 还可能因 origin 为 `null` 抛 `SecurityError`。

处理：`src/index.tsx` 里按协议切换路由器，网页版不受影响。

```tsx
function AppRouter({ children }: { children: ReactNode }) {
    if (window.location.protocol === 'file:') {
        return <HashRouter>{children}</HashRouter>;   // 路径放进 # 后面
    }
    return <BrowserRouter>{children}</BrowserRouter>; // 网页版保持原 URL
}
```

**排查这类"静默白屏"的手段**：主进程里已加好日志转发（`electron/main.js`），
用终端启动即可看到渲染进程的 warning/error；要 DevTools：

```bash
MYDRAFT_DEBUG=1 ./release/mydraft-1.0.0-arm64.AppImage
```

### 7.7 白屏的第三个原因：外链图标字体阻塞首帧

`index.html` 里引了两张公共 CDN 的图标字体样式表（Material Icons、Font Awesome）。应用的图标（图标面板、
画布上放的图标）都是 `<i class="...">` 字体图标，**不能直接删掉这两个链接**。

但 `<link rel="stylesheet">` 属于**渲染阻塞**资源：打包后页面走 `file://`，机器一旦离线或被墙，
请求会长时间挂着，首帧就一直不出来 —— 表现和路由问题一样是"启动后白屏"，区别是它会**等很久之后自己出现**。

处理：两张表加 `data-deferred-css` + `media="print"`，先异步下载不阻塞渲染，
再由 `src/index.tsx` 在应用启动时把 `media` 切回 `all`：

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" data-deferred-css media="print">
```

```ts
for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-deferred-css]'))) {
    link.media = 'all';
}
```

代价只有一条：图标面板里的图标会稍晚一点出现。

> **彻底摆脱外网的做法**：把这两份字体下载到 `public/`（Google 的 `material-icons.woff2`、
> Font Awesome 的 `font-awesome.min.css` + `fontawesome-webfont.woff2`），把 `<link>` 改成站内相对路径。
> 有网的机器上 `curl -L -O <url>` 拉一次即可，之后离线也能正常显示图标。

**另外加了"启动看门狗"**（`index.html`，只在 `file://` 下生效，网页版不受影响）：
12 秒后若 `#root-layout` 仍为空，就把地址、协议、以及捕获到的脚本/资源加载错误**直接写在页面上**。
以后再遇到白屏，截一张窗口图就能定位，不必连 DevTools。

### 7.8 AppImage 在 arm64 上报 `libz.so` 缺失（与代码无关）

```
./mydraft-1.0.0-arm64.AppImage: error while loading shared libraries:
libz.so: cannot open shared object file: No such file or directory
```

**这不是我们打包出来的应用的错，也不是白屏问题**，而是 arm64 AppImage 运行时的固有缺陷：
运行时 ELF 的依赖项写的是**不带版本号**的 `libz.so`，而 Debian / UOS 上
`zlib1g` 只提供 `libz.so.1`，`libz.so` 这个开发用软链属于 `zlib1g-dev`。
x86_64 版运行时没这个问题，所以只在 arm64 上遇到（AppImageKit 已知问题 #1092）。

> **它发生在应用代码运行之前** —— 外壳都没起来，所以 `--appimage-extract-and-run`
> 也救不了（这个参数同样由运行时处理）。`libfuse2` 是另一回事，别混淆。

三种处理，任选一种：

```bash
# ① 推荐：装上开发包（会带 /usr/lib/aarch64-linux-gnu/libz.so）
sudo apt install -y zlib1g-dev

# ② 不联网 / 不想装整个 dev 包：手工建软链
sudo ln -s /usr/lib/aarch64-linux-gnu/libz.so.1 /usr/lib/aarch64-linux-gnu/libz.so

# ③ 完全不动系统（免 sudo）：本地造一个软链目录，让 ld.so 去找
mkdir -p ~/.local/libzfix
ln -sf /usr/lib/aarch64-linux-gnu/libz.so.1 ~/.local/libzfix/libz.so
LD_LIBRARY_PATH=~/.local/libzfix ./mydraft-1.0.0-arm64.AppImage
```

**对本项目最重要的一条**：`deb` 包**不需要** `libz.so`，完全不受这个问题影响。
所以给 arm64 机器分发时，**优先给 deb**；AppImage 只作为"免安装试用"的备选，
并在交付说明里附上上面这段。


## 八、文件清单

打包后交付物：

```
release/
├── mydraft_1.0.0_arm64.deb         # UOS / Deepin / Debian 系（arm64 首选，无需 libz.so）
├── mydraft-1.0.0-arm64.AppImage    # 免安装试用（arm64 上需先补 libz.so，见 §7.8）
├── mydraft-1.0.0.aarch64.rpm       # CentOS/openEuler 包
├── linux-arm64-unpacked/           # 解压目录，可直接跑 ./mydraft（含排查用）
└── builder-effective-config.yaml   # 构建配置记录
```

> **包名由 `package.json` 的 `name` 字段决定**（当前为 `mydraft`）。
> deb / rpm 的文件名与安装后的包名都取自它，所以卸载是
> `sudo apt remove mydraft`；若把 `name` 改回 `mydraft.cc`，卸载命令也要跟着带上 `.cc`。
> 注意 AppImage 的文件名走的是 `productName`，与 `name` 无关。
> rpm 的架构后缀是 `aarch64`（不是 `arm64`）。

---
*© Sebastian Stehle. All rights reserved. 本桌面版基于 mydraft.cc 构建*
