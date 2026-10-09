/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { DefaultAppearance, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { CommonTheme } from './_theme';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: 0xfff9b7,
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: CommonTheme.CONTROL_TEXT_COLOR,
    [DefaultAppearance.STROKE_COLOR]: 0,
    [DefaultAppearance.STROKE_THICKNESS]: 1,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'left',
    [DefaultAppearance.TEXT]: 'Lorem ipsum dolor sit amet, alii rebum postea eam ex. Et mei laoreet officiis, summo sensibus id mei.',
};

export class Comment implements ShapePlugin {
    public identifier(): string {
        return 'Comment';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 180, y: 170 };
    }

    public render(ctx: RenderContext) {
        const corner = Math.min(14.5, ctx.rect.width, ctx.rect.height) - 0.5;

        this.createBorder(ctx, corner);
        this.createText(ctx);
    }

    private createBorder(ctx: RenderContext, c: number) {
        const outerBounds = ctx.renderer2.getOuterBounds(ctx.shape, ctx.rect);

        const l = outerBounds.left;
        const r = outerBounds.right;
        const t = outerBounds.top;
        const b = outerBounds.bottom;

        const path = `M${l + c},${t} L${r},${t} L${r},${b} L${l},${b} L${l},${t + c} L${l + c},${t} z M${l + c},${t} L${l + c},${t + c} L${l},${t + c}`;

        // 便签底色 / 边框色改由组件外观驱动(默认值仍是原来的黄色 + 黑边)。
        ctx.renderer2.path(ctx.shape, path, p => {
            p.setBackgroundColor(ctx.shape);
            p.setStrokeColor(ctx.shape);
            p.setStrokeStyle('round', 'round');
        });
    }

    private createText(ctx: RenderContext) {
        // 原先没有设置前景色,文字走的是 SVG 默认色 —— 面板上的"字体颜色"改了没反应。
        ctx.renderer2.textMultiline(ctx.shape, ctx.rect.deflate(10, 20), p => {
            p.setForegroundColor(ctx.shape);
        });
    }
}
