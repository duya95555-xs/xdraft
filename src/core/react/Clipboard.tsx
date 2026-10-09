/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { LoadedImage, Types } from '@app/core/utils';
import { useDocumentEvent } from './hooks';

export interface ClipboardCopyEvent {
    // Indicates whether the event type is a cut event.
    isCut: boolean;

    // Access to the clipboard.
    clipboard: ClipboardInstance;
}

export interface ClipboardPasteEvent {
    items: ReadonlyArray<ClipboardItem>;
}

export interface ClipboadTextItem {
    type: 'Text';

    // The text when the clipboard contains a text value.
    text: string;
}

export interface ClipboardImageItem {
    type: 'Image';

    // The loaded image when the clipboard contains a file value.
    image: LoadedImage;
}

export interface ClipboardUrlItem {
    type: 'Url';

    // The URL when the clipboard contains a URL value.
    url: string;
}

export type ClipboardItem = ClipboadTextItem | ClipboardImageItem | ClipboardUrlItem;

class ClipboardInstance {
    private fallback?: string;

    public async set(value: string) {
        this.fallback = value;

        try {
            await navigator.clipboard.writeText(value);
        } catch {
            return;
        }
    }

    public async get() {
        try {
            return await navigator.clipboard.readText();
        } catch {
            return this.fallback;
        }
    }
}

type OnCopy = (event: ClipboardCopyEvent) => void | boolean;
type OnPaste = (event: ClipboardPasteEvent) => void | boolean;

interface ClipboardContextType {
    onCopy: OnCopy[];
    onPaste: OnPaste[];
    clipboard: ClipboardInstance;
}

const DEFAULT_VALUE: ClipboardContextType = {
    onCopy: [],
    onPaste: [],
    clipboard: new ClipboardInstance(),
};

const ClipboardContext = React.createContext<ClipboardContextType>(DEFAULT_VALUE);

const ContextConnector = React.memo(() => {
    const context = React.useContext(ClipboardContext);

    useDocumentEvent('paste', async event => {
        if (isInputOrTextArea(event.target)) {
            return;
        }

        if (!event.clipboardData) {
            return;
        }

        const text = event.clipboardData.getData('text');

        if (Types.isString(text) && text.length > 0) {
            emitPaste(context, { type: 'Text', text });
            return;
        }

        const items = await loadImagesToClipboardItems(event.clipboardData.files);

        if (items.length > 0) {
            emitPaste(context, ...items);
        }
    });

    useDocumentEvent('copy', event => {
        if (isInputOrTextArea(event.target)) {
            return;
        }
        
        for (const callback of context.onCopy) {
            if (callback({ isCut: false, clipboard: context.clipboard })) {
                break;
            }
        }
    });

    useDocumentEvent('cut', event => {
        if (isInputOrTextArea(event.target)) {
            return;
        }

        for (const callback of context.onCopy) {
            if (callback({ isCut: true, clipboard: context.clipboard })) {
                break;
            }
        }
    });

    return null;
});

export const ClipboardContainer = ({ children }: { children: React.ReactNode }) => {
    return (
        <ClipboardContext.Provider value={DEFAULT_VALUE}>
            <ContextConnector />

            {children}
        </ClipboardContext.Provider>
    );
};

interface ClipboardProps {
    // The paste event.
    onPaste?: OnPaste;

    // The copy event.
    onCopy?: OnCopy;
}

export function useClipboard(props?: ClipboardProps) {
    const context = React.useContext(ClipboardContext);
    const currentPaste = React.useRef(props?.onPaste);
    const currentCopy = React.useRef(props?.onCopy);

    currentPaste.current = props?.onPaste;
    currentCopy.current = props?.onCopy;

    React.useEffect(() => {
        const doCopy = (event: any) => {
            return currentCopy.current?.(event);
        };

        const doPaste = (event: any) => {
            return currentPaste.current?.(event);
        };

        context.onCopy.push(doCopy);
        context.onPaste.push(doPaste);

        return () => {
            context.onCopy.splice(context.onCopy.indexOf(doCopy), 1);
            context.onPaste.splice(context.onPaste.indexOf(doPaste), 1);
        };
    }, [context]);
    
    return React.useMemo(() => ({
        paste: async () => {
            tryEmitPaste(context);
        },
        copy: () => {
            emitCopy(context, false);
        },
        cut: () => {
            emitCopy(context, true);
        },
    }), [context]);
}

async function tryEmitPaste(context: ClipboardContextType) {
    const text = await context.clipboard.get();

    if (text) {
        emitPaste(context, { type: 'Text', text });
    }
}

function emitCopy(context: ClipboardContextType, isCut: boolean) {
    const event = Object.freeze({ isCut, clipboard: context.clipboard });

    for (const callback of context.onCopy) {
        const shouldStop = callback(event);

        if (shouldStop) {
            break;
        }
    }
}

function emitPaste(context: ClipboardContextType, ...items: ClipboardItem[]) {
    const event = Object.freeze({ items });

    for (const callback of context.onPaste) {
        const shouldStop = callback(event);

        if (shouldStop) {
            break;
        }
    }
}

export async function loadImagesToClipboardItems(files: FileList | ReadonlyArray<File>) {
    const items: ClipboardItem[] = [];

    for (let i = 0; i < files.length; i++) {
        let file: File | null;

        if (Types.isArray(files)) {
            file = files[i];
        } else {
            file = files.item(i);
        }

        const image = await loadImage(file);

        if (image != null) {
            items.push({ type: 'Image', image });
        }
    }

    return items;
}

// 粘贴图片的降采样上限。
//
// 这里以前默认是 1024,导致任何超过 1024px 的截图在进入画布前就已经被降采样 ——
// Raster.create() 拿到的是一个"已经被压过的尺寸",它自己那个上限形同虚设,
// 用户看到的现象就是"粘贴图片没有保留原始像素"。
//
// 取值 2600:常见 2K(2560) 与 1080p 截图都能原样保留,又能把 4K 及以上大图的
// DataURL 体积压住(PNG 无损重编码,体积随像素数线性增长,4096 会到十几 MB)。
const MAX_PASTED_IMAGE_SIZE = 2600;

export function loadImage(file: File | null, maxDimension = MAX_PASTED_IMAGE_SIZE) {
    return new Promise<LoadedImage | null>((resolve) => {
        if (file === null || file.type.indexOf('image') < 0) {
            resolve(null);
            return;
        }

        // Use a blob URL to decode, then downscale + re-encode to a
        // reasonably-sized DataURL. This keeps both memory and per-paste
        // latency bounded instead of growing with the source file.
        const blobUrl = URL.createObjectURL(file);

        const imageElement = new Image();

        imageElement.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            resolve(null);
        };

        imageElement.onload = () => {
            try {
                let w = imageElement.width;
                let h = imageElement.height;

                if (w > maxDimension || h > maxDimension) {
                    const scale = maxDimension / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(blobUrl);
                    resolve(null);
                    return;
                }

                ctx.drawImage(imageElement, 0, 0, w, h);
                const source = canvas.toDataURL('image/png');

                resolve({ source, width: w, height: h });
            } finally {
                URL.revokeObjectURL(blobUrl);
            }
        };

        imageElement.src = blobUrl;
    });
}

function isInputOrTextArea(element: any) {
    const typed = element as HTMLElement;

    return typed && (typed.nodeName === 'INPUT' || typed.nodeName === 'TEXTAREA');
}