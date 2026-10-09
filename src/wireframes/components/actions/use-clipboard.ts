/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { ClipboardCopyEvent, ClipboardImageItem, ClipboardPasteEvent, Rect2, useClipboard as useClipboardProvider, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { addShape, getDiagram, getDiagrams, getSelection, pasteItems, removeItems, showToast, Serializer, useStore } from '@app/wireframes/model';
import { downloadBlob, renderDiagramToPng } from '@app/wireframes/renderer/export-image';

import { UIAction } from './shared';

const OFFSET = 50;
const PREFIX = 'my-draft:';

export function useClipboard() {
    const dispatch = useAppDispatch();
    const offset = React.useRef(0);
    const selectedDiagram = useStore(getDiagram);
    const diagrams = useStore(getDiagrams);
    const selectionSet = useStore(getSelection);
    const canCopy = selectionSet.selection.size > 0;

    const clipboard = useClipboardProvider({ 
        onPaste: (event: ClipboardPasteEvent) => {
            // Image paste: create an Image shape from the pasted bitmap.
            const imageItem = event.items.find(x => x.type === 'Image') as ClipboardImageItem | undefined;
            if (selectedDiagram && imageItem) {
                const source = imageItem.image.source;
                const w = imageItem.image.width || 100;
                const h = imageItem.image.height || 100;
                offset.current += OFFSET;
                const x = offset.current;
                const y = offset.current;
                dispatch(addShape(selectedDiagram, 'Image', { position: { x, y }, size: { x: w, y: h }, appearance: { URL: source } }));
                return true;
            }

            const text = (event.items[0] as any)['text'] as string;
    
            if (selectedDiagram && text && text.indexOf(PREFIX) === 0) {
                offset.current += OFFSET;
    
                dispatch(pasteItems(selectedDiagram, text.substring(PREFIX.length), offset.current));
                return true;
            }
    
            return;
        },
        onCopy: (event: ClipboardCopyEvent) => {
            if (selectedDiagram) {    
                event.clipboard.set(`${PREFIX}${JSON.stringify(Serializer.serializeSet(selectionSet))}`);
    
                if (event.isCut) {
                    dispatch(removeItems(selectedDiagram, selectionSet.selectedItems));
                }
                
                offset.current = 0;
            }

            return true;
        },
    });

    const copy: UIAction = React.useMemo(() => ({
        disabled: !canCopy,
        icon: 'icon-copy',
        label: texts.common.copy,
        tooltip: texts.common.copyTooltip,
        onAction: clipboard.copy,
    }), [canCopy, clipboard]);

    const cut: UIAction = React.useMemo(() => ({
        disabled: !canCopy,
        icon: 'icon-cut',
        label: texts.common.cut,
        tooltip: texts.common.cutTooltip,
        onAction: clipboard.cut,
    }), [canCopy, clipboard]);

    const paste: UIAction = React.useMemo(() => ({
        disabled: !clipboard,
        icon: 'icon-paste',
        label: texts.common.paste,
        tooltip: texts.common.pasteTooltip,
        onAction: clipboard.paste,
    }), [clipboard]);

    const doCopyAsImage = useEventCallback(() => {
        if (!selectedDiagram || !canCopy) {
            return;
        }

        const aabbs = selectionSet.selectedItems.map(x => x.bounds(selectedDiagram).aabb);
        const bounds = Rect2.fromRects(aabbs).inflate(20);

        // Start rendering synchronously so that the clipboard write keeps
        // a connection to the user gesture (delayed clipboard item).
        const pngPromise =
            renderDiagramToPng({ diagram: selectedDiagram, diagrams, bounds, background: '#ffffff' });

        if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
            finishWithDownload(pngPromise);
            return;
        }

        const delayedItem = new ClipboardItem({ 'image/png': pngPromise.then(x => x.blob) });

        navigator.clipboard.write([delayedItem])
            .then(() => {
                dispatch(showToast(texts.common.copyAsImageDone, 'success'));
            })
            .catch(() => {
                finishWithDownload(pngPromise);
            });
    });

    const finishWithDownload = useEventCallback(async (pngPromise: Promise<{ blob: Blob; externalImages: number }>) => {
        try {
            const { blob } = await pngPromise;

            downloadBlob(blob, 'image.png');

            dispatch(showToast(texts.common.copyAsImageFallback, 'info'));
        } catch {
            dispatch(showToast(texts.common.exportImageFailed, 'error'));
        }
    });

    const copyAsImage: UIAction = React.useMemo(() => ({
        disabled: !canCopy,
        icon: 'icon-copy',
        label: texts.common.copyAsImage,
        shortcut: 'MOD + SHIFT + C',
        tooltip: texts.common.copyAsImageTooltip,
        onAction: doCopyAsImage,
    }), [canCopy, doCopyAsImage]);

    return { copy, cut, paste, copyAsImage };
}
