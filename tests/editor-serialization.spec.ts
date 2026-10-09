/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 保存/加载数据层的回归测试(纯逻辑,jsdom 即可)。
// 运行:CI=1 npx vitest run tests/editor-serialization.spec.ts
//
// 覆盖 PRD 的:
//   S-03  文档名与"当前选中页标题"彻底解耦(documentName 不跟着页标题跑)
//   S-06  画布底色 color 必须进序列化表(否则掉出 50 步撤销窗口就永久丢失)
//   S-07  selectedDiagramId 必须进序列化表(否则重开必跳回第 1 页)
//   S-08  未知 renderer 计数而不是静默丢弃
//   脏标记 UndoableState.revision 的加减规则(自动保存据此判断"有无未保存改动")

import { describe, expect, it } from 'vitest';
import { Color, Vec2 } from '@app/core';
import { Diagram, EditorState, Serializer, UndoableState } from '@app/wireframes/model';

const ACTION = { type: 'test/action' };

function createEditor() {
    return EditorState.create({
        diagrams: {
            d1: Diagram.create({ id: 'd1', title: '第一页' }),
            d2: Diagram.create({ id: 'd2', title: '第三页' }),
        },
        diagramIds: ['d1', 'd2'],
        color: new Color(1, 0, 0, 0.5),
        name: '我的文档',
        selectedDiagramId: 'd2',
        size: new Vec2(800, 600),
    });
}

describe('EditorState 的文档名(S-03)', () => {
    it('documentName 取显式名字,不取任何页的标题', () => {
        expect(createEditor().documentName).toBe('我的文档');
    });

    it('没有显式名字时 documentName 用稳定兜底,而不是当前页标题', () => {
        const editor = EditorState.create({
            diagrams: { d2: Diagram.create({ id: 'd2', title: '第三页' }) },
            diagramIds: ['d2'],
            selectedDiagramId: 'd2',
        });

        // 这是"切到第 3 页就存成另一个文件"的根因所在:文档名绝不能跟着页标题跑。
        expect(editor.documentName).toBe('未命名文档');
        expect(editor.documentName).not.toBe('第三页');
    });

    it('suggestedName 只在没名字时才退回第一页标题(仅用于首次保存预填)', () => {
        const anonymous = EditorState.create({
            diagrams: {
                d1: Diagram.create({ id: 'd1', title: '第一页' }),
                d2: Diagram.create({ id: 'd2', title: '第三页' }),
            },
            diagramIds: ['d1', 'd2'],
            selectedDiagramId: 'd2',
        });

        // 注意:即使当前选中页是 d2,预填也用**第一页** —— 与选中页无关。
        expect(anonymous.suggestedName).toBe('第一页');
        expect(createEditor().suggestedName).toBe('我的文档');
    });

    it('rename() 只改文档名,不动任何页标题', () => {
        const renamed = createEditor().rename('新名字');

        expect(renamed.documentName).toBe('新名字');
        expect(renamed.diagrams.get('d2')!.title).toBe('第三页');
    });
});

describe('Serializer 往返(S-06 / S-07)', () => {
    it('color / name / selectedDiagramId 三个字段都在序列化表里', () => {
        const json: any = Serializer.serializeEditor(createEditor());

        expect(Object.keys(json)).toContain('color');
        expect(Object.keys(json)).toContain('name');
        expect(Object.keys(json)).toContain('selectedDiagramId');
    });

    it('经 JSON 往返后三者都被完整恢复', () => {
        const json: any = Serializer.serializeEditor(createEditor());
        const restored = Serializer.deserializeEditor(JSON.parse(JSON.stringify(json)));

        expect(restored.documentName).toBe('我的文档');
        expect(restored.selectedDiagramId).toBe('d2');

        // 半透明底色必须连 alpha 一起回来 —— 这条同时守着 Color.fromString 的 8 位分支。
        expect(Color.eqWithAlpha(restored.color, new Color(1, 0, 0, 0.5))).toBe(true);
        expect(restored.color.toString()).toBe('#ff000080');
    });

    it('size 与页面顺序也被恢复', () => {
        const json: any = Serializer.serializeEditor(createEditor());
        const restored = Serializer.deserializeEditor(JSON.parse(JSON.stringify(json)));

        expect(restored.size.x).toBe(800);
        expect(restored.size.y).toBe(600);
        expect(restored.diagramIds.values).toEqual(['d1', 'd2']);
        expect(restored.diagrams.size).toBe(2);
    });
});

describe('未知 renderer 的计数(S-08)', () => {
    it('插件不认识的 renderer 会被计入 skippedItems,而不是静默消失', () => {
        Serializer.resetSkippedItems();

        const set = Serializer.deserializeSet({
            visuals: [
                { id: 'x1', type: 'Shape', renderer: 'ThisShapeDoesNotExist' },
                { id: 'x2', type: 'Shape', renderer: 'ThisShapeDoesNotExistEither' },
            ],
            groups: [],
        });

        expect(set.nested.size).toBe(0);
        expect(Serializer.getSkippedItems()).toBe(2);
    });

    it('resetSkippedItems 会把计数清零(加载流程在反序列化前必须调用它)', () => {
        Serializer.deserializeSet({
            visuals: [{ id: 'x1', type: 'Shape', renderer: 'StillNotAShape' }],
            groups: [],
        });

        expect(Serializer.getSkippedItems()).toBeGreaterThan(0);

        Serializer.resetSkippedItems();

        expect(Serializer.getSkippedItems()).toBe(0);
    });
});

describe('脏标记 UndoableState.revision', () => {
    it('新建是 0,executed 每次 +1', () => {
        const created = UndoableState.create({ value: 1 }, ACTION);

        expect(created.revision).toBe(0);

        const once = created.executed({ value: 2 }, ACTION);

        expect(once.revision).toBe(1);

        const twice = once.executed({ value: 3 }, ACTION);

        expect(twice.revision).toBe(2);
    });

    it('被忽略的动作(只改选中/切页)不计数 —— replacePresent(state) 不带 action', () => {
        const executed = UndoableState.create({ value: 1 }, ACTION).executed({ value: 2 }, ACTION);

        expect(executed.revision).toBe(1);

        // actionsToIgnore 的分支:内容引用可能变了,但不算"文档被改动"。
        const ignored = executed.replacePresent({ value: 2 });

        expect(ignored.revision).toBe(1);
    });

    it('合并进上一步的动作要计数 —— replacePresent(state, action) 带 action', () => {
        const executed = UndoableState.create({ value: 1 }, ACTION).executed({ value: 2 }, ACTION);
        const merged = executed.replacePresent({ value: 3 }, ACTION);

        expect(merged.revision).toBe(2);
    });

    it('undo / redo 都改变呈现内容,因此都计数', () => {
        const executed = UndoableState.create({ value: 1 }, ACTION).executed({ value: 2 }, ACTION);

        const undone = executed.undo();

        expect(undone.present).toEqual({ value: 1 });
        expect(undone.revision).toBe(2);

        expect(undone.redo().revision).toBe(3);
    });

    it('不可撤销时 undo 返回自身,计数不变', () => {
        const created = UndoableState.create({ value: 1 }, ACTION);

        expect(created.undo()).toBe(created);
        expect(created.undo().revision).toBe(0);
    });

    it('为什么不能用 actions 做判据:它是 getter,每次访问都返回新数组', () => {
        const executed = UndoableState.create({ value: 1 }, ACTION).executed({ value: 2 }, ACTION);

        // 这个断言是在**记录**一个坑:如果哪天有人把脏标记改回"比较 actions 引用",
        // 这条测试会提醒他这条路走不通(引用恒为 false ⇒ 等于没判断)。
        expect(executed.actions).not.toBe(executed.actions);
        expect(executed.actions).toEqual(executed.actions);
    });
});
