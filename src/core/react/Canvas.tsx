/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { select, Selection } from 'd3-selection';
import { zoom, ZoomBehavior, ZoomTransform } from 'd3-zoom';
import * as React from 'react';
import { useResizeObserver } from './hooks';

export interface CanvasProps {
    onRender: (viewbox: ViewBox, control: Control) => React.ReactNode;
    contentWidth: number;
    contentHeight: number;
    padding: number;
    className?: string;

    // When true the canvas can be panned by dragging with the left mouse button (hand tool).
    panMode?: boolean;

    // When true users draw connections between connectable items (suppresses background pan).
    connectMode?: boolean;
}

type Transform = {
    k: number;
    x: number;
    y: number;
};

const DEFAULT_TRANSFORM: Transform = {
    k: 1,
    x: 0,
    y: 0,
};

export type ViewBox = {
    zoom: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export interface Control {
    reset(): void;

    // Zooms in by a fixed factor, anchored at the viewport center.
    zoomIn(): void;

    // Zooms out by a fixed factor, anchored at the viewport center.
    zoomOut(): void;
}

const CanvasComponent = React.memo((props: CanvasProps) => {
    const {
        className,
        contentHeight,
        contentWidth,
        onRender,
        padding,
    } = props;

    const canvasRef = React.useRef<HTMLDivElement>(null);
    const { width, height } = useResizeObserver(canvasRef);

    const [transform, setTransform] = React.useState<Transform>(DEFAULT_TRANSFORM);
    const contentHeightRef = React.useRef(contentHeight);
    const contentWidthRef = React.useRef(contentWidth);
    const panModeRef = React.useRef(props.panMode);
    const connectModeRef = React.useRef(props.connectMode);
    const selectionRef = React.useRef<Selection<HTMLDivElement, unknown, any, any>>();
    const sizeRef = React.useRef({ width, height });
    const transformRef = React.useRef<Transform>(transform);
    const zoomRef = React.useRef<ZoomBehavior<HTMLDivElement, unknown>>();

    contentWidthRef.current = contentWidth;
    contentHeightRef.current = contentHeight;
    panModeRef.current = props.panMode;
    connectModeRef.current = props.connectMode;
    transformRef.current = transform;

    React.useEffect(() => {
        sizeRef.current = { width, height };
    }, [width, height]);

    React.useEffect(() => {
        const element = canvasRef.current;
        if (!element || zoomRef.current) {
            return;
        }

        const newZoomBehavior = zoom<HTMLDivElement, unknown>()
            .scaleExtent([0.1, 4])
            .filter(event => {
                const e = event as WheelEvent | MouseEvent;

                // Middle button always pans/zooms via d3-zoom.
                if (e.button === 1) {
                    return true;
                }

                // In pan (hand tool) mode the left button is handled by d3-zoom for panning.
                // Wheel is NOT handled here — it falls through to the dedicated doWheelScroll handler.
                if (panModeRef.current) {
                    return e.button === 0;
                }

                // In connect mode the left button must NOT be captured: items need the mousedown to detect
                // the source/target via the editor's hit-testing.
                if (connectModeRef.current) {
                    return false;
                }

                // Default: wheel also falls through to doWheelScroll for panning.
                return false;
            })
            .on('zoom', ({ transform: d3Transform }: { transform: ZoomTransform }) => {
                const newTransform: Transform = { k: d3Transform.k, x: d3Transform.x, y: d3Transform.y };
                setTransform(newTransform);
            });

        zoomRef.current = newZoomBehavior;

        selectionRef.current = select(element);
        selectionRef.current.call(zoomRef.current);
    }, [contentWidth, contentHeight]);

    // Outside pan mode the wheel scrolls (pans) the canvas content instead of zooming.
    React.useEffect(() => {
        const element = canvasRef.current;
        if (!element) {
            return;
        }

        const doWheelScroll = (event: WheelEvent) => {
            if (panModeRef.current) {
                // Pan mode: the wheel is handled by the zoom behavior.
                return;
            }

            event.preventDefault();

            const zoomBehavior = zoomRef.current;
            const selection = selectionRef.current;

            if (!zoomBehavior || !selection) {
                return;
            }

            let dx = event.deltaX;
            let dy = event.deltaY;

            if (event.shiftKey && dx === 0) {
                dx = dy;
                dy = 0;
            }

            // translateBy works in content coordinates, the wheel delta is in screen pixels.
            const k = transformRef.current.k || 1;

            selection.call(zoomBehavior.translateBy, -dx / k, -dy / k);
        };

        element.addEventListener('wheel', doWheelScroll, { passive: false });

        return () => {
            element.removeEventListener('wheel', doWheelScroll);
        };
    }, []);

    const viewBox = React.useMemo(() => {
        const currentZoom = transform.k;
        const w = width ?? 0;
        const h = height ?? 0;

        return {
            minX: round(-transform.x / currentZoom),
            minY: round(-transform.y / currentZoom),
            maxX: round(w / currentZoom),
            maxY: round(h / currentZoom),
            zoom: currentZoom,
        };
    }, [transform, width, height]);

    const control = React.useMemo(() => {
        const zoomBy = (factor: number) => {
            const s = sizeRef.current;
            const t = transformRef.current;

            if (!zoomRef.current || !selectionRef.current || !s.width || !s.height) {
                return;
            }

            const k = Math.min(4, Math.max(0.1, t.k * factor));

            if (k === t.k) {
                return;
            }

            // Keep the viewport center anchored.
            const cx = s.width / 2;
            const cy = s.height / 2;

            const x = cx - (cx - t.x) * (k / t.k);
            const y = cy - (cy - t.y) * (k / t.k);

            zoomRef.current.transform(selectionRef.current, new ZoomTransform(k, x, y));
        };

        return {
            reset: () => {
                const s = sizeRef.current;
                const currentWidth = s.width;
                const currentHeight = s.height;

                if (!zoomRef.current || !selectionRef.current || currentWidth === undefined || currentHeight === undefined || currentWidth === 0 || currentHeight === 0) {
                    return;
                }

                const targetW = currentWidth - 2 * padding;
                const targetH = currentHeight - 2 * padding;

                const cw = contentWidthRef.current;
                const ch = contentHeightRef.current;

                if (cw === 0 || ch === 0) {
                    return;
                }

                const zoomX = targetW / cw;
                const zoomY = targetH / ch;

                const k = Math.max(0.01, Math.min(zoomX, zoomY));

                const x = (currentWidth - k * cw) / 2;
                const y = (currentHeight - k * ch) / 2;

                const newTransform = new ZoomTransform(k, x, y);

                zoomRef.current.transform(selectionRef.current, newTransform);
            },
            zoomIn: () => {
                zoomBy(1.25);
            },
            zoomOut: () => {
                zoomBy(1 / 1.25);
            },
        };
    }, [padding, contentWidth, contentHeight]);

    // 视口只在"从未初始化 → 首次拿到尺寸"时 reset 一次。
    // 此前是尺寸一变就 reset: 开关 AI 输入条 / 侧栏都会让画布尺寸变化,
    // 视图随即被整体重排, 用户正在看的位置直接丢失("画布不知道跑哪去了")。
    const hasResetRef = React.useRef(false);

    React.useEffect(() => {
        if (zoomRef.current && selectionRef.current) {
            if (width !== undefined && height !== undefined && !hasResetRef.current) {
                hasResetRef.current = true;

                control.reset();
            }
        }
    }, [control, width, height]);

    return (
        <div className={className} ref={canvasRef} style={props.panMode ? { cursor: 'url(/grab-hand.png) 14 1, grab' } : undefined}>
            {(width !== undefined && height !== undefined) && onRender(viewBox, control)}
        </div>
    );
});
function round(source: number) {
    return parseFloat(source.toFixed(2));
}

export const Canvas = CanvasComponent;