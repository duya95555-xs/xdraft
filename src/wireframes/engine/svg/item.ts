/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as svg from '@svgdotjs/svg.js';
import { Rect2 } from '@app/core';
import { ShapePlugin } from '@app/wireframes/interface';
import { DiagramItem } from '@app/wireframes/model';
import { EngineItem } from './../interface';
import { SvgObject } from './object';
import { SvgRenderer } from './renderer';
import { linkToSvg, SvgHelper } from './utils';

export class SvgItem extends SvgObject implements EngineItem {
    private readonly group: svg.G;
    private readonly selector: svg.Rect;
    private currentShape: DiagramItem | null = null;
    private currentRect: Rect2 | null = null;
    private isRendered = false;

    protected get root() {
        return this.group;
    }

    public get shape() {
        return this.currentShape;
    }

    constructor(
        public readonly layer: svg.Container,
        public readonly renderer: SvgRenderer,
        public readonly plugin: ShapePlugin,
    ) {
        super();
        this.selector = new svg.Rect().fill('#ffffff').opacity(0.001);

        this.group = new svg.G();
        this.group.add(this.selector);
        linkToSvg(this, this.group);
    }

    public detach() {
        this.remove();
    }

    // 精确命中测试入口(由 SvgLayer.hitTest 调用)。
    // 返回 undefined 表示该形状没有实现精确命中,调用方回退到外接矩形判定。
    public hitTestPoint(x: number, y: number): boolean | undefined {
        const plugin: any = this.plugin;

        if (!this.currentShape || typeof plugin.hitTest !== 'function') {
            return undefined;
        }

        return plugin.hitTest(this.currentShape, { x, y }) ?? undefined;
    }

    public plot(shape: DiagramItem) {
        if (this.currentShape === shape && this.isRendered) {
            this.addToLayer();
            return;
        }
    
        this.renderCore(shape);

        this.addToLayer();
        this.currentShape = shape;
    }

    private addToLayer() {
        if (!this.group.parent()) {
            this.layer.add(this.group);
        }
    }

    private renderCore(shape: DiagramItem) {
        const localRect = new Rect2(0, 0, shape.transform.size.x, shape.transform.size.y);

        if (this.currentRect && 
            this.currentRect.equals(localRect) && 
            this.currentShape?.appearance === shape.appearance) {
            this.arrangeContainer(shape);
            return;
        }

        const previousContainer = this.renderer.getContainer();
        try {
            this.renderer.setContainer(this.group, 1);

            this.plugin.render({ renderer2: this.renderer, rect: localRect, shape: shape });

            this.arrangeSelector(localRect);
            this.arrangeContainer(shape);
        } finally {
            this.currentRect = localRect;
            this.renderer.cleanupAll();
            this.renderer.setContainer(previousContainer);
            this.isRendered = true;
        }
    }

    private arrangeContainer(item: DiagramItem) {
        const to = item.transform;

        SvgHelper.transformBy(this.group, {
            x: to.position.x - 0.5 * to.size.x,
            y: to.position.y - 0.5 * to.size.y,
            w: to.size.x,
            h: to.size.y,
            rx: to.position.x,
            ry: to.position.y,
            rotation: to.rotation.degree,
        });

        this.group.opacity(item.opacity);
    }

    private arrangeSelector(localRect: Rect2) {
        const plugin: any = this.plugin;

        // ── 精确命中插件的特殊处理(第 7 条)─────────────────────────────────
        // 背景:
        //   selector 是一个铺满 AABB 的白底近透明矩形,作用是给"细小图形"提供一个
        //   更容易点中的垫片。但它 fill 非 none ⇒ SVG 默认的 pointer-events:visiblePainted
        //   会让整个外接矩形都可命中。
        //
        //   对连接线这种"斜过来/拐来拐去"的形状,AABB 里有大片空白,垫片会导致:
        //     1) 点空白角落也选中连线;
        //     2) 更严重 —— 连线一旦覆盖住组件,组件的点击会被这个垫片抢走。
        //
        //   插件若实现了 hitTest,就意味着"我能自己精确判断命中"(见 SvgLayer.hitTest),
        //   此时 AABB 垫片必须彻底退出指针命中,命中改由插件自己渲染的
        //   透明加粗路径(pointer-events: stroke)承担。
        //
        // 只对实现了 hitTest 的插件生效,其余插件的 selector 行为保持一字不变。
        if (shouldIgnoreSelectorPointer(plugin)) {
            this.selector.attr('pointer-events', 'none');
        } else {
            this.selector.attr('pointer-events', null);
        }

        let selectionRect = localRect;

        // Calculate a special selection rect, that is slightly bigger than the bounds to make selection easier.
        const diffW = Math.max(0, MIN_DIMENSIONS - selectionRect.width);
        const diffH = Math.max(0, MIN_DIMENSIONS - selectionRect.height);

        if (diffW > 0 || diffH > 0) {
            selectionRect = selectionRect.inflate(diffW * 0.5, diffH * 0.5);
        }

        SvgHelper.transformByRect(this.selector, selectionRect);
    }
}

// selector(AABB 垫片)是否应当完全退出指针命中。
//
// 判据:插件实现了 hitTest,即"自带精确命中测试"。
// 之所以不按插件名字硬编码:任何将来实现 hitTest 的形状(如自定义曲线)都应自动获得
// 同一待遇,否则会出现"它说自己能精确命中,但垫片还在抢事件"的矛盾状态。
export function shouldIgnoreSelectorPointer(plugin: any): boolean {
    return typeof plugin?.hitTest === 'function';
}

const MIN_DIMENSIONS = 10;