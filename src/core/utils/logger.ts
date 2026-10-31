/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { saveAs } from 'file-saver';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    // The ISO time of the entry.
    t: string;

    // The log level.
    level: LogLevel;

    // The scope of the entry, e. g. 'save' or 'export'.
    scope: string;

    // The message.
    message: string;

    // Optional detail, e. g. the error message.
    detail?: string;
}

const MAX_ENTRIES = 2000;
const STORAGE_KEY = 'xdraft.logs';

let buffer: LogEntry[] = load();

// 日志面板的实时刷新:新条目到达时通知订阅者(React 面板用)。
const listeners: Array<(entry: LogEntry) => void> = [];

function load(): LogEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        return raw ? JSON.parse(raw) as LogEntry[] : [];
    } catch {
        return [];
    }
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
    } catch {
        // Local storage might be full or unavailable, keep the in memory buffer.
    }
}

function log(level: LogLevel, scope: string, message: string, detail?: unknown) {
    const entry: LogEntry = {
        t: new Date().toISOString(),
        level,
        scope,
        message,
    };

    if (detail !== undefined && detail !== null) {
        entry.detail = detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : String(detail);
    }

    buffer.push(entry);

    if (buffer.length > MAX_ENTRIES) {
        buffer = buffer.slice(buffer.length - MAX_ENTRIES);
    }

    persist();

    for (const listener of listeners) {
        try {
            listener(entry);
        } catch {
            // 面板的订阅回调出错不能反噬日志本身。
        }
    }
}

export function logInfo(scope: string, message: string, detail?: unknown) {
    log('info', scope, message, detail);
}

export function logWarn(scope: string, message: string, detail?: unknown) {
    log('warn', scope, message, detail);
}

export function logError(scope: string, message: string, detail?: unknown) {
    log('error', scope, message, detail);
}

export function getLogs(): ReadonlyArray<LogEntry> {
    return buffer;
}

/* 订阅新日志(返回取消订阅函数)。日志面板用它做实时刷新。 */
export function subscribeLogs(listener: (entry: LogEntry) => void): () => void {
    listeners.push(listener);

    return () => {
        const index = listeners.indexOf(listener);

        if (index >= 0) {
            listeners.splice(index, 1);
        }
    };
}

/* 清空全部日志(日志面板的"清空"按钮)。 */
export function clearLogs() {
    buffer = [];

    persist();
}

/* Downloads all log entries as a plain text file. */
export function downloadLogs() {
    const text = buffer.map(entry =>
        `${entry.t} [${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}${entry.detail ? ` - ${entry.detail}` : ''}`,
    ).join('\n');

    const blob = new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' });

    saveAs(blob, 'xdraft-logs.txt');
}
