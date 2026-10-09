/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { MathHelper } from '@app/core/utils';
import { CONNECTOR_RENDERER } from '@app/wireframes/shapes/neutral/_connector';
import { EditorState } from './../internal';
import { createItemsAction, DiagramRef, ItemsRef } from './utils';

export const groupItems =
    createAction('grouping/group', (diagram: DiagramRef, items: ItemsRef, groupId?: string) => {
        return { payload: createItemsAction(diagram, items, { groupId: groupId || MathHelper.nextId() }) };
    });

export const ungroupItems =
    createAction('grouping/ungroup', (diagram: DiagramRef, groups: ItemsRef) => {
        return { payload: createItemsAction(diagram, groups) };
    });

export function buildGrouping(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(groupItems, (state, action) => {
            const { diagramId, groupId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                // 连接线不参与成组(CONN-005):它的几何由端点组件决定,
                // 一旦进了组,组的整体变换会和重新路由两套几何互相打架。
                const targets = itemIds.filter(id => diagram.items.get(id)?.renderer !== CONNECTOR_RENDERER);

                if (targets.length === 0) {
                    return diagram;
                }

                return diagram.group(groupId, targets).selectItems([groupId]);
            });
        })
        .addCase(ungroupItems, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                const childIds: string[] = [];

                for (const groupId of itemIds) {
                    const target = diagram.items.get(groupId);

                    if (target) {
                        childIds.push(...target.childIds.values);

                        diagram = diagram.ungroup(groupId);
                    }
                }

                diagram = diagram.selectItems(childIds);

                return diagram;
            });
        });
}
