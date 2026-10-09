/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// The target where the diagram is saved: the local folder (default) or the
// mydraft.cc cloud. Persisted in localStorage so it survives reloads.

import { hasLocalDiagrams, isPackagedApp } from '@app/core';

export type SaveTarget = 'serverFile' | 'cloud';

const SAVE_TARGET_KEY = 'mydraft.saveTarget';

// 云端入口是否可用。
//
// 打包版没有随包后端, api.mydraft.cc 也未必可达 —— 按 D3=B: 入口**保留但置灰**并附说明,
// 而不是隐藏。让用户点进一个注定失败的动作是最糟的选择。
export function isCloudTargetAvailable(): boolean {
    return !isPackagedApp();
}

// 本机落盘是否可用: 需要 preload 暴露的 IPC 桥。
// 在 Electron 里为 true; 普通浏览器里为 false(那时退回到 dev proxy 的 fetch 路径)。
export function isLocalTargetAvailable(): boolean {
    return hasLocalDiagrams();
}

export function getSaveTarget(): SaveTarget {
    const value = localStorage.getItem(SAVE_TARGET_KEY);

    if (value === 'cloud') {
        // 存的是云端但当前环境用不了(例如打包版里残留的偏好) ⇒ 回落到本机。
        return isCloudTargetAvailable() ? 'cloud' : 'serverFile';
    }

    return 'serverFile';
}

export function setSaveTarget(target: SaveTarget) {
    localStorage.setItem(SAVE_TARGET_KEY, target);
}
