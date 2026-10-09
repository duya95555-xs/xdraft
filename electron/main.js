// xdraft Electron 主进程 (based on mydraft.cc)
// 负责创建窗口、加载应用、处理应用级事件

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

// ── 品牌更名兼容 ────────────────────────────────────────────────────────────
// 产品从 mydraft 更名 xdraft 后, Electron 会把 userData 目录切到
// ~/.config/xdraft (跟随 productName), 老用户已保存的本机文档
// (~/.config/mydraft/diagrams) 会"消失"。这里显式把 userData 固定在
// 历史目录: 数据零迁移、旧文档继续可见。
app.setPath('userData', path.join(app.getPath('appData'), 'mydraft'));

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;

// ── 本机文档存储 ────────────────────────────────────────────────────────────
// 以前"保存到本地目录"走的是渲染进程里的 fetch('/api/diagrams/<name>'), 那条相对路径
// 只靠 vite 的 dev proxy 转发到 127.0.0.1:8901; 打包版是 file:// 协议, 会被解析成
// file:///api/diagrams/... 直接抛 Failed to fetch。改由主进程落盘, 真正离线可用。

function getDiagramsDir() {
    return path.join(app.getPath('userData'), 'diagrams');
}

async function ensureDiagramsDir() {
    const dir = getDiagramsDir();

    await fsp.mkdir(dir, { recursive: true });

    return dir;
}

// 与渲染进程的 sanitizeFileName 保持同一套规则; 再叠一层 path.basename 防目录穿越。
function sanitizeName(name) {
    const cleaned = String(name ?? '').trim().replace(/[\\/:*?"<>|]/g, '-');

    return path.basename(cleaned.length > 0 ? cleaned : 'diagram');
}

function resolveDiagramPath(name) {
    return path.join(getDiagramsDir(), `${sanitizeName(name)}.json`);
}

// 先写临时文件再 rename: 写一半被打断也不会留下半个 JSON 覆盖掉好文件。
async function writeJsonAtomic(filePath, body) {
    const text = JSON.stringify(body, undefined, 4);
    const tmp = `${filePath}.tmp`;

    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, filePath);

    return Buffer.byteLength(text);
}

function registerIpcHandlers() {
    ipcMain.handle('xdraft:diagram:list', async () => {
        try {
            const dir = await ensureDiagramsDir();
            const entries = await fsp.readdir(dir);
            const result = [];

            for (const entry of entries) {
                if (!entry.toLowerCase().endsWith('.json')) {
                    continue;
                }

                try {
                    const stat = await fsp.stat(path.join(dir, entry));

                    if (stat.isFile()) {
                        result.push({ name: entry.slice(0, -5), savedAt: stat.mtimeMs, bytes: stat.size });
                    }
                } catch {
                    // 单个文件读不到就跳过, 不要让整次列表失败。
                }
            }

            result.sort((lhs, rhs) => rhs.savedAt - lhs.savedAt);

            return result;
        } catch (ex) {
            console.error('[xdraft] 列出本机文档失败:', ex);

            return [];
        }
    });

    ipcMain.handle('xdraft:diagram:read', async (_event, name) => {
        const text = await fsp.readFile(resolveDiagramPath(name), 'utf8');

        return { name: sanitizeName(name), stored: JSON.parse(text) };
    });

    ipcMain.handle('xdraft:diagram:write', async (_event, name, body) => {
        await ensureDiagramsDir();

        const safe = sanitizeName(name);
        const bytes = await writeJsonAtomic(resolveDiagramPath(safe), body);

        return { file: `local://${safe}`, name: safe, bytes };
    });

    ipcMain.handle('xdraft:diagram:remove', async (_event, name) => {
        await fsp.rm(resolveDiagramPath(name), { force: true });

        return true;
    });

    ipcMain.handle('xdraft:diagram:saveAs', async (_event, body, suggestedName) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '另存为',
            defaultPath: path.join(app.getPath('documents'), `${sanitizeName(suggestedName)}.json`),
            filters: [{ name: 'xdraft 文档', extensions: ['json'] }],
        });

        if (canceled || !filePath) {
            return { canceled: true };
        }

        const bytes = await writeJsonAtomic(filePath, body);

        return { canceled: false, file: filePath, bytes };
    });

    // 渲染进程询问完毕: allow=true 真关, false 取消。
    ipcMain.handle('xdraft:window:closeConfirmed', (_event, allow) => {
        closeRequestPending = false;

        if (allow) {
            forceCloseWindow();
        }

        return true;
    });
}

// ── 关窗保护 ────────────────────────────────────────────────────────────────
// 有未保存改动时先问渲染进程。带 5 秒兜底: 渲染进程若崩溃或卡住, 不能永远关不掉窗口。

let allowClose = false;
let closeRequestPending = false;

function forceCloseWindow() {
    allowClose = true;
    closeRequestPending = false;

    if (mainWindow) {
        mainWindow.close();
    }
}

function setupCloseGuard(win) {
    win.on('close', (event) => {
        // 只有拿到放行许可(allowClose)才允许真正关闭。
        // 注意: 确认流程进行中(closeRequestPending)也必须拦截 —— 否则用户双击标题栏
        // 的 X 时, 第二次 close 事件会从这里"裸 return"直达系统关闭, 绕过未保存确认。
        if (allowClose) {
            return;
        }

        event.preventDefault();

        // 确认已在进行中: 忽略重复的关窗请求, 等渲染进程答复或 5 秒兜底超时。
        if (closeRequestPending) {
            return;
        }

        closeRequestPending = true;
        win.webContents.send('xdraft:window:beforeClose');

        setTimeout(() => {
            if (closeRequestPending) {
                console.warn('[xdraft] 关窗确认超时, 直接关闭。');

                forceCloseWindow();
            }
        }, 5000);
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 600,
        title: 'Xdraft',
        icon: path.join(__dirname, 'icons', 'icon_256.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            // preload 里读不到 app.isPackaged, 用它把真实值传过去。
            additionalArguments: [`--xdraft-is-packaged=${app.isPackaged ? 'true' : 'false'}`],
        },
        show: false,
        backgroundColor: '#f5f5f5',
    });

    // 加载应用
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        // 注意: 打包进 asar 后 __dirname 已是 .../app.asar/electron,
        // 而 dist-electron/ 位于 asar 根目录(见 package.json 的 build.files),
        // 因此必须回退一级, 否则会指向不存在的 electron/dist-electron/index.html 导致白屏。
        const indexPath = path.join(__dirname, '..', 'dist-electron', 'index.html');
        mainWindow.loadFile(indexPath);
    }

    // 诊断: 页面加载失败 / 渲染进程崩溃时把原因打到终端, 避免"白屏但没有任何提示"。
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error(`[xdraft] 页面加载失败: ${errorCode} ${errorDescription} -> ${validatedURL}`);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[xdraft] 渲染进程异常退出: ${details && details.reason}`);
    });

    // 把渲染进程的 console 转发到终端(默认只转发 warning/error)。
    // 需要看全部日志 + 打开 DevTools 时: XDRAFT_DEBUG=1 ./xdraft-*.AppImage
    const debugEnabled = !!process.env.XDRAFT_DEBUG;

    mainWindow.webContents.on('console-message', (...args) => {
        const first = args[0];
        const newShape = first != null && typeof first === 'object' && 'message' in first;

        // Electron 新版本传事件对象, 旧版本传 (event, level, message, line, sourceId)
        const level = newShape ? first.level : args[1];
        const message = newShape ? first.message : args[2];
        const isProblem = level === 'warning' || level === 'error' || level === 2 || level === 3;

        if (debugEnabled || isProblem) {
            console.log(`[renderer] ${message}`);
        }
    });

    if (debugEnabled) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // 窗口准备好后再显示，避免白屏
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 外部链接用系统浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    setupCloseGuard(mainWindow);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// macOS 风格: Dock 关闭窗口后再次点击 Dock 重新打开
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.whenReady().then(() => {
    // 生产环境隐藏菜单栏，使用 React 内置菜单
    if (!isDev) {
        Menu.setApplicationMenu(null);
    }

    registerIpcHandlers();
    createMainWindow();
});

// 处理第二个实例(单例锁)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });
}
