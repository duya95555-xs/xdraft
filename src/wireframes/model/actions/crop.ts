/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { ASPECT_RATIO, EditorState, IMAGE_CROP, IMAGE_CROP_ORIGIN, Transform } from './../internal';
import { createItemsAction, DiagramRef, ItemRef } from './utils';

// Crops an image in one atomic step: the appearance (crop rect and origin bounds) and the
// item transform are updated together, so a crop is a single undo step.
export const cropImage =
    createAction('image/crop', (diagram: DiagramRef, item: ItemRef, relCrop: string, newBounds: Transform, origBounds: Transform | null) => {
        return { payload: createItemsAction(diagram, [item], {
            relCrop,
            newBounds: newBounds.toJS(),
            origBounds: origBounds ? origBounds.toJS() : null,
        }) };
    });

// Resets the crop of an image and restores the bounds from before the first crop.
export const resetCrop =
    createAction('image/resetCrop', (diagram: DiagramRef, item: ItemRef) => {
        return { payload: createItemsAction(diagram, [item], {}) };
    });

export function buildCrop(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(cropImage, (state, action) => {
            const { diagramId, itemIds, relCrop, newBounds, origBounds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                return diagram.updateItems(itemIds, item => {
                    if (item.type === 'Group') {
                        return item;
                    }

                    let updated = item.setAppearance(IMAGE_CROP, relCrop);

                    if (origBounds) {
                        updated = updated.setAppearance(IMAGE_CROP_ORIGIN, origBounds);
                    }

                    // A crop invalidates a locked aspect ratio, because the ratio changes.
                    updated = updated.setAppearance(ASPECT_RATIO, '');

                    return updated.set('transform', Transform.fromJS(newBounds));
                });
            });
        })
        .addCase(resetCrop, (state, action) => {
            const { diagramId, itemIds } = action.payload;

            return state.updateDiagram(diagramId, diagram => {
                return diagram.updateItems(itemIds, item => {
                    if (item.type === 'Group') {
                        return item;
                    }

                    const origin = item.appearance.get(IMAGE_CROP_ORIGIN);

                    let updated = item.setAppearance(IMAGE_CROP, '');
                    updated = updated.setAppearance(IMAGE_CROP_ORIGIN, '');

                    if (origin) {
                        updated = updated.set('transform', Transform.fromJS(origin));
                    }

                    return updated;
                });
            });
        });
}
