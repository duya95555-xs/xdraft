/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Rect2, Vec2, ViewBox } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineLine, EngineMouseEvent, Listener } from '@app/wireframes/engine';
import { computeSplitTiles, Diagram, DiagramItem, Transform } from '@app/wireframes/model';
import { texts } from '@app/texts';
import { OverlayManager } from './../contexts/OverlayContext';

export interface SplitAdornerProps {
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

    // The image item that is currently split. Null when the split mode is inactive.
    splitItem: DiagramItem | null;

    // The overlay manager.
    overlayManager: OverlayManager;

    // Invoked when the user has clicked a valid split position.
    onSplit: (item: DiagramItem, point: Vec2) => void;

    // Invoked when the user cancels the split mode.
    onCancel: () => void;
}

const LINE_COLOR = '#ff4d4f';

export class SplitAdorner extends React.PureComponent<SplitAdornerProps> implements Listener {
    private vLine: EngineLine = null!;
    private hLine: EngineLine = null!;
    private mousePosition: Vec2 | null = null;

    constructor(props: SplitAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: SplitAdornerProps) {
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

            this.vLine = this.props.layer.line();
            this.vLine.color(LINE_COLOR);

            this.hLine = this.props.layer.line();
            this.hLine.color(LINE_COLOR);

            this.hideShapes();
        }

        if (this.props.splitItem !== prevProps.splitItem) {
            this.mousePosition = null;
        }

        this.renderShapes();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        this.removeShapes();
    }

    public onMouseMove(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.props.splitItem) {
            next(event);
            return;
        }

        stopEvent(event.source);

        this.mousePosition = event.position;

        // Remove the hint label of an invalid click so it does not trail behind.
        this.props.overlayManager.reset();

        this.renderShapes();
    }

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (!this.props.splitItem) {
            next(event);
            return;
        }

        // Swallow the press so no item gets selected or dragged in split mode.
        stopEvent(event.source);
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.props.splitItem) {
            next(event);
            return;
        }

        stopEvent(event.source);

        const point = event.position;
        const tiles = computeSplitTiles(this.splitBounds(), point);

        if (tiles.length > 0) {
            this.props.onSplit(this.props.splitItem, point);
        } else {
            // No cut line crosses the image: show a hint and stay in split mode.
            this.props.overlayManager.reset();

            this.props.overlayManager.showInfo(Transform.fromRect(new Rect2(point.x, point.y, 1, 1)), texts.common.splitImageDisabled);
        }
    }

    public onKeyDown(event: KeyboardEvent, next: (event: KeyboardEvent) => void) {
        if (this.props.splitItem && event.key === 'Escape') {
            stopEvent(event);

            this.props.onCancel();
            return;
        }

        next(event);
    }

    public onClick(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.props.splitItem) {
            stopEvent(event.source);
            return false;
        }

        next(event);

        return false;
    }

    public onDoubleClick(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.props.splitItem) {
            stopEvent(event.source);
            return;
        }

        next(event);
    }

    public render() {
        return null;
    }

    private splitBounds(): Rect2 {
        return this.props.splitItem!.bounds(this.props.selectedDiagram).aabb;
    }

    private renderShapes() {
        if (!this.props.splitItem) {
            this.hideShapes();
            return;
        }

        // The visible area in diagram coordinates, so the lines always span
        // the whole viewport no matter the zoom level or the pan offset.
        // ViewBox 的 maxX/maxY 是坐标（不是宽高），Rect2 构造是 (x, y, w, h);
        // 必须换算成宽高，否则在负坐标区域时十字辅助线会短一截。
        const viewport = new Rect2(this.props.viewBox.minX, this.props.viewBox.minY, this.props.viewBox.maxX - this.props.viewBox.minX, this.props.viewBox.maxY - this.props.viewBox.minY);
        const point = this.mousePosition;

        if (!point) {
            this.hideShapes();
            return;
        }

        const stroke = 1.5 / this.props.zoom;

        this.vLine.show();
        this.vLine.plot({ x1: point.x, y1: viewport.y, x2: point.x, y2: viewport.bottom, width: stroke });

        this.hLine.show();
        this.hLine.plot({ x1: viewport.x, y1: point.y, x2: viewport.right, y2: point.y, width: stroke });
    }

    private hideShapes() {
        this.vLine?.hide();
        this.hLine?.hide();
    }

    private removeShapes() {
        this.vLine?.remove();
        this.hLine?.remove();
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
