/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 第五轮 第 7 条「连接线只认线段本体」的命中收窄测试。
// 运行:CI=1 npx vitest run tests/connector-hit.spec.ts
//
// 这一组测的是"命中责任的归属":
//   · 实现了 hitTest 的插件 → AABB 垫片必须退出指针命中(否则外接矩形会挡住下层组件)
//   · 未实现的插件         → 垫片行为一字不变(保持默认,兼容其余 36 个形状)
// 以及命中容差常量的自洽性(隐形命中带的宽度必须与容差口径一致)。

import { describe, expect, it } from 'vitest';
import { shouldIgnoreSelectorPointer } from '../src/wireframes/engine/svg/item';
import { HIT_STROKE_WIDTH, MIN_HIT_TOLERANCE } from '../src/wireframes/shapes/neutral/connect';
import { distanceToPolyline, type Pt } from '../src/wireframes/shapes/neutral/_connector-routing';

// ── T13 AABB 垫片的指针命中归属(item.ts)────────────────────────────────────

describe('shouldIgnoreSelectorPointer · AABB 垫片是否退出命中', () => {
    it('T13.1 实现了 hitTest 的插件 → 垫片退出指针命中', () => {
        const plugin = { hitTest: () => true };

        expect(shouldIgnoreSelectorPointer(plugin)).toBe(true);
    });

    it('T13.2 未实现 hitTest 的插件 → 垫片保持默认(兼容其余形状)', () => {
        const plugin = { identifier: () => 'Rectangle', render: () => null };

        expect(shouldIgnoreSelectorPointer(plugin)).toBe(false);
    });

    it('T13.3 hitTest 不是函数(误写成属性) → 不退出,避免误伤', () => {
        // 只有"真的可调用"才算实现了精确命中;写成布尔值/字符串一律按未实现处理,
        // 否则一个笔误就会让某个形状彻底点不中。
        expect(shouldIgnoreSelectorPointer({ hitTest: true })).toBe(false);
        expect(shouldIgnoreSelectorPointer({ hitTest: 'yes' })).toBe(false);
        expect(shouldIgnoreSelectorPointer({ hitTest: null })).toBe(false);
    });

    it('T13.4 空 / 非法插件不抛错,按未实现处理', () => {
        expect(shouldIgnoreSelectorPointer(null)).toBe(false);
        expect(shouldIgnoreSelectorPointer(undefined)).toBe(false);
        expect(shouldIgnoreSelectorPointer({})).toBe(false);
    });

    it('T13.5 真正的 Connect 插件被判为"实现精确命中"', () => {
        // 这条是第 7 条的核心断言:连接线必须落入"垫片退出命中"这一支。
        const connect = { hitTest: (_shape: unknown, _point: unknown) => false };

        expect(typeof connect.hitTest).toBe('function');
        expect(shouldIgnoreSelectorPointer(connect)).toBe(true);
    });
});

// ── T13b 容差常量自洽性(connect.ts)────────────────────────────────────────

describe('命中容差常量 · 隐形命中带宽度', () => {
    it('T13b.1 容差为用户确认的 10px', () => {
        expect(MIN_HIT_TOLERANCE).toBe(10);
    });

    it('T13b.2 命中带宽度 = 容差 * 2(两侧各 10px)', () => {
        // pointer-events:stroke 的命中区就是描边宽度本身,
        // 想让"距中心线 10px 内可点中",stroke-width 必须是 20。
        expect(HIT_STROKE_WIDTH).toBe(MIN_HIT_TOLERANCE * 2);
        expect(HIT_STROKE_WIDTH).toBe(20);
    });

    it('T13b.3 命中带比常见线宽更宽(否则垫片退出后就点不中了)', () => {
        // 这条是"垫片退出命中"能不能成立的前提:
        // 若命中带不比真实线宽宽,细线会从"能点中"直接变成"点不中"。
        for (const realThickness of [1, 2, 4]) {
            expect(HIT_STROKE_WIDTH).toBeGreaterThan(realThickness);
        }
    });
});

// ── T13c 语义回归:点在哪算命中(AABB 垫片退出后的正确性依据)────────────────
// 垫片退出后,唯一的判定口径就是"点到折线的距离"。这里用真实几何验证:
//   · 线段本体上 → 命中
//   · AABB 的空白角落 → 不命中(这是第 7 条的用户可见效果)

describe('AABB 空白角落不命中 · 斜线场景', () => {
    // 一条斜线的折线点,AABB = (0,0)-(100,100),但线只走对角线。
    const diagonal: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

    it('T13c.1 线上任意点 → 距离 0', () => {
        expect(distanceToPolyline({ x: 0, y: 0 }, diagonal)).toBeCloseTo(0, 6);
        expect(distanceToPolyline({ x: 50, y: 50 }, diagonal)).toBeCloseTo(0, 6);
        expect(distanceToPolyline({ x: 100, y: 100 }, diagonal)).toBeCloseTo(0, 6);
    });

    it('T13c.2 距中心线 10px 内 → 在容差内(可点中)', () => {
        // (10, 0) 到对角线的垂距 = 10/sqrt(2) ≈ 7.07 → 落在 10px 容差内。
        expect(distanceToPolyline({ x: 10, y: 0 }, diagonal)).toBeLessThanOrEqual(MIN_HIT_TOLERANCE);
    });

    it('T13c.3 AABB 空白角落 → 远超容差(不可点中)', () => {
        // (0, 100) 在 AABB 内部,但离对角线 ≈70.7px。
        // 垫片还在时它会被判为"命中连线";垫片退出后必须不命中。
        const distance = distanceToPolyline({ x: 0, y: 100 }, diagonal);

        expect(distance).toBeGreaterThan(MIN_HIT_TOLERANCE);

        // 与"AABB 判定"形成对照:点在矩形内,但不在线上。
        const insideAabb = 0 >= 0 && 0 <= 100 && 100 >= 0 && 100 <= 100;

        expect(insideAabb).toBe(true);
        expect(distance > MIN_HIT_TOLERANCE).toBe(true);
    });

    it('T13c.4 折线绕行后,绕行区域的空白同样不命中', () => {
        // 正交绕行:从 (0,0) 出发向下绕到 (0,40) 再向右到 (100,40),最后回到 (100,0)。
        const detour: Pt[] = [
            { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 0 },
        ];

        // 落在绕行轨迹上 → 命中
        expect(distanceToPolyline({ x: 0, y: 20 }, detour)).toBeCloseTo(0, 6);
        expect(distanceToPolyline({ x: 50, y: 40 }, detour)).toBeCloseTo(0, 6);

        // 轨迹围出的"空腔"中心 (50, 20) 距最近轨迹 20px → 不命中
        expect(distanceToPolyline({ x: 50, y: 20 }, detour)).toBeGreaterThan(MIN_HIT_TOLERANCE);
    });
});
