/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import {  useSelector } from 'react-redux';
import { createSelector } from 'reselect';
import { Color, ColorPalette, Types } from '@app/core/utils';
import { texts } from '@app/texts';
import { addDiagram, addShape, changeColor, changeColors, changeItemsAppearance, pasteItems, removeDiagram, removeItems } from './actions';
import { AssetsStateInStore } from './assets-state';
import { Diagram } from './diagram';
import { DiagramItemSet } from './diagram-item-set';
import { EditorState, EditorStateInStore } from './editor-state';
import { LoadingStateInStore } from './loading-state';
import { UIStateInStore } from './ui-state';
import { UndoableState } from './undoable-state';

const EMPTY_SELECTION_SET = DiagramItemSet.EMPTY;

export const getDiagramId = (state: EditorStateInStore) => state.editor.present.selectedDiagramId;
export const getDiagrams = (state: EditorStateInStore) => state.editor.present.diagrams;
export const getDiagramsFilter = (state: UIStateInStore) => state.ui.diagramsFilter;
export const getEditorRoot = (state: EditorStateInStore) => state.editor;
export const getEditor = (state: EditorStateInStore) => state.editor.present;
export const getIcons = (state: AssetsStateInStore) => state.assets.icons;
export const getIconSet = (state: AssetsStateInStore) => state.assets.iconSet;
export const getIconsFilter = (state: AssetsStateInStore) => state.assets.iconsFilter;
export const getOrderedDiagrams = (state: EditorStateInStore) => state.editor.present.orderedDiagrams;
export const getShapes = (state: AssetsStateInStore) => state.assets.shapes;
export const getShapesFilter = (state: AssetsStateInStore) => state.assets.shapesFilter;

export const getIconsFilterRegex = createSelector(
    getIconsFilter,
    filter => new RegExp(filter || '.*', 'i'),
);

export const getShapesFilterRegex = createSelector(
    getShapesFilter,
    filter => new RegExp(filter || '.*', 'i'),
);

export const getDiagramsFilterRegex = createSelector(
    getDiagramsFilter,
    filter => new RegExp(filter || '.*', 'i'),
);

export const getIconSets = createSelector(
    getIcons,
    icons => Object.keys(icons),
);

export const getSelectedIcons = createSelector(
    getIcons,
    getIconSet,
    (icons, set) => icons[set],
);

export const getFilteredIcons = createSelector(
    getSelectedIcons,
    getIconsFilterRegex,
    (icons, filter) => icons.filter(x => filter.test(x.displaySearch)),
);

export const getFilteredShapes = createSelector(
    getShapes,
    getShapesFilterRegex,
    (shapes, filter) => shapes.filter(x => filter.test(x.displaySearch)),
);

export const getFilteredDiagrams = createSelector(
    getOrderedDiagrams,
    getDiagramsFilterRegex,
    (diagrams, filter) => diagrams.filter((x, index) => filter.test(getPageName(x, index))),
);

// 当前 diagram。
//
// ⚠️ 这里**故意不用 createSelector 记忆化**,与下面的 getSelection 同理:
// createSelector 默认缓存只有 1 条,而本文件里 getMasterDiagram 会把 getDiagram
// 当作输入选择器调用,EditorView / EditorViewInner / 各个 adorner 也各自调用它。
// 多个调用点交替命中同一个 size-1 缓存时,缓存会被互相驱逐 —— 结果是**同一个 state**
// 在不同组件里拿到不同代的 Diagram 实例,组件之间对同一份数据产生分歧。
//
// diagrams.get(id) 只是 Map 一次哈希查找,直算成本可忽略。
export const getDiagram = (state: EditorStateInStore): Diagram | undefined =>
    state.editor.present.diagrams.get(state.editor.present.selectedDiagramId!);

export const getMasterDiagram = (state: EditorStateInStore): Diagram | undefined =>
    state.editor.present.diagrams.get(getDiagram(state)?.master!);

// 选区投影:当前 diagram 的 selectedIds -> DiagramItemSet。
//
// ⚠️ 这里既不能写成 createSelector,也不能写成"每次直算"的普通函数,两条理由都要看:
//
// ① **reselect 默认缓存大小是 1,多个调用点会互相驱逐。**
//    本文件里 getDiagram 曾被 getMasterDiagram 当作输入选择器调用,而 EditorView /
//    EditorViewInner / 各 adorner 也各自调用它。交替命中同一个 size-1 缓存时,
//    同一个 state 在不同组件里会拿到**不同代的 Diagram 实例**。
//
// ② **但也不能直接用普通函数"每次直算"** —— 那样每次都返回新的 DiagramItemSet,
//    而本 selector 确实会通过 redux 的 useSelector / useStore 使用
//    (见 components/actions/use-clipboard.ts),于是每次都被判定为"快照一直在变",
//    触发无限重渲染(Maximum update depth exceeded),页面卡死在旧画面上。
//
// 所以这里用 **WeakMap 按 diagram 实例**缓存:
//   · Diagram 是不可变对象(arrange() 走 this.merge() 返回新实例),
//     所以"选区变了"必然意味着"diagram 实例变了",拿实例当 key 是精确的;
//   · 同一个 diagram 永远映射到同一个 DiagramItemSet ⇒ 引用稳定,
//     useSelector / React.memo 的浅比较都能正常工作;
//   · key 是实例本身,不存在"多个调用点互相驱逐"的问题;
//   · WeakMap 随 diagram 被 GC 自动回收,不会泄漏。
const SELECTION_CACHE = new WeakMap<Diagram, DiagramItemSet>();

export const getSelection = (state: EditorStateInStore): DiagramItemSet => {
    const diagram = state.editor.present.diagrams.get(state.editor.present.selectedDiagramId!);

    if (!diagram) {
        return EMPTY_SELECTION_SET;
    }

    let cached = SELECTION_CACHE.get(diagram);

    if (!cached) {
        cached = DiagramItemSet.createFromDiagram(diagram.selectedIds.values, diagram);
        SELECTION_CACHE.set(diagram, cached);
    }

    return cached;
};

export const getColors = createSelector(
    getEditorRoot,
    editor => {
        const colors: { [color: string]: { count: number; color: Color } } = {};

        const addColor = (value: any) => {
            // 跳过解析不了的颜色值(如纯文本组件底板默认的 'transparent' 关键字):
            // 这里在 useSelector 的 selector 里运行,抛异常会直接导致整棵 React 树卸载白屏。
            let color: Color;

            try {
                color = Color.fromValue(value);
            } catch {
                return;
            }

            let colorKey = color.toString();
            let colorEntry = colors[colorKey];

            if (!colorEntry) {
                colorEntry = { count: 1, color };
                colors[colorKey] = colorEntry;
            } else {
                colorEntry.count++;
            }
        };

        addColor(editor.present.color.toNumber());

        for (const diagram of editor.present.diagrams.values) {
            for (const shape of diagram.items.values) {
                if (shape.type === 'Group') {
                    continue;
                }
                
                for (const [key, value] of shape.appearance.entries) {
                    if (key.endsWith('COLOR')) {
                        addColor(value);
                    }
                }
            }
        }

        const sorted = Object.entries(colors).sort((x, y) => y[1].count - x[1].count);

        return new ColorPalette(sorted.map(x => x[1].color));
    },
    {
        memoizeOptions: {
            equalityCheck: (current: UndoableState<EditorState>, previous: UndoableState<EditorState>) => {
                function shouldChange() {
                    if (current === previous) {
                        return false;
                    }

                    if (current.present.id !== previous.present.id) {
                        return true;
                    }
    
                    const lastAction = previous.lastAction;
    
                    return (
                        addDiagram.match(lastAction) ||
                        addShape.match(lastAction) ||
                        changeColor.match(lastAction) ||
                        changeColors.match(lastAction) ||
                        changeItemsAppearance.match(lastAction) ||
                        pasteItems.match(lastAction) ||
                        removeDiagram.match(lastAction) ||
                        removeItems.match(lastAction)
                    );
                }

                return !shouldChange();
            },
        },
    },
);

export function getPageName(diagram: Diagram | string, index: number): string {
    let title: string | undefined;

    if (Types.isString(diagram)) {
        title = diagram;
    } else {
        title = diagram.title;
    }

    return title || `${texts.common.page} ${index + 1}`;
}

type State = AssetsStateInStore & EditorStateInStore & UIStateInStore & LoadingStateInStore;

export function useStore<T>(selector: ((state: State) => T)) {
    return useSelector<State, T>(p => selector(p));
}