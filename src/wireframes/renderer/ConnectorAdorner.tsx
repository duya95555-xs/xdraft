/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Vec2 } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { Diagram, DiagramItem, DiagramItemSet, PluginRegistry } from '@app/wireframes/model';
import {
    CONNECTOR_RENDERER, connectorEndpoints, connectorPoints, connectorWaypoints,
    HandleCandidate, chooseHandleAt,
} from '@app/wireframes/shapes/neutral/_connector';
import { Pt } from '@app/wireframes/shapes/neutral/_connector-routing';

// 途经点手柄的屏幕尺寸(会按 1/zoom 换算成 diagram 单位,保证视觉大小恒定)。
const HANDLE_SIZE = 9;

// 端点手柄稍大一些,并与途经点用形状区分:端点=实心蓝圆,途经点=白色方形。
const ENDPOINT_SIZE = 11;

// 判定"按在手柄上"的屏幕半径。
const HANDLE_HIT_RADIUS = 11;

// 端点改接时判定"落在哪个组件上"的屏幕外扩距离,让贴边释放也能命中。
const DROP_TOLERANCE = 2;

// 拖拽吸附网格。
const SNAP_GRID = 4;

const HANDLE_FILL = '#ffffff';
const HANDLE_STROKE = '#1677ff';

// 端点手柄:实心蓝圆。
const ENDPOINT_FILL = '#1677ff';
const ENDPOINT_STROKE = '#ffffff';

// 改接拖拽时的候选高亮色。
const DROPDOWN_HIGHLIGHT = '#1677ff';

export interface ConnectorAdornerProps {
    // The current zoom value.
    zoom: number;

    // The target layer.
    layer: EngineLayer;

    // The current engine.
    engine: Engine;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The selected items.
    selectionSet: DiagramItemSet;

    // 写回连接线的固定途经点(空数组 = 恢复全自动路由)。
    onSetConnectorWaypoints?: (diagram: Diagram, item: DiagramItem, waypoints: ReadonlyArray<{ x: number; y: number }>) => any;

    // 端点改接:把 source/target 端改接到另一个组件上。
    onReconnectConnector?: (diagram: Diagram, item: DiagramItem, end: 'source' | 'target', target: DiagramItem, point: { x: number; y: number }) => any;
}

type HandleSlot = {
    connectorId: string;

    kind: HandleCandidate['kind'];

    // endpoint: 0/1;waypoint: 在 waypoints 数组中的下标。
    index: number;

    // diagram 绝对坐标。
    point: Pt;
};

type DragState = {
    connectorId: string;

    // 只有途经点拖拽会写模型,端点拖拽要等释放。
    kind: HandleCandidate['kind'];

    // endpoint: 0/1;waypoint: 数组下标。
    index: number;

    waypoints: Array<{ x: number; y: number }>;

    point: Pt;

    // 端点拖拽:当前悬停到的候选目标组件 id(仅用于高亮,不写模型)。
    hoverId: string | null;

    moved: boolean;
};

// 连接线拐点手柄(FR-6):选中连线后显示手柄,拖动手柄即固定一个途经点并重算路径。
// 核心不变式:**手柄 = 途经点**。一旦产生途经点,手柄集合就等于它,位置不会在重路由后跳走。
//
// 端点手柄(C1)与途经点手柄共用一个 adorner:
//   · 端点 = 折线首/末点,拖到另一个组件上即改接(实心蓝圆,略大);
//   · 途经点 = 折线内部拐点(白色方块)。
// 命中优先级 endpoint > waypoint —— 二者可能重合(只有一个拐点时)。
export class ConnectorAdorner extends React.Component<ConnectorAdornerProps> implements Listener {
    // 两组手柄对象:端点用圆(ellipse),途经点用方框(rect)。
    // 不能混用 —— SVG 后端只对 <ellipse> 套用 rx/ry,给 rect 传 rx/ry 会被忽略。
    private handles: EngineRect[] = [];

    // 手柄是圆还是方,按 slots[i].kind 决定。
    private handleIsEllipse: boolean[] = [];

    private slots: HandleSlot[] = [];

    // 候选组件高亮框(改接拖拽期间才显示)。
    private highlight: EngineRect | null = null;

    private drag: DragState | null = null;

    constructor(props: ConnectorAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: ConnectorAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }

            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.handles = [];
            this.handleIsEllipse = [];
        }

        // 选中集合变化 / 模型重算后,吸附中的端点拖拽要重新读取端点位置。
        this.refresh();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        // 移除残留手柄,否则切到抓手模式后它们会冻在持久层上。
        this.handles.forEach(h => h.remove());
        this.handles = [];
        this.handleIsEllipse = [];
        this.highlight?.remove();
        this.highlight = null;
        this.drag = null;
    }

    // ── 手柄计算与绘制 ──────────────────────────────────────────────────────

    private connectors(): DiagramItem[] {
        return this.props.selectionSet.selectedItems.filter(x => x.renderer === CONNECTOR_RENDERER);
    }

    // 某条连线的途经点手柄(diagram 绝对坐标)。
    // 有途经点时手柄就是途经点本身(不变式);否则从当前折线里挑最多 2 个内部拐点。
    private waypointHandlesOf(connector: DiagramItem): Pt[] {
        const stored = connectorWaypoints(connector);

        if (stored.length > 0) {
            return stored;
        }

        const local = connectorPoints(connector);

        if (!local || local.length < 3) {
            return [];
        }

        const t = connector.transform;
        const originX = t.left;
        const originY = t.top;

        const absolute = local.map(p => ({ x: p.x + originX, y: p.y + originY }));

        // 只挑"内部"顶点(去掉首末端点),端点由 endpoint 手柄承担。
        const interior = absolute.slice(1, absolute.length - 1);

        if (interior.length <= 2) {
            return interior;
        }

        // 超过 2 个时取折线长度贡献最大的两个。
        const scored = interior.map((p, i) => {
            const before = absolute[i];
            const after = absolute[i + 2];

            return { i, p, score: dist(before, p) + dist(p, after) };
        });

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, 2).sort((a, b) => a.i - b.i).map(s => s.p);
    }

    // 选中连线的全部手柄(端点在前,便于重合时端点胜出)。
    private handlesOf(connector: DiagramItem): HandleSlot[] {
        const result: HandleSlot[] = [];

        if (this.props.onReconnectConnector) {
            const ends = connectorEndpoints(connector);

            if (ends) {
                // 起终点完全重合(极短连线)时只留一个端点手柄,否则两个圆叠在一起点不中。
                result.push({ connectorId: connector.id, index: 0, kind: 'endpoint', point: ends[0] });

                if (dist(ends[0], ends[1]) > 1) {
                    result.push({ connectorId: connector.id, index: 1, kind: 'endpoint', point: ends[1] });
                }
            }
        }

        if (this.props.onSetConnectorWaypoints) {
            this.waypointHandlesOf(connector).forEach((point, index) => {
                result.push({ connectorId: connector.id, index, kind: 'waypoint', point });
            });
        }

        return result;
    }

    private refresh() {
        if (!this.props.layer || (!this.props.onSetConnectorWaypoints && !this.props.onReconnectConnector)) {
            this.hideAll();
            return;
        }

        // 端点拖拽期间手柄位置由鼠标决定,不跟着模型刷新,否则会跟手抖动。
        if (this.drag && this.drag.kind === 'endpoint') {
            return;
        }

        this.slots = [];

        for (const connector of this.connectors()) {
            this.slots.push(...this.handlesOf(connector));
        }

        // 先补齐数量,再检查图元类型是否匹配。复用对象可以避免每次选中变化都重建 DOM。
        while (this.handles.length < this.slots.length) {
            const index = this.handles.length;
            const isEndpoint = this.slots[index].kind === 'endpoint';
            const handle = isEndpoint ? this.props.layer.ellipse() : this.props.layer.rect();

            handle.strokeWidth(1);
            handle.cursor('move');

            this.handles.push(handle);
            this.handleIsEllipse.push(isEndpoint);
        }

        // 图元类型不匹配(例如某条连线的第一个手柄从端点变成途经点)时按需替换。
        for (let i = 0; i < this.slots.length; i++) {
            const isEndpoint = this.slots[i].kind === 'endpoint';

            if (this.handleIsEllipse[i] === isEndpoint) {
                continue;
            }

            this.handles[i].remove();

            const handle = isEndpoint ? this.props.layer.ellipse() : this.props.layer.rect();

            handle.strokeWidth(1);
            handle.cursor('move');

            this.handles[i] = handle;
            this.handleIsEllipse[i] = isEndpoint;
        }

        this.paintHandles();
    }

    // 按 slots 重画全部手柄(位置 + 样式)。
    private paintHandles() {
        const zoom = this.props.zoom;
        const stroke = 1 / zoom;

        this.handles.forEach((handle, i) => {
            const slot = this.slots[i];

            if (!slot) {
                handle.hide();
                return;
            }

            const isEndpoint = slot.kind === 'endpoint';
            const size = (isEndpoint ? ENDPOINT_SIZE : HANDLE_SIZE) / zoom;

            handle.show();
            handle.fill(isEndpoint ? ENDPOINT_FILL : HANDLE_FILL);
            handle.strokeColor(isEndpoint ? ENDPOINT_STROKE : HANDLE_STROKE);
            // 端点靠"实心圆"辨识,白描边;途经点靠"白底方框"辨识,蓝描边。
            handle.strokeWidth(isEndpoint ? stroke * 2 : stroke);
            handle.plot({
                h: size,
                w: size,
                x: slot.point.x - size * 0.5,
                y: slot.point.y - size * 0.5,
            });
        });
    }

    private hideAll() {
        this.handles.forEach(h => h.hide());
        this.slots = [];
        this.hideHighlight();
    }

    // 找出光标下最近的手柄(endpoint 优先)。
    private handleAt(position: Vec2): HandleSlot | null {
        const threshold = HANDLE_HIT_RADIUS / this.props.zoom;

        const candidates: HandleCandidate[] = this.slots.map(s => ({
            index: s.index,
            kind: s.kind,
            point: s.point,
        }));

        const hit = chooseHandleAt(candidates, position, threshold);

        if (!hit) {
            return null;
        }

        return this.slots.find(s => s.kind === hit.kind && s.index === hit.index) ?? null;
    }

    // ── 改接候选 ────────────────────────────────────────────────────────────

    // 找出光标下的可连接组件(不含自身与连线)。
    private candidateAt(position: Vec2, connectorId: string): DiagramItem | null {
        const tolerance = DROP_TOLERANCE / this.props.zoom;

        // items 是 ImmutableMap,`.values` 是 getter(不是方法),与 EditorView.findConnectableAt 一致。
        const candidates = Array.from(this.props.selectedDiagram.items.values);

        // 倒序 = 视觉上层优先,和 EditorView.findConnectableAt 一致。
        for (let i = candidates.length - 1; i >= 0; i--) {
            const item = candidates[i];

            if (item.id === connectorId || item.renderer === CONNECTOR_RENDERER || item.isLocked) {
                continue;
            }

            // 与 EditorView.findConnectableAt 保持完全一致的口径(同一注册表查询)。
            const plugin = PluginRegistry.get(item.renderer);

            if (!plugin?.plugin?.connectable?.()) {
                continue;
            }

            const b = item.bounds(this.props.selectedDiagram).aabb;

            if (position.x >= b.x - tolerance && position.x <= b.x + b.w + tolerance &&
                position.y >= b.y - tolerance && position.y <= b.y + b.h + tolerance) {
                return item;
            }
        }

        return null;
    }

    private showHighlight(item: DiagramItem | null) {
        if (!this.props.layer) {
            return;
        }

        if (!item) {
            this.hideHighlight();
            return;
        }

        if (!this.highlight) {
            const rect = this.props.layer.rect();

            rect.fill('none');
            rect.strokeColor(DROPDOWN_HIGHLIGHT);
            this.highlight = rect;
        }

        const b = item.bounds(this.props.selectedDiagram).aabb;
        const pad = 4;
        const stroke = 2 / this.props.zoom;

        this.highlight.strokeWidth(stroke);
        this.highlight.plot({ h: b.h + pad * 2, w: b.w + pad * 2, x: b.x - pad, y: b.y - pad });
        this.highlight.show();
    }

    private hideHighlight() {
        this.highlight?.hide();
    }

    // ── 事件 ────────────────────────────────────────────────────────────────

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (this.drag) {
            next(event);
            return;
        }

        const slot = this.handleAt(event.position);

        if (!slot) {
            next(event);
            return;
        }

        const connector = this.props.selectedDiagram.items.get(slot.connectorId);

        if (!connector) {
            next(event);
            return;
        }

        // ── 端点:进入改接拖拽(不写模型) ──
        if (slot.kind === 'endpoint') {
            if (!this.props.onReconnectConnector) {
                next(event);
                return;
            }

            this.drag = {
                connectorId: slot.connectorId,
                hoverId: null,
                index: slot.index,
                kind: 'endpoint',
                moved: false,
                point: slot.point,
                waypoints: connectorWaypoints(connector),
            };

            event.source.preventDefault();
            return;
        }

        // ── 途经点:需要可写回 ──
        if (!this.props.onSetConnectorWaypoints) {
            next(event);
            return;
        }

        // 首次拖拽:把当前全部手柄物化为途经点,后续手柄集合就恒等于途经点。
        let waypoints: Array<{ x: number; y: number }> = connectorWaypoints(connector);

        if (waypoints.length === 0) {
            waypoints = this.slots
                .filter(s => s.connectorId === slot.connectorId && s.kind === 'waypoint')
                .map(s => ({ x: s.point.x, y: s.point.y }));
        }

        if (slot.index >= waypoints.length) {
            next(event);
            return;
        }

        this.drag = {
            connectorId: slot.connectorId,
            hoverId: null,
            index: slot.index,
            kind: 'waypoint',
            moved: false,
            point: slot.point,
            waypoints,
        };

        event.source.preventDefault();

        // 已消费该事件,不再向后传递(否则会同时触发框选 / 变换)。
    }

    public onMouseDrag(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        const snapped = {
            x: Math.round(event.position.x / SNAP_GRID) * SNAP_GRID,
            y: Math.round(event.position.y / SNAP_GRID) * SNAP_GRID,
        };

        if (this.drag.kind === 'endpoint') {
            // 改接只做视觉反馈:把手柄跟到鼠标、高亮候选组件。模型等 mouseup 才提交。
            const candidate = this.candidateAt(event.position, this.drag.connectorId);

            this.drag = { ...this.drag, hoverId: candidate?.id ?? null, moved: true, point: snapped };

            this.moveEndpointHandle(0, snapped);
            this.showHighlight(candidate);
            return;
        }

        const waypoints = this.drag.waypoints.map((w, i) => (i === this.drag!.index ? snapped : w));

        this.drag = { ...this.drag, moved: true, waypoints };

        this.commit(this.drag.connectorId, waypoints);
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        const drag = this.drag;

        this.drag = null;
        this.hideHighlight();

        // 只是点了一下手柄、没有真正拖动:不改动模型。
        if (!drag.moved) {
            this.refresh();
            return;
        }

        if (drag.kind === 'waypoint') {
            this.refresh();
            return;
        }

        // ── 端点改接:释放位置必须落在合法组件上才提交 ──
        const candidate = this.candidateAt(event.position, drag.connectorId);

        if (!candidate || !this.props.onReconnectConnector) {
            // 释放到空白处 = 取消改接,恢复原状。
            this.refresh();
            return;
        }

        const connector = this.props.selectedDiagram.items.get(drag.connectorId);

        if (connector) {
            const end = drag.index === 0 ? 'source' : 'target';

            this.props.onReconnectConnector(
                this.props.selectedDiagram, connector, end, candidate, { x: event.position.x, y: event.position.y });
        }

        this.refresh();
    }

    public onBlur(event: FocusEvent, next: (event: FocusEvent) => void) {
        if (!this.drag) {
            next(event);
            return;
        }

        this.drag = null;
        this.hideHighlight();
    }

    private moveEndpointHandle(_index: number, point: Pt) {
        // 拖拽期间手柄位置由鼠标决定,这里只更新对应端点的坐标后重画。
        for (const slot of this.slots) {
            if (slot.connectorId === this.drag?.connectorId && slot.kind === 'endpoint' && slot.index === this.drag.index) {
                slot.point = point;
            }
        }

        this.paintHandles();
    }

    // 双击手柄 = 清除该连线的全部途经点,恢复全自动路由。
    public onDoubleClick(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        if (!this.props.onSetConnectorWaypoints) {
            next(event);
            return;
        }

        const slot = this.handleAt(event.position);

        // 端点手柄不吃双击:改接语义与"清途经点"无关。
        if (!slot || slot.kind === 'endpoint') {
            next(event);
            return;
        }

        const connector = this.props.selectedDiagram.items.get(slot.connectorId);

        if (!connector || connectorWaypoints(connector).length === 0) {
            next(event);
            return;
        }

        event.source.preventDefault();
        this.commit(slot.connectorId, []);
    }

    private commit(connectorId: string, waypoints: ReadonlyArray<{ x: number; y: number }>) {
        const connector = this.props.selectedDiagram.items.get(connectorId);

        if (connector) {
            this.props.onSetConnectorWaypoints?.(this.props.selectedDiagram, connector, waypoints);
        }
    }

    public render(): any {
        return null;
    }
}

function dist(a: Pt, b: Pt): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
