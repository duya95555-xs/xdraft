/*
 * 回归测试: 组合后新组成为唯一选中项时,所有 appearance 访问都不能抛错。
 *
 * 背景(1.0.4 线上崩溃): Group 没有 appearance 字段,而 DiagramItem.getAppearance
 * 直接 this.appearance.get(key) —— 组合后 EditorView 访问 selectedItem.textDisabled
 * 抛 TypeError,React 18 无错误边界直接卸载整棵树 → 白屏(用户报"组合后崩溃")。
 * 同类风险点: TransformAdorner 拖拽组时读 appearance、F2 对组开文本编辑器。
 */
import { describe, expect, it } from 'vitest';
import { MathHelper } from '@app/core';
import { store } from '@app/store';
import { addDiagram, groupItems, selectDiagram, ungroupItems } from '@app/wireframes/model';

describe('regression: group selected as single item', () => {
    it('appearance getters on a Group return undefined instead of throwing', () => {
        store.dispatch(addDiagram());

        const state0 = store.getState() as any;
        const pageId = state0.editor.present.selectedDiagramId;

        // 两个根级形状 → 组合(与 useGrouping.doGroup 相同路径)。
        const page = state0.editor.present.diagrams.get(pageId);
        const shapes = page.items.values.filter((x: any) => x.type === 'Shape' && x.renderer !== 'Connector');

        if (shapes.length < 2) {
            // 空页面场景下无法组合,跳过断言(由 UI 层 canGroup 挡住)。
            return;
        }

        store.dispatch(groupItems(pageId, shapes.slice(0, 2), MathHelper.nextId()));

        const state1 = store.getState() as any;
        const group = state1.editor.present.diagrams.get(pageId).selectedIds.values
            .map((id: string) => state1.editor.present.diagrams.get(pageId).items.get(id))
            .find((x: any) => x?.type === 'Group');

        expect(group).toBeTruthy();

        // 这些 getter 在组合后都会被 EditorView/属性面板触达,任何一个抛错都会白屏。
        expect(() => group.textDisabled).not.toThrow();
        expect(() => group.isLocked).not.toThrow();
        expect(() => group.fontSize).not.toThrow();
        expect(() => group.text).not.toThrow();
        expect(group.textDisabled).toBeUndefined();
        expect(group.getAppearance('ANY_KEY')).toBeUndefined();

        // 选中组后 getAppearance 仍应对普通形状正常取值。
        expect(shapes[0].getAppearance('TEXT_DISABLED')).toBe(shapes[0].appearance.get('TEXT_DISABLED'));

        // 拆开,避免污染其它用例的 store。
        store.dispatch(ungroupItems(pageId, [group]));
        store.dispatch(selectDiagram(pageId));
    });
});
