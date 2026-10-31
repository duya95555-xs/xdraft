/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 渲染层(SVG 引擎)单元测试。
// 运行:CI=1 npx vitest run tests/svg-engine-dom.spec.ts
//
// 目的:验证第五轮第 6 条在**渲染层**的行为 ——
//   分割(先删原图、再加 4 个 tile)之后,layer 的 DOM 里必须只剩 4 个 SvgItem,
//   原图的 SvgItem 必须彻底摘除,否则点原图区域会命中"幽灵"对象。

import { describe, expect, it } from 'vitest';
import * as svg from '@svgdotjs/svg.js';
import type { ShapePlugin } from '@app/wireframes/interface';
import { SvgEngine } from '@app/wireframes/engine/svg/engine';
import { getElement, getSource } from '@app/wireframes/engine/svg/utils';

// 最小可用插件:render 什么都不画,只用于驱动 SvgItem 的 selector 与 DOM 挂载。
const fakePlugin = {
    identifier: () => 'Fake',
    defaultAppearance: () => ({}),
    defaultSize: () => ({ x: 10, y: 10 }),
    render: () => { /* no-op */ },
} as unknown as ShapePlugin;

// plot() 需要的 shape 替身。
//
// ⚠️ transform 必须给出**完整**结构:SvgItem.arrangeContainer() 会读
// `to.rotation.degree`,缺 rotation 会直接抛 TypeError(曾经就是漏了这个字段)。
// 真实链路上 DiagramItem 的 transform 一定是 Transform 实例、rotation 恒有值,
// 这里只是把替身补齐成等价形状。
function shape(id: string, x: number, y: number, w: number, h: number) {
    return {
        id,
        transform: {
            position: { x, y },
            size: { x: w, y: h },
            rotation: { degree: 0 },
        },
    } as any;
}

function mount(): { doc: svg.Svg; layer: any; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const doc = svg.SVG().addTo(host);
    const engine = new SvgEngine(doc);
    const layer = engine.layer('mainLayer');

    return { doc, layer, host };
}

// children() 返回的是 svg.js 的 List:它的 find() 是 **CSS 选择器**语义,
// 不是数组的 find —— 传函数会抛 "... is not a valid selector"。
// 这里统一 toArray() 转成普通数组,下面的断言才按数组语义工作。
function childArray(layer: any): svg.Element[] {
    const container = getElement(layer) as svg.Container;
    const children: any = container.children();

    return typeof children.toArray === 'function' ? children.toArray() : Array.from(children);
}

// 统计 layer 的 <g> 下挂了多少个 SvgItem(靠 linkToSvg 写在 node 上的 source 判定)。
function countItems(layer: any): number {
    return childArray(layer).filter(el => {
        const source = getSource(el.node as any) as any;

        return source && typeof source.plot === 'function';
    }).length;
}

describe('SvgItem DOM 生命周期', () => {
    it('item() 创建后不在 DOM 中,plot() 之后才挂上去', () => {
        const { layer } = mount();

        const item = layer.item(fakePlugin);

        expect(countItems(layer)).toBe(0);

        item.plot(shape('a', 0, 0, 10, 10));

        expect(countItems(layer)).toBe(1);
    });

    it('remove() 必须把节点从 DOM 里彻底摘掉', () => {
        const { layer } = mount();

        const item = layer.item(fakePlugin);
        item.plot(shape('a', 0, 0, 10, 10));

        expect(countItems(layer)).toBe(1);

        item.remove();

        expect(countItems(layer)).toBe(0);
    });

    it('先给 1 个 item,再换成 4 个新 item:旧 item 必须消失', () => {
        const { layer } = mount();

        // ── 复刻 ItemsLayer 的两步效果 ──────────────────────────────────
        // 第一步:原图(1 个)。
        const original = layer.item(fakePlugin);
        original.plot(shape('img', 200, 200, 400, 300));

        expect(countItems(layer)).toBe(1);

        // 第二步:分割 —— 删除原图,新增 4 个 tile。
        original.remove();

        for (let i = 0; i < 4; i++) {
            const tile = layer.item(fakePlugin);
            tile.plot(shape(`tile${i}`, 100 + i * 50, 100, 50, 50));
        }

        // ── 核心断言:DOM 里恰好 4 个,原图不存在 ────────────────────────
        expect(countItems(layer)).toBe(4);
    });

    it('被 remove() 的节点不再能被 buildHitEvent 沿 DOM 找回(幽灵对象回归)', () => {
        const { layer, doc } = mount();

        const original = layer.item(fakePlugin);
        original.plot(shape('img', 200, 200, 400, 300));

        // 找到原图对应的 DOM 节点与其 source(等价于 buildHitEvent 的起点)。
        const children = childArray(layer);
        const originalNode = children.find(el => {
            const source = getSource(el.node as any) as any;

            return source === original;
        });

        expect(originalNode).toBeDefined();

        original.remove();

        // remove() 之后,该节点必须脱离文档树 —— document.contains 为 false。
        expect(document.contains((originalNode as any).node)).toBe(false);

        // 而且它不再是 mainLayer 的子节点。
        // ⚠️ 必须重新取一次快照:上面的 children 是 remove() 之前取的,
        // 拿旧数组判 includes 恒为 true,等于没测。
        expect(childArray(layer).includes(originalNode as any)).toBe(false);

        // doc 本身仍然在文档里(对照组,确认不是整个 canvas 被摘掉)。
        expect(document.contains((doc.node as any))).toBe(true);
    });

    it('detach() 与 remove() 对 DOM 的效果一致(都是真删)', () => {
        const { layer } = mount();

        const a = layer.item(fakePlugin);
        a.plot(shape('a', 0, 0, 10, 10));

        const b = layer.item(fakePlugin);
        b.plot(shape('b', 0, 0, 10, 10));

        expect(countItems(layer)).toBe(2);

        a.detach();
        b.remove();

        expect(countItems(layer)).toBe(0);
    });
});
