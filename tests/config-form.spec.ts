/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 配置 JSON → 表单生成器的单元测试(纯函数,jsdom 即可)。
// 运行:CI=1 npx vitest run tests/config-form.spec.ts

import { describe, expect, it } from 'vitest';
import { buildConfigFormFromJson } from '@app/wireframes/model';

const APP_MINE_CONFIG = `{
    "sceneCode": "APP_MINE",
    "sceneName": "个人中心邀评入口",
    "enabled": 1,
    "containerUrl": "https://xxx.com/container/pageA",
    "jumpUrl": "https://xxx.com/jump/comment",
    "intervalDays": 7,
    "canClose": 1
}`;

describe('buildConfigFormFromJson', () => {
    it('APP_MINE 配置 → 标题 + 每键"标签+控件"两行', () => {
        const shapes = buildConfigFormFromJson(APP_MINE_CONFIG, 100, 200)!;

        // 1 个标题 + 7 个键 × (Label + 控件) = 15 个组件。
        expect(shapes.length).toBe(1 + 7 * 2);
        expect(shapes[0].renderer).toBe('Heading');
        expect(shapes[0].appearance['TEXT']).toBe('个人中心邀评入口(APP_MINE)');
    });

    it('0/1 数字生成枚举下拉,其它数字生成数字输入,字符串生成文本输入', () => {
        const shapes = buildConfigFormFromJson(APP_MINE_CONFIG, 0, 0)!;
        const controlOf = (key: string) => {
            const labelIndex = shapes.findIndex(s => s.renderer === 'Label' && s.appearance['TEXT'] === key);
            return shapes[labelIndex + 1];
        };

        expect(controlOf('enabled').renderer).toBe('ComboBox');
        expect(controlOf('canClose').renderer).toBe('ComboBox');
        expect(controlOf('intervalDays').renderer).toBe('Numeric');
        expect(controlOf('containerUrl').renderer).toBe('TextInput');
        expect(controlOf('jumpUrl').renderer).toBe('TextInput');
        expect(controlOf('containerUrl').appearance['TEXT']).toBe('https://xxx.com/container/pageA');
    });

    it('普通文本/非对象 JSON/数组一律返回 null(走默认粘贴)', () => {
        expect(buildConfigFormFromJson('你好世界', 0, 0)).toBeNull();
        expect(buildConfigFormFromJson('{broken json', 0, 0)).toBeNull();
        expect(buildConfigFormFromJson('[1,2,3]', 0, 0)).toBeNull();
        expect(buildConfigFormFromJson('42', 0, 0)).toBeNull();
        expect(buildConfigFormFromJson('{}', 0, 0)).toBeNull();
    });

    it('行按 40px 间距纵向排列,键标签在左、控件在右', () => {
        const shapes = buildConfigFormFromJson(APP_MINE_CONFIG, 100, 200)!;
        const firstLabel = shapes[1];
        const secondLabel = shapes[3];

        expect(firstLabel.position).toEqual({ x: 100, y: 250 });
        expect(secondLabel.position).toEqual({ x: 100, y: 290 });
        expect(shapes[2].position.x).toBe(100 + 150 + 10);
    });
});
