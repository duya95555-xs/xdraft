/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// Electron 桥。
//
// `electron/preload.js` 通过 contextBridge 暴露 `window.xdraftApp`。在普通浏览器里
// 它是 undefined —— 下面所有能力函数都会返回"不可用", 调用方据此回落到旧的 fetch 路径。

export interface LocalDiagramInfo {
    // 文档名(不含 .json)。
    name: string;

    // 最后修改时间。
    savedAt: number;

    // 文件大小(字节)。
    bytes: number;
}

export interface LocalDiagramsBridge {
    list(): Promise<LocalDiagramInfo[]>;
    read(name: string): Promise<{ name: string; stored: any }>;
    write(name: string, body: any): Promise<{ file: string; name: string; bytes: number }>;
    remove(name: string): Promise<boolean>;
    saveAs(body: any, suggestedName: string): Promise<{ canceled: boolean; file?: string; bytes?: number }>;
}

export interface DesktopBridge {
    platform: string;

    // 是否运行在打包产物里(deb / AppImage)。dev 下即便跑在 Electron 里也是 false。
    isPackaged: boolean;

    diagrams?: LocalDiagramsBridge;

    // 关窗保护: 窗口即将关闭时回调, 由渲染进程决定放行还是取消。
    onBeforeClose?(handler: () => void): () => void;

    closeConfirmed?(allow: boolean): Promise<void>;
}

export function getDesktopBridge(): DesktopBridge | undefined {
    return (window as any).xdraftApp;
}

// 能否通过 IPC 直接读写本机文档。浏览器 / preload 未加载时为 false。
export function hasLocalDiagrams(): boolean {
    return !!getDesktopBridge()?.diagrams;
}

// 打包版。云端入口据此置灰(保留但不隐藏), 本机落盘是默认目标。
export function isPackagedApp(): boolean {
    return getDesktopBridge()?.isPackaged === true;
}
