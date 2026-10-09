/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ImmutableList, ImmutableMap, ImmutableSet, MathHelper, Record, Rotation, Types, Vec2 } from '@app/core/utils';
import { Connector, CONNECTOR_RENDERER, connectorGeometry, connectorSlot, connectorWaypoints, flattenPoints, toLegacyAnchor, toRectLike } from '@app/wireframes/shapes/neutral/_connector';
import { Blocker, CONNECTOR_CLEARANCE, CONNECTOR_SELF_INSET, pointsBounds, Pt, RectLike, routeConnector } from '@app/wireframes/shapes/neutral/_connector-routing';
import { DiagramItem } from './diagram-item';
import { DiagramItemSet } from './diagram-item-set';
import { Transform } from './transform';

type Items = ImmutableMap<DiagramItem>;
type ItemIds = ImmutableList<string>;

type UpdateProps = {
    // The list of items.
    items: Items;

    // The item ids.
    itemIds: ItemIds;

    // The selected ids.
    selectedIds: ImmutableSet<string>;
};

type Props = {
    // The unique id of the diagram.
    id: string;

    // The optional title.
    title?: string;

    // The list of items.
    items: Items;

    // The root ids.
    rootIds: ItemIds;

    // The selected ids.
    selectedIds: ImmutableSet<string>;

    // Set the master diagram.
    master?: string;
};

export type InitialDiagramProps = {
    // The unique id of the diagram.
    id?: string;

    // The optional title.
    title?: string;

    // The list of items.
    items?: { [id: string]: DiagramItem } | Items;

    // The rootIds ids.
    rootIds?: ReadonlyArray<string> | ItemIds;

    // Set the master diagram.
    master?: string;
};

export class Diagram extends Record<Props> {
    private cachedParents?: { [id: string]: DiagramItem };
    private cachedRootItems?: DiagramItem[];

    public get id() {
        return this.get('id');
    }

    public get title() {
        return this.get('title');
    }

    public get items() {
        return this.get('items');
    }

    public get rootIds() {
        return this.get('rootIds');
    }

    public get selectedIds() {
        return this.get('selectedIds');
    }

    public get master() {
        return this.get('master');
    }

    public get rootItems(): ReadonlyArray<DiagramItem> {
        return this.cachedRootItems ||= this.findItems(this.rootIds.values);
    }

    public static create(setup: InitialDiagramProps = {}) {
        const { id, items, rootIds, master, title } = setup;

        const props: Props = {
            id: id || MathHelper.nextId(),
            items: ImmutableMap.of(items),
            master,
            rootIds: ImmutableList.of(rootIds),
            selectedIds: ImmutableSet.empty(),
            title,
        };

        return new Diagram(props);
    }

    public children(item: DiagramItem): ReadonlyArray<DiagramItem> {
        return this.findItems(item.childIds.values);
    }

    public findItems(ids: ReadonlyArray<string>) {
        const result: DiagramItem[] = [];

        for (const id of ids) {
            const item = this.items.get(id);

            if (item) {
                result.push(item);
            }
        }

        return result;
    }

    public rename(title: string | undefined) {
        return this.set('title', title);
    }

    public setMaster(master: string | undefined) {
        return this.set('master', master);
    }

    public updateAllItems(updater: (value: DiagramItem) => DiagramItem) {
        return this.set('items', this.items.updateAll(updater));
    }

    public clone() {
        return this.set('id', MathHelper.guid());
    }

    public parent(id: string | DiagramItem) {
        if (!id) {
            return undefined;
        }

        if (Types.is(id, DiagramItem)) {
            id = id.id;
        }

        if (!this.cachedParents) {
            this.cachedParents = {};

            for (const key of this.items.keys) {
                const item = this.items.get(key);

                if (item?.type === 'Group') {
                    for (const childId of item.childIds.values) {
                        this.cachedParents[childId] = item;
                    }
                }
            }
        }

        return this.cachedParents[id];
    }

    public addShape(shape: DiagramItem) {
        if (!shape || this.items.get(shape.id)) {
            return this;
        }

        return this.arrange([], update => {
            update.items = update.items.set(shape.id, shape);

            if (update.items !== this.items) {
                update.itemIds = update.itemIds.add(shape.id);
            }
        });
    }

    // 重新计算连接线的几何:
    //   1. 按当前两个端点组件的 AABB 重新选边(FR-2),组件易位后会自动换边(CONN-002)
    //   2. 槽位 → 沿边参数(FR-1 基准 = 边中点,FR-4 = 同边等间距错开)
    //   3. 正交 A* 路由绕开其它组件(FR-3),并穿过用户固定的途经点(FR-6)
    //   4. bbox = 端点 ∪ 全部拐点 的外接矩形,局部坐标以该 bbox 原点为基准
    //
    // 几何全部落在 appearance 上(不透明、可序列化、天然进撤销栈),渲染层只负责"照着画"。
    //
    // changedItemIds: 只重算与这些 item 相关的连线;为空/未传时全量重算。
    public maintainConnectors(changedItemIds?: ReadonlySet<string>): Diagram {
        // 组件位置在一次维护过程中不会变化,所以障碍与端点 bounds 只取一次。
        const componentRects = new Map<string, RectLike>();
        const connectorIds: string[] = [];

        for (const item of this.items.values) {
            if (item.renderer === CONNECTOR_RENDERER) {
                connectorIds.push(item.id);
            } else if (item.type !== 'Group') {
                componentRects.set(item.id, toRectLike(item.bounds(this).aabb));
            }
        }

        let next: Diagram = this;

        for (const connectorId of connectorIds) {
            const connector = this.items.get(connectorId);

            if (!connector) {
                continue;
            }

            const sourceId = connector.appearance.get(Connector.SOURCE);
            const targetId = connector.appearance.get(Connector.TARGET);

            if (!sourceId || !targetId) {
                continue;
            }

            if (changedItemIds && changedItemIds.size > 0 &&
                !changedItemIds.has(sourceId) && !changedItemIds.has(targetId) && !changedItemIds.has(connectorId)) {
                continue;
            }

            const srcBounds = componentRects.get(sourceId);
            const tgtBounds = componentRects.get(targetId);

            // 端点组件已被删除(尚未清理)时跳过,由 removeDanglingConnectors 负责回收。
            if (!srcBounds || !tgtBounds) {
                continue;
            }

            const geo = connectorGeometry(connector, srcBounds, tgtBounds);

            // 障碍:其它组件外扩 CLEARANCE;源/目标自身内缩,允许贴边走、禁止穿体。
            const blockers: Blocker[] = [];

            for (const [otherId, rect] of componentRects) {
                if (otherId === sourceId || otherId === targetId) {
                    continue;
                }

                blockers.push({ clearance: CONNECTOR_CLEARANCE, rect });
            }

            blockers.push({ clearance: -CONNECTOR_SELF_INSET, rect: srcBounds });
            blockers.push({ clearance: -CONNECTOR_SELF_INSET, rect: tgtBounds });

            const result = routeConnector({
                blockers,
                n1: geo.n1,
                n2: geo.n2,
                p1: geo.p1,
                p2: geo.p2,
                type: connector.appearance.get(Connector.TYPE) ?? 'orthogonal',
                vias: connectorWaypoints(connector),
            });

            const points: Pt[] = result.points.length >= 2 ? result.points : [geo.p1, geo.p2];
            const rect = pointsBounds(points);

            // 先构造 Transform,再以它的 left/top 作为局部坐标原点 ——
            // Transform 会对 position/size 取整,直接用原始 bbox 会产生亚像素错位。
            const transform = new Transform(new Vec2(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5), new Vec2(rect.w, rect.h), Rotation.ZERO);
            const originX = transform.left;
            const originY = transform.top;

            const local = points.map(p => ({ x: p.x - originX, y: p.y - originY }));

            next = next.updateItems([connectorId], item => {
                return item
                    .transformWith(() => transform)
                    .setAppearanceMany({
                        [Connector.ANCHOR]: toLegacyAnchor(geo),
                        [Connector.DEGRADED]: result.degraded,
                        [Connector.PTS]: flattenPoints(local),
                        [Connector.SIDES]: { ss: geo.ss, ts: geo.ts },
                        [Connector.SLOT]: connectorSlot(connector),
                        [Connector.WAYPOINTS]: result.vias,
                        [Connector.X1]: local[0].x, [Connector.Y1]: local[0].y,
                        [Connector.X2]: local[local.length - 1].x, [Connector.Y2]: local[local.length - 1].y,
                    });
            });
        }

        return next;
    }

    // 删除引用了不存在端点的连接线(CONN-001:删组件后连线残留)。
    // 端点组件被删除时,与之相连的连线会同时消失;撤销可一并恢复。
    public removeDanglingConnectors(): Diagram {
        const dangling: string[] = [];

        for (const item of this.items.values) {
            if (item.renderer !== CONNECTOR_RENDERER) {
                continue;
            }

            const sourceId = item.appearance.get(Connector.SOURCE);
            const targetId = item.appearance.get(Connector.TARGET);

            if (!sourceId || !targetId || !this.items.get(sourceId) || !this.items.get(targetId)) {
                dangling.push(item.id);
            }
        }

        if (dangling.length === 0) {
            return this;
        }

        return this.removeItems(DiagramItemSet.createFromDiagram(dangling, this));
    }

    public updateItems(ids: ReadonlyArray<string>, updater: (value: DiagramItem) => DiagramItem) {
        return this.arrange(EMPTY_SELECTION, update => {
            update.items = update.items.mutate(mutator => {
                for (const id of ids) {
                    mutator.update(id, updater);
                }
            });
        });
    }

    public selectItems(ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.selectedIds = ImmutableSet.of(...ids);
        });
    }

    public moveItems(ids: ReadonlyArray<string>, index: number) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.moveTo(ids, index);
        }, 'SameParent');
    }

    public bringToFront(ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.bringToFront(ids);
        }, 'SameParent');
    }

    public bringForwards(ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.bringForwards(ids);
        }, 'SameParent');
    }

    public sendToBack(ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.sendToBack(ids);
        }, 'SameParent');
    }

    public sendBackwards(ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.sendBackwards(ids);
        }, 'SameParent');
    }

    public group(groupId: string, ids: ReadonlyArray<string>) {
        return this.arrange(ids, update => {
            update.itemIds = update.itemIds.add(groupId).remove(...ids);
            update.items = update.items.set(groupId, DiagramItem.createGroup({ id: groupId, childIds: ids }));
        }, 'SameParent');
    }

    public ungroup(groupId: string) {
        return this.arrange([groupId], update => {
            const group = this.items.get(groupId)!;

            update.itemIds = update.itemIds.add(...group.childIds.values).remove(groupId);
            update.items = update.items.remove(groupId);
        });
    }

    public addItems(set: DiagramItemSet): Diagram {
        if (!set.canAdd(this)) {
            return this;
        }

        return this.arrange(EMPTY_SELECTION, update => {
            update.items = update.items.mutate(mutator => {
                for (const item of set.nested.values()) {
                    mutator.set(item.id, item);
                }
            });

            update.itemIds = update.itemIds.add(...set.rootIds);
        });
    }

    public removeItems(set: DiagramItemSet): Diagram {
        if (!set.canRemove(this)) {
            return this;
        }

        return this.arrange(EMPTY_SELECTION, update => {
            update.items = update.items.mutate(m => {
                for (const item of set.nested.values()) {
                    m.remove(item.id);
                }
            });

            update.selectedIds = update.selectedIds.mutate(m => {
                for (const id of set.nested.keys()) {
                    m.remove(id);
                }
            });

            update.itemIds = update.itemIds.remove(...set.rootIds);
        });
    }

    public masterDiagrams(diagrams: ImmutableMap<Diagram>): Diagram[] {
        const seenDiagrams = new Set<string>([this.id]);
        const result: Diagram[] = [];
        let masterId = this.master;
        while (masterId !== undefined && !seenDiagrams.has(masterId)) {
            const master = diagrams.get(masterId);
            if (!master) {
                break;
            }
            result.unshift(master);
            seenDiagrams.add(masterId);
            masterId = master.master;
        }
        return result;
    }

    private arrange(targetIds: Iterable<string>, updater: (diagram: UpdateProps) => void, condition?: 'NoCondition' | 'SameParent'): Diagram {
        if (!targetIds) {
            return this;
        }

        let resultParent: DiagramItem | undefined = undefined;
        let index = 0;

        // All items must have the same parent for the update.
        for (const itemId of targetIds) {
            const item = this.items.get(itemId);

            if (!item) {
                return this;
            }

            const parent = this.parent(itemId);

            if (index === 0) {
                resultParent = parent;
            } else if (parent !== resultParent && condition === 'SameParent') {
                return this;
            }

            index++;
        }

        if (resultParent) {
            const update = {
                items: this.items,
                itemIds: resultParent.childIds,
                selectedIds: this.selectedIds,
            };

            updater(update);

            if (update.itemIds !== resultParent.childIds) {
                update.items = update.items.update(resultParent.id, p => p.set('childIds', update.itemIds));
            }

            return this.merge({ items: update.items, selectedIds: update.selectedIds });
        } else {
            const update = {
                items: this.items,
                itemIds: this.rootIds,
                selectedIds: this.selectedIds,
            };

            updater(update);

            return this.merge({ items: update.items, selectedIds: update.selectedIds, rootIds: update.itemIds });
        }
    }
}

const EMPTY_SELECTION: ReadonlyArray<string> = [];