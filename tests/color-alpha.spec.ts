/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// alpha 通道的回归测试(纯函数,jsdom 即可)。
// 运行:CI=1 npx vitest run tests/color-alpha.spec.ts
//
// 覆盖 PRD 的 I-01a~c 三条缺陷的"根部":
//   ① fromString('#rrggbbaa') 必须**保留** alpha(原来 substring(1, 7) 把它截掉了);
//   ② eq / ne 仍然只比 RGB(色板高亮依赖这个语义,不能被顺手改掉);
//   ③ eqWithAlpha / eqAlpha 按 8 位量化比较,避免往返浮点差一个 ULP 的假阴性。

import { describe, expect, it } from 'vitest';
import { Color } from '@app/core';

describe('Color.fromString 与 alpha', () => {
    it('① 8 位 hex 的 alpha 必须被解析出来(曾经的 substring(1, 7) 会截断它)', () => {
        const color = Color.fromString('#11223344');

        expect(color.r).toBeCloseTo(0x11 / 255, 6);
        expect(color.g).toBeCloseTo(0x22 / 255, 6);
        expect(color.b).toBeCloseTo(0x33 / 255, 6);
        expect(color.a).toBeCloseTo(0x44 / 255, 6);
    });

    it('① 不带 # 的 8 位 hex 同样解析出 alpha', () => {
        const color = Color.fromString('11223344');

        expect(color.a).toBeCloseTo(0x44 / 255, 6);
    });

    it('6 位 hex 的 alpha 视为 1', () => {
        expect(Color.fromString('#112233').a).toBe(1);
    });

    it('3 位简写仍然可用', () => {
        const color = Color.fromString('#f80');

        expect(color.r).toBeCloseTo(1, 6);
        expect(color.g).toBeCloseTo(0x88 / 255, 6);
        expect(color.b).toBe(0);
        expect(color.a).toBe(1);
    });

    it('rgba() 的 alpha 可用', () => {
        expect(Color.fromString('rgba(255, 0, 0, 0.5)').a).toBe(0.5);
    });

    it('非法格式仍然抛错(没有被吞掉)', () => {
        expect(() => Color.fromString('nope')).toThrow();
    });

    it('CSS 关键字 "transparent" 必须能解析(拖文本标签卡死的根因)', () => {
        const color = Color.fromString('transparent');

        expect(color.isTransparent).toBe(true);
        expect(color.a).toBe(0);
    });

    it('"transparent" 大小写 / 空格不敏感,且往返稳定为 #00000000', () => {
        expect(Color.fromString('TRANSPARENT').a).toBe(0);
        expect(Color.fromString(' Transparent ').a).toBe(0);
        expect(Color.fromString('transparent').toString()).toBe('#00000000');
    });

    it('放行 "transparent" 没有把白名单放宽:其它关键字仍然抛错', () => {
        expect(() => Color.fromString('none')).toThrow();
        expect(() => Color.fromString('transparentx')).toThrow();
        expect(() => Color.fromString('currentcolor')).toThrow();
    });
});

describe('Color.toString 往返', () => {
    it('a >= 1 输出 6 位', () => {
        expect(new Color(1, 0, 0).toString()).toBe('#ff0000');
        expect(new Color(1, 0, 0, 1).toString()).toBe('#ff0000');
    });

    it('a < 1 输出 8 位,且 alpha 被四舍五入到 2 位 hex', () => {
        expect(new Color(1, 0, 0, 0.5).toString()).toBe('#ff000080');
        expect(new Color(0, 0, 0, 0).toString()).toBe('#00000000');
    });

    it('toString → fromString 往返后 alpha 在 8 位量化下不变', () => {
        for (const a of [0, 0.2, 0.5, 0.75, 0.999, 1]) {
            const original = new Color(0.2, 0.4, 0.6, a);
            const restored = Color.fromString(original.toString());

            // 直接比浮点会因 round-trip 差一个 ULP,所以用 eqAlpha 的量化判据 ——
            // 这也正是 eqAlpha 存在的理由。
            expect(Color.eqAlpha(original, restored)).toBe(true);
            expect(restored.r).toBeCloseTo(original.r, 6);
            expect(restored.g).toBeCloseTo(original.g, 6);
            expect(restored.b).toBeCloseTo(original.b, 6);
        }
    });
});

describe('Color.eq / eqWithAlpha / eqAlpha', () => {
    const opaque = new Color(1, 0, 0, 1);
    const translucent = new Color(1, 0, 0, 0.5);

    it('② eq 仍然只比 RGB:同色不同 alpha 判为相等(色板高亮依赖此语义)', () => {
        expect(Color.eq(opaque, translucent)).toBe(true);
        expect(Color.ne(opaque, translucent)).toBe(false);
        expect(opaque.eq(translucent)).toBe(true);
    });

    it('eq 对真的不同色仍然判不等', () => {
        expect(Color.eq(opaque, new Color(0, 0, 1, 1))).toBe(false);
        expect(Color.ne(opaque, new Color(0, 0, 1, 1))).toBe(true);
    });

    it('③ eqWithAlpha 在两个通道都相同时才为真', () => {
        expect(Color.eqWithAlpha(opaque, translucent)).toBe(false);
        expect(Color.eqWithAlpha(opaque, new Color(1, 0, 0, 1))).toBe(true);
        expect(Color.eqWithAlpha(opaque, new Color(0, 0, 1, 1))).toBe(false);
    });

    it('③ eqAlpha 按 8 位量化比较,能吃掉 round-trip 的浮点误差', () => {
        const quantized = new Color(1, 0, 0, 0x44 / 255);

        expect(Color.eqAlpha(new Color(1, 0, 0, 0x44 / 255), quantized)).toBe(true);
        expect(Color.eqAlpha(quantized, Color.fromString('#ff000044'))).toBe(true);

        // 相邻两个量化档必须判不等,否则"改不动透明度"那种 bug 会被测试放过。
        expect(Color.eqAlpha(quantized, new Color(1, 0, 0, 0x45 / 255))).toBe(false);
    });
});

describe('Color 其它不变量', () => {
    it('构造时 clamp 到 [0, 1]', () => {
        const color = new Color(2, -1, 0.5, 3);

        expect(color.r).toBe(1);
        expect(color.g).toBe(0);
        expect(color.b).toBe(0.5);
        expect(color.a).toBe(1);
    });

    it('isTransparent 只看 alpha', () => {
        expect(Color.TRANSPARENT.isTransparent).toBe(true);
        expect(Color.fromString('#00000000').isTransparent).toBe(true);
        expect(Color.BLACK.isTransparent).toBe(false);
    });

    it('fromNumber 不带 alpha(保持既有语义)', () => {
        expect(Color.fromNumber(0xff0000).a).toBe(1);
    });
});
