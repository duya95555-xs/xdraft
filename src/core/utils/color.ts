/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Types } from './types';

/* eslint-disable prefer-template */
/* eslint-disable no-bitwise */

interface IColorDefinition {
    regex: RegExp;

    process(bots: RegExpExecArray): Color;
}

const ColorDefinitions: IColorDefinition[] = [
    {
        regex: /^transparent$/,
        process: () => Color.TRANSPARENT,
    },
    {
        regex: /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/,
        process: (bits) => {
            return new Color(
                parseInt(bits[1], 10) / 255,
                parseInt(bits[2], 10) / 255,
                parseInt(bits[3], 10) / 255);
        },
    },
    {
        regex: /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([0-9.]+)\)$/,
        process: (bits) => {
            return new Color(
                parseInt(bits[1], 10) / 255,
                parseInt(bits[2], 10) / 255,
                parseInt(bits[3], 10) / 255,
                Number(bits[4]));
        },
    },
    {
        regex: /^(\w{2})(\w{2})(\w{2})(\w{2})$/,
        process: (bits) => {
            return new Color(
                parseInt(bits[1], 16) / 255,
                parseInt(bits[2], 16) / 255,
                parseInt(bits[3], 16) / 255,
                parseInt(bits[4], 16) / 255);
        },
    },
    {
        regex: /^(\w{2})(\w{2})(\w{2})$/,
        process: (bits) => {
            return new Color(
                parseInt(bits[1], 16) / 255,
                parseInt(bits[2], 16) / 255,
                parseInt(bits[3], 16) / 255);
        },
    },
    {
        regex: /^(\w{1})(\w{1})(\w{1})$/,
        process: (bits) => {
            return new Color(
                parseInt(bits[1] + bits[1], 16) / 255,
                parseInt(bits[2] + bits[2], 16) / 255,
                parseInt(bits[3] + bits[3], 16) / 255);
        },
    },
];

export class Color {
    public static readonly BLACK = new Color(0, 0, 0);
    public static readonly WHITE = new Color(1, 1, 1);
    public static readonly GREEN = new Color(0, 1, 0);
    public static readonly BLUE = new Color(0, 0, 1);
    public static readonly RED = new Color(1, 0, 0);
    public static readonly TRANSPARENT = new Color(0, 0, 0, 0);

    public readonly r: number;
    public readonly g: number;
    public readonly b: number;
    public readonly a: number;

    public get luminance() {
        return (this.r + this.r + this.b + this.g + this.g + this.g) / 6;
    }

    public get isTransparent() {
        return this.a <= 0;
    }

    constructor(r: number, g: number, b: number, a = 1) {
        this.r = Math.min(1, Math.max(0, r));
        this.g = Math.min(1, Math.max(0, g));
        this.b = Math.min(1, Math.max(0, b));
        this.a = Math.min(1, Math.max(0, a));

        Object.freeze(this);
    }

    public eq(c: Color): boolean {
        return Color.eq(this, c);
    }

    public ne(c: Color): boolean {
        return Color.ne(this, c);
    }

    public static eq(lhs: Color, rhs: Color): boolean {
        return lhs.r === rhs.r && lhs.g === rhs.g && lhs.b === rhs.b;
    }

    public static ne(lhs: Color, rhs: Color): boolean {
        return lhs.r !== rhs.r || lhs.g !== rhs.g || lhs.b !== rhs.b;
    }

    // 含 alpha 的相等判断。
    //
    // 保留 eq / ne 的原有语义(只比 RGB)不动 —— 它们被用在"色板里哪个色被选中"
    // 这类场景上(见 core/react/ColorList.tsx),若把 alpha 一并纳入,半透明色将匹配
    // 不到任何色板项,反而丢掉高亮。需要"连透明度一起比"的地方改用本方法。
    public static eqWithAlpha(lhs: Color, rhs: Color): boolean {
        return Color.eq(lhs, rhs) && Color.eqAlpha(lhs, rhs);
    }

    // alpha 单独比较:按 8 位量化后再比,而不是直接比浮点。
    //
    // 原因:alpha 经常经 "#rrggbbaa" 往返一次(toString 里 Math.round(a * 255) / 255,
    // fromString 里 parseInt(x, 16) / 255),两条路径的浮点结果可能差一个 ULP,
    // 直接用 === 会出现"看起来一样却判不等"的假阴性。
    public static eqAlpha(lhs: Color, rhs: Color): boolean {
        return Math.round(lhs.a * 255) === Math.round(rhs.a * 255);
    }

    public toNumber(): number {
        return ((this.r * 255) << 16) + ((this.g * 255) << 8) + (this.b * 255);
    }

    public toString(): string {
        let r = Math.round(this.r * 255).toString(16);
        let g = Math.round(this.g * 255).toString(16);
        let b = Math.round(this.b * 255).toString(16);

        if (r.length === 1) {
            r = '0' + r;
        }
        if (g.length === 1) {
            g = '0' + g;
        }
        if (b.length === 1) {
            b = '0' + b;
        }

        if (this.a >= 1) {
            return '#' + r + g + b;
        }

        let a = Math.round(this.a * 255).toString(16);
        if (a.length === 1) {
            a = '0' + a;
        }

        return '#' + r + g + b + a;
    }

    public static fromHex(r: number, g: number, b: number): Color {
        return new Color(
            parseInt('' + r, 16) / 255,
            parseInt('' + g, 16) / 255,
            parseInt('' + b, 16) / 255);
    }

    public static fromNumber(rgb: number): Color {
        const r = ((rgb >> 16) & 0xff) / 255;
        const g = ((rgb >> 8) & 0xff) / 255;
        const b = (rgb & 0xff) / 255;

        return new Color(r, g, b);
    }

    public static fromValue(value: number | string | Color): Color {
        if (Types.isString(value)) {
            return Color.fromString(value);
        } else if (Types.isNumber(value)) {
            return Color.fromNumber(value);
        } else {
            return value;
        }
    }

    public static fromString(value: string) {
        if (value.charAt(0) === '#') {
            // 只剥掉 '#' 本身 —— 不能写成 substring(1, 7):
            // 那会把 "#rrggbbaa" 里的 alpha 提前截掉,透明度永远解析不出来(另一个
            // "点应用透明度就打回 100%"的成因)。剥掉 '#' 之后 3 / 6 / 8 位分别由
            // 下面的 ColorDefinitions 匹配,其中 /^(\w{2})(\w{2})(\w{2})(\w{2})$/ 就是带 alpha 的。
            value = value.substring(1);
        }

        value = value.replace(/ /g, '').toLowerCase();

        for (const colorDefinition of ColorDefinitions) {
            const bits = colorDefinition.regex.exec(value);

            if (bits) {
                return colorDefinition.process(bits);
            }
        }

        throw new Error('Color is not in a valid format.');
    }

    public static fromHsv(h: number, s: number, v: number): Color {
        h /= 60;

        const i = Math.floor(h);
        const f = (h - i);
        const p = (v * (1 - s));
        const q = (v * (1 - (f * s)));
        const t = (v * (1 - ((1 - f) * s)));

        switch (i % 6) {
            case 0:
                return new Color(v, t, p);
            case 1:
                return new Color(q, v, p);
            case 2:
                return new Color(p, v, t);
            case 3:
                return new Color(p, q, v);
            case 4:
                return new Color(t, p, v);
            default:
                return new Color(v, p, q);
        }
    }

    public static fromHsl(h: number, s: number, l: number): Color {
        let r = 0;
        let g = 0;
        let b = 0;

        h /= 360;

        if (s === 0) {
            // eslint-disable-next-line no-multi-assign
            r = g = b = l;
        } else {
            const hue2rgb = (pi: number, qi: number, ti: number) => {
                if (ti < 0) {
                    ti += 1;
                }

                if (ti > 1) {
                    ti -= 1;
                }
                if (ti < 1 / 6) {
                    return pi + (qi - pi) * 6 * ti;
                }
                if (ti < 1 / 2) {
                    return qi;
                }
                if (ti < 2 / 3) {
                    return pi + (qi - pi) * (2 / 3 - ti) * 6;
                }
                return pi;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;

            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return new Color(r, g, b);
    }
}
