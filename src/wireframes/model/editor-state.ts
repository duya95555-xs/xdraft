/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Color, ImmutableList, ImmutableMap, MathHelper, Record, Vec2 } from '@app/core/utils';
import { Diagram } from './diagram';
import { UndoableState } from './undoable-state';

// The default canvas size when no user-defined default size is stored.
export const DEFAULT_DIAGRAM_SIZE = new Vec2(1000, 1000);

// The localStorage key for the user-defined default canvas size.
const DEFAULT_SIZE_STORAGE_KEY = 'defaultDiagramSize';

// 没有显式文档名时使用的兜底名字。
//
// 刻意**不**回落到"当前选中页的标题":那正是"切到第 3 页、自动保存就写到另一个文件、
// 一份文档散成 N 个文件"的成因。文档名与页标题彻底解耦,页标题只在"首次保存时给
// 文件对话框做预填"这一处被参考(见 suggestedName)。
export const UNNAMED_DOCUMENT = '未命名文档';

// Reads the user-defined default canvas size for new diagrams from the local storage.
export function getDefaultDiagramSize(): Vec2 {
    try {
        const stored = window.localStorage.getItem(DEFAULT_SIZE_STORAGE_KEY);

        if (stored) {
            const { w, h } = JSON.parse(stored);

            if (typeof w === 'number' && typeof h === 'number' && w >= 100 && w <= 3000 && h >= 100 && h <= 3000) {
                return new Vec2(w, h);
            }
        }
    } catch {
        // Ignore invalid or unavailable storage.
    }

    return DEFAULT_DIAGRAM_SIZE;
}

// Persists the given size as the default canvas size for new diagrams.
export function saveDefaultDiagramSize(width: number, height: number) {
    try {
        window.localStorage.setItem(DEFAULT_SIZE_STORAGE_KEY, JSON.stringify({ w: width, h: height }));
    } catch {
        // Ignore storage errors.
    }
}

type Diagrams = ImmutableMap<Diagram>;
type DiagramIds = ImmutableList<string>;

type Props = {
    // The id of the selected diagram.
    selectedDiagramId?: string | null;

    // The actual diagrams.
    diagrams: Diagrams;

    // The list of ordered diagram ids.
    diagramIds: DiagramIds;

    // The size of all diagrams.
    size: Vec2;

    // The id of the state.
    id: string;

    // The color for all diagrams.
    color: Color;

    // 文档名(文档级,不是页标题)。所有保存入口统一使用它。
    name?: string;
};

export type InitialEditorProps = {
    // The actual diagrams.
    diagrams?: { [id: string]: Diagram } | ImmutableMap<Diagram>;

    // The list of ordered diagram ids.
    diagramIds?: ReadonlyArray<string> | DiagramIds;

    // The size of all diagrams.
    size?: Vec2;

    // The color for all diagrams.
    color?: Color;

    // 文档名。
    name?: string;

    // 恢复上次选中的页。
    selectedDiagramId?: string | null;
};

export class EditorState extends Record<Props> {
    public get id() {
        return this.get('id');
    }

    public get selectedDiagramId() {
        return this.get('selectedDiagramId');
    }

    public get diagrams() {
        return this.get('diagrams');
    }

    public get diagramIds() {
        return this.get('diagramIds');
    }

    public get color() {
        return this.get('color');
    }

    public get size() {
        return this.get('size');
    }

    // 显式的文档名。可能为空 —— 空表示"用户还没起过名字"。
    public get name() {
        return this.get('name');
    }

    // 展示与落盘统一使用的文档名:没有显式名字时给一个稳定兜底。
    // ⚠️ 兜底值**不**取自任何一页的标题,避免"改页名 = 换文件"。
    public get documentName(): string {
        const name = this.name?.trim();

        return name && name.length > 0 ? name : UNNAMED_DOCUMENT;
    }

    // 仅用于"首次保存"时给文件对话框预填名字:优先文档名,其次第一页标题。
    // 这是"建议值",不是持续依赖 —— 一旦落盘,后续一切以文档名为准。
    public get suggestedName(): string {
        const name = this.name?.trim();

        if (name && name.length > 0) {
            return name;
        }

        return this.orderedDiagrams[0]?.title?.trim() || UNNAMED_DOCUMENT;
    }

    public get orderedDiagrams(): ReadonlyArray<Diagram> {
        return this.findDiagrams(this.diagramIds.values);
    }

    public static create(setup: InitialEditorProps = {}): EditorState {
        const { color, diagrams, diagramIds, name, selectedDiagramId, size } = setup;

        const props: Props = {
            id: MathHelper.guid(),
            color: color || Color.WHITE,
            diagrams: ImmutableMap.of(diagrams),
            diagramIds: ImmutableList.of(diagramIds),
            name,
            selectedDiagramId,
            size: size || getDefaultDiagramSize(),
        };

        return new EditorState(props);
    }

    public findDiagrams(ids: ReadonlyArray<string>) {
        const result: Diagram[] = [];

        for (const id of ids) {
            const item = this.diagrams.get(id);

            if (item) {
                result.push(item);
            }
        }
        
        return result;
    }

    public changeSize(size: Vec2) {
        return this.set('size', size);
    }

    public changeColor(color: Color) {
        return this.set('color', color);
    }

    public rename(name: string | undefined) {
        return this.set('name', name);
    }

    public moveDiagram(diagramId: string, index: number) {
        return this.set('diagramIds', this.diagramIds.moveTo([diagramId], index));
    }

    public updateDiagram(diagramId: string, updater: (value: Diagram) => Diagram) {
        return this.set('diagrams', this.diagrams.update(diagramId, updater));
    }

    public updateAllDiagrams(updater: (value: Diagram) => Diagram) {
        return this.set('diagrams', this.diagrams.updateAll(updater));
    }

    public selectDiagram(diagramId: string | null | undefined) {
        if (!this.diagrams.get(diagramId!)) {
            return this;
        }

        return this.set('selectedDiagramId', diagramId);
    }

    public removeDiagram(diagramId: string) {
        return this.merge({
            diagrams: this.diagrams.remove(diagramId),
            diagramIds: this.diagramIds.remove(diagramId),
            selectedDiagramId: this.selectedDiagramId ? null : this.selectedDiagramId,
        });
    }

    public addDiagram(diagram: Diagram) {
        if (!diagram || this.diagrams.get(diagram.id)) {
            return this;
        }

        return this.merge({
            diagrams: this.diagrams.set(diagram.id, diagram),
            diagramIds: this.diagramIds.add(diagram.id),
        });
    }
}

export interface EditorStateInStore {
    editor: UndoableState<EditorState>;
}
