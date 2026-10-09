/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { Rect2 } from '@app/core';
import { MathHelper } from '@app/core/utils';
import { ASPECT_RATIO, composeCrop, cropToString, Diagram, DiagramItem, DiagramItemSet, EditorState, FULL_CROP, IMAGE_CROP, marqueeToRelative, parseCrop, Transform } from './../internal';
import { createItemsAction, DiagramRef, ItemRef } from './utils';

// Splits an image into independent tiles: the cut lines are the horizontal and
// vertical axis-aligned lines through the given point (the last right-click position).
// Point inside the image => 2x2 (4 tiles); point outside => only lines crossing the
// image cut (2 tiles); no line crossing => no split. One atomic action => single undo step.
export const splitImage =
    createAction('image/split', (diagram: DiagramRef, item: ItemRef, point: { x: number; y: number }) => {
        return { payload: createItemsAction(diagram, [item], { point }) };
    });

// Computes the tile rectangles of a split. Returns an empty array when no cut line
// intersects the item bounds. Adjacent tiles share the cut coordinate, so there is
// neither a gap nor an overlap between them.
export function computeSplitTiles(itemRect: Rect2, point: { x: number; y: number }): Rect2[] {
    const crossX = point.y > itemRect.y && point.y < itemRect.bottom;
    const crossY = point.x > itemRect.x && point.x < itemRect.right;

    if (!crossX && !crossY) {
        return [];
    }

    const xs = crossY ? [itemRect.x, point.x, itemRect.right] : [itemRect.x, itemRect.right];
    const ys = crossX ? [itemRect.y, point.y, itemRect.bottom] : [itemRect.y, itemRect.bottom];

    const tiles: Rect2[] = [];

    for (let i = 0; i < xs.length - 1; i++) {
        for (let j = 0; j < ys.length - 1; j++) {
            tiles.push(new Rect2(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]));
        }
    }

    return tiles;
}

export function buildSplit(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(splitImage, (state, action) => {
            const { diagramId, itemIds, point } = action.payload;

            return state.updateDiagram(diagramId, (diagram: Diagram) => {
                const item = diagram.items.get(itemIds[0]);

                if (!item || item.type === 'Group' || item.isLocked || diagram.parent(item)) {
                    return diagram;
                }

                const itemRect = item.bounds(diagram).aabb;
                const tiles = computeSplitTiles(itemRect, point);

                if (tiles.length <= 1) {
                    return diagram;
                }

                // Each tile shows the same image, but only its sub-rect of the original image.
                const crop = parseCrop(item.appearance.get(IMAGE_CROP)) ?? FULL_CROP;

                const newItems = tiles.map(tile => {
                    const absCrop = composeCrop(crop, marqueeToRelative(tile, itemRect));

                    return item
                        .set('id', MathHelper.nextId())
                        .set('transform', Transform.fromRect(tile))
                        .setAppearance(IMAGE_CROP, cropToString(absCrop))
                        .setAppearance(ASPECT_RATIO, '');
                });

                const nested = new Map<string, DiagramItem>();
                const selection = new Map<string, DiagramItem>();

                for (const newItem of newItems) {
                    nested.set(newItem.id, newItem);
                    selection.set(newItem.id, newItem);
                }

                const oldSet = DiagramItemSet.createFromDiagram([item], diagram);

                return diagram
                    .removeItems(oldSet)
                    .addItems(new DiagramItemSet(nested, selection))
                    .selectItems(newItems.map(x => x.id));
            });
        });
}
