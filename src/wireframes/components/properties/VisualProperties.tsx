/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Button, Col, Row, Select, Slider, Space, Switch } from 'antd';
import classNames from 'classnames';
import * as React from 'react';
import { Color, ColorPicker, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { DefaultAppearance } from '@app/wireframes/interface';
import { getColors, getDiagramId, getSelection, selectColorTab, useStore } from '@app/wireframes/model';
import { UniqueValue, useAppearance, useColorAppearance } from './../actions';
import './VisualProperties.scss';

// 需求口径(第五轮第 1~4 条):组件不支持的属性 -> 该行**保留并置灰**,不隐藏、不移除。
// 判据 = useAppearance/useColorAppearance 返回的 `empty`(选中项里没有任何一个声明过该 appearance key)。
// 组件要支持某属性,必须在自己的 defaultAppearance() 里声明该 key,并在 render() 里真正用上。
const rowClass = (value: UniqueValue<any>) => classNames('property', { disabled: !!value.empty });

export const VisualProperties = React.memo(() => {
    const dispatch = useAppDispatch();
    const recentColors = useStore(getColors);
    const selectedColorTab = useStore(s => s.ui.selectedColorTab as any);
    const selectedDiagramId = useStore(getDiagramId);
    const selectionSet = useStore(getSelection);

    const [backgroundColor, setBackgroundColor] =
        useColorAppearance(selectedDiagramId, selectionSet,
            DefaultAppearance.BACKGROUND_COLOR);

    const [fontSize, setFontSize] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.FONT_SIZE);

    const [foregroundColor, setForegroundColor] =
        useColorAppearance(selectedDiagramId, selectionSet,
            DefaultAppearance.FOREGROUND_COLOR);

    const [strokeColor, setStrokeColor] =
        useColorAppearance(selectedDiagramId, selectionSet,
            DefaultAppearance.STROKE_COLOR);

    const [strokeThickness, setStrokeThickness] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.STROKE_THICKNESS);

    const [shadowEnabled, setShadowEnabled] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.SHADOW_ENABLED);

    const [shadowColor, setShadowColor] =
        useColorAppearance(selectedDiagramId, selectionSet,
            DefaultAppearance.SHADOW_COLOR);

    const [shadowBlur, setShadowBlur] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.SHADOW_BLUR);

    const [shadowOffsetX, setShadowOffsetX] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.SHADOW_OFFSET_X);

    const [shadowOffsetY, setShadowOffsetY] =
        useAppearance<number>(selectedDiagramId, selectionSet,
            DefaultAppearance.SHADOW_OFFSET_Y);

    const [textAlignment, setTextAlignment] =
        useAppearance<string>(selectedDiagramId, selectionSet,
            DefaultAppearance.TEXT_ALIGNMENT);

    const doSelectColorTab = useEventCallback((key: string) => {
        dispatch(selectColorTab(key));
    });

    // ── 背景透明度 ────────────────────────────────────────────────────────
    //
    // 直接读写 BACKGROUND_COLOR 的 alpha 通道,**不新增 appearance key** ⇒ 老文件天然兼容。
    // 是否置灰沿用与其它行完全相同的判据(选中项里没有任何一个声明过 BACKGROUND_COLOR),
    // 于是它自动只对声明过该 key 的组件开放,纯文本类组件仍然"保留但置灰"。
    //
    // ⚠️ 这里绝不能用 DefaultAppearance.OPACITY 代替 —— SVG 渲染器把它写成**元素级**
    // opacity(engine/svg/renderer.ts),描边和文字会跟着一起变淡。那是"整体透明度",
    // 不是"底色透明度"。要"只有底色透明、边框文字不动",必须落在 BACKGROUND_COLOR 的 alpha 上。
    const backgroundOpacity = React.useMemo(() => {
        const current = backgroundColor.value;

        // 两种情况置灰:
        //   · empty —— 选中项里没人声明过 BACKGROUND_COLOR(与「背景颜色」行同一判据);
        //   · 多选且底色互不相同 —— hook 会给出 undefined 的 value,此时没有统一的 RGB
        //     可以继承,强行写会把选中的组件统统刷成同一个颜色。
        if (backgroundColor.empty || !current) {
            return { empty: true, percent: 100 };
        }

        return { empty: false, percent: Math.round(current.a * 100) };
    }, [backgroundColor]);

    const doChangeBackgroundOpacity = useEventCallback((percent: number) => {
        const current = backgroundColor.value;

        if (!current) {
            return;
        }

        setBackgroundColor(new Color(current.r, current.g, current.b, percent / 100));
    });

    if (!selectedDiagramId) {
        return null;
    }

    return (
        <>
            <div style={{ display: (selectionSet.selectedItems.length > 0 ? 'block' : 'none') }}>
                <div className='property-subsection visual-properties'>
                    <Row className={rowClass(fontSize)}>
                        <Col span={12} className='property-label'>{texts.common.fontSize}</Col>
                        <Col span={12} className='property-value'>
                            <Select disabled={fontSize.empty} value={fontSize.value} onChange={setFontSize}>
                                {DEFINED_FONT_SIZES.map(value =>
                                    <Select.Option key={value.toString()} value={value}>{value}</Select.Option>,
                                )}
                            </Select>
                        </Col>
                    </Row>
                    <Row className={rowClass(strokeThickness)}>
                        <Col span={12} className='property-label'>{texts.common.strokeThickness}</Col>
                        <Col span={12} className='property-value'>
                            <Select disabled={strokeThickness.empty} value={strokeThickness.value} onChange={setStrokeThickness}>
                                {DEFINED_STROKE_THICKNESSES.map(value =>
                                    <Select.Option key={value.toString()} value={value}>{value}</Select.Option>,
                                )}
                            </Select>
                        </Col>
                    </Row>
                    <Row className={rowClass(shadowEnabled)}>
                        <Col span={12} className='property-label'>{texts.common.shadowEnabled}</Col>
                        <Col span={12} className='property-value'>
                            <Switch disabled={shadowEnabled.empty} checked={!!shadowEnabled.value} onChange={v => setShadowEnabled(v ? 1 : 0)} />
                        </Col>
                    </Row>
                    <Row className={rowClass(shadowColor)} style={{ display: (shadowEnabled.value ? 'flex' : 'none') }}>
                        <Col span={12} className='property-label'>{texts.common.shadowColor}</Col>
                        <Col span={12} className='property-value'>
                            <ColorPicker activeColorTab={selectedColorTab} disabled={shadowColor.empty} value={shadowColor.value}
                                onChange={setShadowColor}
                                onActiveColorTabChanged={doSelectColorTab}
                                recentColors={recentColors}
                                showAlpha allowEyedropper />
                        </Col>
                    </Row>
                    <Row className={rowClass(shadowBlur)} style={{ display: (shadowEnabled.value ? 'flex' : 'none') }}>
                        <Col span={12} className='property-label'>{texts.common.shadowBlur}</Col>
                        <Col span={12} className='property-value'>
                            <Select disabled={shadowBlur.empty} value={shadowBlur.value} onChange={setShadowBlur}>
                                {DEFINED_SHADOW_BLURS.map(value =>
                                    <Select.Option key={value.toString()} value={value}>{value}</Select.Option>,
                                )}
                            </Select>
                        </Col>
                    </Row>
                    <Row className={rowClass(shadowOffsetX)} style={{ display: (shadowEnabled.value ? 'flex' : 'none') }}>
                        <Col span={12} className='property-label'>{texts.common.shadowOffsetX}</Col>
                        <Col span={12} className='property-value'>
                            <Select disabled={shadowOffsetX.empty} value={shadowOffsetX.value} onChange={setShadowOffsetX}>
                                {DEFINED_SHADOW_OFFSETS.map(value =>
                                    <Select.Option key={value.toString()} value={value}>{value}</Select.Option>,
                                )}
                            </Select>
                        </Col>
                    </Row>
                    <Row className={rowClass(shadowOffsetY)} style={{ display: (shadowEnabled.value ? 'flex' : 'none') }}>
                        <Col span={12} className='property-label'>{texts.common.shadowOffsetY}</Col>
                        <Col span={12} className='property-value'>
                            <Select disabled={shadowOffsetY.empty} value={shadowOffsetY.value} onChange={setShadowOffsetY}>
                                {DEFINED_SHADOW_OFFSETS.map(value =>
                                    <Select.Option key={value.toString()} value={value}>{value}</Select.Option>,
                                )}
                            </Select>
                        </Col>
                    </Row>
                    <Row className={rowClass(strokeColor)}>
                        <Col span={12} className='property-label'>{texts.common.strokeColor}</Col>
                        <Col span={12} className='property-value'>
                            <ColorPicker activeColorTab={selectedColorTab} disabled={strokeColor.empty} value={strokeColor.value}
                                onChange={setStrokeColor}
                                onActiveColorTabChanged={doSelectColorTab}
                                recentColors={recentColors} />
                        </Col>
                    </Row>
                    <Row className={rowClass(foregroundColor)}>
                        <Col span={12} className='property-label'>{texts.common.foregroundColor}</Col>
                        <Col span={12} className='property-value'>
                            <ColorPicker activeColorTab={selectedColorTab} disabled={foregroundColor.empty} value={foregroundColor.value}
                                onChange={setForegroundColor}
                                onActiveColorTabChanged={doSelectColorTab}
                                recentColors={recentColors}
                                showAlpha allowEyedropper />
                        </Col>
                    </Row>
                    <Row className={rowClass(backgroundColor)}>
                        <Col span={12} className='property-label'>{texts.common.backgroundColor}</Col>
                        <Col span={12} className='property-value'>
                            <ColorPicker activeColorTab={selectedColorTab} disabled={backgroundColor.empty} value={backgroundColor.value}
                                onChange={setBackgroundColor}
                                onActiveColorTabChanged={doSelectColorTab}
                                recentColors={recentColors}
                                showAlpha allowEyedropper />
                        </Col>
                    </Row>
                    <Row className={rowClass(backgroundOpacity)}>
                        <Col span={12} className='property-label'>{texts.common.backgroundOpacity}</Col>
                        <Col span={12} className='property-value'>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Slider className='property-slider'
                                    disabled={backgroundOpacity.empty}
                                    max={100}
                                    min={0}
                                    onChange={doChangeBackgroundOpacity}
                                    style={{ flex: '1 1 auto', minWidth: 0 }}
                                    value={backgroundOpacity.percent} />

                                <span style={{ flex: '0 0 auto', minWidth: 34, textAlign: 'right' }}>
                                    {backgroundOpacity.percent}%
                                </span>
                            </div>
                        </Col>
                    </Row>
                    <Row className={rowClass(textAlignment)}>
                        <Col span={12} className='property-label'>{texts.common.textAlignment}</Col>
                        <Col span={12} className='property-value'>
                            <Space.Compact className='text-alignment'>
                                <TextButton value={textAlignment} onClick={setTextAlignment}
                                    mode='left' icon='icon-align-left' label={texts.common.alignmentLeft} />

                                <TextButton value={textAlignment} onClick={setTextAlignment}
                                    mode='center' icon='icon-align-center' label={texts.common.alignmentCenter} />

                                <TextButton value={textAlignment} onClick={setTextAlignment}
                                    mode='right' icon='icon-align-right' label={texts.common.alignmentRight} />

                                <TextButton value={textAlignment} onClick={setTextAlignment}
                                    mode='justify' icon='icon-align-justify' label={texts.common.alignmentJustify} />
                            </Space.Compact>
                        </Col>
                    </Row>
                </div>
            </div>
        </>
    );
});

type TextButtonProps = { mode: any; value: UniqueValue<any>; icon: string; label: string; onClick: (tag: any) => void };

const TextButton = React.memo(({ value, mode, icon, label, onClick }: TextButtonProps) => {
    const type = mode === value.value ? 'primary' : undefined;

    return (
        <Button disabled={value.empty} type={type} onClick={() => onClick(mode)} title={label}>
            <i className={icon} />
        </Button>
    );
});

const DEFINED_STROKE_THICKNESSES = [0, 1, 2, 4, 6, 8];
const DEFINED_SHADOW_BLURS = [0, 2, 4, 6, 8, 10, 15, 20, 30];
const DEFINED_SHADOW_OFFSETS = [-20, -15, -10, -6, -4, -2, 0, 2, 4, 6, 10, 15, 20];
const DEFINED_FONT_SIZES = [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60];
