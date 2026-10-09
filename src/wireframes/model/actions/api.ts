/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { getDesktopBridge, hasLocalDiagrams, LocalDiagramInfo, logError, logInfo } from '@app/core';

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export async function getDiagram(readToken: string) {
    const url = `${SERVER_URL}/${readToken}`;

    logInfo('api', `GET ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
        logError('api', `GET ${url} failed with HTTP ${response.status}.`);

        throw Error('Failed to load diagram');
    }

    logInfo('api', `GET ${url} succeeded with HTTP ${response.status}.`);

    const stored = await response.json();

    return stored;
}

export async function putDiagram(readToken: string, writeToken: string, body: any) {
    const url = `${SERVER_URL}/${readToken}/${writeToken}`;

    // 只序列化一次: 文档大起来之后 stringify 是这里最贵的一步, 之前为了记日志做了两遍。
    const json = JSON.stringify(body);

    logInfo('api', `PUT ${url} (${json.length} bytes).`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            ['Content-Type']: 'application/json',
        },
        body: json,
    });

    if (!response.ok) {
        logError('api', `PUT ${url} failed with HTTP ${response.status}.`);

        throw Error('Failed to save diagram');
    }

    logInfo('api', `PUT ${url} succeeded with HTTP ${response.status}.`);
}

// ── 本机文档(Electron IPC) ──────────────────────────────────────────────────
//
// 以前这里只有一条 `fetch('/api/diagrams/<name>')` 的相对路径。它**只**靠 vite.config.ts
// 的 dev proxy 转发到 127.0.0.1:8901; 打包版走 file://, 相对路径会被解析成
// file:///api/diagrams/... ⇒ 直接抛 Failed to fetch。这就是打包版开箱即坏的那条链路。
//
// 现在: Electron 里走主进程 IPC 真落盘(userData/diagrams/), 浏览器里保留 fetch 回落
// (给还在用 dev proxy 的场景)。

function localBridge() {
    return getDesktopBridge()?.diagrams;
}

// 本机落盘是否可用 —— 不可用时 UI 应把这个目标置灰, 而不是让用户点了报错。
export function canUseLocalStorage() {
    return hasLocalDiagrams();
}

export async function putDiagramToServerFile(name: string, body: any) {
    const bridge = localBridge();

    if (bridge) {
        logInfo('api', `WRITE local://${name}.`);

        const result = await bridge.write(name, body);

        logInfo('api', `WRITE local://${name} succeeded (${result.bytes} bytes).`);

        return { file: result.file };
    }

    const url = `/api/diagrams/${encodeURIComponent(name)}`;

    const bodyJson = JSON.stringify(body);

    logInfo('api', `PUT ${url} (${bodyJson.length} bytes).`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            ['Content-Type']: 'application/json',
        },
        body: bodyJson,
    });

    if (!response.ok) {
        logError('api', `PUT ${url} failed with HTTP ${response.status}.`);

        throw Error('Failed to save diagram');
    }

    const json: { file: string; bytes: number } = await response.json();

    logInfo('api', `PUT ${url} succeeded, file ${json.file}.`);

    return json;
}

export async function listLocalDiagrams(): Promise<LocalDiagramInfo[]> {
    const bridge = localBridge();

    if (!bridge) {
        return [];
    }

    const result = await bridge.list();

    logInfo('api', `LIST local:// -> ${result.length} document(s).`);

    return result;
}

export async function readLocalDiagram(name: string) {
    const bridge = localBridge();

    if (!bridge) {
        throw Error('Local storage is not available');
    }

    logInfo('api', `READ local://${name}.`);

    const result = await bridge.read(name);

    return result.stored;
}

export async function deleteLocalDiagram(name: string) {
    const bridge = localBridge();

    if (!bridge) {
        return false;
    }

    logInfo('api', `DELETE local://${name}.`);

    return bridge.remove(name);
}

// 走系统"另存为"对话框。Electron 里这样能拿到真实路径, 比 file-saver 触发浏览器下载可靠。
// 浏览器里返回 null, 由调用方回落到 file-saver。
export async function saveDiagramAsToLocal(body: any, suggestedName: string) {
    const bridge = localBridge();

    if (!bridge) {
        return null;
    }

    const result = await bridge.saveAs(body, suggestedName);

    if (result.canceled) {
        return { canceled: true, file: '' };
    }

    logInfo('api', `SAVE AS "${result.file}" (${result.bytes} bytes).`);

    return { canceled: false, file: result.file || '' };
}

export async function postDiagram(body: any)  {
    const url = `${SERVER_URL}/`;

    const bodyJson = JSON.stringify(body);

    logInfo('api', `POST ${url} (${bodyJson.length} bytes).`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            ['Content-Type']: 'application/json',
        },
        body: bodyJson,
    });

    if (!response.ok) {
        logError('api', `POST ${url} failed with HTTP ${response.status}.`);

        throw Error('Failed to save diagram');
    }

    logInfo('api', `POST ${url} succeeded with HTTP ${response.status}.`);

    const json: { readToken: string; writeToken: string } = await response.json();

    return json;
}
