/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

/* eslint-disable @typescript-eslint/no-loop-func */

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { MathHelper, Rotation, Vec2 } from '@app/core/utils';
import { Appearance } from '@app/wireframes/interface';
import { Connector, CONNECTOR_RENDERER, connectorSlot, connectorWaypoints, nearestAnchorSide, nextSlotFor, slotForIndex, toRectLike } from '@app/wireframes/shapes/neutral/_connector';
import { Side } from '@app/wireframes/shapes/neutral/_connector-routing';
import { Connect } from '@app/wireframes/shapes/neutral/connect';
import { Diagram, DiagramItem, DiagramItemSet, EditorState, PluginRegistry, Serializer, Transform } from './../internal';
import { DefaultConfigurableFactory } from './../factories';
import { createDiagramAction, createItemsAction, DiagramRef, ItemsRef } from './utils';

// 合法的边标识,用于校验从 appearance 里读出来的 SIDES 是否可信。
const VALID_SIDES: { [key: string]: boolean } = { B: true, L: true, R: true, T: true };

export const addShape =
    createAction('items/addShape', (diagram: DiagramRef, renderer: string, props: { position?: { x: number; y: number }; size?: { x: number; y: number }; appearance?: Appearance } = {}, id?: string) => {
        return { payload: createDiagramAction(diagram, { id: id || MathHelper.nextId(), renderer, ...props }) };
    });

export const lockItems =
    createAction('items/lock', (diagram: DiagramRef, items: ItemsRef) => {
        return { payload: createItemsAction(diagram, items) };
    });

export const unlockItems =
    createAction('items/unlock', (diagram: DiagramRef, items: ItemsRef) => {
        return { payload: createItemsAction(diagram, items) };
    });

export const selectItems =
    createAction('items/select', (diagram: DiagramRef, items: ItemsRef) => {
        return { payload: createItemsAction(diagram, items) };
    });

export const removeItems =
    createAction('items/remove', (diagram: DiagramRef, items: ItemsRef) => {
        return { payload: createItemsAction(diagram, items) };
    });

export const renameItems =
    createAction('items/rename', (diagram: DiagramRef, items: ItemsRef, name: string) => {
        return { payload: createItemsAction(diagram, items, { name }) };
    });

export const pasteItems =
    createAction('items/paste', (diagram: DiagramRef, json: string, offset = 0) => {
        return { payload: createDiagramAction(diagram, { json: Serializer.tryGenerateNewIds(json), offset }) };
    });

// 在源/目标 item 之间创建一条连接线;源/目标必须是 connectable()=true 且未锁定的组件,否则静默忽略。
//
// points 是"鼠标按下 / 松开位置"(diagram 绝对坐标):给出时按"距离该位置最近的边中点"选边,
// 并标记为手动选边(SIDES_MANUAL)⇒ 永久固定;未给出、或位置落在组件中心区域无法判断时,
// 回退到 chooseSides 的自动选边。
export const addConnector =
    createAction('items/addConnector', (diagram: DiagramRef, source: DiagramItem, target: DiagramItem, anchor?: { sx: number; sy: number; tx: number; ty: number }, points?: { source?: { x: number; y: number }; target?: { x: number; y: number } }) => {
        return { payload: createDiagramAction(diagram, { sourceId: source.id, targetId: target.id, anchor, sourcePoint: points?.source, targetPoint: points?.target }) };
    });

// 设置连接线的用户固定途经点(FR-6)。传空数组即恢复全自动路由。
export const setConnectorWaypoints =
    createAction('items/connectorWaypoints', (diagram: DiagramRef, items: ItemsRef, waypoints: ReadonlyArray<{ x: number; y: number }>) => {
        return { payload: createItemsAction(diagram, items, { waypoints }) };
    });

// 端点改接(C1):把连接线的 source 端或 target 端改接到另一个组件上。
//
// point 是"鼠标释放位置"(diagram 绝对坐标),用来决定改接后从/到哪条边出入,
// 与创建连线时的选边口径完全一致(nearestAnchorSide → 手选;判断不出 → 回退自动选边)。
//
// 改接会使原来的途经点失去意义(它们是按旧路径固定的),因此一并清空。
export const reconnectConnector =
    createAction('items/reconnectConnector', (diagram: DiagramRef, connector: ItemsRef, end: 'source' | 'target', target: DiagramItem, point?: { x: number; y: number }) => {
        return { payload: createItemsAction<{ end: 'source' | 'target'; point?: { x: number; y: number }; targetId: string }>(diagram, connector, { end, point, targetId: target.id }) };
    });

export function buildItems(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(selectItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                return diagram.selectItems(itemIds);
            });
        })
        .addCase(removeItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const set = DiagramItemSet.createFromDiagram(itemIds, diagram);

                // 级联删除引用了这些组件的连接线(CONN-001):
                // 否则删掉组件后连线会留在画布上,而且几何被"冻结"在最后一帧。
                const affected = new Set<string>(set.nested.keys());

                for (const item of diagram.items.values) {
                    if (item.renderer !== CONNECTOR_RENDERER) {
                        continue;
                    }

                    const sourceId = item.appearance.get(Connector.SOURCE);
                    const targetId = item.appearance.get(Connector.TARGET);

                    if ((sourceId && affected.has(sourceId)) || (targetId && affected.has(targetId))) {
                        affected.add(item.id);
                    }
                }

                const full = DiagramItemSet.createFromDiagram([...affected], diagram);

                return diagram.removeItems(full).removeDanglingConnectors();
            });
        })
        .addCase(lockItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const set = DiagramItemSet.createFromDiagram(itemIds, diagram);

                return diagram.updateItems([...set.nested.keys()], item => {
                    return item.lock();
                });
            });
        })
        .addCase(unlockItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const set = DiagramItemSet.createFromDiagram(itemIds, diagram);

                return diagram.updateItems([...set.nested.keys()], item => {
                    return item.unlock();
                });
            });
        })
        .addCase(renameItems, (state, action) => {
            const { diagramId, itemIds, name } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                return diagram.updateItems(itemIds, item => {
                    return item.rename(name);
                });
            });
        })
        .addCase(pasteItems, (state, action) => {
            const { diagramId, json, offset } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                // Serializer 已把 CONNECTOR_SOURCE / TARGET 重映射到新 id(CONN-003)。
                const set = Serializer.deserializeSet(JSON.parse(json));

                diagram = diagram.addItems(set);

                diagram = diagram.updateItems([...set.nested.keys()], item => {
                    const boundsOld = item.bounds(diagram);
                    const boundsNew = boundsOld.moveBy(new Vec2(offset, offset));

                    let result = item.transformByBounds(boundsOld, boundsNew);

                    // 途经点是绝对坐标,不跟随 transform 偏移,这里手动平移。
                    const waypoints = connectorWaypoints(result);

                    if (waypoints.length > 0) {
                        result = result.setAppearance(Connector.WAYPOINTS, waypoints.map(p => ({ x: p.x + offset, y: p.y + offset })));
                    }

                    return result;
                });
                
                diagram = diagram.selectItems(set.rootIds);

                return diagram.maintainConnectors(new Set([...set.nested.keys()]));
            });
        })
        .addCase(setConnectorWaypoints, (state, action) => {
            const { diagramId, itemIds, waypoints } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const next = diagram.updateItems(itemIds, item =>
                    item.setAppearance(Connector.WAYPOINTS, waypoints ?? []));

                // 途经点是硬约束,写回后必须立刻重路由才能看到效果。
                return next.maintainConnectors(new Set(itemIds));
            });
        })
        .addCase(reconnectConnector, (state, action) => {
            const { diagramId, itemIds, end, point, targetId } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const connectorId = itemIds[0];
                const connector = connectorId ? diagram.items.get(connectorId) : undefined;
                const target = diagram.items.get(targetId);

                // 只处理连接线;目标必须 connectable()=true 且未锁定(CONN-006 同口径)。
                if (!connector || connector.renderer !== CONNECTOR_RENDERER || !target) {
                    return diagram;
                }

                if (!(PluginRegistry.get(target.renderer)?.plugin?.connectable?.()) || target.isLocked) {
                    return diagram;
                }

                const sourceId = connector.appearance.get(Connector.SOURCE);
                const targetOldId = connector.appearance.get(Connector.TARGET);

                // 改接到自己原来的一端 = 无变化。
                const newSourceId = end === 'source' ? targetId : sourceId;
                const newTargetId = end === 'target' ? targetId : targetOldId;

                if (!newSourceId || !newTargetId || newSourceId === newTargetId) {
                    return diagram;
                }

                const newSource = diagram.items.get(newSourceId);

                if (!newSource ||
                    !(PluginRegistry.get(newSource.renderer)?.plugin?.connectable?.()) ||
                    newSource.isLocked) {
                    return diagram;
                }

                // ── 选边 ────────────────────────────────────────────────────────
                // 只对"刚被改接的那一端"按鼠标位置重新选边;另一端保持原有的手选意图不动。
                const stored = connector.appearance.get(Connector.SIDES);
                const manual = connector.appearance.get(Connector.SIDES_MANUAL);

                const srcBounds = toRectLike(newSource.bounds(diagram).aabb);
                const tgtBounds = toRectLike(target.bounds(diagram).aabb);

                let ss: Side | undefined = manual && stored ? stored.ss : undefined;
                let ts: Side | undefined = manual && stored ? stored.ts : undefined;

                const dropped = point ? nearestAnchorSide(end === 'source' ? srcBounds : tgtBounds, point) : null;

                if (dropped) {
                    if (end === 'source') {
                        ss = dropped;
                    } else {
                        ts = dropped;
                    }
                }

                // 改造后源/目标的相对位置可能已经翻转,旧的手选边对可能变成"绕大圈"。
                // 只有两端都还能用(都是合法 Side)才沿用,否则整体回退自动选边。
                const validSides = ss && ts && VALID_SIDES[ss] && VALID_SIDES[ts];

                const explicitSides: { ss: Side; ts: Side } | undefined =
                    dropped || validSides ? { ss: ss!, ts: ts! } : undefined;

                // ── 槽位重算 ────────────────────────────────────────────────────
                // 改接后"同源同目标 + 同侧对"的集合变了,原槽位可能撞车,重新挑一个空位。
                const siblings: Array<{ ss: Side; ts: Side; slot: number }> = [];

                for (const item of diagram.items.values) {
                    if (item.id === connectorId || item.renderer !== CONNECTOR_RENDERER) {
                        continue;
                    }

                    const s = item.appearance.get(Connector.SOURCE);
                    const t = item.appearance.get(Connector.TARGET);

                    if (!((s === newSourceId && t === newTargetId) || (s === newTargetId && t === newSourceId))) {
                        continue;
                    }

                    const info = item.appearance.get(Connector.SIDES);

                    if (info && VALID_SIDES[info.ss] && VALID_SIDES[info.ts]) {
                        siblings.push({ slot: connectorSlot(item), ss: info.ss, ts: info.ts });
                    }
                }

                const sidesForSlot = explicitSides ?? { ss: 'R' as Side, ts: 'L' as Side };
                const slot = nextSlotFor(siblings, sidesForSlot.ss, sidesForSlot.ts);

                const next = diagram.updateItems([connectorId], item =>
                    item.setAppearanceMany({
                        [Connector.SOURCE]: newSourceId,
                        [Connector.TARGET]: newTargetId,
                        [Connector.SLOT]: slot,
                        // 途经点是按旧路径固定的,改接后必须清空。
                        [Connector.WAYPOINTS]: [],
                        ...(explicitSides
                            ? { [Connector.SIDES]: explicitSides, [Connector.SIDES_MANUAL]: true }
                            : { [Connector.SIDES_MANUAL]: false }),
                    }));

                return next.maintainConnectors(new Set([newSourceId, newTargetId, connectorId]));
            });
        })
        .addCase(addShape, (state, action) => {
            const { diagramId, appearance, id, position, renderer, size } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const registration = PluginRegistry.get(renderer);

                if (!registration) {
                    throw new Error(`Cannot find renderer for ${renderer}.`);
                }

                const { size: defaultSize, appearance: defaults, ...other } = registration.createDefaultShape();

                const initialSize = size || defaultSize;
                const initialProps = {
                    ...other,
                    id,
                    transform: new Transform(
                        new Vec2(
                            (position?.x || 0) + 0.5 * initialSize.x, 
                            (position?.y || 0) + 0.5 * initialSize.y),
                        new Vec2(
                            initialSize.x,
                            initialSize.y), 
                        Rotation.ZERO),
                    appearance: { ...defaults || {}, ...appearance },
                };

                const shape = DiagramItem.createShape(initialProps);

                return diagram.addShape(shape).selectItems([id]);
            });
        })
        .addCase(addConnector, (state, action) => {
            const { diagramId, sourceId, targetId, anchor, sourcePoint, targetPoint } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const source = diagram.items.get(sourceId);
                const target = diagram.items.get(targetId);

                if (!source || !target) {
                    return diagram;
                }

                // 两端都必须是 connectable()=true 且未锁定的组件才能连线;否则静默忽略(CONN-006)。
                if (!(PluginRegistry.get(source.renderer)?.plugin?.connectable?.() &&
                      PluginRegistry.get(target.renderer)?.plugin?.connectable?.()) ||
                    source.isLocked || target.isLocked) {
                    return diagram;
                }

                // ── 选边 ────────────────────────────────────────────────────────
                // 需求:直接选"距离鼠标选择位置最近的那条边",而不是按两个组件之间的相对
                // 位置自动选边 —— 这样多条连线时用户能自己决定从哪条边出去 / 进来。
                // 任一端判断不出明确意图(鼠标落在组件中心区域)则整体回退到自动选边。
                const srcBounds = toRectLike(source.bounds(diagram).aabb);
                const tgtBounds = toRectLike(target.bounds(diagram).aabb);

                const srcSide = sourcePoint ? nearestAnchorSide(srcBounds, sourcePoint) : null;
                const tgtSide = targetPoint ? nearestAnchorSide(tgtBounds, targetPoint) : null;

                // 手选结果,或旧调用方显式传入的 anchor —— 都算"用户指定",永久固定。
                const explicitSides =
                    (srcSide && tgtSide) ? { ss: srcSide, ts: tgtSide } :
                    (anchor ? sidesFromLegacyAnchor(anchor) : undefined);

                // ── 槽位(FR-4 错开)─────────────────────────────────────────────
                // 已有"同源同目标"连线数,正负交替错开。手选边时只统计同一条边上的线,
                // 免得从不同边出去的线互相挤占槽位。
                let existing = 0;

                for (const item of diagram.items.values) {
                    if (item.renderer !== CONNECTOR_RENDERER) {
                        continue;
                    }

                    const s = item.appearance.get(Connector.SOURCE);
                    const t = item.appearance.get(Connector.TARGET);

                    if (!((s === sourceId && t === targetId) || (s === targetId && t === sourceId))) {
                        continue;
                    }

                    if (explicitSides) {
                        const stored = item.appearance.get(Connector.SIDES);

                        if (stored && (stored.ss !== explicitSides.ss || stored.ts !== explicitSides.ts)) {
                            continue;
                        }
                    }

                    existing++;
                }

                const plugin = new Connect();
                const initialTransform = new Transform(new Vec2(0, 0), new Vec2(1, 1), Rotation.ZERO);

                const initialAppearance = {
                    ...plugin.defaultAppearance(),
                    [Connector.SOURCE]: sourceId,
                    [Connector.TARGET]: targetId,
                    [Connector.SLOT]: slotForIndex(existing),
                    // 手动选边要打上 SIDES_MANUAL 标记,否则会被 maintainConnectors 重算掉。
                    ...(explicitSides
                        ? { [Connector.SIDES]: explicitSides, [Connector.SIDES_MANUAL]: true }
                        : {}),
                };

                const connector = DiagramItem.createShape({
                    id: MathHelper.nextId(),
                    appearance: initialAppearance,
                    configurables: plugin.configurables?.(DefaultConfigurableFactory.INSTANCE),
                    renderer: plugin.identifier(),
                    transform: initialTransform,
                });

                let next = diagram.addShape(connector).selectItems([connector.id]);

                // 真正的几何(选边 / 锚点 / 路由 / bbox)统一由 maintainConnectors 计算。
                next = next.maintainConnectors(new Set([sourceId, targetId, connector.id]));

                return next;
            });
        });
}

// 归一化锚点 → 最近的边。
function sideOfNormalizedPoint(x: number, y: number): Side {
    const candidates: Array<[Side, number]> = [
        ['L', x],
        ['R', 1 - x],
        ['T', y],
        ['B', 1 - y],
    ];

    candidates.sort((a, b) => a[1] - b[1]);

    return candidates[0][0];
}

// 兼容旧的显式 anchor 入参:只有当它恰好构成"法线互指"的合法组合时才采纳,
// 否则交给 chooseSides 重新推导(FR-2 优先)。
function sidesFromLegacyAnchor(anchor: { sx: number; sy: number; tx: number; ty: number }) {
    const ss = sideOfNormalizedPoint(anchor.sx, anchor.sy);
    const ts = sideOfNormalizedPoint(anchor.tx, anchor.ty);

    const valid =
        (ss === 'R' && ts === 'L') ||
        (ss === 'L' && ts === 'R') ||
        (ss === 'B' && ts === 'T') ||
        (ss === 'T' && ts === 'B');

    return valid ? { ss, ts } : undefined;
}

export function calculateSelection(items: ReadonlyArray<DiagramItem>, diagram: Diagram, isSingleSelection?: boolean, isCtrl?: boolean): ReadonlyArray<string> {
    if (!items) {
        return [];
    }

    let selectedItems: DiagramItem[] = [];

    function resolveGroup(item: DiagramItem, stop?: DiagramItem) {
        while (true) {
            const group = diagram.parent(item.id);

            if (!group || group === stop) {
                break;
            } else {
                item = group;
            }
        }

        return item;
    }

    if (isSingleSelection) {        
        if (items.length === 1) {
            const single = items[0];

            if (single) {
                const singleId = single.id;

                if (isCtrl) {
                    if (!single.isLocked) {
                        if (diagram.selectedIds.has(singleId)) {
                            return diagram.selectedIds.remove(singleId).values;
                        } else {
                            return diagram.selectedIds.add(resolveGroup(single).id).values;
                        }
                    } else {
                        return diagram.selectedIds.values;
                    }
                } else {
                    const group = diagram.parent(single.id);

                    if (group && diagram.selectedIds.has(group.id)) {
                        selectedItems.push(resolveGroup(single, group));
                    } else {
                        selectedItems.push(resolveGroup(single));
                    }
                }
            }
        }
    } else {
        const selection: { [id: string]: DiagramItem } = {};

        for (let item of items) {
            if (item) {
                item = resolveGroup(item);

                if (!selection[item.id]) {
                    selection[item.id] = item;
                    selectedItems.push(item);
                }
            }
        }
    }

    if (selectedItems.length > 1) {
        selectedItems = selectedItems.filter(i => !i.isLocked);
    }

    return selectedItems.map(i => i.id);
}
