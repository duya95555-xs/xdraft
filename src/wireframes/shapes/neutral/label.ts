/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/
import { ConstraintFactory, DefaultAppearance, RenderContext, ShapePlugin, ShapeSource } from '@app/wireframes/interface';
import { renderTextBackground, TEXT_BOX_DEFAULT_APPEARANCE } from './_text-box';
import { CommonTheme } from './_theme';

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.FONT_SIZE]: CommonTheme.CONTROL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: CommonTheme.CONTROL_TEXT_COLOR,
    [DefaultAppearance.TEXT]: 'Label',
    ...TEXT_BOX_DEFAULT_APPEARANCE,
};

export class Label implements ShapePlugin {
    public identifier(): string {
        return 'Label';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 46, y: 30 };
    }

    // 纯文本标签不参与连接线吸附 —— 它没有边框/填充,画不出"线贴在边上"的视觉,
    // 作为锚点会让连线端点悬在文字外面。可连线范围严格收窄为流程图形状
    // (Rectangle / RoundedRectangle / Diamond)。
    // (图片同理,见 neutral/image.ts;圆形与按钮已于上一轮移除。)

    public create(source: ShapeSource) {
        if (source.type == 'Text') {
            const { text } = source;

            return {
                renderer: this.identifier(),
                appearance: {
                    [DefaultAppearance.TEXT]: text,
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
        }, true);
    }
}
