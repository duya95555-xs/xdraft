/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Vec2 } from '@app/core';
import { Engine, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { Diagram, DiagramItem } from '@app/wireframes/model';
import { toRectLike } from '@app/wireframes/shapes/neutral/_connector';
import { ALL_SIDES, nearestAnchor, RectLike, Side, sideAnchorPoint } from '@app/wireframes/shapes/neutral/_connector-routing';

// 锚点圆的屏幕直径。
const ANCHOR_SIZE = 9;

// hover 中的锚点放大后的屏幕直径。
const ANCHOR_SIZE_ACTIVE = 14;

// 判定"鼠标悬停到锚点上"的屏幕半径。比圆本身大一圈,便于点选。
const ANCHOR_HIT_RADIUS = 14;

// 组件描边的屏幕宽度。
const OUTLINE_WIDTH = 1.5;

const ANCHOR_FILL = '#ffffff';
const ANCHOR_STROKE = '#1677ff';
const ANCHOR_ACTIVE_FILL = '#1677ff';
const ANCHOR_ACTIVE_STROKE = '#ffffff';
const OUTLINE_STROKE = '#1677ff';

export interface ConnectorAnchorAdornerProps {
    // The current zoom value.
    zoom: number;

    // The target layer.
    layer: EngineLayer;

    // The current engine.
    engine: Engine;

    // The selected diagram.
    selectedDiagram: Diagram;

    // 鼠标当前悬停的组件(由 EditorView 维护;null = 无)。
    hoverItem: DiagramItem | null;

    // 鼠标此刻悬停在四边锚点中的哪一条(由本 adorner 自己算出并回传)。
    hoverSide: Side | null;

    // 上报"鼠标当前悬停在哪条边的锚点上"。null = 未悬停在任何锚点。
    onHoverAnchor?: (side: Side | null) => void;
}

// 连线模式下的锚点提示器(C2)。
//
// 行为:鼠标移到可连接组件上 → 描出该组件轮廓 + 浮现四条边的中点锚点圆;
//      鼠标再靠近某个锚点 → 该锚点放大并填实,表示"若此刻连线就从这条边出入"。
//
// 之所以单独一个 adorner 而不是塞进 ConnectorAdorner:
//   · 生命周期完全不同 —— 只在 connectMode 存在,常规编辑不挂载;
//   · 事件语义相反 —— 它必须**放行** mousedown(让 EditorView 收线),不能消费。
export class ConnectorAnchorAdorner extends React.Component<ConnectorAnchorAdornerProps> implements Listener {
    private outline: EngineRect | null = null;
    private anchors: EngineRect[] = [];

    // 上一帧上报给外部的状态,用于变化检测(避免每帧都触发 React setState)。
    private reported: Side | null | undefined = undefined;

    constructor(props: ConnectorAnchorAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: ConnectorAnchorAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }

            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.anchors = [];
        }

        this.refresh();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        this.outline?.remove();
        this.outline = null;

        this.anchors.forEach(a => a.remove());
        this.anchors = [];
    }

    // ── 绘制 ────────────────────────────────────────────────────────────────

    // 当前位置命中的锚点边。
    private hitAnchor(item: DiagramItem, position: Vec2): Side | null {
        const rect = toRectLike(item.bounds(this.props.selectedDiagram).aabb);
        const hit = nearestAnchor(rect, position, ANCHOR_HIT_RADIUS / this.props.zoom);

        return hit?.side ?? null;
    }

    private refresh() {
        const { hoverItem, layer } = this.props;

        if (!layer || !hoverItem) {
            this.hideAll();
            return;
        }

        const rect: RectLike = toRectLike(hoverItem.bounds(this.props.selectedDiagram).aabb);

        // 组件轮廓。
        if (!this.outline) {
            const o = layer.rect();

            o.fill('none');
            this.outline = o;
        }

        this.outline.strokeColor(OUTLINE_STROKE);
        this.outline.strokeWidth(OUTLINE_WIDTH / this.props.zoom);
        this.outline.plot({ h: rect.h, w: rect.w, x: rect.x, y: rect.y });
        this.outline.show();

        // 四条边的中点锚点。必须用 ellipse() —— SVG 后端只对 <ellipse> 元素套用 rx/ry,
        // 用 rect() 传 rx/ry 会被忽略,画出来的是方块。
        while (this.anchors.length < ALL_SIDES.length) {
            const a = layer.ellipse();

            a.strokeWidth(1);
            a.cursor('crosshair');
            this.anchors.push(a);
        }

        const zoom = this.props.zoom;
        const active = this.props.hoverSide;

        ALL_SIDES.forEach((side, i) => {
            const anchor = this.anchors[i];

            if (!anchor) {
                return;
            }

            const isActive = active === side;
            const size = (isActive ? ANCHOR_SIZE_ACTIVE : ANCHOR_SIZE) / zoom;
            const p = sideAnchorPoint(rect, side, 0.5);

            anchor.fill(isActive ? ANCHOR_ACTIVE_FILL : ANCHOR_FILL);
            anchor.strokeColor(isActive ? ANCHOR_ACTIVE_STROKE : ANCHOR_STROKE);
            anchor.strokeWidth((isActive ? 2 : 1) / zoom);
            anchor.plot({ h: size, w: size, x: p.x - size * 0.5, y: p.y - size * 0.5 });
            anchor.show();
        });
    }

    private hideAll() {
        this.outline?.hide();
        this.anchors.forEach(a => a.hide());
    }

    // ── 事件 ────────────────────────────────────────────────────────────────

    // 只用来跟踪悬停,绝不消费事件 —— 否则 EditorView 收不到 mousedown,连线就断了。
    public onMouseMove(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        const item = this.props.hoverItem;

        if (item && this.props.onHoverAnchor) {
            const side = this.hitAnchor(item, event.position);

            if (side !== this.reported) {
                this.reported = side;
                this.props.onHoverAnchor(side);
            }
        }

        next(event);
    }

    public render(): any {
        return null;
    }
}
