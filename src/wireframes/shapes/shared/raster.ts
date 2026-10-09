/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { DefaultAppearance, RenderContext, ShapePlugin, ShapeSource } from '@app/wireframes/interface';
import { SHADOW_DEFAULT_APPEARANCE } from './../neutral/_shadow';
import { renderRasterWithCrop } from './cropped-raster';

// 位图尺寸上限。
// 用户要求"粘贴图片保持原像素",所以这里不再把图缩到 300px —— 那样会丢掉清晰度。
// 但完全不设上限也不行:一张 8000×8000 的位图会让 asar 序列化体积与渲染开销失控,
// 因此只对"大图"做降采样,阈值取 2600:2K(2560) 与 1080p 截图都能原样保留。
//
// ⚠️ 必须与 src/core/react/Clipboard.tsx 的 MAX_PASTED_IMAGE_SIZE 保持一致。
// 那一条是"粘贴/拖入文件"入口,这一条是"插件创建"入口;两者取值不同的话,
// 同一张图经不同入口进画布会得到不同尺寸。
const MAX_IMAGE_SIZE = 2600;

const SOURCE = 'SOURCE';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.TEXT_DISABLED]: true,
    ...SHADOW_DEFAULT_APPEARANCE,
};

export class Raster implements ShapePlugin {
    public identifier(): string {
        return 'Raster';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 80, y: 30 };
    }

    public create(source: ShapeSource) {
        if (source.type == 'Image') {
            let { width: w, height: h, source: data } = source.image;

            // 保持原始像素:仅在超过 MAX_IMAGE_SIZE 时才等比缩小。
            if (w > MAX_IMAGE_SIZE || h > MAX_IMAGE_SIZE) {
                const ratio = w / h;

                if (ratio > 1) {
                    w = MAX_IMAGE_SIZE;
                    h = Math.round(MAX_IMAGE_SIZE / ratio);
                } else {
                    h = MAX_IMAGE_SIZE;
                    w = Math.round(MAX_IMAGE_SIZE * ratio);
                }
            }

            return { 
                renderer: this.identifier(),
                size: {
                    x: w,
                    y: h,
                }, 
                appearance: { 
                    [SOURCE]: data,
                },
            };
        }

        return null;
    }

    public showInGallery() {
        return false;
    }

    public render(ctx: RenderContext) {
        renderRasterWithCrop(ctx, ctx.shape.getAppearance(SOURCE), true);
    }
}
