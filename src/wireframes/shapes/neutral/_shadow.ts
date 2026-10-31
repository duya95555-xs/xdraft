/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Types } from '@app/core/utils';
import { Shape, ShapeProperties } from '@app/wireframes/interface';
import { CommonTheme } from './_theme';

// 阴影的 5 个 appearance key。
//
// 字符串值与 `DefaultAppearance` 里的常量一一对应。这里写**字面量**而不是 import
// `DefaultAppearance`，是为了与 `shapes/` 下插件的既有写法保持一致
// （见 rectangle.ts 的 SHADOW_* 局部常量）—— 两边同值，只需要一个来源。
export const SHADOW_ENABLED = 'SHADOW_ENABLED';
export const SHADOW_COLOR = 'SHADOW_COLOR';
export const SHADOW_BLUR = 'SHADOW_BLUR';
export const SHADOW_OFFSET_X = 'SHADOW_OFFSET_X';
export const SHADOW_OFFSET_Y = 'SHADOW_OFFSET_Y';

// 在 defaultAppearance() 里展开这一份即可获得阴影能力。
// 同时必须在 render() 里调用 applyShadow()，否则会出现"能改但画面没反应"。
export const SHADOW_DEFAULT_APPEARANCE = {
    [SHADOW_ENABLED]: 0,
    [SHADOW_COLOR]: CommonTheme.DEFAULT_SHADOW_COLOR,
    [SHADOW_BLUR]: CommonTheme.DEFAULT_SHADOW_BLUR,
    [SHADOW_OFFSET_X]: CommonTheme.DEFAULT_SHADOW_OFFSET_X,
    [SHADOW_OFFSET_Y]: CommonTheme.DEFAULT_SHADOW_OFFSET_Y,
};

// 把该组件当前的阴影外观应用到 properties。
//
// ⚠️ 只有**声明过 SHADOW_ENABLED 的组件**才会真正动元素的 `style` 属性。
// 这一层保护是必需的：本函数会被放进共享渲染路径（如 renderRasterWithCrop），
// 未声明阴影的插件必须一位字节都不受影响 —— 尤其是 SVG 引擎关闭阴影时会
// `removeAttribute('style')`，若无条件调用就会抹掉别人的 inline style。
export function applyShadow(properties: ShapeProperties, shape: Shape): ShapeProperties {
    const enabled = shape.getAppearance(SHADOW_ENABLED);

    if (Types.isUndefined(enabled)) {
        return properties;
    }

    return properties.setShadow(
        !!enabled,
        shape.getAppearance(SHADOW_COLOR),
        shape.getAppearance(SHADOW_OFFSET_X),
        shape.getAppearance(SHADOW_OFFSET_Y),
        shape.getAppearance(SHADOW_BLUR));
}
