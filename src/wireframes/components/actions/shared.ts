/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

/* eslint-disable one-var */
/* eslint-disable one-var-declaration-per-line */

import * as React from 'react';
import { Color, Types, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { changeItemsAppearance, DiagramItemSet } from '@app/wireframes/model';

export interface UIAction {
    // The label.
    label: string;

    // The icon.
    icon: JSX.Element | string;

    // The tooltip.
    tooltip: string;

    // The shortcut.
    shortcut?: string;

    // True when disabled.
    disabled: boolean;

    // The method to invoke the action.
    onAction: () => void;
}

export type UniqueValue<TValue> = { value?: TValue; empty?: boolean };
export type UniqueConverter<TInput> = { parse: (value: any) => TInput; write: (value: TInput) => any };

const DEFAULT_CONVERTER = {
    parse: (value: any) => {
        if (value === 'undefined') {
            return undefined!;
        }

        return value;
    },
    write: (value: any) => {
        return value;
    },
};

const COLOR_CONVERTER: UniqueConverter<Color> = {
    parse: (value: any) => {
        if (value === 'undefined') {
            return undefined!;
        }

        // 'transparent' 等解析不了的颜色值(纯文本组件底板默认值)静默跳过:
        // 本 converter 在属性面板的 React 渲染期运行,抛异常会卸载整棵组件树白屏
        // (与 getColors 的崩溃同源,2026-09-21 实机复现:拖入 Label 选中后即白屏)。
        try {
            return Color.fromValue(value);
        } catch {
            return undefined!;
        }
    },
    write: (value: Color) => {
        return value.toString();
    },
};

type Result<T> = [UniqueValue<T>, (value: T) => void];

type RefDiagramId = string | null | undefined;
type RefDiagramItemSet = DiagramItemSet | null | undefined;

export function useColorAppearance(selectedDiagramId: RefDiagramId, selectedSet: RefDiagramItemSet, key: string): Result<Color> {
    return useAppearanceCore(selectedDiagramId, selectedSet, key, COLOR_CONVERTER);
}

export function useAppearance<T>(selectedDiagramId: RefDiagramId, selectedSet: RefDiagramItemSet, key: string, allowUndefined = false, force = false): Result<T> {
    return useAppearanceCore(selectedDiagramId, selectedSet, key, DEFAULT_CONVERTER, allowUndefined, force);
}

export function useAppearanceCore<T>(selectedDiagramId: RefDiagramId, selectionSet: RefDiagramItemSet, key: string, converter: UniqueConverter<T>, allowUndefined = false, force = false): Result<T> {
    const dispatch = useAppDispatch();

    const value = React.useMemo(() => {
        if (!selectionSet) {
            return { empty: true };
        }

        let value: T | undefined, empty = true;

        for (const item of selectionSet.nested.values()) {
            if (item.type === 'Group') {
                continue;
            }
    
            const appearance = item.appearance.get(key);

            if (!Types.isUndefined(appearance) || allowUndefined) {
                empty = false;

                const parsed = converter.parse(appearance);

                if (parsed && value && !Types.equals(value, parsed)) {
                    value = undefined;
                } else {
                    value = parsed;
                }
            }
        }

        return { value, empty };
    }, [allowUndefined, converter, key, selectionSet]);

    const doChangeAppearance = useEventCallback((value: T) => {
        if (selectedDiagramId && selectionSet) {
            // 用 appearanceItems(含连接线)而不是 editableItems(排除连接线):
            // 颜色/线宽/线型等外观修改对连线同样有效;editableItems 只该用于几何变换。
            dispatch(changeItemsAppearance(selectedDiagramId, selectionSet.appearanceItems, key, converter.write(value), force));
        }
    });

    return [value, doChangeAppearance];
}
