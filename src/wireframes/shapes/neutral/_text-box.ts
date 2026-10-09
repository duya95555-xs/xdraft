/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { DefaultAppearance, RenderContext } from '@app/wireframes/interface';

// 「纯文本组件」的底色与边框支持。
//
// 为什么需要单独一套：纯文本组件(Label / Heading / Paragraph / Link)的文字走
// SVG `foreignObject` + 内部 `<div>`，而 `fill` / `stroke` 这类 SVG 表现属性
// **对 HTML 内容不起作用** —— 想在文字块上体现"填充色 / 描边色 / 描边粗细"，
// 必须额外画一个矩形当底板。
//
// 默认值刻意取「全透明 + 0 粗细」，保证**视觉零变化**：这三项对纯文本组件
// 只提供能力、不改变既有观感。用户把颜色改成具体值后底板才显现。
// (若想恢复成"永远没有底板"的旧行为，删掉 render() 里的 renderTextBackground 调用即可。)
export const TEXT_BOX_DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: 'transparent',
    [DefaultAppearance.STROKE_COLOR]: 'transparent',
    [DefaultAppearance.STROKE_THICKNESS]: 0,
};

// 在文字之下画底板。必须在 render() 里**先于**文字调用，否则会盖住文字。
export function renderTextBackground(ctx: RenderContext) {
    ctx.renderer2.rectangle(ctx.shape, 0, ctx.rect, p => {
        p.setBackgroundColor(ctx.shape);
        p.setStrokeColor(ctx.shape);
    });
}
