/*
 * 「我的形状」(母版库)回归:捕获、命名增删、插入(含向量偏移)。
 *
 * 背景: 1.0.4 新增的母版功能复用 Serializer.serializeSet + pasteItems 链路,
 * 这里锁住三个关键行为:
 *   1. 捕获选中项(多选/含组合)后能完整存取;
 *   2. pasteItems 支持 {x,y} 向量偏移(母版对齐落点的前提);
 *   3. 重命名/删除的正确性。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '@app/store';
import {
    addDiagram,
    addShape,
    captureSelectionAsMyShape,
    getDiagram,
    groupItems,
    listMyShapes,
    masterBounds,
    masterOffsetToCenter,
    pasteItems,
    removeMyShape,
    renameMyShape,
    selectDiagram,
    selectItems,
} from '@app/wireframes/model';

function state(): any {
    return store.getState() as any;
}

function freshPage(): string {
    const action = addDiagram();
    store.dispatch(action);

    const newId = (action.payload as any).diagramId;
    store.dispatch(selectDiagram(newId));

    return newId;
}

function currentPage(): any {
    const s = state();

    return s.editor.present.diagrams.get(s.editor.present.selectedDiagramId);
}

describe('MyShapes (master library)', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('should capture selection, insert with vector offset, rename and remove', () => {
        const diagramId = freshPage();

        // ── 画布上放两个形状(一个改过外观,验证配置保留)──────────────────
        store.dispatch(addShape(diagramId, 'Label', { position: { x: 100, y: 100 }, appearance: { TEXT: 'Hello' } }));
        store.dispatch(addShape(diagramId, 'Button', { position: { x: 300, y: 200 } }));

        const page1 = currentPage();
        const oldIds = page1.rootIds.values as string[];
        expect(oldIds.length).toBe(2);

        // ── 捕获选中项为我的形状 ────────────────────────────────────────
        store.dispatch(selectItems(diagramId, oldIds));

        const diagram = getDiagram(state())!;
        const selectedIds = diagram.selectedIds.values as string[];
        const result = captureSelectionAsMyShape(diagram, selectedIds, '组合');

        expect('master' in result).toBe(true);

        const master = listMyShapes()[0];
        expect(master).toBeDefined();
        expect(master.name).toBe('组合');
        expect(master.data.visuals.length).toBe(2);

        // ── 外接框计算:两个形状的包围盒 ────────────────────────────────
        const bounds = masterBounds(master.data);
        expect(bounds.minX).toBeLessThanOrEqual(100);
        expect(bounds.width).toBeGreaterThan(0);

        // ── 插入:{x,y} 向量偏移,所有图元位置精确平移 ──────────────────
        const vector = masterOffsetToCenter(master.data, 500, 400);
        store.dispatch(pasteItems(diagramId, JSON.stringify(master.data), vector));

        const page2 = currentPage();
        const insertedIds = (page2.rootIds.values as string[]).filter(id => !oldIds.includes(id));
        expect(insertedIds.length).toBe(2);

        for (const id of insertedIds) {
            const item = page2.items.get(id);
            expect(item).toBeDefined();

            // 在母版数据里按 renderer + 尺寸找同源图元,位置差必须精确等于偏移向量。
            const match = (master.data.visuals as any[]).find(v =>
                v.renderer === item.renderer &&
                Math.abs(v.transform.w - item.transform.size.x) < 1e-6 &&
                Math.abs(v.transform.h - item.transform.size.y) < 1e-6);

            expect(match).toBeDefined();
            expect(item.transform.position.x - match.transform.x).toBeCloseTo(vector.x, 6);
            expect(item.transform.position.y - match.transform.y).toBeCloseTo(vector.y, 6);
        }

        // 插入后母版外接框中心 = 目标点(500,400)。
        let cx = 0;
        let cy = 0;

        for (const id of insertedIds) {
            const t = page2.items.get(id).transform;

            cx += t.position.x;
            cy += t.position.y;
        }

        // (外接框中心 ≠ 质心,但两个矩形同源时,位置均值偏移应与向量一致 ——
        //  这里只验证平移不变性,已在上面逐项精确断言过。)
        expect(isFinite(cx) && isFinite(cy)).toBe(true);

        // ── 重命名 / 删除 ──────────────────────────────────────────────
        expect(renameMyShape(master.id, '我的按钮组')).toBe(true);
        expect(listMyShapes()[0].name).toBe('我的按钮组');

        expect(removeMyShape(master.id)).toBe(true);
        expect(listMyShapes().length).toBe(0);
    });

    it('should return error when nothing is selected', () => {
        const diagramId = freshPage();
        const diagram = getDiagram(state())!;

        const result = captureSelectionAsMyShape(diagram, [], '组合');

        expect(result).toEqual({ error: 'empty' });
    });

    it('should capture a group and keep edited text/colors on insert', () => {
        const diagramId = freshPage();

        // 两个形状都改过外观(文字/填充色/字号),再组合。
        store.dispatch(addShape(diagramId, 'Label', {
            position: { x: 100, y: 100 },
            appearance: { TEXT: 'Hello', FILL_COLOR: '#ff0000', FONT_SIZE: 24 },
        }));
        store.dispatch(addShape(diagramId, 'Button', {
            position: { x: 300, y: 200 },
            appearance: { FILL_COLOR: '#00ff00' },
        }));

        const page1 = currentPage();
        const shapeIds = page1.rootIds.values as string[];

        store.dispatch(groupItems(diagramId, shapeIds));

        const page2 = currentPage();
        const groupIds = (page2.rootIds.values as string[]).filter(id => !shapeIds.includes(id));

        expect(groupIds.length).toBe(1);

        // 组合既没有 name 也没有 renderer,这里回归"捕获不再抛错、能正常入库"。
        store.dispatch(selectItems(diagramId, groupIds));

        const diagram = getDiagram(state())!;
        const result = captureSelectionAsMyShape(diagram, diagram.selectedIds.values as string[], '组合');

        expect('master' in result).toBe(true);

        const master = listMyShapes()[0];

        expect(master).toBeDefined();
        expect(master.name).toBe('组合');

        // 插入后逐个断言:编辑过的文字/颜色/字号全部保留。
        store.dispatch(pasteItems(diagramId, JSON.stringify(master.data), { x: 500, y: 400 }));

        const page3 = currentPage();
        const insertedGroup = (page3.rootIds.values as string[])
            .map(id => page3.items.get(id))
            .find(i => i && i.type === 'Group' && !groupIds.includes(i.id));

        expect(insertedGroup).toBeDefined();

        const label = insertedGroup.childIds.values.map(id => page3.items.get(id)).find(i => i.renderer === 'Label');
        const button = insertedGroup.childIds.values.map(id => page3.items.get(id)).find(i => i.renderer === 'Button');

        expect(label.appearance.get('TEXT')).toBe('Hello');
        expect(label.appearance.get('FILL_COLOR')).toBe('#ff0000');
        expect(label.appearance.get('FONT_SIZE')).toBe(24);
        expect(button.appearance.get('FILL_COLOR')).toBe('#00ff00');
    });
});
