/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { applyShadow, SHADOW_BLUR, SHADOW_COLOR, SHADOW_DEFAULT_APPEARANCE, SHADOW_ENABLED, SHADOW_OFFSET_X, SHADOW_OFFSET_Y } from './_shadow';
import { CommonTheme } from './_theme';

const BORDER_RADIUS = 'BORDER_RADIUS';
const PADDING_HORIZONTAL = 'PADDING_HORIZONTAL2';
const PADDING_VERTICAL = 'PADDING_VERTICAL2';

const DEFAULT_APPEARANCE = {
    [BORDER_RADIUS]: 0,
    [DefaultAppearance.BACKGROUND_COLOR]: 0xFFFFFF,
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: 0,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.FLOWCHART_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: CommonTheme.CONTROL_BORDER_THICKNESS,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'center',
    [DefaultAppearance.TEXT]: 'Rectangle',
    [PADDING_HORIZONTAL]: 10,
    [PADDING_VERTICAL]: 10,
    ...SHADOW_DEFAULT_APPEARANCE,
};

export class Rectangle implements ShapePlugin {
    public identifier(): string {
        return 'Rectangle';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 100, y: 60 };
    }

    // 参与连接线吸附:参见批次五(连接线原语与连线模式)
    public connectable(): boolean {
        return true;
    }

    public configurables(factory: ConfigurableFactory) {
        return [
            factory.slider(BORDER_RADIUS, 'Border Radius', 0, 40),
            factory.number(PADDING_HORIZONTAL, 'Padding Horizontal', 0, 40),
            factory.number(PADDING_VERTICAL, 'Padding Vertical', 0, 40),
            factory.toggle(SHADOW_ENABLED, 'Shadow Enabled'),
            factory.color(SHADOW_COLOR, 'Shadow Color'),
            factory.slider(SHADOW_BLUR, 'Shadow Blur', 0, 30),
            factory.slider(SHADOW_OFFSET_X, 'Shadow Offset X', -30, 30),
            factory.slider(SHADOW_OFFSET_Y, 'Shadow Offset Y', -30, 30),
        ];
    }

    public render(ctx: RenderContext) {
        this.createShape(ctx);
        this.createText(ctx);
    }

    private createShape(ctx: RenderContext) {
        const borderRadius = ctx.shape.getAppearance(BORDER_RADIUS);

        ctx.renderer2.rectangle(ctx.shape, borderRadius, ctx.rect, p => {
            p.setStrokeColor(ctx.shape);
            p.setBackgroundColor(ctx.shape);
            applyShadow(p, ctx.shape);
        });
    }

    private createText(ctx: RenderContext) {
        const paddingVertical = ctx.shape.getAppearance(PADDING_VERTICAL);
        const paddingHorizontal = ctx.shape.getAppearance(PADDING_HORIZONTAL);

        ctx.renderer2.text(ctx.shape, ctx.rect.deflate(paddingHorizontal, paddingVertical), p => {
            p.setForegroundColor(ctx.shape);
        }, true);
    }
}
