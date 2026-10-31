/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { MathHelper } from '@app/core/utils';
import { Diagram } from './diagram';
import { DiagramItem } from './diagram-item';
import { DiagramItemSet } from './diagram-item-set';
import { Serializer } from './serializer';

// ── 我的形状(母版库)─────────────────────────────────────────────────────
// 把画布上选中的形状 / 组合序列化保存,之后可随时拖回或双击插入,配置原样保留。
// 存储走 localStorage(key 固定),数据本身是 Serializer.serializeSet 的产物,
// 插入时统一走 pasteItems(自动重生成 id、重映射连线端点),与复制/粘贴同一条链路。

export interface MyShapeMaster {
    // 唯一标识。
    id: string;

    // 用户可改的显示名。
    name: string;

    // 创建时间戳。
    createdAt: number;

    // 序列化的组件集(visuals + groups),结构见 serializer.ts。
    data: { visuals: any[]; groups: any[] };
}

const STORAGE_KEY = 'xdraft.myShapes';

let cache: MyShapeMaster[] | null = null;
const listeners = new Set<() => void>();

function readAll(): MyShapeMaster[] {
    if (cache) {
        return cache;
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];

        cache = Array.isArray(parsed) ? parsed.filter(m => m && m.id && m.data) : [];
    } catch {
        cache = [];
    }

    return cache;
}

function writeAll(list: MyShapeMaster[]): boolean {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // 配额超限或存储被禁用:保持内存中的旧值,由调用方提示用户。
        return false;
    }

    cache = list;

    for (const cb of listeners) {
        cb();
    }

    return true;
}

export function listMyShapes(): MyShapeMaster[] {
    return readAll();
}

export function subscribeMyShapes(cb: () => void): () => void {
    listeners.add(cb);

    return () => listeners.delete(cb);
}

export function addMyShape(name: string, data: { visuals: any[]; groups: any[] }): MyShapeMaster | null {
    const master: MyShapeMaster = {
        id: MathHelper.nextId(),
        name: name.trim() || 'My Shape',
        createdAt: Date.now(),
        data,
    };

    return writeAll([master, ...readAll()]) ? master : null;
}

export function renameMyShape(id: string, name: string): boolean {
    const list = readAll();

    return writeAll(list.map(m => (m.id === id ? { ...m, name: name.trim() || m.name } : m)));
}

export function removeMyShape(id: string): boolean {
    return writeAll(readAll().filter(m => m.id !== id));
}

// 把画布当前选中的图元(含组合)捕获为一个「我的形状」。
// 返回 master 或错误码:'empty'=没有可保存的选中项,'quota'=本地存储写入失败。
export function captureSelectionAsMyShape(
    diagram: Diagram,
    selectedIds: ReadonlyArray<string>,
    defaultGroupName = 'Group',
): { master: MyShapeMaster } | { error: 'empty' | 'quota' } {
    const ids = selectedIds.filter(id => !!diagram.items.get(id));

    if (ids.length === 0) {
        return { error: 'empty' };
    }

    const set = DiagramItemSet.createFromDiagram(ids, diagram);

    if (set.nested.size === 0) {
        return { error: 'empty' };
    }

    const data = Serializer.serializeSet(set);

    // 默认名:单个图元用它的名字(没有就用 renderer 标识),多个用「组合」。
    const roots = set.rootIds.map(id => set.nested.get(id)).filter(Boolean) as DiagramItem[];

    let name: string;

    if (roots.length === 1) {
        name = roots[0].name || roots[0].renderer;
    } else {
        name = defaultGroupName;
    }

    const master = addMyShape(name, data);

    return master ? { master } : { error: 'quota' };
}

// 母版的外接框(按 transform 位置 ± 尺寸/2 估算,忽略旋转 —— 只用于摆放,不影响配置)。
export function masterBounds(data: { visuals: any[] }): { minX: number; minY: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const visual of data.visuals || []) {
        const t = visual.transform;

        if (!t) {
            continue;
        }

        minX = Math.min(minX, t.x - (t.w || 0) / 2);
        minY = Math.min(minY, t.y - (t.h || 0) / 2);
        maxX = Math.max(maxX, t.x + (t.w || 0) / 2);
        maxY = Math.max(maxY, t.y + (t.h || 0) / 2);
    }

    if (!isFinite(minX)) {
        return { minX: 0, minY: 0, width: 0, height: 0 };
    }

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

// 计算让母版外接框对齐到目标中心点所需的 pasteItems 偏移向量。
export function masterOffsetToCenter(data: { visuals: any[] }, centerX: number, centerY: number): { x: number; y: number } {
    const b = masterBounds(data);

    return {
        x: centerX - (b.minX + b.width / 2),
        y: centerY - (b.minY + b.height / 2),
    };
}
