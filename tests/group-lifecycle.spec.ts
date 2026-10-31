/*
 * 组的完整生命周期回归: 保存/加载、复制/粘贴、撤销/重做、嵌套组合、删除。
 *
 * 背景: 1.0.4 修复了「组合即白屏」(Group 无 appearance 被直接访问),
 * 这些用例锁住组在其余关键路径上的行为,防止同类问题换个入口再出现。
 */
import { describe, expect, it } from 'vitest';
import { MathHelper } from '@app/core';
import { store } from '@app/store';
import {
    addDiagram,
    addShape,
    getSelection,
    groupItems,
    loadDiagramInternal,
    pasteItems,
    redo,
    removeItems,
    selectDiagram,
    Serializer,
    undo,
    ungroupItems,
} from '@app/wireframes/model';
import { Diagram } from '@app/wireframes/model/diagram';
import { DiagramItem } from '@app/wireframes/model/diagram-item';
import { DiagramItemSet } from '@app/wireframes/model/diagram-item-set';

function freshPage() {
    const action = addDiagram();
    store.dispatch(action);
    // addDiagram 只在**首个**页面时自动选中(diagrams.ts:125),多页面时必须手动切过去。
    const newId = (action.payload as any).diagramId;
    store.dispatch(selectDiagram(newId));
    return newId;
}

function currentPage() {
    const state = store.getState() as any;
    const id = state.editor.present.selectedDiagramId;
    return { id, page: state.editor.present.diagrams.get(id) };
}

// childIds 图必须始终无环;返回环路径或 null。
function findCycle(page: any): string[] | null {
    const groups = new Map<string, string[]>();
    for (const item of page.items.values) {
        if (item.type === 'Group') {
            groups.set(item.id, item.childIds.values.filter((c: string) => page.items.get(c)?.type === 'Group'));
        }
    }
    const color = new Map<string, number>();
    const stack: string[] = [];
    const dfs = (u: string): string[] | null => {
        color.set(u, 1);
        stack.push(u);
        for (const v of groups.get(u) || []) {
            if (color.get(v) === 1) return stack.slice(stack.indexOf(v)).concat(v);
            if (!color.has(v)) {
                const r = dfs(v);
                if (r) return r;
            }
        }
        stack.pop();
        color.set(u, 2);
        return null;
    };
    for (const g of groups.keys()) {
        if (!color.has(g)) {
            const r = dfs(g);
            if (r) return r;
        }
    }
    return null;
}

function expectHealthy(label: string) {
    const { page } = currentPage();
    expect(findCycle(page), `${label}: 组结构成环`).toBeNull();
    // 每个组引用的 child 必须真实存在。
    for (const item of page.items.values) {
        if (item.type === 'Group') {
            for (const c of item.childIds.values) {
                expect(page.items.get(c), `${label}: 组 ${item.id} 引用不存在的子项 ${c}`).toBeTruthy();
            }
        }
    }
    // 渲染层会做的事: 全量 bounds + 选区投影都不能抛。
    expect(() => {
        for (const item of page.items.values) {
            item.bounds(page);
        }
        getSelection(store.getState() as any);
    }, `${label}: 渲染模拟抛错`).not.toThrow();
}

function addTwoShapes() {
    store.dispatch(addShape(currentPage().id, 'Rectangle', { position: { x: 100, y: 100 } }));
    store.dispatch(addShape(currentPage().id, 'Heading', { position: { x: 300, y: 100 } }));
}

describe('group lifecycle', () => {
    it('group survives save/load round-trip', () => {
        freshPage();
        addTwoShapes();

        const { id, page } = currentPage();
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape');
        store.dispatch(groupItems(id, shapes, MathHelper.nextId()));
        expectHealthy('after-group');

        // 与 saveDiagramToFile 相同: 序列化整个 editor。
        const stored = Serializer.serializeEditor((store.getState() as any).editor.present);
        store.dispatch(loadDiagramInternal({ version: 2, editor: JSON.parse(JSON.stringify(stored)) }, 'roundtrip'));

        const loaded = currentPage().page;
        const groups = loaded.items.values.filter((x: any) => x.type === 'Group');
        expect(groups.length).toBe(1);
        expect(groups[0].childIds.values.length).toBe(2);
        expectHealthy('after-reload');
    });

    it('copy/paste a group keeps structure with new ids', () => {
        freshPage();
        addTwoShapes();

        const { id, page } = currentPage();
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape');
        store.dispatch(groupItems(id, shapes, MathHelper.nextId()));
        expectHealthy('after-group');

        const state = store.getState() as any;
        const json = JSON.stringify(Serializer.serializeSet(getSelection(state)));

        const before = currentPage().page.items.size;
        store.dispatch(pasteItems(id, json, 50));
        expectHealthy('after-paste');

        const after = currentPage().page;
        expect(after.items.size).toBe(before + 3); // 新组 + 2 个子项
        const groups = after.items.values.filter((x: any) => x.type === 'Group');
        expect(groups.length).toBe(2);
        // 粘贴出的组必须是**新** id,不能覆盖原组。
        expect(new Set(groups.map(g => g.id)).size).toBe(2);
    });

    it('undo/redo across group+paste stays acyclic (historical corruption path)', () => {
        freshPage();
        addTwoShapes();

        const { id, page } = currentPage();
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape');
        store.dispatch(groupItems(id, shapes, MathHelper.nextId()));

        const json = JSON.stringify(Serializer.serializeSet(getSelection(store.getState() as any)));
        store.dispatch(pasteItems(id, json, 50));
        expectHealthy('before-undo');

        store.dispatch(undo()); // 撤销粘贴
        expectHealthy('after-undo-1');
        store.dispatch(undo()); // 撤销组合
        expectHealthy('after-undo-2');

        store.dispatch(redo());
        expectHealthy('after-redo-1');
        store.dispatch(redo());
        expectHealthy('after-redo-2');
    });

    it('delete group then undo restores it', () => {
        freshPage();
        addTwoShapes();

        const { id, page } = currentPage();
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape');
        store.dispatch(groupItems(id, shapes, MathHelper.nextId()));

        const group = currentPage().page.items.values.find((x: any) => x.type === 'Group');
        store.dispatch(removeItems(id, [group]));
        expect(currentPage().page.items.values.some((x: any) => x.type === 'Group')).toBe(false);
        expectHealthy('after-remove');

        store.dispatch(undo());
        expect(currentPage().page.items.values.some((x: any) => x.type === 'Group')).toBe(true);
        expectHealthy('after-undo-remove');
    });

    it('nested grouping (group of groups of shapes)', () => {
        freshPage();
        addTwoShapes();

        const { id, page } = currentPage();
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape');

        store.dispatch(groupItems(id, shapes.slice(0, 1), MathHelper.nextId()));
        expectHealthy('inner-group');

        const inner = currentPage().page.items.values.find((x: any) => x.type === 'Group');
        const other = shapes.slice(1);

        store.dispatch(groupItems(id, [inner, ...other], MathHelper.nextId()));
        expectHealthy('outer-group');

        // 外组的 childIds 里引用了内组;渲染 bounds 必须能算出嵌套区域。
        const outer = currentPage().page.items.values.find((x: any) => x.type === 'Group' && x.id !== inner.id);
        expect(outer.childIds.values).toContain(inner.id);
        expect(() => outer.bounds(currentPage().page)).not.toThrow();
    });

    it('cyclic groups (corrupt data) do not overflow the stack', () => {
        // 手工构造历史 bug 可能留下的坏数据: A ↔ B 互相嵌套。
        const shape = DiagramItem.createShape({ renderer: 'Rectangle', id: 'shape-1' });
        const groupA = DiagramItem.createGroup({ id: 'group-a', childIds: ['group-b', 'shape-1'] });
        const groupB = DiagramItem.createGroup({ id: 'group-b', childIds: ['group-a'] });
        // ImmutableMap.of 要的是 { id: item } 对象,不是数组。
        const diagram = Diagram.create({
            id: 'cyclic-doc',
            items: { [shape.id]: shape, [groupA.id]: groupA, [groupB.id]: groupB },
            rootIds: ['group-a'],
        });

        // 这两条路径都会递归走 childIds: 环必须被打断而不是吃满调用栈。
        const set = DiagramItemSet.createFromDiagram(['group-a'], diagram);
        expect(set.nested.size).toBe(3);

        expect(() => groupA.bounds(diagram)).not.toThrow();
    });
});
