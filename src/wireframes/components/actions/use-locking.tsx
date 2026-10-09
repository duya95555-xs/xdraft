/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import * as React from 'react';
import { useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { getDiagramId, getSelection, lockItems, unlockItems, useStore } from '@app/wireframes/model';
import { UIAction } from './shared';

export function useLocking() {
    const dispatch = useAppDispatch();
    const selectedDiagramId = useStore(getDiagramId);
    const selectionSet = useStore(getSelection);

    const selectedItems = selectionSet.selectedItems;

    // Only when all selected items are locked the action unlocks them again.
    const allLocked = selectedItems.length > 0 && selectedItems.every(x => x.isLocked);

    const doToggle = useEventCallback(() => {
        if (!selectedDiagramId || selectedItems.length === 0) {
            return;
        }

        if (allLocked) {
            dispatch(unlockItems(selectedDiagramId, selectedItems.map(x => x.id)));
        } else {
            // Lock all unlocked items. Locked items are not part of multi-selections,
            // but they can be selected alone, so filter defensively.
            dispatch(lockItems(selectedDiagramId, selectedItems.filter(x => !x.isLocked).map(x => x.id)));
        }
    });

    const lock: UIAction = React.useMemo(() => {
        const icon = allLocked ? (
            <LockOutlined />
        ) : (
            <UnlockOutlined />
        );

        return {
            disabled: selectedItems.length === 0,
            icon,
            label: allLocked ? texts.common.unlock : texts.common.lock,
            shortcut: 'MOD + L',
            tooltip: texts.common.lockTooltip,
            onAction: doToggle,
        };
    }, [allLocked, selectedItems.length, doToggle]);

    return { lock };
}
