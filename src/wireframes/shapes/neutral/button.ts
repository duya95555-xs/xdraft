/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { CommonTheme } from './_theme';

const BUTTON_PADDING_HORIZONTAL = 'BUTTON_PADDING_HORIZONTAL';
const BUTTON_PADDING_VERTICAL = 'BUTTON_PADDING_VERTICAL';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: CommonTheme.CONTROL_BACKGROUND_COLOR,
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: CommonTheme.CONTROL_TEXT_COLOR,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.CONTROL_BORDER_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: CommonTheme.CONTROL_BORDER_THICKNESS,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'center',
    [DefaultAppearance.TEXT]: 'Button',
    [BUTTON_PADDING_HORIZONTAL]: 14,
    [BUTTON_PADDING_VERTICAL]: 4,
};

export class Button implements ShapePlugin {
    public identifier(): string {
        return 'Button';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 100, y: 30 };
    }

    // 注意:按钮**不**参与连线。可连线范围已收窄为流程图形状
    // (矩形 / 圆角矩形 / 菱形),参见 mydraft-资产面板与连线锚点-方案-v1.md。

    public configurables(factory: ConfigurableFactory) {
        return [
            factory.number(BUTTON_PADDING_HORIZONTAL, 'Padding Horizontal', 0, 40),
            factory.number(BUTTON_PADDING_VERTICAL, 'Padding Vertical', 0, 40),
        ];
    }

    public render(ctx: RenderContext) {
        this.createBorder(ctx);
        this.createText(ctx);
    }

    private createBorder(ctx: RenderContext) {
        ctx.renderer2.rectangle(ctx.shape, CommonTheme.CONTROL_BORDER_RADIUS, ctx.rect, p => {
            p.setBackgroundColor(ctx.shape);
            p.setStrokeColor(ctx.shape);
        });
    }

    private createText(ctx: RenderContext) {
        const paddingVertical = ctx.shape.getAppearance(BUTTON_PADDING_VERTICAL);
        const paddingHorizontal = ctx.shape.getAppearance(BUTTON_PADDING_HORIZONTAL);

        ctx.renderer2.text(ctx.shape, ctx.rect.deflate(paddingHorizontal, paddingVertical), p => {
            p.setForegroundColor(ctx.shape);
        });
    }
}
