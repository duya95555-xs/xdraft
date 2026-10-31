/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { applyShadow, SHADOW_DEFAULT_APPEARANCE } from './_shadow';
import { CommonTheme } from './_theme';

const ACCENT = 'ACCENT_COLOR';

// 圆角半径的外观键。导出给 RadiusAdorner(画布上的圆角拖拽手柄)与
// CustomProperties(本地化标签)共用, 避免魔法字符串分叉。
export const FLOW_BORDER_RADIUS = 'FLOW_BORDER_RADIUS';

const DEFAULT_RADIUS = 16;

const DEFAULT_APPEARANCE = {
    [FLOW_BORDER_RADIUS]: DEFAULT_RADIUS,
    [DefaultAppearance.BACKGROUND_COLOR]: 0xFFFFFF,
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: 0,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.FLOWCHART_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: CommonTheme.CONTROL_BORDER_THICKNESS,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'center',
    [DefaultAppearance.TEXT]: 'Process',
    [ACCENT]: CommonTheme.CONTROL_BORDER_COLOR,
    ...SHADOW_DEFAULT_APPEARANCE,
};

export class RoundedRectangle implements ShapePlugin {
    public identifier(): string {
        return 'RoundedRectangle';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 120, y: 70 };
    }

    // 参与连接线吸附:参见批次五(连接线原语与连线模式)
    public connectable(): boolean {
        return true;
    }

    public configurables(factory: ConfigurableFactory) {
        return [
            factory.slider(FLOW_BORDER_RADIUS, 'Border Radius', 0, 100),
            factory.color(ACCENT, 'Accent Color'),
        ];
    }

    public render(ctx: RenderContext) {
        this.createShape(ctx);
        this.createText(ctx);
    }

    private createShape(ctx: RenderContext) {
        const radius = ctx.shape.getAppearance(FLOW_BORDER_RADIUS) ?? DEFAULT_RADIUS;
        const accent = ctx.shape.getAppearance(ACCENT);

        ctx.renderer2.rectangle(ctx.shape, radius, ctx.rect, p => {
            p.setStrokeColor(accent);
            p.setBackgroundColor(ctx.shape);
            applyShadow(p, ctx.shape);
        });
    }

    private createText(ctx: RenderContext) {
        ctx.renderer2.text(ctx.shape, ctx.rect.inflate(-12, -10), p => {
            p.setForegroundColor(ctx.shape);
        }, true);
    }
}
