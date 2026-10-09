/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Rect2 } from '@app/core';
import { RenderContext } from '@app/wireframes/interface';
import { IMAGE_CROP, parseCrop } from '@app/wireframes/model';
import { applyShadow } from './../neutral/_shadow';

// Renders a raster source with the relative crop stored in the IMAGE_CROP appearance applied.
// The full image is enlarged so that the cropped area fills the item rect, clipped to the
// item rect. Uses the group/clip pipeline of both engines (SVG clipPath, Pixi mask).
// Sources without a valid crop render exactly as before.
export function renderRasterWithCrop(ctx: RenderContext, source: string, aspectRatio: boolean) {
    const crop = parseCrop(ctx.shape.getAppearance(IMAGE_CROP));

    if (crop && (crop.x > 0 || crop.y > 0 || crop.w < 1 || crop.h < 1)) {
        const fullRect = new Rect2(
            ctx.rect.x - (crop.x / crop.w) * ctx.rect.w,
            ctx.rect.y - (crop.y / crop.h) * ctx.rect.h,
            ctx.rect.w / crop.w,
            ctx.rect.h / crop.h);

        // 裁切分支故意用【两层 group】:
        //   外层 —— 不裁切,只挂阴影;内层 —— 把放大后的整图裁到 item 矩形。
        // 阴影必须挂在外层:clip 与 filter 同时落在一个元素上时,浏览器先算 filter 再按 clip 裁,
        // 阴影会被切在 item 矩形内部 ⇒ 等于看不见。
        ctx.renderer2.group(outer => {
            outer.group(inner => {
                inner.raster(source, fullRect, false);
            }, inner => {
                // The group/clip callbacks receive the RAW engine renderer whose
                // rectangle signature is (strokeWidth, radius, bounds) — NOT the
                // outer (shape, radius, bounds) overload. Passing the shape object
                // as strokeWidth produced NaN bounds and a zero-sized clip that
                // hid the image completely (white shape).
                inner.rectangle(0, 0, ctx.rect);
            });
        }, undefined, p => applyShadow(p, ctx.shape));
    } else {
        ctx.renderer2.raster(source, ctx.rect, aspectRatio, p => applyShadow(p, ctx.shape));
    }
}
