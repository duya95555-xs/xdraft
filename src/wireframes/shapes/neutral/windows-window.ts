/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { DefaultAppearance, Rect2, RenderContext, ShapePlugin } from '@app/wireframes/interface';
import { CommonTheme } from './_theme';

const OFFSET = { left: 1, top: 30, right: 1, bottom: 1 };

const BUTTON_SIZE = 10;
const BUTTON_MARGIN = 6;

const DEFAULT_APPEARANCE = {
    [DefaultAppearance.BACKGROUND_COLOR]: 0xFFFFFF,
    [DefaultAppearance.FOREGROUND_COLOR]: CommonTheme.CONTROL_TEXT_COLOR,
    [DefaultAppearance.FONT_SIZE]: 12,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.CONTROL_BORDER_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: 1,
    [DefaultAppearance.TEXT]: 'Window Title',
};

/* A window in the windows (win10) style: title text on the left and min/max/close buttons on the right. */
export class WindowsWindow implements ShapePlugin {
    public identifier(): string {
        return 'WindowsWindow';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        return { x: 800, y: 600 };
    }

    public previewSize() {
        return { x: 400, y: 300 };
    }

    public previewOffset() {
        return OFFSET;
    }

    public render(ctx: RenderContext) {
        this.createWindow(ctx);

        if (ctx.rect.width >= 100 && ctx.rect.height >= 50) {
            this.createTitle(ctx);
            this.createButtons(ctx);
            this.createSeparator(ctx);
        }

        this.createInner(ctx);
    }

    private createWindow(ctx: RenderContext) {
        const windowRect = new Rect2(-OFFSET.left, -OFFSET.top, ctx.rect.width + OFFSET.left + OFFSET.right, ctx.rect.height + OFFSET.top + OFFSET.bottom);

        ctx.renderer2.rectangle(ctx.shape, 0, windowRect, p => {
            p.setBackgroundColor(CommonTheme.CONTROL_BACKGROUND_COLOR);
            p.setStrokeColor(ctx.shape);
        });
    }

    private createInner(ctx: RenderContext) {
        ctx.renderer2.rectangle(0, 0, ctx.rect, p => {
            p.setBackgroundColor(ctx.shape);
        });
    }

    private createTitle(ctx: RenderContext) {
        const titleRect = new Rect2(
            -OFFSET.left + 10, -OFFSET.top + 2,
            ctx.rect.width - 90, OFFSET.top - 6);

        // config 里必须显式带 fontSize:早先只传了 text / alignment,
        // getFontSize 取不到值就回退成 16,面板上的"字体大小"改了没反应。
        ctx.renderer2.text({ fontSize: ctx.shape.fontSize, text: ctx.shape.text, alignment: 'left' }, titleRect, p => {
            p.setForegroundColor(ctx.shape);
        });
    }

    private createSeparator(ctx: RenderContext) {
        const separatorRect = new Rect2(-OFFSET.left, -1, ctx.rect.width + OFFSET.left + OFFSET.right, 1);

        ctx.renderer2.rectangle(0, 0, separatorRect, p => {
            p.setBackgroundColor(CommonTheme.CONTROL_BORDER_COLOR);
        });
    }

    private createButtons(ctx: RenderContext) {
        const fg = CommonTheme.CONTROL_TEXT_COLOR;

        const y = -OFFSET.top + (OFFSET.top - BUTTON_SIZE) / 2;
        // Windows 习惯:从左到右依次是 最小化、最大化、关闭。
        let x = ctx.rect.width + OFFSET.right - 8 - BUTTON_SIZE - 2 * (BUTTON_SIZE + BUTTON_MARGIN);

        // Minimize button (leftmost).
        ctx.renderer2.rectangle(0, 0, new Rect2(x, y + BUTTON_SIZE - 1, BUTTON_SIZE, 1), p => {
            p.setBackgroundColor(fg);
        });

        x += BUTTON_SIZE + BUTTON_MARGIN;

        // Maximize button.
        ctx.renderer2.rectangle(1, 0, new Rect2(x, y, BUTTON_SIZE, BUTTON_SIZE), p => {
            p.setStrokeColor(fg);
        });

        x += BUTTON_SIZE + BUTTON_MARGIN;

        // Close button (rightmost).
        const closePath =
            `M${x},${y} L${x + BUTTON_SIZE},${y + BUTTON_SIZE}` +
            ` M${x + BUTTON_SIZE},${y} L${x},${y + BUTTON_SIZE}`;

        ctx.renderer2.path(1, closePath, p => {
            p.setStrokeColor(fg);
        });
    }
}
