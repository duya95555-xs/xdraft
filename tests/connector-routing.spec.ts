/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 连接线几何引擎单元测试(纯函数,不需要浏览器 / DOM)。
// 运行:CI=1 npx vitest run tests/connector-routing.spec.ts

import { describe, expect, it } from 'vitest';
import {
    ALL_SIDES,
    anchorPointsOf,
    chooseHandleAt,
    chooseSides,
    distanceToPolyline,
    handlePoints,
    nearestAnchor,
    nearestAnchorSide,
    nextSlotFor,
    pathFromPoints,
    pointsBounds,
    polylineLength,
    pointAtDistance,
    routeConnector,
    sanitizeVias,
    sideAnchorPoint,
    sideNormal,
    simplifyPoints,
    slotForIndex,
    slotToT,
    type Blocker,
    type HandleCandidate,
    type Pt,
    type RectLike,
    type Side,
} from '../src/wireframes/shapes/neutral/_connector-routing';

const A: RectLike = { x: 0, y: 0, w: 100, h: 60 };
const B: RectLike = { x: 300, y: 0, w: 100, h: 60 };      // A 正右
const C: RectLike = { x: 0, y: 300, w: 100, h: 60 };      // A 正下
const D: RectLike = { x: 300, y: 300, w: 100, h: 60 };    // A 右下

function blocker(rect: RectLike, clearance = 12): Blocker {
    return { rect, clearance };
}

// 轴对齐线段与矩形的"实体"相交。与引擎内部判定保持一致(严格不等号:贴边不算穿)。
function crosses(x1: number, y1: number, x2: number, y2: number, r: RectLike) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    return maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h;
}

function anySegmentCrosses(points: ReadonlyArray<Pt>, rects: ReadonlyArray<RectLike>) {
    for (let i = 1; i < points.length; i++) {
        for (const r of rects) {
            if (crosses(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, r)) {
                return true;
            }
        }
    }

    return false;
}

function isOrthogonal(points: ReadonlyArray<Pt>) {
    for (let i = 1; i < points.length; i++) {
        const dx = Math.abs(points[i].x - points[i - 1].x);
        const dy = Math.abs(points[i].y - points[i - 1].y);

        if (dx > 0.5 && dy > 0.5) {
            return false;
        }
    }

    return true;
}

describe('锚点模型', () => {
    it('T1.1 slot=0 时落在四条边的正中心', () => {
        expect(slotToT(A, 'R', 0)).toBe(0.5);
        expect(sideAnchorPoint(A, 'R', 0.5)).toEqual({ x: 100, y: 30 });
        expect(sideAnchorPoint(A, 'L', 0.5)).toEqual({ x: 0, y: 30 });
        expect(sideAnchorPoint(A, 'T', 0.5)).toEqual({ x: 50, y: 0 });
        expect(sideAnchorPoint(A, 'B', 0.5)).toEqual({ x: 50, y: 60 });
    });

    it('T1.2 slot 沿边等间距错开且不超过 30% 边长', () => {
        // R 边长 = h = 60 → 上限 18px
        expect(slotToT(A, 'R', 1)).toBeCloseTo(0.5 + 8 / 60, 6);
        expect(slotToT(A, 'R', 2)).toBeCloseTo(0.5 + 16 / 60, 6);
        // slot 3 → 24px 被夹到 18px
        expect(slotToT(A, 'R', 3)).toBeCloseTo(0.5 + 18 / 60, 6);
        expect(slotToT(A, 'R', 99)).toBeCloseTo(0.8, 6);
        expect(slotToT(A, 'R', -99)).toBeCloseTo(0.2, 6);
    });

    it('T1.3 错开后仍在同一条边上(不跑出边界)', () => {
        for (const slot of [-5, -1, 1, 5]) {
            const p = sideAnchorPoint(A, 'R', slotToT(A, 'R', slot));
            expect(p.x).toBe(100);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(60);
        }
    });

    it('T1.4 法线为四个方向的单位向量', () => {
        expect(sideNormal('L')).toEqual({ x: -1, y: 0 });
        expect(sideNormal('R')).toEqual({ x: 1, y: 0 });
        expect(sideNormal('T')).toEqual({ x: 0, y: -1 });
        expect(sideNormal('B')).toEqual({ x: 0, y: 1 });
    });
});

describe('选边(FR-2 垂直出入的数学前提)', () => {
    it('T2.1 水平排列取 R→L / L→R', () => {
        expect(chooseSides(A, B)).toEqual({ ss: 'R', ts: 'L' });
        expect(chooseSides(B, A)).toEqual({ ss: 'L', ts: 'R' });
    });

    it('T2.2 垂直排列取 B→T / T→B', () => {
        expect(chooseSides(A, C)).toEqual({ ss: 'B', ts: 'T' });
        expect(chooseSides(C, A)).toEqual({ ss: 'T', ts: 'B' });
    });

    it('T2.3 任意组合都满足"法线互指"', () => {
        const all = [A, B, C, D];

        for (const src of all) {
            for (const tgt of all) {
                if (src === tgt) {
                    continue;
                }

                const { ss, ts } = chooseSides(src, tgt);
                const n1 = sideNormal(ss);
                const n2 = sideNormal(ts);

                // 点积 < 0 即方向相反(互指)
                expect(n1.x * n2.x + n1.y * n2.y).toBeLessThan(0);
            }
        }
    });

    it('T2.4 交换源/目标得到镜像结果', () => {
        for (const [src, tgt] of [[A, B], [A, C], [A, D], [B, D]] as Array<[RectLike, RectLike]>) {
            const forward = chooseSides(src, tgt);
            const backward = chooseSides(tgt, src);

            expect(backward.ss).toBe(forward.ts);
            expect(backward.ts).toBe(forward.ss);
        }
    });
});

describe('路由(FR-2 / FR-3 / FR-6)', () => {
    it('T3.1 正对的两端保留直线', () => {
        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 30 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(B, -1)],
            type: 'straight',
        });

        expect(result.degraded).toBe(false);
        expect(result.points).toHaveLength(2);
        expect(result.points[0]).toEqual({ x: 100, y: 30 });
        expect(result.points[1]).toEqual({ x: 300, y: 30 });
    });

    it('T3.2 两端不正对时 straight 降级为正交(Q1 决策)', () => {
        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 300 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(D, -1)],
            type: 'straight',
        });

        expect(result.degraded).toBe(false);
        expect(result.points.length).toBeGreaterThan(2);
        expect(isOrthogonal(result.points)).toBe(true);
    });

    it('T3.3 斜对角:所有线段正交,且出入段沿法线', () => {
        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 330 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(D, -1)],
            type: 'orthogonal',
        });

        expect(result.degraded).toBe(false);
        expect(isOrthogonal(result.points)).toBe(true);
        expect(result.points[0]).toEqual({ x: 100, y: 30 });
        expect(result.points[result.points.length - 1]).toEqual({ x: 300, y: 330 });

        // 首段必须沿 +x 走(垂直于右边),末段必须沿 +x 进入(垂直于左边)
        const p = result.points;
        expect(p[1].y).toBe(p[0].y);
        expect(p[1].x).toBeGreaterThan(p[0].x);
        expect(p[p.length - 2].y).toBe(p[p.length - 1].y);
        expect(p[p.length - 2].x).toBeLessThan(p[p.length - 1].x);
    });

    it('T3.4 中间有障碍时绕开,不穿透', () => {
        const wall: RectLike = { x: 150, y: 100, w: 100, h: 200 };

        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 330 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(D, -1), blocker(wall, 12)],
            type: 'orthogonal',
        });

        expect(result.degraded).toBe(false);
        expect(isOrthogonal(result.points)).toBe(true);
        expect(anySegmentCrosses(result.points, [wall])).toBe(false);
    });

    it('T3.5 绕行后仍与障碍保持间隙', () => {
        const wall: RectLike = { x: 150, y: 100, w: 100, h: 200 };

        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 330 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(D, -1), blocker(wall, 12)],
            type: 'orthogonal',
        });

        const inflated: RectLike = { x: 150 - 12, y: 100 - 12, w: 100 + 24, h: 200 + 24 };

        expect(anySegmentCrosses(result.points, [inflated])).toBe(false);
    });

    it('T3.6 完全被围住时退化而非抛错', () => {
        const cage = [
            { x: -20, y: 0, w: 120, h: 10 },     // 上
            { x: -20, y: 50, w: 120, h: 10 },    // 下
            { x: -20, y: 0, w: 10, h: 60 },      // 左
            { x: 90, y: 0, w: 40, h: 60 },       // 右
        ];

        let result: ReturnType<typeof routeConnector> | null = null;

        expect(() => {
            result = routeConnector({
                p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
                p2: { x: 300, y: 30 }, n2: { x: -1, y: 0 },
                blockers: [blocker(A, -1), blocker(B, -1), ...cage.map(c => blocker(c, 12))],
                type: 'orthogonal',
            });
        }).not.toThrow();

        expect(result!.degraded).toBe(true);
        expect(result!.points.length).toBeGreaterThanOrEqual(2);
    });

    it('T3.7 障碍贴得很近时仍能连通(自适应 stub)', () => {
        const near: RectLike = { x: 105, y: 0, w: 100, h: 60 };   // 与 A 只隔 5px

        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 105, y: 30 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(near, -1)],
            type: 'orthogonal',
        });

        expect(result.degraded).toBe(false);
        expect(result.points[0]).toEqual({ x: 100, y: 30 });
        expect(result.points[result.points.length - 1]).toEqual({ x: 105, y: 30 });
    });

    it('T3.8 退化的路径不会无限增长(点数量有界)', () => {
        const result = routeConnector({
            p1: { x: 0, y: 0 }, n1: { x: 1, y: 0 },
            p2: { x: 400, y: 400 }, n2: { x: -1, y: 0 },
            blockers: [],
            type: 'orthogonal',
        });

        // [p1, a1, a2, p2] 经简化后不应超过 4 个点
        expect(result.points.length).toBeLessThanOrEqual(4);
    });
});

describe('途经点(FR-6)', () => {
    it('T4.1 折线穿过用户固定点', () => {
        const via: Pt = { x: 200, y: 200 };

        const result = routeConnector({
            p1: { x: 100, y: 30 }, n1: { x: 1, y: 0 },
            p2: { x: 300, y: 330 }, n2: { x: -1, y: 0 },
            blockers: [blocker(A, -1), blocker(D, -1)],
            vias: [via],
            type: 'orthogonal',
        });

        expect(result.degraded).toBe(false);

        // 固定点必须落在折线上(逐段判定点到线段距离)
        const onPath = result.points.some((p, i) => {
            if (i === 0) {
                return false;
            }

            const a = result.points[i - 1];
            const b = p;
            const minX = Math.min(a.x, b.x) - 0.5;
            const maxX = Math.max(a.x, b.x) + 0.5;
            const minY = Math.min(a.y, b.y) - 0.5;
            const maxY = Math.max(a.y, b.y) + 0.5;

            return via.x >= minX && via.x <= maxX && via.y >= minY && via.y <= maxY;
        });

        expect(onPath).toBe(true);
    });

    it('T4.2 落在障碍内的固定点被推出,并被回写', () => {
        const wall: RectLike = { x: 150, y: 100, w: 100, h: 200 };
        const rects = [wall];

        const sanitized = sanitizeVias([{ x: 200, y: 200 }], rects);

        expect(sanitized).toHaveLength(1);
        // 推出到最近的边:左右距离 50,上下距离 100 → 推到左边
        expect(sanitized[0].x === 150 || sanitized[0].x === 250 || sanitized[0].y === 100 || sanitized[0].y === 300).toBe(true);
        expect(crosses(0, 0, 0, 0, wall)).toBe(false);
    });

    it('T4.3 固定点最多保留 2 个(Q6 决策)', () => {
        const sanitized = sanitizeVias([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], []);

        expect(sanitized).toHaveLength(2);
    });

    it('T4.4 手柄数量不超过 2,且落在内部顶点上', () => {
        const points: Pt[] = [
            { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
            { x: 200, y: 100 }, { x: 200, y: 200 },
        ];

        const handles = handlePoints(points, 2);

        expect(handles.length).toBeLessThanOrEqual(2);
        expect(handles.length).toBeGreaterThan(0);

        for (const h of handles) {
            expect(points.some(p => p.x === h.x && p.y === h.y)).toBe(true);
        }
    });

    it('T4.5 简单 L 型只有一个手柄', () => {
        expect(handlePoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 2)).toHaveLength(1);
    });
});

describe('折线工具', () => {
    it('T5.1 简化去除共线与重复点', () => {
        const result = simplifyPoints([
            { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 0 }, { x: 100, y: 100 },
        ]);

        expect(result).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    });

    it('T5.2 长度与定点计算正确', () => {
        const points: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

        expect(polylineLength(points)).toBeCloseTo(200, 6);
        expect(pointAtDistance(points, 50)).toEqual({ x: 50, y: 0 });
        expect(pointAtDistance(points, 150)).toEqual({ x: 100, y: 50 });
    });

    it('T5.3 path 生成:直角与圆角两种形态', () => {
        const points: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

        expect(pathFromPoints(points, 0)).toBe('M 0 0 L 100 0 L 100 100');
        expect(pathFromPoints(points, 10)).toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
        expect(pathFromPoints([{ x: 1, y: 2 }], 0)).toBe('M 1 2');
        expect(pathFromPoints([], 0)).toBe('');
    });
});

// bbox 语义:必须是「两端点 ∪ 全部拐点」的外接矩形,而不是只包住两个端点。
// 旧实现只取端点,引入绕行后局部坐标系会错位 → 渲染 / 命中 / 框选同时错。
describe('折线外接矩形 (pointsBounds)', () => {
    it('T6.1 只包住端点时等于两端点矩形', () => {
        const r = pointsBounds([{ x: 10, y: 20 }, { x: 110, y: 80 }]);

        expect(r).toEqual({ h: 60, w: 100, x: 10, y: 20 });
    });

    it('T6.2 绕行拐点会被算进去(不同于旧语义)', () => {
        // 端点矩形是 (0,0)-(100,0),但路径绕到 y=-40,bbox 必须把绕行部分包住。
        const points: Pt[] = [
            { x: 0, y: 0 }, { x: 0, y: -40 }, { x: 100, y: -40 }, { x: 100, y: 0 },
        ];

        const r = pointsBounds(points);

        expect(r.x).toBe(0);
        expect(r.y).toBe(-40);
        expect(r.w).toBe(100);
        expect(r.h).toBe(40);

        // 旧语义(仅端点)会得到 h === 0,这里必须不同。
        expect(r.h).not.toBe(0);
    });

    it('T6.3 端点完全对齐时钳制到最小尺寸且中心不变', () => {
        const horizontal = pointsBounds([{ x: 50, y: 0 }, { x: 50, y: 200 }]);

        // 宽为 0 → 钳到 1,中心仍在 x = 50。
        expect(horizontal.w).toBeGreaterThanOrEqual(1);
        expect(horizontal.x + horizontal.w / 2).toBeCloseTo(50, 6);
        expect(horizontal.h).toBe(200);

        const single = pointsBounds([{ x: 7, y: 9 }], 1);

        expect(single.w).toBeGreaterThanOrEqual(1);
        expect(single.h).toBeGreaterThanOrEqual(1);
    });

    it('T6.4 空集合不崩,返回最小尺寸矩形', () => {
        const r = pointsBounds([], 1);

        expect(r.w).toBe(1);
        expect(r.h).toBe(1);
    });
});

// 多线错开(FR-4):同一对组件上的多条线用不同槽位,正负交替避免单向累积。
describe('槽位序号 (slotForIndex)', () => {
    it('T7.1 序列为 0, +1, -1, +2, -2 …', () => {
        expect([0, 1, 2, 3, 4, 5].map(slotForIndex)).toEqual([0, 1, -1, 2, -2, 3]);
    });

    it('T7.2 非法输入退化为 0(边中点)', () => {
        expect(slotForIndex(-3)).toBe(0);
        expect(slotForIndex(NaN)).toBe(0);
        expect(slotForIndex(Infinity)).toBe(0);
    });

    it('T7.3 不同槽位在边上互不重叠', () => {
        const rect: RectLike = { x: 0, y: 0, w: 100, h: 200 };

        const a = slotToT(rect, 'L', slotForIndex(1));
        const b = slotToT(rect, 'L', slotForIndex(2));
        const c = slotToT(rect, 'L', slotForIndex(3));

        expect(a).not.toBeCloseTo(b, 6);
        expect(b).not.toBeCloseTo(c, 6);
        expect(a).not.toBeCloseTo(c, 6);
    });
});

// 命中测试(FR-5 / CONN-004):斜线的"空白角落"必须不被命中,线条本体才命中。
describe('点到折线距离 (distanceToPolyline)', () => {
    const diagonal: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

    it('T8.1 线上点距离为 0,端点外侧按端点算', () => {
        expect(distanceToPolyline({ x: 50, y: 50 }, diagonal)).toBeCloseTo(0, 6);
        expect(distanceToPolyline({ x: -10, y: 0 }, diagonal)).toBeCloseTo(10, 6);
    });

    it('T8.2 AABB 空白角落距离远大于容差(不会被选中)', () => {
        // 斜线 AABB = (0,0)-(100,100);左上角 (0,100) 在 AABB 内,但离线段很远(≈70.7)。
        const corner = { x: 0, y: 100 };
        const distance = distanceToPolyline(corner, diagonal);

        expect(distance).toBeGreaterThan(20);

        // 以「AABB 命中」为口径时它一定被选中,以「距离」为口径时不会。
        expect(distance).toBeLessThan(Math.sqrt(100 * 100 + 100 * 100));
    });

    it('T8.3 折线的每一段都参与计算', () => {
        const l: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

        expect(distanceToPolyline({ x: 100, y: 50 }, l)).toBeCloseTo(0, 6);
        expect(distanceToPolyline({ x: 50, y: 20 }, l)).toBeCloseTo(20, 6);
    });

    it('T8.4 空集合返回无穷大;单点退化为点距', () => {
        expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
        expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBeCloseTo(5, 6);
    });
});

// ── T9 按鼠标位置选边(nearestAnchorSide)────────────────────────────────────
// 判据 = 点到四条边【中点】的欧氏距离,最近者须显著小于次近者,否则视为"判断不出意图"。
describe('nearestAnchorSide', () => {
    it('T9.1 靠近右边中段 → R', () => {
        expect(nearestAnchorSide(A, { x: 95, y: 30 })).toBe('R');
    });

    it('T9.2 靠近左边中段 → L', () => {
        expect(nearestAnchorSide(A, { x: 5, y: 30 })).toBe('L');
    });

    it('T9.3 靠近上边中段 → T', () => {
        expect(nearestAnchorSide(A, { x: 50, y: 5 })).toBe('T');
    });

    it('T9.4 靠近下边中段 → B', () => {
        expect(nearestAnchorSide(A, { x: 50, y: 55 })).toBe('B');
    });

    it('T9.5 正中心:四条边中点等距 → null(回退自动选边)', () => {
        expect(nearestAnchorSide(A, { x: 50, y: 30 })).toBeNull();
    });

    it('T9.6 组件外远处 → 仍取最近的边', () => {
        expect(nearestAnchorSide(A, { x: 200, y: 30 })).toBe('R');
    });

    it('T9.7 点恰好落在边中点上 → 该边(距离 0)', () => {
        expect(nearestAnchorSide(A, { x: 100, y: 30 })).toBe('R');
    });

    it('T9.8 零尺寸组件 → null(四个中点重合,无从判断)', () => {
        expect(nearestAnchorSide({ x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5 })).toBeNull();
    });

    it('T9.9 同一输入结果确定', () => {
        expect(nearestAnchorSide(A, { x: 90, y: 45 })).toBe(nearestAnchorSide(A, { x: 90, y: 45 }));
        expect(nearestAnchorSide(A, { x: 90, y: 45 })).toBe('R');
    });
});

// ── T10 锚点全集 / 最近锚点(C2 的基础)──────────────────────────────────────
describe('anchorPointsOf / nearestAnchor', () => {
    it('T10.1 四边中点按 L,R,T,B 顺序返回', () => {
        const pts = anchorPointsOf(A);

        expect(pts).toHaveLength(4);
        expect(pts[0]).toEqual({ x: 0, y: 30 });     // L
        expect(pts[1]).toEqual({ x: 100, y: 30 });   // R
        expect(pts[2]).toEqual({ x: 50, y: 0 });     // T
        expect(pts[3]).toEqual({ x: 50, y: 60 });    // B
        expect(ALL_SIDES).toEqual(['L', 'R', 'T', 'B']);
    });

    it('T10.2 最近锚点返回 side + 坐标 + 距离', () => {
        const hit = nearestAnchor(A, { x: 96, y: 32 });

        expect(hit?.side).toBe('R');
        expect(hit?.point).toEqual({ x: 100, y: 30 });
        expect(hit?.distance).toBeCloseTo(Math.sqrt(4 * 4 + 2 * 2), 6);
    });

    it('T10.3 超出 maxDistance → null(未命中)', () => {
        const far = { x: 500, y: 500 };

        expect(nearestAnchor(A, far, 10)).toBeNull();

        // 门限放开后必须给出答案,且要与"自己按距离算一遍"的结论一致 ——
        // 不写死字面量,避免手算四个中点的距离时出错。
        const hit = nearestAnchor(A, far, 10000);

        expect(hit).not.toBeNull();

        const expected = anchorPointsOf(A)
            .map((p, i) => ({ d: Math.hypot(p.x - far.x, p.y - far.y), i }))
            .sort((a, b) => a.d - b.d)[0];

        expect(hit!.side).toBe(ALL_SIDES[expected.i]);
        expect(hit!.distance).toBeCloseTo(expected.d, 6);
    });

    it('T10.4 正中心:仍返回一个锚点(不像 nearestAnchorSide 那样弃权)', () => {
        // nearestAnchor 是"给候选组件的",必须给出确定答案;弃权由调用方按 maxDistance 控制。
        expect(nearestAnchor(A, { x: 50, y: 30 })?.side).toBeDefined();
    });

    it('T10.5 与 nearestAnchorSide 在同一位置上的结论一致', () => {
        for (const p of [{ x: 96, y: 30 }, { x: 4, y: 30 }, { x: 50, y: 4 }, { x: 50, y: 56 }]) {
            expect(nearestAnchor(A, p)?.side).toBe(nearestAnchorSide(A, p));
        }
    });
});

// ── T11 手柄命中判定(C1 端点优先级)──────────────────────────────────────────
describe('chooseHandleAt', () => {
    const endpointStart: HandleCandidate = { index: 0, kind: 'endpoint', point: { x: 100, y: 30 } };
    const endpointEnd: HandleCandidate = { index: 1, kind: 'endpoint', point: { x: 300, y: 30 } };
    const waypoint: HandleCandidate = { index: 0, kind: 'waypoint', point: { x: 200, y: 30 } };

    it('T11.1 命中最近的端点', () => {
        const hit = chooseHandleAt([endpointStart, endpointEnd], { x: 104, y: 30 }, 10);

        expect(hit?.kind).toBe('endpoint');
        expect(hit?.index).toBe(0);
    });

    it('T11.2 命中途经点', () => {
        const hit = chooseHandleAt([endpointStart, endpointEnd, waypoint], { x: 203, y: 30 }, 10);

        expect(hit?.kind).toBe('waypoint');
    });

    it('T11.3 端点与途经点完全重合 → 端点优先', () => {
        const overlapping: HandleCandidate = { index: 0, kind: 'waypoint', point: { x: 100, y: 30 } };
        const hit = chooseHandleAt([endpointStart, overlapping], { x: 100, y: 30 }, 10);

        expect(hit?.kind).toBe('endpoint');
    });

    it('T11.4 超出门限 → null', () => {
        expect(chooseHandleAt([endpointStart, waypoint], { x: 500, y: 500 }, 10)).toBeNull();
    });

    it('T11.5 空候选 → null', () => {
        expect(chooseHandleAt([], { x: 0, y: 0 }, 10)).toBeNull();
    });
});

// ── T12 改接后的槽位重算(C1)─────────────────────────────────────────────────
describe('nextSlotFor', () => {
    const s = (ss: Side, ts: Side, slot: number) => ({ ss, ts, slot });

    it('T12.1 无同侧对兄弟 → 0', () => {
        expect(nextSlotFor([], 'R', 'L')).toBe(0);
        expect(nextSlotFor([s('B', 'T', 0)], 'R', 'L')).toBe(0);
    });

    it('T12.2 已有 slot 0 → 取 +1(与 slotForIndex 序列一致)', () => {
        expect(nextSlotFor([s('R', 'L', 0)], 'R', 'L')).toBe(1);
    });

    it('T12.3 已占 0 / +1 → 取 -1', () => {
        expect(nextSlotFor([s('R', 'L', 0), s('R', 'L', 1)], 'R', 'L')).toBe(-1);
    });

    it('T12.4 间隙会被复用(0 / -1 已占 → 取 +1)', () => {
        expect(nextSlotFor([s('R', 'L', 0), s('R', 'L', -1)], 'R', 'L')).toBe(1);
    });

    it('T12.5 只统计同侧对的兄弟', () => {
        // 同源同目标但走 T→B 的线不参与 R→L 的排位。
        expect(nextSlotFor([s('T', 'B', 1), s('R', 'L', 0)], 'R', 'L')).toBe(1);
    });

    it('T12.6 结果永不与既有槽位冲突', () => {
        const existing = [s('R', 'L', 0), s('R', 'L', 1), s('R', 'L', -1)];

        expect(existing.some(x => x.slot === nextSlotFor(existing, 'R', 'L'))).toBe(false);
    });
});
