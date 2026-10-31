/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 连接线几何引擎(纯函数,无 React / 无 DOM,可单元测试)。
//
// 职责:
//   1. 锚点模型:四条边的边中点 + 沿边槽位(多线错开)
//   2. 选边:保证两端法线互相朝向(FR-2 垂直出入的数学前提)
//   3. 路由:正交网格 A*,绕开障碍(FR-3)、支持用户固定点(FR-6)
//   4. 折线工具:简化 / 长度 / 定点 / SVG path 生成 / 手柄选取
//
// 约束优先级(高 → 低):
//   H1 端点位置与法线方向      —— 由 stub 构造保证,不可违反
//   H2 不穿透组件              —— 由 blocker 保证
//   H5 贴用户指定点(vias)      —— 硬约束,路由必须穿过
//   H4 少拐点 > H3 最短
//   H1/H2 不可兼得 → 返回 degraded=true,由渲染层画红色虚线,绝不抛错

export type Side = 'L' | 'R' | 'T' | 'B';

export interface Pt {
    x: number;
    y: number;
}

// 与 Rect2 结构兼容(只读四个字段),便于在测试中直接传字面量。
export interface RectLike {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Blocker {
    rect: RectLike;

    // 外扩距离。其它组件用正数(安全间隙),源/目标自身用负数(允许贴边走、禁止穿体)。
    clearance: number;
}

export interface RouteRequest {
    // 起点与"外向法线"(单位向量之一:±x / ±y)。
    p1: Pt;
    n1: Pt;

    // 终点与外向法线。
    p2: Pt;
    n2: Pt;

    // 障碍集合(不含本连线自身)。
    blockers: Blocker[];

    // 用户固定的途经点(绝对坐标),按顺序穿过。
    vias?: Pt[];

    // 'straight' | 'orthogonal' | 'curved'
    type?: string;
}

export interface RouteResult {
    // 完整折线(含首尾端点),绝对坐标。
    points: Pt[];

    // 无可行解,渲染层应降级展示。
    degraded: boolean;

    // 清洗后的途经点(可能被推出障碍),模型层应回写,保证"手柄 = vias"不变式。
    vias: Pt[];
}

// ── 常量 ────────────────────────────────────────────────────────────────────

// 多线错开的步长。
const SLOT_STEP = 8;

// 错开上限占边长的比例。
const SLOT_LIMIT_RATIO = 0.3;

// 出入段(法线缓冲区)长度范围。
const STUB_MIN = 12;
const STUB_MAX = 28;

// 转向代价:把"少拐点"排在"更短"之前。
const TURN_PENALTY = 24;

// 网格候选坐标上限(每轴),防止大图纸退化。
const AXIS_LIMIT = 48;

// 坐标合并阈值。
const SAME = 0.5;

// ── 基础工具 ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
}

function dist(a: Pt, b: Pt) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function fmt(v: number) {
    return Math.round(v * 100) / 100;
}

function inflate(r: RectLike, d: number): RectLike {
    return {
        x: r.x - d,
        y: r.y - d,
        w: Math.max(0, r.w + 2 * d),
        h: Math.max(0, r.h + 2 * d),
    };
}

// 轴对齐线段是否与矩形"实体"相交。使用严格不等号,因此贴着边界走是允许的
// ——这既是"允许贴边绕行"的需要,也让端点落在组件边界上时不误判。
function hitsRect(x1: number, y1: number, x2: number, y2: number, r: RectLike): boolean {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    return maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h;
}

function hitsAny(x1: number, y1: number, x2: number, y2: number, rects: RectLike[]): boolean {
    for (const r of rects) {
        if (hitsRect(x1, y1, x2, y2, r)) {
            return true;
        }
    }

    return false;
}

function insideAny(p: Pt, rects: RectLike[]): boolean {
    for (const r of rects) {
        if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) {
            return true;
        }
    }

    return false;
}

// 沿法线找一段"自由"的缓冲区。
// 组件贴得很近时,固定长度的 stub 会直接扎进邻居组件,导致 A* 起点被封锁而整条线退化;
// 这里按 1px 步长回收,保证 N-2 的法线方向在可行空间内尽量延伸。
function stubPoint(p: Pt, n: Pt, stub: number, rects: RectLike[]): Pt {
    for (let s = stub; s >= 1; s -= 1) {
        const q: Pt = { x: p.x + n.x * s, y: p.y + n.y * s };

        if (!insideAny(q, rects)) {
            return q;
        }
    }

    return { x: p.x, y: p.y };
}

// ── 锚点模型 ────────────────────────────────────────────────────────────────

export function oppositeSide(side: Side): Side {
    switch (side) {
        case 'L': return 'R';
        case 'R': return 'L';
        case 'T': return 'B';
        default:  return 'T';
    }
}

// 外向法线(单位向量)。
export function sideNormal(side: Side): Pt {
    switch (side) {
        case 'L': return { x: -1, y: 0 };
        case 'R': return { x: 1, y: 0 };
        case 'T': return { x: 0, y: -1 };
        default:  return { x: 0, y: 1 };
    }
}

export function sideLength(r: RectLike, side: Side) {
    return side === 'L' || side === 'R' ? r.h : r.w;
}

// 边上的参数点:t=0.5 即边中点(FR-1 的基准)。
export function sideAnchorPoint(r: RectLike, side: Side, t: number): Pt {
    const tt = clamp(t, 0, 1);

    switch (side) {
        case 'L': return { x: r.x, y: r.y + tt * r.h };
        case 'R': return { x: r.x + r.w, y: r.y + tt * r.h };
        case 'T': return { x: r.x + tt * r.w, y: r.y };
        default:  return { x: r.x + tt * r.w, y: r.y + r.h };
    }
}

// 按鼠标位置选边:返回"明显更近"的那条边;无法判断时返回 null。
//
// 判据 = 点到四条边【中点】的欧氏距离,最近者必须显著小于次近者(d1 * 1.25 < d2)。
// 之所以用中点而不是"到边的垂距":锚点本身定义在边中点上。
// 之所以要"显著":鼠标按在组件正中央时四个中点等距,此时任何选择都是噪音,
// 应返回 null 让调用方回退到 chooseSides 的自动选边。
export function nearestAnchorSide(r: RectLike, point: Pt): Side | null {
    const sides: Side[] = ['L', 'R', 'T', 'B'];

    const measured = sides
        .map(side => ({ side, d: dist(point, sideAnchorPoint(r, side, 0.5)) }))
        .sort((a, b) => a.d - b.d);

    const first = measured[0];
    const second = measured[1];

    if (!first || !second) {
        return null;
    }

    // 零尺寸/退化组件:四个中点重合,无从判断。
    if (second.d <= 1e-6) {
        return null;
    }

    return first.d * 1.25 < second.d ? first.side : null;
}

export const ALL_SIDES: ReadonlyArray<Side> = ['L', 'R', 'T', 'B'];

// 四条边的边中点(FR-1 的锚点全集),固定顺序 L/R/T/B。
export function anchorPointsOf(r: RectLike): Pt[] {
    return ALL_SIDES.map(side => sideAnchorPoint(r, side, 0.5));
}

// 从锚点集合里挑出离 point 最近的一个;超出 maxDistance 视为未命中(返回 null)。
// 与 nearestAnchorSide 的区别:后者只回答"哪条边",这里直接给出锚点坐标与距离,
// 供 hover 高亮与端点改接判定复用。
export function nearestAnchor(r: RectLike, point: Pt, maxDistance = Number.POSITIVE_INFINITY):
    { side: Side; point: Pt; distance: number } | null {

    let best: { side: Side; point: Pt; distance: number } | null = null;

    for (const side of ALL_SIDES) {
        const anchor = sideAnchorPoint(r, side, 0.5);
        const d = dist(point, anchor);

        if (!best || d < best.distance) {
            best = { distance: d, point: anchor, side };
        }
    }

    if (!best || best.distance > maxDistance) {
        return null;
    }

    return best;
}

// 槽位 → 沿边参数。基准恒为边中点,slot≠0 时沿边等间距错开,上限 30% 边长。
export function slotToT(r: RectLike, side: Side, slot: number): number {
    if (!slot || !Number.isFinite(slot)) {
        return 0.5;
    }

    const len = sideLength(r, side);

    if (len <= 0) {
        return 0.5;
    }

    const limit = len * SLOT_LIMIT_RATIO;
    const offset = clamp(slot * SLOT_STEP, -limit, limit);

    return clamp(0.5 + offset / len, 0, 1);
}

export interface SidePair {
    ss: Side;
    ts: Side;
}

// 选边:优先"面对面"的一对(法线互指),无面对面关系时按中心点主导轴。
// 返回的组合只可能是 R→L / L→R / B→T / T→B,因此 FR-2 恒成立。
export function chooseSides(src: RectLike, tgt: RectLike): SidePair {
    const candidates: Array<{ pair: SidePair; gap: number }> = [];

    const srcRight = src.x + src.w;
    const tgtRight = tgt.x + tgt.w;
    const srcBottom = src.y + src.h;
    const tgtBottom = tgt.y + tgt.h;

    const overlapX = Math.min(srcRight, tgtRight) - Math.max(src.x, tgt.x);
    const overlapY = Math.min(srcBottom, tgtBottom) - Math.max(src.y, tgt.y);

    if (overlapY > 0 && srcRight <= tgt.x) {
        candidates.push({ pair: { ss: 'R', ts: 'L' }, gap: tgt.x - srcRight });
    }

    if (overlapY > 0 && tgtRight <= src.x) {
        candidates.push({ pair: { ss: 'L', ts: 'R' }, gap: src.x - tgtRight });
    }

    if (overlapX > 0 && srcBottom <= tgt.y) {
        candidates.push({ pair: { ss: 'B', ts: 'T' }, gap: tgt.y - srcBottom });
    }

    if (overlapX > 0 && tgtBottom <= src.y) {
        candidates.push({ pair: { ss: 'T', ts: 'B' }, gap: src.y - tgtBottom });
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => a.gap - b.gap);

        return candidates[0].pair;
    }

    // 斜对角贴近或投影重叠:按主导轴择边,方向仍互相朝向。
    const dx = (tgt.x + tgt.w * 0.5) - (src.x + src.w * 0.5);
    const dy = (tgt.y + tgt.h * 0.5) - (src.y + src.h * 0.5);

    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? { ss: 'R', ts: 'L' } : { ss: 'L', ts: 'R' };
    }

    return dy >= 0 ? { ss: 'B', ts: 'T' } : { ss: 'T', ts: 'B' };
}

// ── 途经点清洗 ──────────────────────────────────────────────────────────────

// 把落在障碍内部的途经点推到最近的可通行位置。
// 否则 A* 无法抵达该点,整条线会退化为红色虚线——用户只是把拐点拖到了组件上而已。
export function sanitizeVias(vias: ReadonlyArray<Pt>, rects: RectLike[], limit = 2): Pt[] {
    const result: Pt[] = [];

    for (const via of vias.slice(0, limit)) {
        let p: Pt = { x: via.x, y: via.y };

        for (const r of rects) {
            if (p.x <= r.x || p.x >= r.x + r.w || p.y <= r.y || p.y >= r.y + r.h) {
                continue;
            }

            // 到四条边的最短推出距离。
            const dl = p.x - r.x;
            const dr = r.x + r.w - p.x;
            const dt = p.y - r.y;
            const db = r.y + r.h - p.y;

            const min = Math.min(dl, dr, dt, db);

            if (min === dl) {
                p = { x: r.x, y: p.y };
            } else if (min === dr) {
                p = { x: r.x + r.w, y: p.y };
            } else if (min === dt) {
                p = { x: p.x, y: r.y };
            } else {
                p = { x: p.x, y: r.y + r.h };
            }
        }

        result.push(p);
    }

    return result;
}

// ── 折线工具 ────────────────────────────────────────────────────────────────

// 去除重复点与共线中间点。
export function simplifyPoints(points: ReadonlyArray<Pt>): Pt[] {
    const compact: Pt[] = [];

    for (const p of points) {
        const last = compact[compact.length - 1];

        if (last && Math.abs(last.x - p.x) < SAME && Math.abs(last.y - p.y) < SAME) {
            continue;
        }

        compact.push({ x: p.x, y: p.y });
    }

    const result: Pt[] = [];

    for (let i = 0; i < compact.length; i++) {
        if (i > 0 && i < compact.length - 1) {
            const a = result[result.length - 1];
            const b = compact[i];
            const c = compact[i + 1];

            const sameX = Math.abs(a.x - b.x) < SAME && Math.abs(b.x - c.x) < SAME;
            const sameY = Math.abs(a.y - b.y) < SAME && Math.abs(b.y - c.y) < SAME;

            if (sameX || sameY) {
                continue;
            }
        }

        result.push(compact[i]);
    }

    return result;
}

export function polylineLength(points: ReadonlyArray<Pt>): number {
    let total = 0;

    for (let i = 1; i < points.length; i++) {
        total += dist(points[i - 1], points[i]);
    }

    return total;
}

// 折线的外接矩形(包含首尾端点与全部拐点)。
// 必须用它作为连接线的 Transform 尺寸 —— 旧实现只包住两个端点,引入绕行后局部坐标系会错位。
export function pointsBounds(points: ReadonlyArray<Pt>, minSize = 1): RectLike {
    if (points.length === 0) {
        return { x: 0, y: 0, w: minSize, h: minSize };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }

    // 端点完全对齐时会得到 0 尺寸 → 除零与不可见,这里钳制到 minSize。
    const w = Math.max(minSize, maxX - minX);
    const h = Math.max(minSize, maxY - minY);

    // 保持中心不变地扩展到 minSize。
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    return { h, w, x: cx - w * 0.5, y: cy - h * 0.5 };
}

// 第 index 条"同源同目标"连线使用的槽位序号:0, +1, -1, +2, -2 …
// 正负交替可避免单向累积一路顶到 30% 边长上限(FR-4)。
export function slotForIndex(index: number): number {
    if (!Number.isFinite(index) || index <= 0) {
        return 0;
    }

    const k = Math.ceil(index / 2);

    return index % 2 === 1 ? k : -k;
}

// 端点改接后重算槽位:在"同源同目标 + 同侧对"的既有连线里往后排一个位。
// 之所以要同侧对才算:不同侧对的连线根本不共用锚点,不该互相让位。
export function nextSlotFor(
    existing: ReadonlyArray<{ ss: Side; ts: Side; slot: number }>,
    ss: Side, ts: Side): number {

    const same = existing.filter(x => x.ss === ss && x.ts === ts);

    if (same.length === 0) {
        return 0;
    }

    // 已占用的槽位里挑一个没被用过的序号,顺序与 slotForIndex 一致(0, +1, -1, +2, -2 …)。
    const used = new Set(same.map(x => x.slot));

    for (let i = 0; i < 1000; i++) {
        const candidate = slotForIndex(i);

        if (!used.has(candidate)) {
            return candidate;
        }
    }

    return 0;
}

// ── 命中测试 ────────────────────────────────────────────────────────────────

// 点到线段的最短距离。
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = 0;

    if (lenSq > 1e-6) {
        t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    }

    const cx = ax + t * dx;
    const cy = ay + t * dy;

    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

// 点到折线的最短距离。斜线的空白角落距离远大于容差,因此不会被选中(FR-5 / CONN-004)。
export function distanceToPolyline(point: Pt, points: ReadonlyArray<Pt>): number {
    if (points.length === 0) {
        return Number.POSITIVE_INFINITY;
    }

    if (points.length === 1) {
        return Math.sqrt((point.x - points[0].x) ** 2 + (point.y - points[0].y) ** 2);
    }

    let best = Number.POSITIVE_INFINITY;

    for (let i = 1; i < points.length; i++) {
        best = Math.min(best, distanceToSegment(point.x, point.y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
    }

    return best;
}

// 沿折线走 d 距离处的点(用于文本标注定位)。
export function pointAtDistance(points: ReadonlyArray<Pt>, d: number): Pt {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }

    if (points.length === 1) {
        return points[0];
    }

    let remaining = Math.max(0, d);

    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const len = dist(a, b);

        if (remaining <= len || i === points.length - 1) {
            const ratio = len <= 0 ? 0 : clamp(remaining / len, 0, 1);

            return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
        }

        remaining -= len;
    }

    return points[points.length - 1];
}

// 生成 SVG path。cornerRadius > 0 时用二次贝塞尔把拐角磨圆(curved 类型与圆角折线共用)。
export function pathFromPoints(points: ReadonlyArray<Pt>, cornerRadius = 0): string {
    if (points.length === 0) {
        return '';
    }

    if (points.length === 1) {
        return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    }

    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;

    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const next = points[i + 1];

        const inLen = dist(prev, cur);
        const outLen = dist(cur, next);

        if (cornerRadius > 0 && inLen > 0.1 && outLen > 0.1) {
            const rr = Math.min(cornerRadius, inLen * 0.5, outLen * 0.5);
            const a = lerpTowards(cur, prev, rr);
            const b = lerpTowards(cur, next, rr);

            d += ` L ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(b.x)} ${fmt(b.y)}`;
        } else {
            d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`;
        }
    }

    const last = points[points.length - 1];

    return `${d} L ${fmt(last.x)} ${fmt(last.y)}`;
}

function lerpTowards(from: Pt, to: Pt, distance: number): Pt {
    const len = dist(from, to);

    if (len <= 0) {
        return { x: from.x, y: from.y };
    }

    const ratio = clamp(distance / len, 0, 1);

    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

// 可拖拽手柄:优先取折线的内部顶点;超过 max 个时,取"相邻段长之和"最大的若干个。
export function handlePoints(points: ReadonlyArray<Pt>, max = 2): Pt[] {
    const interior = points.slice(1, Math.max(1, points.length - 1));

    if (interior.length === 0) {
        return [];
    }

    if (interior.length <= max) {
        return interior.map(p => ({ x: p.x, y: p.y }));
    }

    const scored = interior.map((p, index) => {
        const prev = points[index];
        const next = points[index + 2];

        return { index, score: dist(prev, p) + dist(p, next), p };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
        .slice(0, max)
        .sort((a, b) => a.index - b.index)
        .map(s => ({ x: s.p.x, y: s.p.y }));
}

// 手柄种类。端点(改接)优先于途经点(改拐):
// 端点手柄就画在折线首尾,若让途经点优先,拖端点时会误判成拖第一个拐点。
export type HandleKind = 'endpoint' | 'waypoint';

export interface HandleCandidate {
    kind: HandleKind;

    // endpoint: 0 = 起点(source), 1 = 终点(target)。
    // waypoint: 在该连线的 waypoints 数组中的下标。
    index: number;

    point: Pt;
}

// 从候选手柄里挑出光标下的那个。
// 排序规则:距离近者优先;距离相同(端点与途经点重合)时端点优先。
export function chooseHandleAt(
    candidates: ReadonlyArray<HandleCandidate>, point: Pt, maxDistance: number): HandleCandidate | null {

    let best: HandleCandidate | null = null;
    let bestDistance = maxDistance;

    for (const candidate of candidates) {
        const d = dist(point, candidate.point);

        if (d > maxDistance) {
            continue;
        }

        const better = !best
            || d < bestDistance - 1e-6
            // 重合时端点胜出。
            || (Math.abs(d - bestDistance) <= 1e-6 && candidate.kind === 'endpoint' && best.kind === 'waypoint');

        if (better) {
            best = candidate;
            bestDistance = d;
        }
    }

    return best;
}

// ── 路由 ────────────────────────────────────────────────────────────────────

export function routeConnector(request: RouteRequest): RouteResult {
    const { p1, n1, p2, n2 } = request;
    const type = request.type ?? 'orthogonal';

    const rects = request.blockers.map(b => inflate(b.rect, b.clearance));
    const vias = sanitizeVias(request.vias ?? [], rects);

    // 完全重合或极近:直接返回两点,避免除零与无意义路由。
    if (dist(p1, p2) < 1) {
        return { points: [p1, p2], degraded: false, vias };
    }

    const stub = clamp(dist(p1, p2) / 3, STUB_MIN, STUB_MAX);

    const a1 = stubPoint(p1, n1, stub, rects);
    const a2 = stubPoint(p2, n2, stub, rects);

    // 直线:仅当两端正对(方向与两条法线一致)且无遮挡时保留;否则降级为正交(FR-2 优先于线型)。
    if (type === 'straight' && vias.length === 0) {
        const parallel = Math.abs(n1.x * n2.y - n1.y * n2.x) < 0.001;
        const opposing = n1.x * n2.x + n1.y * n2.y < 0;
        const aligned = Math.abs((p2.x - p1.x) * n1.y - (p2.y - p1.y) * n1.x) < 1.5;
        const forward = (p2.x - p1.x) * n1.x + (p2.y - p1.y) * n1.y > 0;

        if (parallel && opposing && aligned && forward && !hitsAny(p1.x, p1.y, p2.x, p2.y, rects)) {
            return { points: [p1, p2], degraded: false, vias };
        }
    }

    // 折腿:无途经点 → 一条腿;有途经点 → 依次穿过。
    const anchors: Pt[] = [a1, ...vias, a2];
    const legs: Pt[][] = [];

    let degraded = false;

    for (let i = 0; i < anchors.length - 1; i++) {
        const leg = routeLeg(anchors[i], anchors[i + 1], rects, vias);

        if (!leg) {
            degraded = true;
            break;
        }

        legs.push(leg);
    }

    let middle: Pt[];

    if (degraded) {
        middle = [a1, ...vias, a2];
    } else {
        middle = [a1];

        for (const leg of legs) {
            for (const p of leg) {
                middle.push(p);
            }
        }

        // 每条腿的起点是上一条腿的终点,去重交给 simplifyPoints。
    }

    const points = simplifyPoints([p1, ...middle, p2]);

    // 退化时再检查一次:朴素折线是否仍在穿体(仅作提示,渲染层用红色虚线表达)。
    const stillBlocked = segmentChainBlocked(points, rects);

    return { points, degraded: degraded || stillBlocked, vias };
}

function segmentChainBlocked(points: ReadonlyArray<Pt>, rects: RectLike[]): boolean {
    for (let i = 1; i < points.length; i++) {
        if (hitsAny(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, rects)) {
            return true;
        }
    }

    return false;
}

// 单腿正交 A*。
function routeLeg(start: Pt, goal: Pt, rects: RectLike[], vias: ReadonlyArray<Pt>): Pt[] | null {
    const requiredX = [start.x, goal.x];
    const requiredY = [start.y, goal.y];

    for (const v of vias) {
        requiredX.push(v.x);
        requiredY.push(v.y);
    }

    const optionalX: number[] = [];
    const optionalY: number[] = [];

    const minX = Math.min(...requiredX);
    const maxX = Math.max(...requiredX);
    const minY = Math.min(...requiredY);
    const maxY = Math.max(...requiredY);

    // 只保留连线附近 ±320px 的障碍边缘;远处障碍对本次路由没有价值。
    const margin = 320;

    for (const r of rects) {
        const cx = r.x;
        const cy = r.y;
        const rx = r.x + r.w;
        const ry = r.y + r.h;

        if (rx >= minX - margin && cx <= maxX + margin) {
            optionalX.push(cx, rx);
        }

        if (ry >= minY - margin && cy <= maxY + margin) {
            optionalY.push(cy, ry);
        }
    }

    const xs = buildAxis(requiredX, optionalX);
    const ys = buildAxis(requiredY, optionalY);

    const ix = indexOfCoord(xs, start.x);
    const iy = indexOfCoord(ys, start.y);
    const gx = indexOfCoord(xs, goal.x);
    const gy = indexOfCoord(ys, goal.y);

    if (ix < 0 || iy < 0 || gx < 0 || gy < 0) {
        return null;
    }

    const nx = xs.length;
    const ny = ys.length;

    // 状态 = (ix, iy, dir):dir 0=起始 1=水平移动 2=垂直移动。把方向纳入状态才能正确计转向代价。
    const stateCount = nx * ny * 3;
    const costs = new Float64Array(stateCount).fill(Infinity);
    const parents = new Int32Array(stateCount).fill(-1);
    const closed = new Uint8Array(stateCount);

    const stateId = (x: number, y: number, dir: number) => (y * nx + x) * 3 + dir;

    const heap = new MinHeap();
    const startId = stateId(ix, iy, 0);

    costs[startId] = 0;
    heap.push(startId, heuristic(ix, iy, gx, gy, xs, ys));

    let goalId = -1;

    while (heap.size > 0) {
        const current = heap.pop();
        const currentCost = costs[current];

        if (closed[current]) {
            continue;
        }

        closed[current] = 1;

        const dir = current % 3;
        const node = (current - dir) / 3;
        const cx = node % nx;
        const cy = (node - cx) / nx;

        if (cx === gx && cy === gy) {
            goalId = current;
            break;
        }

        const moves: Array<[number, number, number]> = [
            [cx - 1, cy, 1],
            [cx + 1, cy, 1],
            [cx, cy - 1, 2],
            [cx, cy + 1, 2],
        ];

        for (const [mx, my, mdir] of moves) {
            if (mx < 0 || mx >= nx || my < 0 || my >= ny) {
                continue;
            }

            const nextId = stateId(mx, my, mdir);

            if (closed[nextId]) {
                continue;
            }

            const ax = xs[cx];
            const ay = ys[cy];
            const bx = xs[mx];
            const by = ys[my];

            if (hitsAny(ax, ay, bx, by, rects)) {
                continue;
            }

            const step = Math.abs(bx - ax) + Math.abs(by - ay);
            const turn = dir !== 0 && dir !== mdir ? TURN_PENALTY : 0;
            const nextCost = currentCost + step + turn;

            if (nextCost < costs[nextId] - 0.001) {
                costs[nextId] = nextCost;
                parents[nextId] = current;

                heap.push(nextId, nextCost + heuristic(mx, my, gx, gy, xs, ys));
            }
        }
    }

    if (goalId < 0) {
        return null;
    }

    const reversed: Pt[] = [];

    for (let id = goalId; id >= 0; id = parents[id]) {
        const dir = id % 3;
        const node = (id - dir) / 3;
        const x = node % nx;
        const y = (node - x) / nx;

        reversed.push({ x: xs[x], y: ys[y] });

        if (parents[id] < 0) {
            break;
        }
    }

    return simplifyPoints(reversed.reverse());
}

function heuristic(ix: number, iy: number, gx: number, gy: number, xs: number[], ys: number[]) {
    return Math.abs(xs[gx] - xs[ix]) + Math.abs(ys[gy] - ys[iy]);
}

function buildAxis(required: number[], optional: number[]): number[] {
    const req = sortUnique(required);

    const opt = sortUnique(optional)
        .filter(v => !req.some(r => Math.abs(r - v) < SAME));

    const budget = Math.max(0, AXIS_LIMIT - req.length);

    let chosen = opt;

    if (opt.length > budget && budget > 0) {
        const step = opt.length / budget;
        const picked: number[] = [];

        for (let i = 0; i < budget; i++) {
            picked.push(opt[Math.floor(i * step)]);
        }

        chosen = picked;
    } else if (budget === 0) {
        chosen = [];
    }

    return sortUnique([...req, ...chosen]);
}

function sortUnique(values: ReadonlyArray<number>): number[] {
    const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    const result: number[] = [];

    for (const v of sorted) {
        const last = result[result.length - 1];

        if (last === undefined || Math.abs(v - last) >= SAME) {
            result.push(v);
        }
    }

    return result;
}

function indexOfCoord(values: ReadonlyArray<number>, value: number) {
    let best = -1;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < values.length; i++) {
        const diff = Math.abs(values[i] - value);

        if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
        }
    }

    return bestDiff <= 0.51 ? best : -1;
}

// 极简二叉堆(按 f 值)。
class MinHeap {
    private ids: number[] = [];
    private keys: number[] = [];

    public get size() {
        return this.ids.length;
    }

    public push(id: number, key: number) {
        this.ids.push(id);
        this.keys.push(key);

        let i = this.ids.length - 1;

        while (i > 0) {
            const parent = (i - 1) >> 1;

            if (this.keys[parent] <= this.keys[i]) {
                break;
            }

            this.swap(parent, i);
            i = parent;
        }
    }

    public pop(): number {
        const top = this.ids[0];
        const lastId = this.ids.pop()!;
        const lastKey = this.keys.pop()!;

        if (this.ids.length > 0) {
            this.ids[0] = lastId;
            this.keys[0] = lastKey;

            let i = 0;

            while (true) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;

                if (left < this.keys.length && this.keys[left] < this.keys[smallest]) {
                    smallest = left;
                }

                if (right < this.keys.length && this.keys[right] < this.keys[smallest]) {
                    smallest = right;
                }

                if (smallest === i) {
                    break;
                }

                this.swap(i, smallest);
                i = smallest;
            }
        }

        return top;
    }

    private swap(a: number, b: number) {
        const id = this.ids[a];
        const key = this.keys[a];

        this.ids[a] = this.ids[b];
        this.keys[a] = this.keys[b];
        this.ids[b] = id;
        this.keys[b] = key;
    }
}

// ── 对外默认参数 ────────────────────────────────────────────────────────────

// 障碍间隙:绕行时与组件保持的最小视觉距离。
export const CONNECTOR_CLEARANCE = 12;

// 源/目标自身的内缩量:允许贴边,禁止穿体。
export const CONNECTOR_SELF_INSET = 1;

// curved 类型的圆角半径上限。
export const CONNECTOR_CORNER_RADIUS = 40;
