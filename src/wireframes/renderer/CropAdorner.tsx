/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Rect2, Vec2, ViewBox } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { composeCrop, cropToRect, cropToString, Diagram, DiagramItem, FULL_CROP, IMAGE_CROP, isValidCrop, marqueeToRelative, parseCrop, Transform } from '@app/wireframes/model';
import { texts } from '@app/texts';
import { OverlayManager } from './../contexts/OverlayContext';

export interface CropAdornerProps {
    // The current zoom value.
    zoom: number;

    // The viewbox: the visible area in diagram coordinates.
    viewBox: ViewBox;

    // The view size of the editor.
    viewSize: Vec2;

    // The current engine.
    engine: Engine;

    // The adorner layer.
    layer: EngineLayer;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The image item that is currently cropped. Null when the crop mode is inactive.
    cropItem: DiagramItem | null;

    // The overlay manager.
    overlayManager: OverlayManager;

    // Invoked when the user has finished a valid crop selection.
    onCrop: (item: DiagramItem, relCrop: string, cropRect: Rect2) => void;

    // Invoked when the user cancels the crop mode.
    onCancel: () => void;
}

const MASK_COLOR = 'rgba(0,0,0,0.4)';
const MARQUEE_FILL = 'rgba(255,255,255,0.15)';
const MARQUEE_STROKE = '#ffffff';

export class CropAdorner extends React.PureComponent<CropAdornerProps> implements Listener {
    private maskShapes: EngineRect[] = [];
    private marqueeShape: EngineRect = null!;
    private marqueeStart: Vec2 | null = null;
    private marqueeRect: Rect2 | null = null;

    constructor(props: CropAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: CropAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }

            // Remove the old shapes before creating new ones, otherwise they
            // would stay on the persistent layer as frozen "ghost" overlays
            // whenever the engine changes or the component remounts.
            this.removeShapes();

            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.maskShapes = [];

            for (let i = 0; i < 4; i++) {
                const maskShape = this.props.layer.rect();
                maskShape.fill(MASK_COLOR);
                maskShape.strokeWidth(0);
                this.maskShapes.push(maskShape);
            }

            this.marqueeShape = this.props.layer.rect();
            this.marqueeShape.fill(MARQUEE_FILL);
            this.marqueeShape.strokeColor(MARQUEE_STROKE);
            this.marqueeShape.strokeWidth(1 / this.props.zoom);
            this.marqueeShape.cursor('crosshair');

            this.hideShapes();
        }

        if (this.props.cropItem !== prevProps.cropItem) {
            this.marqueeStart = null;
            this.marqueeRect = null;
        }

        this.renderShapes();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        this.removeShapes();
    }

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (!this.props.cropItem) {
            next(event);
            return;
        }

        stopEvent(event.source);

        const bounds = this.cropBounds();

        if (!bounds.contains(event.position)) {
            this.props.onCancel();
            return;
        }

        this.marqueeStart = event.position;
        this.marqueeRect = new Rect2(event.position.x, event.position.y, 0, 0);

        // Hide overlays from previous interactions so the info label can be
        // reused in place instead of stacking up a new one on every movement.
        this.props.overlayManager.reset();

        this.renderShapes();
    }

    public onMouseDrag(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.props.cropItem || !this.marqueeStart) {
            next(event);
            return;
        }

        stopEvent(event.source);

        const pos = event.position;
        const raw = new Rect2(
            Math.min(this.marqueeStart.x, pos.x),
            Math.min(this.marqueeStart.y, pos.y),
            Math.abs(pos.x - this.marqueeStart.x),
            Math.abs(pos.y - this.marqueeStart.y));

        this.marqueeRect = this.clampToBounds(raw, this.cropBounds());

        this.renderShapes();

        // Reset before every update, otherwise each mouse move would create a
        // new label and leave a trail of black info boxes along the drag path.
        this.props.overlayManager.reset();

        const transform = Transform.fromRect(this.marqueeRect);

        this.props.overlayManager.showInfo(transform, texts.common.cropSizeInfo(Math.round(this.marqueeRect.w), Math.round(this.marqueeRect.h)));
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.props.cropItem || !this.marqueeStart || !this.marqueeRect) {
            next(event);
            return;
        }

        stopEvent(event.source);

        this.props.overlayManager.reset();

        const bounds = this.cropBounds();
        const marqueeRel = marqueeToRelative(this.marqueeRect, bounds);

        this.marqueeStart = null;
        this.marqueeRect = null;

        if (!isValidCrop(marqueeRel, new Vec2(bounds.w, bounds.h))) {
            // Invalid selection: stay in the crop mode to allow another attempt.
            this.renderShapes();
            return;
        }

        const oldRel = parseCrop(this.props.cropItem.appearance.get(IMAGE_CROP)) ?? FULL_CROP;
        const rel = composeCrop(oldRel, marqueeRel);
        const cropRect = cropToRect(marqueeRel, bounds);

        this.props.onCrop(this.props.cropItem, cropToString(rel), cropRect);
    }

    public onKeyDown(event: KeyboardEvent, next: (event: KeyboardEvent) => void) {
        if (this.props.cropItem && event.key === 'Escape') {
            stopEvent(event);

            this.props.onCancel();
            return;
        }

        next(event);
    }

    public onClick(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.props.cropItem) {
            stopEvent(event.source);
            return false;
        }

        next(event);

        return false;
    }

    public onDoubleClick(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.props.cropItem) {
            stopEvent(event.source);
            return;
        }

        next(event);
    }

    public render() {
        return null;
    }

    private cropBounds(): Rect2 {
        return this.props.cropItem!.bounds(this.props.selectedDiagram).aabb;
    }

    private clampToBounds(rect: Rect2, bounds: Rect2): Rect2 {
        const left = Math.max(rect.x, bounds.x);
        const top = Math.max(rect.y, bounds.y);
        const right = Math.min(rect.right, bounds.right);
        const bottom = Math.min(rect.bottom, bounds.bottom);

        if (right <= left || bottom <= top) {
            return new Rect2(bounds.x, bounds.y, 0, 0);
        }

        return new Rect2(left, top, right - left, bottom - top);
    }

    private renderShapes() {
        if (!this.props.cropItem) {
            this.hideShapes();
            return;
        }

        const bounds = this.cropBounds();
        const marquee = this.marqueeRect ?? bounds;

        // The visible area in diagram coordinates. Masks must cover it fully,
        // no matter the zoom level or the pan offset of the view.
        // ViewBox 的 maxX/maxY 是坐标（不是宽高），Rect2 构造是 (x, y, w, h);
        // 必须换算成宽高，否则在负坐标区域时遮罩带会短一截，出现未遮亮的条纹。
        const viewport = new Rect2(this.props.viewBox.minX, this.props.viewBox.minY, this.props.viewBox.maxX - this.props.viewBox.minX, this.props.viewBox.maxY - this.props.viewBox.minY);

        const stroke = 1 / this.props.zoom;

        // Tile the viewport around the marquee with four NON-overlapping bands,
        // otherwise overlapping regions get double-darkened and the mask looks
        // patchy (different gray levels over the same canvas background).
        this.plotMask(this.maskShapes[0], new Rect2(viewport.x, viewport.y, viewport.w, marquee.y - viewport.y));
        this.plotMask(this.maskShapes[1], new Rect2(marquee.right, marquee.y, viewport.right - marquee.right, marquee.h));
        this.plotMask(this.maskShapes[2], new Rect2(viewport.x, marquee.bottom, viewport.w, viewport.bottom - marquee.bottom));
        this.plotMask(this.maskShapes[3], new Rect2(viewport.x, marquee.y, marquee.x - viewport.x, marquee.h));

        if (this.marqueeRect) {
            this.marqueeShape.show();
            this.marqueeShape.strokeWidth(stroke);
            this.marqueeShape.plot({ x: marquee.x, y: marquee.y, w: marquee.w, h: marquee.h });
        } else {
            this.marqueeShape.hide();
        }
    }

    private plotMask(shape: EngineRect, rect: Rect2) {
        if (rect.w <= 0 || rect.h <= 0) {
            shape.hide();
            return;
        }

        shape.show();
        shape.plot({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    private hideShapes() {
        this.maskShapes.forEach(s => s.hide());
        this.marqueeShape?.hide();
    }

    private removeShapes() {
        this.maskShapes.forEach(s => s.remove());
        this.marqueeShape?.remove();
    }
}

function stopEvent(event: Event | { source: MouseEvent }) {
    if (!(event instanceof Event)) {
        event = event.source;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
}
