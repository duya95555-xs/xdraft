/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

export function isMac() {
    return window.navigator?.userAgent?.indexOf('Mac') >= 0;
}

export function isModKey(event: KeyboardEvent | MouseEvent) {
    if (isMac()) {
        return event.metaKey;
    } else {
        return event.ctrlKey;
    }
}

export function isMiddleMouse(event: MouseEvent) {
    return event.button === 1;
}

// 只有左键才参与"选中 / 框选"。
//
// 引擎对**任意按键**都会派发 mousedown(engine/svg/engine.ts 的 doc.mousedown 没有任何
// 按键过滤),而右键菜单是在这之后才由 antd 打开的。右键(button === 2)若继续往下走,
// 会被当成左键走完"选一个"的逻辑:点空白 = 清空选区、点组件 = 塌成单选 ——
// 于是"框选之后右键"看到的菜单里 复制 / 剪切 / 复制成图片 / 组合 / 对齐 / 分布 全部置灰。
// 中键(button === 1)则留给 pan / zoom,由 d3-zoom 直接监听 DOM,不依赖 adorner 调用链。
export function isLeftMouse(event: MouseEvent) {
    return event.button === 0;
}

const escapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const escapeReplaceNoEncode = new RegExp(escapeTestNoEncode.source, 'g');
const escapeReplacements: Record<string, string> = {
    '&' : '&amp;',
    '<' : '&lt;',
    '>' : '&gt;',
    '"' : '&quot;',
    '\'': '&#39;',
};

const getEscapeReplacement = (ch: string) => escapeReplacements[ch];

export function escapeHTML(html: string) {
    if (escapeTestNoEncode.test(html)) {
        return html.replace(escapeReplaceNoEncode, getEscapeReplacement);
    }

    return html;
}

export namespace Keys {
    const ALT = 18;
    const COMMA = 188;
    const CONTROL = 17;
    const DELETE = 8;
    const ENTER = 13;
    const ESCAPE = 27;
    const DOWN = 40;
    const UP = 38;

    type SourceEvent = KeyboardEvent | React.KeyboardEvent;

    export function isAlt(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'ALTLEFT' || key === 'ALTRIGHT' || event.keyCode === CONTROL;
    }

    export function isControl(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'CONTROL' || event.keyCode === ALT;
    }

    export function isComma(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === ',' || event.keyCode === COMMA;
    }

    export function isDelete(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'DELETE' || event.keyCode === DELETE;
    }

    export function isEnter(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'ENTER' || event.keyCode === ENTER;
    }

    export function isDown(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'ARROWDOWN' || event.keyCode === DOWN;
    }

    export function isUp(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'ARROWUP' || event.keyCode === UP;
    }

    export function isEscape(event: SourceEvent) {
        const key = event.key?.toUpperCase();

        return key === 'ESCAPE' || key === 'ESC' || event.keyCode === ESCAPE;
    }
}