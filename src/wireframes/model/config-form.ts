/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

// 配置 JSON → 表单生成器。
//
// 使用场景:把一段平铺的配置 JSON(如 APP_MINE 邀评入口配置)直接 Ctrl+V 到画布,
// 自动铺出"键标签 + 输入控件"的表单,省去手搭。
//
// 映射规则:
//   · 0/1 数字、布尔           → ComboBox(枚举下拉)
//   · 其它数字                 → Numeric(数字输入)
//   · 字符串                   → TextInput(文本输入)
//   · 嵌套对象/数组            → TextInput,值为序列化后的 JSON 文本
//   · 标题行                   → Heading,取 sceneName(+sceneCode),缺失时显示"配置表单"
//
// 只有"形如 JSON 对象"的文本才命中;普通文本照旧走 Label 粘贴路径。

import { DefaultAppearance } from '@app/wireframes/interface';

export interface ConfigFormShape {
    // 目标组件渲染器标识。
    renderer: string;

    // 画布坐标(左上角)。
    position: { x: number; y: number };

    // 初始尺寸(部分组件会被自身 constraint 重新计算)。
    size: { x: number; y: number };

    // 覆盖默认外观的键值(addShape 会与组件默认值合并)。
    appearance: { [key: string]: any };
}

const ROW_HEIGHT = 30;
const ROW_PITCH = 40;
const LABEL_WIDTH = 150;
const CONTROL_WIDTH = 280;
const TITLE_HEIGHT = 36;
const TITLE_GAP = 50;

function isPrimitive(value: any) {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function buildConfigFormFromJson(text: string, originX: number, originY: number): ConfigFormShape[] | null {
    const trimmed = (text || '').trim();

    // 快速排除:不以 '{' 开头的不可能是配置对象,交给默认粘贴路径。
    if (!trimmed.startsWith('{')) {
        return null;
    }

    let parsed: any;

    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }

    // 只接受平铺 JSON 对象;数组/标量不命中。
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }

    const entries = Object.entries(parsed);

    if (entries.length === 0) {
        return null;
    }

    const shapes: ConfigFormShape[] = [];

    // 标题:sceneName 优先,附 sceneCode;都没有则通用标题。
    const sceneName = typeof parsed.sceneName === 'string' && parsed.sceneName ? parsed.sceneName : '配置表单';
    const sceneCode = typeof parsed.sceneCode === 'string' && parsed.sceneCode ? parsed.sceneCode : '';

    shapes.push({
        renderer: 'Heading',
        position: { x: originX, y: originY },
        size: { x: LABEL_WIDTH + CONTROL_WIDTH, y: TITLE_HEIGHT },
        appearance: {
            [DefaultAppearance.TEXT]: sceneCode ? `${sceneName}(${sceneCode})` : sceneName,
            [DefaultAppearance.FONT_SIZE]: 20,
            [DefaultAppearance.TEXT_ALIGNMENT]: 'left',
        },
    });

    entries.forEach(([key, rawValue], index) => {
        const rowY = originY + TITLE_GAP + index * ROW_PITCH;
        const value = isPrimitive(rawValue) ? rawValue : JSON.stringify(rawValue);

        // 键标签(右对齐,贴近右侧控件)。
        shapes.push({
            renderer: 'Label',
            position: { x: originX, y: rowY },
            size: { x: LABEL_WIDTH, y: ROW_HEIGHT },
            appearance: {
                [DefaultAppearance.TEXT]: key,
                [DefaultAppearance.TEXT_ALIGNMENT]: 'right',
            },
        });

        // 值控件:0/1 数字与布尔 → 枚举下拉;其它数字 → 数字输入;其余 → 文本输入。
        let renderer = 'TextInput';

        if (typeof value === 'boolean' || (typeof value === 'number' && (value === 0 || value === 1))) {
            renderer = 'ComboBox';
        } else if (typeof value === 'number') {
            renderer = 'Numeric';
        }

        shapes.push({
            renderer,
            position: { x: originX + LABEL_WIDTH + 10, y: rowY },
            size: { x: CONTROL_WIDTH, y: ROW_HEIGHT },
            appearance: {
                [DefaultAppearance.TEXT]: value === null ? '' : String(value),
                [DefaultAppearance.TEXT_ALIGNMENT]: 'left',
            },
        });
    });

    return shapes;
}
