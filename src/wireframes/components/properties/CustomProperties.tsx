/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Checkbox, Col, InputNumber, Row, Select } from 'antd';
import { CheckboxChangeEvent } from 'antd/lib/checkbox';
import { Color, ColorPalette, ColorPicker, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { changeItemsAppearance, ColorConfigurable, Configurable, getColors, getDiagramId, getSelection, NumberConfigurable, selectColorTab, SelectionConfigurable, SliderConfigurable, TextConfigurable, ToggleConfigurable, useStore } from '@app/wireframes/model';
import { texts } from '@app/texts';
import { CustomSlider } from './CustomSlider';
import { Text } from './Text';

type PropertyTextKey = keyof typeof texts.properties;

// Maps the appearance key of a custom configurable to the localized label. Unmapped keys fall back to the original label.
const LABEL_KEYS: { [name: string]: PropertyTextKey } = {
    ACCENT_COLOR: 'accentColor',
    ARROW_COLOR: 'arrowColor',
    ASPECT_RATIO: 'preserveAspectRatio',
    BAR_COLOR: 'thumbColor',
    BAR_POSITION: 'thumbPosition',
    BAR_SIZE: 'thumbSize',
    BORDER_RADIUS: 'borderRadius',
    BUTTON_PADDING_HORIZONTAL: 'paddingHorizontal',
    BUTTON_PADDING_VERTICAL: 'paddingVertical',
    CONNECTOR_HEAD_END: 'connectorHeadEnd',
    CONNECTOR_HEAD_START: 'connectorHeadStart',
    CONNECTOR_STROKE_DASH: 'connectorStrokeStyle',
    CONNECTOR_TEXT: 'connectorText',
    CONNECTOR_TEXT_BACKGROUND: 'connectorTextBackground',
    CONNECTOR_TEXT_POSITION: 'connectorTextPosition',
    CONNECTOR_TYPE: 'connectorType',
    CONNECTOR_BEND_POSITION: 'connectorBendPosition',
    CONNECTOR_CURVE_AMPLITUDE: 'connectorCurveAmount',
    // 圆角矩形的圆角(与 shapes/neutral/rounded-rectangle.ts 的外观键对齐)。
    FLOW_BORDER_RADIUS: 'borderRadius',
    HEADER_BACKGROUND_COLOR: 'headerBackground',
    HEADER_FOREGROUND_COLOR: 'headerText',
    HEADER_HIDDEN: 'hideHeader',
    ITEM_SIZE_FIXED: 'itemSizeFixed',
    ITEM_SIZE_FIXED_GAP: 'itemSizeFixedGap',
    PADDING_HORIZONTAL2: 'paddingHorizontal',
    PADDING_VERTICAL2: 'paddingVertical',
    SHAPE: 'shape',
    STATE: 'state',
    TAB_ALIGNMENT: 'tabAlignment',
    TAB_COLOR: 'tabColor',
    TAB_POSITION: 'tabPosition',
    URL: 'url',
    VALUE: 'value',
};

// Maps the option values of selection configurables to the localized labels. Unmapped options fall back to the original value.
const OPTION_KEYS: { [option: string]: PropertyTextKey } = {
    'Arrow': 'optionArrow',
    'Bottom': 'optionBottom',
    'Checked': 'optionChecked',
    'Curved': 'optionCurved',
    'Ellipse': 'optionEllipse',
    'Interdeminate': 'optionIndeterminate',
    'Left': 'optionLeft',
    'None': 'optionNone',
    'Normal': 'optionNormal',
    'Orthogonal': 'optionOrthogonal',
    'Rectangle': 'optionRectangle',
    'Rhombus': 'optionRhombus',
    'Right': 'optionRight',
    'Rounded Rectangle': 'optionRoundedRectangle',
    'Straight': 'optionStraight',
    'Top': 'optionTop',
    'Triangle': 'optionTriangle',
    // 连接线专属(小写,与 connect.ts configurables 的选项字面量对齐)
    'arrow': 'optionArrow',
    'curved': 'optionCurved',
    'dashed': 'optionDashed',
    'dotted': 'optionDotted',
    'none': 'optionNone',
    'orthogonal': 'optionOrthogonal',
    'solid': 'optionSolid',
    'straight': 'optionStraight',
};

const getLabel = (configurable: Configurable) => {
    const labelKey = LABEL_KEYS[configurable.name];

    return labelKey ? texts.properties[labelKey] : configurable.label;
};

const getOptionLabel = (option: string) => {
    const optionKey = OPTION_KEYS[option];

    return optionKey ? texts.properties[optionKey] : option;
};

interface CustomPropertyProps {
    // The configurable.
    configurable: Configurable;

    // The appearance value.
    value: any;

    // The selected color tab.
    selectedColorTab: string;

    // The recent colors.
    recentColors: ColorPalette;

    // When the value has changed.
    onChange: (name: string, value: any) => void;

    // The color tab has changed.
    onColorTabChange: (key: string) => void;
}

export const CustomProperty = (props: CustomPropertyProps) => {
    const {
        configurable,
        onChange,
        onColorTabChange,
        recentColors,
        selectedColorTab,
        value,
    } = props;

    const doChangeValue = useEventCallback((newValue: any) => {
        onChange(configurable.name, newValue);
    });

    const doChangeColor = useEventCallback((color: Color) => {
        onChange(configurable.name, color.toNumber());
    });

    const doChangeBoolean = useEventCallback((event: CheckboxChangeEvent) => {
        onChange(configurable.name, event.target.checked);
    });

    return (
        <Row className='property'>
            <Col span={12} className='property-label'>
                {getLabel(configurable)}
            </Col>
            <Col span={12} className='property-value'>
                {configurable instanceof SliderConfigurable &&
                    <CustomSlider value={value}
                        min={configurable.min}
                        max={configurable.max}
                        onChange={doChangeValue} />
                }

                {configurable instanceof NumberConfigurable &&
                    <InputNumber value={value}
                        min={configurable.min}
                        max={configurable.max}
                        onChange={doChangeValue} />
                }

                {configurable instanceof TextConfigurable &&
                    <Text text={value}
                        onTextChange={doChangeValue} />
                }

                {configurable instanceof ToggleConfigurable &&
                    <Checkbox checked={value}
                        onChange={doChangeBoolean} />
                }

                {configurable instanceof SelectionConfigurable &&
                    <Select value={value}
                        onChange={doChangeValue}
                    >
                        {configurable.options.map(o =>
                            <Select.Option key={o} value={o}>{getOptionLabel(o)}</Select.Option>,
                        )}
                    </Select>
                }

                {configurable instanceof ColorConfigurable &&
                    <ColorPicker activeColorTab={selectedColorTab as any} value={value}
                        onChange={doChangeColor}
                        onActiveColorTabChanged={onColorTabChange}
                        recentColors={recentColors} />
                }
            </Col>
        </Row>
    );
};

export const CustomProperties = () => {
    const dispatch = useAppDispatch();
    const recentColors = useStore(getColors);
    const selectedDiagramId = useStore(getDiagramId);
    const selectedColorTab = useStore(s => s.ui.selectedColorTab);
    const selectionSet = useStore(getSelection);

    const doSelectColorTab = useEventCallback((key: string) => {
        dispatch(selectColorTab(key));
    });

    const doChange = useEventCallback((key: string, value: any) => {
        if (selectedDiagramId) {
            dispatch(changeItemsAppearance(selectedDiagramId, selectionSet.selectedItems, key, value));
        }
    });

    if (selectionSet.selectedItems.length !== 1 || !selectedDiagramId) {
        return null;
    }

    const selectedShape = selectionSet.selectedItems[0];

    if (!selectedShape.configurables) {
        return null;
    }

    return (
        <>
            {selectedShape.configurables.map(c =>
                <CustomProperty key={c.name}
                    selectedColorTab={selectedColorTab}
                    configurable={c}
                    onChange={doChange}
                    onColorTabChange={doSelectColorTab}
                    recentColors={recentColors}
                    value={selectedShape.appearance.get(c.name)}
                />,
            )}
        </>
    );
};
