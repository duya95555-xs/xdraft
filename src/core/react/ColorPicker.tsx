/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import Icon from '@ant-design/icons';
import { HighlightOutlined } from '@ant-design/icons';
import { Button, Popover, Tabs } from 'antd';
import { TooltipPlacement } from 'antd/lib/tooltip';
import * as React from 'react';
import { ColorResult, SketchPicker } from 'react-color';
import { Color, ColorPalette } from '@app/core/utils';
import { texts } from '@app/texts';
import { ColorList } from './ColorList';
import { useEventCallback } from './hooks';
import './ColorPicker.scss';
import { TabsProps } from 'antd';

type ColorTab = 'palette' | 'advanced';

// react-color 的 result.hex 恒为 6 位(不含 alpha),透明度只放在 result.rgb.a 里。
// 把它合成成 8 位 "#rrggbbaa",让"预览色块 / 应用按钮 / 后续解析"三处都不丢 alpha。
function withAlpha(result: ColorResult) {
    const a = Math.round(Math.min(1, Math.max(0, result.rgb?.a ?? 1)) * 255);

    return `${result.hex}${a.toString(16).padStart(2, '0')}`;
}

export interface ColorPickerProps {
    // The selected color.
    value?: Color | string | null;

    // The color palette.
    palette?: ColorPalette;

    // The color palette.
    recentColors?: ColorPalette;

    // The active color tab.
    activeColorTab?: ColorTab;

    // Where to place the popover
    popoverPlacement?: TooltipPlacement;

    // If disabled or not.
    disabled?: boolean;

    // Triggered when the color has changed.
    onChange?: (color: Color) => void;

    // Triggered when the active color tab has changed.
    onActiveColorTabChanged?: (key: ColorTab) => void;

    // Show alpha (opacity) controls for the color.
    showAlpha?: boolean;

    // Show an eyedropper that picks a color from the screen (Chrome/Edge only).
    allowEyedropper?: boolean;
}

export const ColorPicker = React.memo((props: ColorPickerProps) => {
    const {
        activeColorTab,
        allowEyedropper,
        disabled,
        onActiveColorTabChanged,
        onChange,
        palette,
        popoverPlacement,
        recentColors,
        showAlpha,
        value,
    } = props;

    const [color, setColor] = React.useState(Color.BLACK);
    const [colorHex, setColorHex] = React.useState(color.toString());
    const [visible, setVisible] = React.useState<boolean>(false);

    // 取色器(EyeDropper)打开期间,用户在屏幕上点按是在"取色",此时点击不应关闭弹层。
    const pickingRef = React.useRef(false);

    // 点击弹层与触发按钮以外的空白处 → 关闭弹层。
    // mousedown 早于 click,在拖动画布/点选组件前触发,避免"先关了弹层又误触画布"。
    React.useEffect(() => {
        if (!visible) {
            return;
        }

        const onPointerDown = (event: MouseEvent) => {
            if (pickingRef.current) {
                return;
            }

            const target = event.target as HTMLElement | null;

            if (target?.closest('.color-picker-popover') || target?.closest('.color-picker-button')) {
                return;
            }

            setVisible(false);
        };

        document.addEventListener('mousedown', onPointerDown);

        return () => {
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, [visible]);

    const selectedPalette = React.useMemo(() => {
        return palette || ColorPalette.colors();
    }, [palette]);

    React.useEffect(() => {
        setColorHex(color.toString());
    }, [color]);

    React.useEffect(() => {
        setColor(value ? Color.fromValue(value) : Color.BLACK);
    }, [value]);

    const doToggle = useEventCallback(() => {
        setVisible(x => !x);
    });

    const doSelectColorResult = useEventCallback((result: ColorResult) => {
        // ── 关键:把 alpha 一起带进 hex ────────────────────────────────────────
        //
        // react-color 的 result.hex 恒为 6 位,**不含** alpha,透明度只放在 result.rgb.a 里。
        // 之前这里直接 setColorHex(result.hex),于是:
        //   · 色块预览(背景色就是 colorHex)看不见透明度;
        //   · 点「应用」时 doConfirmColor 解析的也是这个 6 位串 ⇒ 透明度被打回 100%。
        // 拖动滑条时是"实时写回 appearance"的,所以现象是"拖的时候有效、一按应用就回弹"。
        const hex = showAlpha ? withAlpha(result) : result.hex;

        setColorHex(hex);

        if (showAlpha) {
            // Propagate alpha changes immediately when enabled.
            const next = Color.fromValue(hex);

            setColor(next);
            onChange && onChange(next);
        }
    });

    const doSelectTab = useEventCallback((key: string) => {
        onActiveColorTabChanged && onActiveColorTabChanged(key as ColorTab);
    });

    const doSelectColor = useEventCallback((result: Color) => {
        // 色板里给的都是不透明色(a = 1)。若直接采用,用户在「高级」里设好的透明度会被
        // 悄悄打回 100%。这里在开启 alpha 时保留当前透明度:色板只负责选色相,
        // 透明度始终由 alpha 控件(高级 tab 的滑条 / 属性面板的「背景透明度」)决定。
        const next = showAlpha ? new Color(result.r, result.g, result.b, color.a) : result;

        onChange && onChange(next);
        setVisible(false);
        setColorHex(next.toString());
    });

    const doConfirmColor = useEventCallback(() => {
        const next = Color.fromValue(colorHex);

        // 打开弹层却什么都没改就点「应用」,不应该产生一次撤销记录。
        // 用含 alpha 的比较来判"确实改了没有"。
        if (!Color.eqWithAlpha(next, color)) {
            onChange && onChange(next);
        }

        setVisible(false);
        setColorHex(next.toString());
    });

    const doEyeDropper = useEventCallback(async () => {
        const EyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;

        if (!EyeDropper) {
            return;
        }

        try {
            pickingRef.current = true;

            const result = await new EyeDropper().open();
            const picked = Color.fromValue(result.sRGBHex);

            onChange && onChange(picked);
            setColor(picked);
            setColorHex(picked.toString());
            setVisible(false);
        } catch {
            // User cancelled the picker or an error occurred - silently ignore.
        } finally {
            pickingRef.current = false;
        }
    });

    const tabItems: TabsProps['items'] = [
        {
            key: 'palette',
            label: texts.common.palette,
            children: (
                <>
                    <ColorList color={color} colors={selectedPalette} onClick={doSelectColor} />

                    {recentColors &&
                        <div>
                            <h4>{texts.common.recent}</h4>

                            <ColorList color={color} colors={recentColors} onClick={doSelectColor} />
                        </div>
                    }
                </>
            ),
        },
        {
            key: 'advanced',
            label: texts.common.advanced,
            children: (
                <>
                    <SketchPicker
                        color={colorHex}
                        onChange={doSelectColorResult}
                        disableAlpha={!showAlpha}
                        width='210px'
                        presetColors={[]}
                    />

                    <div className='color-picker-actions'>
                        {allowEyedropper &&
                            <Button size='small' onClick={doEyeDropper} title={texts.common.eyedropper} icon={<HighlightOutlined />} />
                        }

                        <Button onClick={doConfirmColor}>
                            {texts.common.apply}
                        </Button>
                    </div>
                </>
            ),
        },
    ];

    const content = (
        <Tabs size='small' className='color-picker-tabs' animated={false} activeKey={activeColorTab} onChange={doSelectTab} items={tabItems} />
    );

    const placement = popoverPlacement || 'left';

    return (
        <Popover content={content} open={visible && !disabled} placement={placement} trigger={[]} onOpenChange={setVisible} overlayClassName='color-picker-popover'>
            <Button disabled={disabled} className='color-picker-button' onClick={doToggle}
                icon={
                    <Icon component={() =>
                        <div className='color-picker-color'>
                            <div className='color-picker-color-inner' style={{ background: colorHex }}></div>
                        </div>
                    } />
                }>
            </Button>
        </Popover>
    );
});
