// mydraft.cc Electron 预加载脚本
// 在渲染进程加载 Node.js/Electron API，通过 contextBridge 安全暴露

const { contextBridge, ipcRenderer } = require('electron');

// 打包状态由主进程通过 additionalArguments 注入 —— preload 里拿不到 app.isPackaged。
// (原先这里硬编码 true, 导致 dev 下渲染进程也自认为"打包版", 云端入口与落盘路径判断全错。)
const PACKAGED_FLAG = '--mydraft-is-packaged=';
const packagedArg = process.argv.find(x => x.startsWith(PACKAGED_FLAG));
const isPackaged = packagedArg ? packagedArg.substring(PACKAGED_FLAG.length) === 'true' : true;

const CHANNEL_LIST = 'mydraft:diagram:list';
const CHANNEL_READ = 'mydraft:diagram:read';
const CHANNEL_WRITE = 'mydraft:diagram:write';
const CHANNEL_REMOVE = 'mydraft:diagram:remove';
const CHANNEL_SAVE_AS = 'mydraft:diagram:saveAs';
const CHANNEL_BEFORE_CLOSE = 'mydraft:window:beforeClose';
const CHANNEL_CLOSE_CONFIRMED = 'mydraft:window:closeConfirmed';

contextBridge.exposeInMainWorld('mydraftApp', {
    platform: process.platform,
    isPackaged,

    // 本机文档存储: 落盘到 app.getPath('userData')/diagrams/ (Linux 即 ~/.config/mydraft/diagrams)。
    // 全部返回 Promise, 失败时 reject 并带上可读的 message。
    diagrams: {
        list: () => ipcRenderer.invoke(CHANNEL_LIST),
        read: (name) => ipcRenderer.invoke(CHANNEL_READ, name),
        write: (name, body) => ipcRenderer.invoke(CHANNEL_WRITE, name, body),
        remove: (name) => ipcRenderer.invoke(CHANNEL_REMOVE, name),
        saveAs: (body, suggestedName) => ipcRenderer.invoke(CHANNEL_SAVE_AS, body, suggestedName),
    },

    // 关窗保护: 主进程在窗口即将关闭时发来事件, 由渲染进程决定"保存并关闭 / 直接关闭 / 取消"。
    // 返回一个取消订阅函数(React 里放在 useEffect 的 cleanup 中)。
    onBeforeClose: (handler) => {
        const listener = () => handler();

        ipcRenderer.on(CHANNEL_BEFORE_CLOSE, listener);

        return () => {
            ipcRenderer.removeListener(CHANNEL_BEFORE_CLOSE, listener);
        };
    },

    // allow = true 真正关闭窗口; false 表示用户取消, 窗口留着。
    closeConfirmed: (allow) => ipcRenderer.invoke(CHANNEL_CLOSE_CONFIRMED, allow),
});
