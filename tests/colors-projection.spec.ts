/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// getColors 投影的回归测试(纯函数,jsdom 即可)。
// 运行:CI=1 npx vitest run tests/colors-projection.spec.ts
//
// 覆盖 2026-09-21 实机复现的"拖入 Label/标题/段落/链接 即整应用白屏":
//   纯文本组件底板默认值 'transparent' 不是 Color.fromString 认识的格式,
//   getColors 在 useSelector 的 selector 里抛异常 → React 整棵树卸载。
//   修复: addColor 对无法解析的颜色值静默跳过。
//
// 同文件顺带锁住 M6 修复: getFontFamily 对 Shape 参数必须读 fontFamily 字段
// (原来错读成 fontSize,导致字体家族设置在画布上静默失效)。

import { describe, expect, it } from 'vitest';
import { DefaultAppearance } from '@app/wireframes/interface';
import { getFontFamily } from '@app/wireframes/engine/shared';
import { Diagram, DiagramItem, EditorState, getColors, Transform, UndoableState } from '@app/wireframes/model';

function buildStateWithShape(appearance: { [key: string]: any }) {
    const shape = DiagramItem.createShape({
        renderer: 'Label',
        transform: Transform.ZERO,
        appearance,
    });

    const diagram = Diagram.create({ id: 'page1' }).addShape(shape);
    const editor = EditorState.create({
        diagrams: [diagram],
        diagramIds: ['page1'],
        selectedDiagramId: 'page1',
    });

    return { editor: UndoableState.create(editor) } as any;
}

// Label / Heading / Paragraph / Link 共用的底板默认外观(TEXT_BOX_DEFAULT_APPEARANCE)。
const LABEL_LIKE_APPEARANCE = {
    [DefaultAppearance.TEXT]: 'Label',
    [DefaultAppearance.FONT_SIZE]: 13,
    [DefaultAppearance.FOREGROUND_COLOR]: '#333333',
    [DefaultAppearance.BACKGROUND_COLOR]: 'transparent',
    [DefaultAppearance.STROKE_COLOR]: 'transparent',
    [DefaultAppearance.STROKE_THICKNESS]: 0,
};

describe('getColors 投影(调色板)', () => {
    it('拖入含 \'transparent\' 默认值的纯文本组件不再抛异常(回归:拖入 Label 即白屏)', () => {
        const state = buildStateWithShape(LABEL_LIKE_APPEARANCE);

        // 修复前:这一行抛 'Color is not in a valid format.'
        const palette = getColors(state);

        // 可解析的颜色正常进入调色板。
        expect(palette.colors.map(c => c.toString())).toContain('#333333');
    });

    it('其它非法颜色值同样被跳过,不影响调色板生成', () => {
        const state = buildStateWithShape({
            [DefaultAppearance.FOREGROUND_COLOR]: 'not-a-color',
        });

        expect(() => getColors(state)).not.toThrow();
    });
});

describe('getFontFamily(渲染引擎)', () => {
    it('Shape 参数必须读 fontFamily 字段(回归:原来错读 fontSize)', () => {
        const fakeShape: any = {
            getAppearance: () => undefined,
            fontSize: 24,
            fontFamily: 'Georgia',
        };

        expect(getFontFamily(fakeShape)).toBe('Georgia');
    });
});
