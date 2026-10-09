/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Rect2 } from '@app/core/utils';
import { DiagramItem } from '@app/wireframes/model';
import { chooseSides, Pt, RectLike, Side, SidePair, sideAnchorPoint, sideNormal, slotToT } from './_connector-routing';

// 连接线(Connect)appearance 中的语义与几何缓存 key 常量。
// 详见 mydraft-二次开发/批次五-连接线原语与连线模式.md
export const Connector = {
    // 连接关系
    SOURCE: 'CONNECTOR_SOURCE',       // 源 item id
    TARGET: 'CONNECTOR_TARGET',       // 目标 item id
    // 归一化锚点(沿每条边的 [0..1] 参数,矩形/圆角矩形=4 中点或 4 角,圆=8 方向角)
    // 兼容保留:新代码以 SIDES + SLOT 为准,此 key 仅只读,不再作为几何依据。
    ANCHOR: 'CONNECTOR_ANCHOR',       // { sx, sy, tx, ty }
    // 选边结果:{ ss, ts },ss/ts ∈ 'L' | 'R' | 'T' | 'B'。
    // 只可能是 R→L / L→R / B→T / T→B 四种"法线互指"组合(FR-2)。
    SIDES: 'CONNECTOR_SIDES',
    // 该 SIDES 是否为"用户手选"(创建连线时按鼠标位置选定的那条边)。
    // true  ⇒ 永久固定,组件移动也不重算(尊重用户的布置意图);
    // 缺省  ⇒ 自动模式,每次按当前 AABB 重新选边(组件易位后自动换边)。
    SIDES_MANUAL: 'CONNECTOR_SIDES_MANUAL',
    // 多线错开槽位:同一对组件同一条边上的第 n 条线,0 为边中点(FR-1),±n 依次错开(FR-4)。
    SLOT: 'CONNECTOR_SLOT',
    // 用户拖拽固定的途经点(绝对坐标,最多 2 个)。存在时手柄集合恒等于该数组(FR-6 不变式)。
    WAYPOINTS: 'CONNECTOR_WAYPOINTS',
    // 最终折线点(局部坐标,flat [x,y,...]),渲染的唯一依据 —— 几何全部归模型层。
    PTS: 'CONNECTOR_PTS',
    // 路由无解时的降级标记:渲染为红色虚线。
    DEGRADED: 'CONNECTOR_DEGRADED',
    // 本地坐标系下的起终点坐标(Transform 原点=bbox 左上角, 见 §2.3)
    X1: 'CONNECTOR_X1', Y1: 'CONNECTOR_Y1',
    X2: 'CONNECTOR_X2', Y2: 'CONNECTOR_Y2',
    // 视觉(用户可改)
    TYPE: 'CONNECTOR_TYPE',           // 'straight' | 'orthogonal' | 'curved'
    HEAD_START: 'CONNECTOR_HEAD_START', // 'none' | 'arrow'
    HEAD_END: 'CONNECTOR_HEAD_END',     // 'none' | 'arrow'
    // 线型: 'solid'(实线) | 'dashed'(虚线) | 'dotted'(点线)
    STROKE_DASH: 'CONNECTOR_STROKE_DASH',
    // 拐角位置(旧字段:新路由由 A* 决定拐点,不再使用,保留以兼容老图纸)
    BEND_POSITION: 'CONNECTOR_BEND_POSITION',
    // 弧度(curved 类型时的圆角半径强度,0 = 使用默认圆角)
    CURVE_AMPLITUDE: 'CONNECTOR_CURVE_AMPLITUDE',
    // 文本标注
    TEXT: 'CONNECTOR_TEXT',
    TEXT_POSITION: 'CONNECTOR_TEXT_POSITION', // 沿路径归一化位置 [0..1]
    // 标注文字的背景色。缺省 = 不透明地铺一层画布底色(见 connect.ts 的 DEFAULT_APPEARANCE),
    // 这样文字压到网格线或其它图形上时仍然清晰可读。
    TEXT_BACKGROUND: 'CONNECTOR_TEXT_BACKGROUND',
};

// 连接线的 renderer 标识符。
export const CONNECTOR_RENDERER = 'Connector';

export function isConnector(item: DiagramItem | null | undefined): boolean {
    return !!item && item.renderer === CONNECTOR_RENDERER;
}

// 输入两个 item bounds(绝对坐标系)与"形状类型",输出归一化锚点对。
// 保留供老图纸 / 外部调用使用;新代码请用 connectorGeometry()。
export function closestAnchorPair(srcBounds: Rect2, tgtBounds: Rect2) {
    const cand = anchorCandidates();
    const sides: Side[] = ['L', 'R', 'T', 'B'];

    const pair = chooseSides(toRectLike(srcBounds), toRectLike(tgtBounds));

    const a = sides.indexOf(pair.ss);
    const b = sides.indexOf(pair.ts);

    // 退化为"边中点对":chooseSides 只给边,不给沿边参数,中点即 0.5。
    return { sx: cand[a].x, sy: cand[a].y, tx: cand[b].x, ty: cand[b].y };
}

// 4 候选锚点:上下左右边中点。
function anchorCandidates(): Array<{ x: number; y: number }> {
    return [
        { x: 0,   y: .5 }, // 左
        { x: 1,   y: .5 }, // 右
        { x: .5, y: 0   }, // 上
        { x: .5, y: 1   }, // 下
    ];
}

// 由源/目标 item + 归一化锚点推导出绝对起/终点坐标。
export function anchorToAbsolute(item: DiagramItem, anchor: { x: number; y: number }, diagram: any): { x: number; y: number } {
    const b = item.bounds(diagram).aabb;
    return { x: b.x + anchor.x * b.width, y: b.y + anchor.y * b.height };
}

export function toRectLike(rect: Rect2 | RectLike): RectLike {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

// ── 锚点模型读取 ────────────────────────────────────────────────────────────

const VALID_SIDES: { [key: string]: boolean } = { B: true, L: true, R: true, T: true };

// 读取 appearance 所需的最小结构;DiagramItem 与渲染层的 Shape 都满足。
export interface AppearanceHolder {
    getAppearance(key: string): any;
}

// 选边规则:
//   · 用户手选(SIDES_MANUAL=true)⇒ 沿用已存的 SIDES,永久固定;
//   · 其余情况 ⇒ 每次按当前两个 bounds 重新推导。
//
// 注意:这里**不能**无条件优先读取已存的 SIDES —— maintainConnectors 每帧都会把结果
// 写回 SIDES,若再优先读它,连线创建后选边就被永久冻结,组件移动也不会换边。
export function connectorSides(connector: AppearanceHolder, src: RectLike, tgt: RectLike): SidePair {
    const stored = connector.getAppearance(Connector.SIDES);

    if (connector.getAppearance(Connector.SIDES_MANUAL) &&
        stored && VALID_SIDES[stored.ss] && VALID_SIDES[stored.ts]) {
        return { ss: stored.ss, ts: stored.ts };
    }

    return chooseSides(src, tgt);
}

export function connectorSlot(connector: AppearanceHolder): number {
    const slot = Number(connector.getAppearance(Connector.SLOT));

    return Number.isFinite(slot) ? slot : 0;
}

// 第 index 条同源同目标连线使用的槽位序号:0, +1, -1, +2, -2 …
// 正负交替可避免单向累积顶到 30% 边长上限。
export { slotForIndex } from './_connector-routing';

// 按鼠标位置选边(创建连线时决定从哪条边出去/进来)。
export { nearestAnchorSide } from './_connector-routing';

// 改接后重算槽位序号(C1)。
export { nextSlotFor } from './_connector-routing';

// 四边中点锚点全集 + 最近锚点查询(hover 选锚点 / 端点改接共用)。
export { ALL_SIDES, anchorPointsOf, nearestAnchor } from './_connector-routing';

// 手柄命中判定(endpoint 优先于 waypoint)。
export { chooseHandleAt } from './_connector-routing';
export type { HandleCandidate, HandleKind } from './_connector-routing';

export function connectorWaypoints(connector: AppearanceHolder): Pt[] {
    const raw = connector.getAppearance(Connector.WAYPOINTS);

    if (!Array.isArray(raw)) {
        return [];
    }

    const result: Pt[] = [];

    for (const p of raw.slice(0, 2)) {
        const x = Number(p?.x);
        const y = Number(p?.y);

        if (Number.isFinite(x) && Number.isFinite(y)) {
            result.push({ x, y });
        }
    }

    return result;
}

// 读取缓存的折线点(局部坐标)。缺失时返回 null,调用方应回退到旧渲染分支。
export function connectorPoints(connector: AppearanceHolder): Pt[] | null {
    const raw = connector.getAppearance(Connector.PTS);

    if (!Array.isArray(raw) || raw.length < 4) {
        return null;
    }

    const result: Pt[] = [];

    for (let i = 0; i + 1 < raw.length; i += 2) {
        const x = Number(raw[i]);
        const y = Number(raw[i + 1]);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }

        result.push({ x, y });
    }

    return result;
}

export function flattenPoints(points: ReadonlyArray<Pt>): number[] {
    const result: number[] = [];

    for (const p of points) {
        result.push(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100);
    }

    return result;
}

// 连线的两个端点(diagram 绝对坐标):[source 端, target 端]。
// 优先用缓存的 PTS 首尾点 + Transform 原点换算;老图纸没有 PTS 时回退 X1/Y1 / X2/Y2。
// 返回 null 表示完全没有几何缓存(刚创建还没维护过的连线),调用方应跳过端点手柄。
export function connectorEndpoints(connector: AppearanceHolder & { transform: { left: number; top: number } }): [Pt, Pt] | null {
    const local = connectorPoints(connector);
    const ox = connector.transform?.left;
    const oy = connector.transform?.top;

    if (local && local.length >= 2 && Number.isFinite(ox) && Number.isFinite(oy)) {
        const first = local[0];
        const last = local[local.length - 1];

        return [
            { x: first.x + ox, y: first.y + oy },
            { x: last.x + ox, y: last.y + oy },
        ];
    }

    const x1 = Number(connector.getAppearance(Connector.X1));
    const y1 = Number(connector.getAppearance(Connector.Y1));
    const x2 = Number(connector.getAppearance(Connector.X2));
    const y2 = Number(connector.getAppearance(Connector.Y2));

    if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2) &&
        Number.isFinite(ox) && Number.isFinite(oy)) {
        return [{ x: x1 + ox, y: y1 + oy }, { x: x2 + ox, y: y2 + oy }];
    }

    return null;
}

export interface ConnectorGeometry {
    // 源/目标选边。
    ss: Side;
    ts: Side;

    // 沿边参数(0.5 = 边中点)。
    st: number;
    tt: number;

    // 绝对端点与外向法线(单位向量)。
    p1: Pt;
    n1: Pt;
    p2: Pt;
    n2: Pt;
}

export function connectorGeometry(connector: AppearanceHolder, src: RectLike, tgt: RectLike): ConnectorGeometry {
    const sides = connectorSides(connector, src, tgt);
    const slot = connectorSlot(connector);

    const st = slotToT(src, sides.ss, slot);
    const tt = slotToT(tgt, sides.ts, slot);

    return {
        n1: sideNormal(sides.ss),
        n2: sideNormal(sides.ts),
        p1: sideAnchorPoint(src, sides.ss, st),
        p2: sideAnchorPoint(tgt, sides.ts, tt),
        ss: sides.ss,
        st,
        ts: sides.ts,
        tt,
    };
}

// 把选边 + 沿边参数换算回旧的归一化锚点 { sx, sy, tx, ty },用于兼容老读取方。
export function normalizedAnchor(side: Side, t: number): { x: number; y: number } {
    switch (side) {
        case 'L': return { x: 0, y: t };
        case 'R': return { x: 1, y: t };
        case 'T': return { x: t, y: 0 };
        default:  return { x: t, y: 1 };
    }
}

export function toLegacyAnchor(geo: ConnectorGeometry) {
    const a = normalizedAnchor(geo.ss, geo.st);
    const b = normalizedAnchor(geo.ts, geo.tt);

    return { sx: a.x, sy: a.y, tx: b.x, ty: b.y };
}

// ── 命中测试(FR-5 / CONN-004)──────────────────────────────────────────────
// 实现在 _connector-routing 中(纯几何、可单测),这里只做转发。
export { distanceToPolyline, distanceToSegment, pointsBounds } from './_connector-routing';
