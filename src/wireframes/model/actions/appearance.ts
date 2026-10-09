/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { Color, Types } from '@app/core/utils';
import { CONNECTOR_RENDERER } from '@app/wireframes/shapes/neutral/_connector';
import { DiagramItemSet, EditorState, PluginRegistry, Transform } from './../internal';
import { createItemsAction, DiagramRef, ItemsRef } from './utils';

export const changeColors =
    createAction('items/color', (oldColor: Color, newColor: Color) => {
        return { payload: { oldColor: oldColor.toString(), newColor: newColor.toString() } };
    });

export const changeItemsAppearance =
    createAction('items/appearance', (diagram: DiagramRef, shapes: ItemsRef, key: string, value: any, force = false) => {
        return { payload: createItemsAction(diagram, shapes, { appearance: { key, value }, force }) };
    });

export const transformItems =
    createAction('items/transform', (diagram: DiagramRef, items: ItemsRef, oldBounds: Transform, newBounds: Transform) => {
        return { payload: createItemsAction(diagram, items, { oldBounds: oldBounds.toJS(), newBounds: newBounds.toJS() }) };
    });

export function buildAppearance(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(changeColors, (state, action) => {
            const oldColor = Color.fromValue(action.payload.oldColor);
    
            const newColorValue = Color.fromValue(action.payload.newColor);
            const newColorNumber = newColorValue.toNumber();

            return state.updateAllDiagrams(diagram => {
                return diagram.updateAllItems(item => {
                    if (item.type === 'Group') {
                        return item;
                    }

                    const appearance = item.appearance.mutate(mutator => {
                        for (const [key, value] of item.appearance.entries) {
                            if (key.endsWith('COLOR')) {
                                // 'transparent' 等非法颜色值跳过(纯文本组件底板默认值),
                                // 否则 redux reducer 抛异常直接崩应用。
                                let parsedColor: Color;

                                try {
                                    parsedColor = Color.fromValue(value);
                                } catch {
                                    continue;
                                }

                                if (parsedColor.eq(oldColor)) {
                                    mutator.set(key, newColorNumber);
                                }
                            }
                        }
                    });

                    return item.replaceAppearance(appearance);
                });
            });
        })
        .addCase(changeItemsAppearance, (state, action) => {
            const { diagramId, appearance, itemIds, force } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const { key, value } = appearance;

                const next = diagram.updateItems(itemIds, item => {
                    const plugin = PluginRegistry.get(item.renderer)?.plugin;
                    
                    if (!plugin) {
                        throw new Error(`Cannot find renderer for ${item.renderer}.`);
                    }

                    if (force || !Types.isUndefined(plugin.defaultAppearance()[key])) {
                        return item.setAppearance(key, value);
                    }

                    return item;
                });

                // 改动的是连接线的视觉属性(线型 / 圆角)时必须立即重路由,
                // 否则要等到下次拖动组件才会看到新线型生效。
                if (itemIds.some(id => diagram.items.get(id)?.renderer === CONNECTOR_RENDERER)) {
                    return next.maintainConnectors(new Set(itemIds));
                }

                return next;
            });
        })
        .addCase(transformItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const boundsOld = Transform.fromJS(action.payload.oldBounds);
                const boundsNew = Transform.fromJS(action.payload.newBounds);

                if (boundsOld.equals(boundsNew)) {
                    return diagram;
                }

                // Groups do not have a rendered transform of their own, so their transform
                // must be baked into the nested items. Otherwise moving or resizing a group
                // would have no visible effect at all.
                const targetIds = new Set<string>();

                for (const id of itemIds) {
                    const item = diagram.items.get(id);

                    if (item?.type === 'Group') {
                        const set = DiagramItemSet.createFromDiagram([id], diagram);

                        for (const nestedId of set.nested.keys()) {
                            targetIds.add(nestedId);
                        }
                    } else {
                        targetIds.add(id);
                    }
                }

                return diagram.updateItems([...targetIds], item => {
                    return item.transformByBounds(boundsOld, boundsNew);
                }).maintainConnectors(new Set<string>(targetIds));
            });
        });
}
