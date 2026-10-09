/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, Rect2, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { applyShadow, SHADOW_DEFAULT_APPEARANCE } from './_shadow';
import { CommonTheme } from './_theme';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: 0xFFFFFF,
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: 0,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.FLOWCHART_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: CommonTheme.CONTROL_BORDER_THICKNESS,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'center',
    [DefaultAppearance.TEXT]: 'Decision',
    ...SHADOW_DEFAULT_APPEARANCE,
};

export class Diamond implements ShapePlugin {
    public identifier(): string {
        return 'Diamond';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 120, y: 80 };
    }

    // 参与连接线吸附:参见批次五(连接线原语与连线模式)
    public connectable(): boolean {
        return true;
    }

    public configurables(_factory: ConfigurableFactory) {
        return [];
    }

    public render(ctx: RenderContext) {
        this.createShape(ctx);
        this.createText(ctx);
    }

    private createShape(ctx: RenderContext) {
        const r = ctx.rect;
        const cx = r.x + r.width * 0.5;
        const cy = r.y + r.height * 0.5;

        // 菱形:上/右/下/左四角连线描边色由 ctx.shape STROKE_COLOR 读取,厚度由 STROKE_THICKNESS
        const d = `M ${cx} ${r.y} L ${r.right} ${cy} L ${cx} ${r.bottom} L ${r.left} ${cy} Z`;

        ctx.renderer2.path(ctx.shape, d, p => {
            p.setStrokeColor(ctx.shape);
            p.setBackgroundColor(ctx.shape);
            applyShadow(p, ctx.shape);
        });
    }

    private createText(ctx: RenderContext) {
        const r = ctx.rect;

        // 文本放在内切矩形内,避免出菱形边界
        const inner = new Rect2(r.x + r.width * 0.18, r.y + r.height * 0.28, r.width * 0.64, r.height * 0.44);

        ctx.renderer2.text(ctx.shape, inner, p => {
            p.setForegroundColor(ctx.shape);
        }, true);
    }
}
