/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Types } from '@app/core/utils';
import { CONNECTOR_RENDERER } from '@app/wireframes/shapes/neutral/_connector';
import { Diagram } from './diagram';
import { DiagramItem } from './diagram-item';

export class DiagramItemSet {
    private cachedSelectedItems?: ReadonlyArray<DiagramItem>;
    private cachedEditableItems?: ReadonlyArray<DiagramItem>;
    private cachedEditableId?: Set<string>;
    private cachedAppearanceItems?: ReadonlyArray<DiagramItem>;

    public static EMPTY = new DiagramItemSet(new Map(), new Map());

    public readonly rootIds: string[] = [];
    public readonly isComplete: boolean = true;

    public get selectedItems() {
        return this.cachedSelectedItems ||= Array.from(this.selection.values());
    }

    public get editableItems() {
      // 连接线不是自由变换对象:它的几何由 maintainConnectors 决定,
      // 拖拽/缩放只会被下一帧覆盖,所以从可变换集合里排除(CONN-008)。
      return this.cachedEditableItems ||= Array.from(this.nested.values())
          .filter(x => x.renderer !== CONNECTOR_RENDERER)
          .filter(x => !this.selection.has(x.id) || !x.isLocked);
    }

    public get appearanceItems() {
      // appearance 类修改(颜色/线宽/线型/字号等)对连线同样有意义 —— 线色、虚线、
      // 箭头都是连线的外观。因此这里只排除锁定项,**不**排除连接线:
      // CONN-008 的"连线不可变换"只针对几何变换(editableItems),不针对外观修改。
      // (曾误用 editableItems 做改色目标集,导致选中连线后改颜色/线宽静默无效。)
      return this.cachedAppearanceItems ||= Array.from(this.nested.values())
          .filter(x => !this.selection.has(x.id) || !x.isLocked);
    }

    public get editableIds() {
        return this.cachedEditableId ||= new Set(this.editableItems.map(x => x.id));
    }

    constructor(
        public readonly nested: Map<string, DiagramItem>,
        public readonly selection: Map<string, DiagramItem>,
    ) {
        const parents: { [id: string]: boolean } = {};

        for (const item of nested.values()) {
            if (item.type !== 'Group') {
                continue;
            }

            for (const childId of item.childIds.values) {
                if (!nested.get(childId) || parents[childId]) {
                    this.isComplete = false;
                }

                parents[childId] = true;
            }
        }

        for (const item of nested.values()) {
            if (!parents[item.id]) {
                this.rootIds.push(item.id);
            }
        }
    }

    public static createFromDiagram(items: ReadonlyArray<string | DiagramItem>, diagram: Diagram): DiagramItemSet {
        const allItems = new Map<string, DiagramItem>();
        const allSources = new Map<string, DiagramItem>();

        flattenRootItems(items, diagram, allItems, allSources);

        return new DiagramItemSet(allItems, allSources);
    }

    public canAdd(diagram: Diagram): boolean {
        if (!this.isComplete) {
            return false;
        }

        for (const item of this.nested.values()) {
            if (diagram.items.has(item.id)) {
                return false;
            }
        }

        return true;
    }

    public canRemove(diagram: Diagram): boolean {
        if (!this.isComplete) {
            return false;
        }

        for (const item of this.nested.values()) {
            if (!diagram.items.has(item.id)) {
                return false;
            }
        }

        return true;
    }
}

type OrderedItems = { item: DiagramItem; orderIndex: number }[];

function flattenRootItems(items: ReadonlyArray<string | DiagramItem>, diagram: Diagram, allItems: Map<string, DiagramItem>, source: Map<string, DiagramItem>) {
    const byRoot: OrderedItems = [];
    const byParents = new Map<string, OrderedItems>();

    for (const itemOrId of items) {
        let item = itemOrId;

        if (Types.isString(itemOrId)) {
            item = diagram.items.get(itemOrId)!;
        } else {
            item = itemOrId;
        }

        if (!item) {
            continue;
        }

        const parent = diagram.parent(item);

        if (parent) {
            let byParent = byParents.get(parent.id);

            if (!byParent) {
                byParent = [];
                byParents.set(parent.id, byParent);
            }

            const orderIndex = parent.childIds.indexOf(item.id);

            byParent.push({ orderIndex, item });                
        } else {
            const orderIndex = diagram.rootIds.indexOf(item.id);

            byRoot.push({ orderIndex, item });   
        }

        source.set(item.id, item);
    }

    unrollParent(byRoot, diagram, allItems);

    for (const byParent of byParents.values()) {        
        unrollParent(byParent, diagram, allItems);
    }
}

function unrollParent(byParent: OrderedItems, diagram: Diagram, allItems: Map<string, DiagramItem>) {
    if (byParent.length === 0) {
        return;
    }

    byParent.sort((a, b) => a.orderIndex - b.orderIndex);

    for (const { item } of byParent) {
        allItems.set(item.id, item);

        if (item.type === 'Group') {
            unrollItems(item.childIds.values, diagram, allItems);
        }
    }
}

function unrollItems(source: ReadonlyArray<string>, diagram: Diagram, allItems: Map<string, DiagramItem>) {
    for (const itemOrId of source) {
        let item = diagram.items.get(itemOrId);

        if (!item) {
            continue;
        }

        allItems.set(item.id, item);

        if (item.type === 'Group') {
            unrollItems(item.childIds.values, diagram, allItems);
        }
    }
}