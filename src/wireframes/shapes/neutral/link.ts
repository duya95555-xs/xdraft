/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConstraintFactory, DefaultAppearance, RenderContext, ShapePlugin, ShapeSource } from '@app/wireframes/interface';
import { renderTextBackground, TEXT_BOX_DEFAULT_APPEARANCE } from './_text-box';
import { CommonTheme } from './_theme';

// 底色 / 描边走 `_text-box` 的"全透明"默认值。
// 原先是从表单控件抄来的 CONTROL_BACKGROUND_COLOR + 边框色,但 render() 里
// 从来没画过底框 —— 面板上能改、画面没反应。现在改为透明底板 + 真正渲染。
const DEFAULT_APPEARANCE = {
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: 0x08519c,
    [DefaultAppearance.TEXT_ALIGNMENT]: 'center',
    [DefaultAppearance.TEXT]: 'Link',
    ...TEXT_BOX_DEFAULT_APPEARANCE,
};

export class Link implements ShapePlugin {
    public identifier(): string {
        return 'Link';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 40, y: 30 };
    }

    // 纯文本链接不参与连接线吸附:与 Label 同理 —— 没有边框/填充,
    // 画不出"线贴在边上"的视觉,作为锚点会让连线端点悬在文字外面。
    // 可连线范围严格收窄为流程图形状(Rectangle / RoundedRectangle / Diamond)。

    public create(source: ShapeSource) {
        if (source.type == 'Url') {
            const { url } = source;

            return {
                renderer: this.identifier(),
                appearance: {
                    [DefaultAppearance.TEXT]: url,
                },
            };
        }

        return null;
    }

    public constraint(factory: ConstraintFactory) {
        return factory.textSize(5, 5);
    }

    public render(ctx: RenderContext) {
        renderTextBackground(ctx);

        ctx.renderer2.text(ctx.shape, ctx.rect, p => {
            p.setForegroundColor(ctx.shape);
            p.setTextDecoration('underline');
        });
    }
}
