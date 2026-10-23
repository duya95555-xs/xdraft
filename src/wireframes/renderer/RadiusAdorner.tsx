/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Vec2 } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { Diagram, DiagramItem, DiagramItemSet } from '@app/wireframes/model';
import { FLOW_BORDER_RADIUS } from '@app/wireframes/shapes/neutral/rounded-rectangle';

// 手柄的屏幕尺寸(除以 zoom 换算成 diagram 单位, 保证视觉大小恒定)。
const HANDLE_SIZE = 9;

// 判定"按在手柄上"的屏幕半径。
const HANDLE_HIT_RADIUS = 12;

const HANDLE_FILL = '#ffffff';
const HANDLE_STROKE = '#1677ff';

// 圆弧点相对圆角的位置系数: 圆角圆心在 (x+r, y+r), 手柄放在朝左上角的圆弧点上,
// 该点相对形状左上角的对角距离 = r * ARC_FACTOR(= (√2-1) * √2 / ... 推导见 arcPoint)。
const ARC_FACTOR = Math.SQRT2 - 1;

export interface RadiusAdornerProps {
    // The current zoom value.
    zoom: number;

    // The current engine.
    engine: Engine;

    // The adorner layer.
    layer: EngineLayer;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The selected items.
    selectionSet: DiagramItemSet;

    // 手型 / 连线模式下只渲染不响应。
    disabled?: boolean;

    // 修改圆角外观(拖拽过程中实时提交, 与连接线途经点拖拽同一模式)。
    onChangeItemsAppearance: (diagram: Diagram, visuals: ReadonlyArray<DiagramItem>, key: string, val: any) => any;
}

type DragState = {
    itemId: string;

    // 形状左上角(拖拽期间不变)。
    x: number;
    y: number;

    // 拖拽开始的圆角值。
    startRadius: number;

    // 拖拽开始时手柄到左上角的对角距离(用于换算增量)。
    startDist: number;
};

// 圆角拖拽手柄(RadiusAdorner): 单选圆角矩形时, 在左上角圆弧上显示一个手柄,
// 拖动它即可直接调整圆角半径 —— 拖得越靠近对角线, 圆角越大。
// 右侧属性面板的"圆角"滑杆仍然可用, 两者写同一个外观键。
export class RadiusAdorner extends React.Component<RadiusAdornerProps> implements Listener {
    private handle: EngineRect | null = null;
    private drag: DragState | null = null;

    constructor(props: RadiusAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: RadiusAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }

            this.removeHandle();

            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.handle = null;
        }

        this.refresh();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        this.removeHandle();
        this.drag = null;
    }

    // ── 手柄计算与绘制 ──────────────────────────────────────────────────────

    private target(): DiagramItem | null {
        if (this.props.selectionSet.selectedItems.length !== 1) {
            return null;
        }

        const item = this.props.selectionSet.selectedItems[0];

        if (item.renderer !== 'RoundedRectangle' || item.isLocked) {
            return null;
        }

        return item;
    }

    private radiusOf(item: DiagramItem) {
        const value = item.appearance.get(FLOW_BORDER_RADIUS);

        return typeof value === 'number' && value >= 0 ? value : 16;
    }

    private maxRadius(item: DiagramItem) {
        const b = item.bounds(this.props.selectedDiagram).aabb;

        // 圆角物理上限 = 短边的一半(SVG 渲染器会自行收敛, 这里保持语义一致)。
        return Math.max(0, Math.min(b.w, b.h) * 0.5);
    }

    // 圆弧点(朝左上角方向)相对形状左上角的对角距离。
    private arcDistance(radius: number) {
        return radius * ARC_FACTOR;
    }

    private refresh() {
        if (!this.props.layer) {
            this.hideHandle();
            return;
        }

        const item = this.props.disabled ? null : this.target();

        if (!item) {
            this.hideHandle();
            return;
        }

        if (!this.handle) {
            this.handle = this.props.layer.rect();
            this.handle.strokeWidth(1);
            this.handle.cursor('nwse-resize');
        }

        this.paintHandle(item);
    }

    private paintHandle(item: DiagramItem) {
        if (!this.handle) {
            return;
        }

        const b = item.bounds(this.props.selectedDiagram).aabb;
        const radius = this.radiusOf(item);
        const arc = this.arcDistance(radius);

        const zoom = this.props.zoom;
        const size = HANDLE_SIZE / zoom;
        const stroke = 1 / zoom;

        this.handle.show();
        this.handle.fill(HANDLE_FILL);
        this.handle.strokeColor(HANDLE_STROKE);
        this.handle.strokeWidth(stroke);
        this.handle.plot({
            h: size,
            w: size,
            x: b.x + arc - size * 0.5,
            y: b.y + arc - size * 0.5,
        });
    }

    private hideHandle() {
        this.handle?.hide();
    }

    private removeHandle() {
        this.handle?.remove();
        this.handle = null;
    }

    private handleAt(position: Vec2): boolean {
        const item = this.target();

        if (!item || !this.handle) {
            return false;
        }

        const b = item.bounds(this.props.selectedDiagram).aabb;
        const arc = this.arcDistance(this.radiusOf(item));
        const threshold = HANDLE_HIT_RADIUS / this.props.zoom;

        const dx = position.x - (b.x + arc);
        const dy = position.y - (b.y + arc);

        return Math.sqrt(dx * dx + dy * dy) <= threshold;
    }

    // ── 事件 ────────────────────────────────────────────────────────────────

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.drag) {
            next(event);
            return;
        }

        const item = this.target();

        if (!item || !this.handleAt(event.position)) {
            next(event);
            return;
        }

        const b = item.bounds(this.props.selectedDiagram).aabb;
        const radius = this.radiusOf(item);

        this.drag = {
            itemId: item.id,
            startDist: this.arcDistance(radius),
            startRadius: radius,
            x: b.x,
            y: b.y,
        };

        event.source.preventDefault();
    }

    public onMouseDrag(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        const item = this.props.selectedDiagram.items.get(this.drag.itemId);

        if (!item) {
            this.drag = null;
            return;
        }

        // 鼠标到形状左上角的对角距离直接换算成圆角: 光标贴着圆弧走, 所见即所得。
        const dist = Math.hypot(event.position.x - this.drag.x, event.position.y - this.drag.y);
        const delta = dist - this.drag.startDist;

        const maxR = this.maxRadius(item);
        const radius = Math.min(maxR, Math.max(0, Math.round(this.drag.startRadius + delta)));

        this.props.onChangeItemsAppearance(
            this.props.selectedDiagram, [item], FLOW_BORDER_RADIUS, radius);
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        this.drag = null;
        this.refresh();
    }

    public onBlur(event: FocusEvent, next: (event: FocusEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        this.drag = null;
        this.refresh();
    }

    public render(): any {
        return null;
    }
}
