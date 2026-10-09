/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { applyShadow, SHADOW_DEFAULT_APPEARANCE } from './_shadow';
import { CommonTheme } from './_theme';
import { renderRasterWithCrop } from './../shared/cropped-raster';

const IMAGE_URL = 'URL';
const IMAGE_ASPECT_RATIO = 'ASPECT_RATIO';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: 0xFFFFFF,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.CONTROL_BORDER_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: CommonTheme.CONTROL_BORDER_THICKNESS,
    [DefaultAppearance.TEXT_DISABLED]: true,
    [IMAGE_ASPECT_RATIO]: true,
    [IMAGE_URL]: '',
    ...SHADOW_DEFAULT_APPEARANCE,
};

export class Image implements ShapePlugin {
    public identifier(): string {
        return 'Image';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 100, y: 100 };
    }

    // 图片不参与连接线吸附 —— 图片是"内容",不是流程节点。
    // (粘贴进画布的位图走的是 Raster 插件,那边同样没有 connectable()。)
    // 见 mydraft-资产面板与连线锚点-方案-v1.md 第 3 章:可连线范围收窄为流程图形状。

    public configurables(factory: ConfigurableFactory) {
        return [
            factory.text(IMAGE_URL, 'Url'),
            factory.toggle(IMAGE_ASPECT_RATIO, 'Preserve aspect ratio'),
        ];
    }

    public render(ctx: RenderContext) {
        const url = ctx.shape.getAppearance(IMAGE_URL);

        if (url) {
            // 阴影由 renderRasterWithCrop 内部挂到 raster 元素上(裁切分支挂在裁切组的外层)。
            renderRasterWithCrop(ctx, url, ctx.shape.getAppearance(IMAGE_ASPECT_RATIO));
        } else {
            this.createBorder(ctx);
            this.createCross(ctx);
        }
    }

    private createCross(ctx: RenderContext) {
        const l = ctx.rect.left + 0.5;
        const r = ctx.rect.right - 0.5;
        const t = ctx.rect.top + 0.5;
        const b = ctx.rect.bottom - 0.5;

        const path = `M${l},${t} L${r},${b} M${l},${b} L${r},${t}`;

        // 交叉线刻意**不**加阴影:占位图的外框(createBorder)已经承担阴影,
        // 两处都挂会让同一个 drop-shadow 叠加两次。
        ctx.renderer2.path(ctx.shape, path, p => {
            p.setStrokeColor(ctx.shape);
            p.setStrokeStyle('butt', 'butt');
        });
    }

    private createBorder(ctx: RenderContext) {
        ctx.renderer2.rectangle(ctx.shape, 0, ctx.rect, p => {
            p.setBackgroundColor(ctx.shape);
            p.setStrokeColor(ctx.shape);
            applyShadow(p, ctx.shape);
        });
    }
}
