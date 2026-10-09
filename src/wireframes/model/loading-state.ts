/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

type RecentDiagrams = { [tokenToRead: string]: RecentDiagramValue };

// 本机文档(通过 Electron IPC 落到 userData/diagrams 的那些): 文档名 -> 保存时间。
type RecentLocalDiagrams = { [name: string]: number };

export interface RecentDiagramValue {
    // The date when it was saved last.
    date: number;

    // The write token (optional for local files).
    tokenToWrite?: string;
}

export interface RecentDiagram extends RecentDiagramValue {
    // The read token.
    tokenToRead: string;
}

export interface LoadingState {
    // Indicates if the loading operation is in progress.
    isLoading: boolean;

    // Indicates if the saving operation is in progress.
    isSaving: boolean;

    // The read token.
    tokenToRead?: string | null;

    // The write token.
    tokenToWrite?: string | null;

    // The reacent diagrams.
    recentDiagrams: RecentDiagrams;

    // ── 本机文档与自动保存(保存重构 M3) ──────────────────────────────────────

    // 本机文档列表。以前"本机"条目跟云端挤在 recentDiagrams 里, 存的是 local://<name>,
    // 点开却只能弹一个文件选择框(浏览器安全限制, 拿不到真实路径) —— 毫无意义。
    // 现在本机单独一张表, 且在 Electron 下可以直接读回来。
    recentLocal: RecentLocalDiagrams;

    // 上一次"成功落盘"时的 editor.revision。与当前 revision 相等 ⇒ 没有未保存改动。
    // 用它替代原来那个"只看有没有内容"的判据, 自动保存才不会被无条件触发。
    savedRevision: number;

    // 上一次成功保存的时间戳(标题栏显示「已保存 HH:mm」)。
    lastSavedAt?: number | null;

    // 连续自动保存失败次数, 用于指数退避; 一旦成功就归零。
    autoSaveFailCount: number;
}

export interface LoadingStateInStore {
    loading: LoadingState;
}

export function loadRecentDiagrams() {
    try {
        const recent = localStorage.getItem('recent');

        return JSON.parse(recent!) || {} as RecentDiagrams;
    } catch {
        return {};
    }
}

export function saveRecentDiagrams(recent: RecentDiagrams) {
    try {
        const json = JSON.stringify(recent);

        return localStorage.setItem('recent', json);
    } catch {
        return false;
    }
}

export function loadRecentLocal() {
    try {
        const recent = localStorage.getItem('recent.local');

        return JSON.parse(recent!) || {} as RecentLocalDiagrams;
    } catch {
        return {};
    }
}

export function saveRecentLocal(recent: RecentLocalDiagrams) {
    try {
        const json = JSON.stringify(recent);

        return localStorage.setItem('recent.local', json);
    } catch {
        return false;
    }
}

// 只保留最近 N 条, 防止这张表随着使用无限增长。
export function trimRecentLocal(recent: RecentLocalDiagrams, capacity = 12) {
    const entries = Object.entries(recent).sort((lhs, rhs) => rhs[1] - lhs[1]);

    return Object.fromEntries(entries.slice(0, capacity));
}

export const createInitialLoadingState: () => LoadingState = () => {
    return {
        isLoading: false,
        isSaving: false,
        recentDiagrams: loadRecentDiagrams(),
        recentLocal: loadRecentLocal(),
        savedRevision: 0,
        lastSavedAt: null,
        autoSaveFailCount: 0,
    };
};
