/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Color, ImmutableList, ImmutableMap, MathHelper, Rotation, Types, Vec2 } from '@app/core/utils';
import { Connector } from '@app/wireframes/shapes/neutral/_connector';
import { Diagram } from './diagram';
import { DiagramItem } from './diagram-item';
import { DiagramItemSet } from './diagram-item-set';
import { EditorState } from './editor-state';
import { PluginRegistry } from './registry';
import { Transform } from './transform';

type IdMap = { [id: string]: string };

// 加载期间因为"插件不认识这个 renderer"而被跳过的组件数量。
//
// readDiagramItem 没有可用的返回通道(调用方 deserializeSet / readDiagram 会直接
// 跳过 null),所以用模块级计数器把"丢了几个"收集起来:加载流程在反序列化**之前**
// resetSkippedItems(),在**之后** getSkippedItems() 取走并提示用户。
// 以前这里是静默 return null —— 跨版本打开文件会无声丢组件,用户完全看不出。
let skippedItems = 0;

export namespace Serializer {
    export function resetSkippedItems() {
        skippedItems = 0;
    }

    export function getSkippedItems() {
        return skippedItems;
    }

    export function tryGenerateNewIds(json: string): string {
        try {
            return generateNewIds(json);
        } catch {
            return json;
        }
    }

    export function generateNewIds(json: string): string {
        const input = JSON.parse(json);

        const idMap: IdMap = {};

        for (const jsonShape of input.visuals) {
            const oldId = jsonShape.id;

            jsonShape.id = MathHelper.nextId();

            idMap[oldId] = jsonShape.id;
        }

        for (const jsonGroup of input.groups) {
            const oldId = jsonGroup.id;

            jsonGroup.id = MathHelper.nextId();

            idMap[oldId] = jsonGroup.id;
        }

        for (const jsonGroup of input.groups) {
            jsonGroup.childIds = jsonGroup.childIds.map((id: string) => idMap[id]);
        }

        // 连接线的端点存在 appearance 里(而不是 childIds),必须同步重映射,
        // 否则粘贴出来的连线会连回原图纸上的旧组件(CONN-003)。
        for (const jsonShape of input.visuals) {
            const appearance = jsonShape.appearance;

            if (!appearance) {
                continue;
            }

            const sourceId = appearance[Connector.SOURCE];
            const targetId = appearance[Connector.TARGET];

            if (Types.isString(sourceId) && idMap[sourceId]) {
                appearance[Connector.SOURCE] = idMap[sourceId];
            }

            if (Types.isString(targetId) && idMap[targetId]) {
                appearance[Connector.TARGET] = idMap[targetId];
            }
        }

        return JSON.stringify(input);
    }

    export function deserializeSet(input: any): DiagramItemSet {
        const allItems = new Map<string, DiagramItem>();

        for (const inputVisual of input.visuals) {
            const item = readDiagramItem(inputVisual, 'Shape');

            if (item) {
                allItems.set(item.id, item);
            }
        }

        for (const inputGroup of input.groups) {
            const item = readDiagramItem(inputGroup, 'Group');

            if (item) {
                allItems.set(item.id, item);
            }
        }

        return new DiagramItemSet(allItems, allItems);
    }

    export function serializeSet(set: DiagramItemSet) {
        const output: any = { visuals: [], groups: [] };

        for (const item of set.nested.values()) {
            const serialized = writeDiagramItem(item);

            if (item.type === 'Shape') {
                output.visuals.push(serialized);
            } else {
                output.groups.push(serialized);
            }
        }

        return output;
    }

    export function deserializeEditor(input: any) {
        return readEditor(input);
    }

    export function serializeEditor(editor: EditorState) {
        const output = writeEditor(editor);

        return output;
    }
}

function writeEditor(source: EditorState) {
    return writeObject(source.unsafeValues(), EDITOR_SERIALIZERS);
}

function writeDiagram(source: Diagram) {
    return writeObject(source.unsafeValues(), DIAGRAM_SERIALIZERS);
}

function writeDiagramItem(source: DiagramItem) {
    return writeObject(source.unsafeValues(), DIAGRAM_ITEM_SERIALIZERS);
}

function writeObject(source: object, serializers: PropertySerializers) {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(source)) {
        const serializer = serializers[key];

        if (serializer) {
            result[key] = serializer.get(value);
        }
    }

    return result;
}

function readEditor(source: Record<string, any>) {
    const raw: any = readObject(source, EDITOR_SERIALIZERS);

    return EditorState.create(raw);
}

function readDiagram(source: Record<string, any>) {
    const raw: any = readObject(source, DIAGRAM_SERIALIZERS);

    if (!raw.rootIds) {
        raw.rootIds = source['itemIds'];
    }

    return Diagram.create(raw);
}

function readDiagramItem(source: object, type?: any) {
    const raw: any = readObject(source, DIAGRAM_ITEM_SERIALIZERS);

    if ((raw.type || type) === 'Shape') {
        const defaults = PluginRegistry.get(raw.renderer!)?.createDefaultShape();

        if (!defaults) {
            // 未知 renderer —— 通常是"用旧版程序打开新版文件",或插件被移除。
            // 以前这里静默 return null,组件无声消失;现在计数,由加载流程提示
            // "N 个组件无法识别",至少让用户知道内容不完整。
            skippedItems++;
            return null;
        }

        return DiagramItem.createShape({ ...defaults, ...raw });
    } else {
        return DiagramItem.createGroup(raw);
    }
}

function readObject(source: Record<string, any>, serializers: PropertySerializers) {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(source)) {
        const serializer = serializers[key];

        if (serializer) {
            result[key] = serializer.set(value);
        }
    }

    return result;
}

interface PropertySerializer {
    get(source: any): any;
    
    set(source: any): any;
}

type PropertySerializers = { [key: string]: PropertySerializer };

const EDITOR_SERIALIZERS: PropertySerializers = {
    'id': {
        get: (source) => source,
        set: (source) => source,
    },
    'diagrams': {
        get: (source: ImmutableMap<Diagram>) => Array.from(source.values, writeDiagram),
        set: (source: any[]) => buildObject(source.map(readDiagram), x => x.id),
    },
    'diagramIds': {
        get: (source: ImmutableList<string>) => source.values,
        set: (source) => source,
    },
    'size': {
        get: (source: Vec2) => ({ x: source.x, y: source.y }),
        set: (source: any) => new Vec2(source.x, source.y),
    },
    // ── 以下三个此前**漏在序列化表之外**,各自对应一个存量缺陷 ──────────────
    //
    // 'color'   —— 画布底色。以前只能靠回放 changeColor 动作恢复,一旦这次改动掉出
    //              50 步撤销窗口,底色就**永久丢失**(快照里根本没有它)。
    // 'name'    —— 文档名。没有它,"一个文档一个文件"就无从谈起。
    // 'selectedDiagramId' —— 上次选中的页。以前重开必跳回第 1 页(selectDiagram 又在
    //              actionsToIgnore 里,永远不会进动作日志)。
    'color': {
        get: (source: Color) => source.toString(),
        set: (source: any) => Color.fromValue(source),
    },
    'name': {
        get: (source) => source,
        set: (source) => source,
    },
    'selectedDiagramId': {
        get: (source) => source,
        set: (source) => source,
    },
};

const DIAGRAM_SERIALIZERS: PropertySerializers = {
    'id': {
        get: (source) => source,
        set: (source) => source,
    },
    'master': {
        get: (source) => source,
        set: (source) => source,
    },
    'items': {
        get: (source: ImmutableMap<DiagramItem>) => Array.from(source.values, writeDiagramItem),
        set: (source: any[]) => buildObject(source.map(readDiagramItem), x => x.id),
    },
    'rootIds': {
        get: (source: ImmutableList<string>) => source.values,
        set: (source) => source,
    },
    'title': {
        get: (source) => source,
        set: (source) => source,
    },
};

const DIAGRAM_ITEM_SERIALIZERS: PropertySerializers = {
    'appearance': {
        get: (source: ImmutableMap<any>) => Object.fromEntries(source.entries),
        set: (source: any) => source,
    },
    'childIds': {
        get: (source: ImmutableList<string>) => Array.from(source.values),
        set: (source) => source,
    },
    'id': {
        get: (source) => source,
        set: (source) => source,
    },
    'isLocked': {
        get: (source) => source,
        set: (source) => source,
    },
    'name': {
        get: (source) => source,
        set: (source) => source,
    },
    'renderer': {
        get: (source) => source,
        set: (source) => source,
    },
    'rotation': {
        get: (source: Rotation) => source.degree,
        set: (source: any) => Rotation.fromDegree(source),
    },
    'type': {
        get: (source) => source,
        set: (source) => source,
    },
    'transform': {
        get: (source: Transform) => source.toJS(),
        set: (source: any) => Transform.fromJS(source),
    },
};

function buildObject<V>(source: ReadonlyArray<V | undefined | null>, selector: (source: V) => string) {
    const result: { [key: string]: V } = {};

    for (const item of source) {
        if (item) {
            result[selector(item)] = item;
        }
    }

    return result;
}