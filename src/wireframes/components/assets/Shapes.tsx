/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { SearchOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import classNames from 'classnames';
import * as React from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useStore as useReduxStore } from 'react-redux';
import { Grid, useEventCallback, useResizeObserver } from '@app/core';
import { AppState, useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { addShape, filterShapes, getDiagramId, getFilteredShapes, getShapesFilter, ShapeInfo, useStore } from '@app/wireframes/model';
import { ShapeImage } from './ShapeImage';
import './Shapes.scss';

// 流程图形状:既是"流程图形状"分组的成员,也是唯一允许作为连接线端点的图元。
// 参见 mydraft-资产面板与连线锚点-方案-v1.md 第 1、3 章。
const FLOWCHART_SHAPES = new Set(['Rectangle', 'RoundedRectangle', 'Diamond']);

// 表单形状组的展示顺序:按 Axure 默认组件库的排列习惯(图片→文字→按钮→输入控件→
// 容器→设备→装饰),和 Axure 用户的心智模型保持一致。表里没有的形状保持注册序,
// 稳定排在列出的形状之后。"流程图形状"分组不套用这个顺序(见下方分组逻辑)。
const AXURE_SHAPE_ORDER: string[] = [
    'Image', 'Raster',            // 图片
    'Heading', 'Label', 'Paragraph', // 文字
    'Button', 'Link', 'ButtonBar',   // 按钮/链接
    'RadioButton', 'Checkbox', 'Toggle', // 选择
    'Dropdown', 'ComboBox', 'List',  // 列表
    'TextInput', 'TextArea', 'Numeric', 'Slider', // 输入
    'Progress', 'Tabs',              // 反馈/导航
    'Icon', 'Shape', 'Circle',       // 图形
    'Browser', 'Grid',               // 容器
    'Window', 'WindowsWindow', 'Phone', 'Tablet', // 设备
    'HorizontalLine', 'VerticalLine', 'HorizontalScrollbar', 'VerticalScrollbar', // 线与滚动条
    'Comment',                       // 注释
];

const AXURE_ORDER_INDEX = new Map(AXURE_SHAPE_ORDER.map((name, i) => [name, i]));

// 分组标识(用于折叠状态)。折叠状态持久化到 localStorage 的键。
const GROUP_FLOWCHART = 'flowchart';
const GROUP_FORM = 'form';
const COLLAPSED_STORAGE_KEY = 'xdraft.assetGroups.collapsed';

const keyBuilder = (shape: ShapeInfo, iconWidth: number) => {
    // The icon width is part of the key, because the Grid caches cells module-wide by this key.
    return `${shape.name}-${iconWidth}`;
};

// The icon must stay inside the cell: at most 72px wide and at most 80% of the cell width.
const buildIconSize = (cellWidth: number) => {
    if (cellWidth <= 0) {
        return { width: 72, height: Math.round(72 * 54 / 88) };
    }

    // Quantize to 4px steps to avoid excessive re-renders while resizing.
    const width = Math.max(48, Math.min(72, Math.floor(cellWidth * 0.8 / 4) * 4));

    return { width, height: Math.round(width * 54 / 88) };
};

interface ShapeCellProps {
    // The shape to render.
    shape: ShapeInfo;

    // The size of the preview image.
    iconSize: { width: number; height: number };

    // Adds the shape to the diagram (double click).
    onAdd: (shape: ShapeInfo) => void;
}

// 资产卡片。**整个卡片(含标题)都是拖拽源** —— 拖住标题文字也能把形状放到画布上;
// 卡片同时设置了 user-select: none,避免拖动时把标题当成文本选中。
const ShapeCell = React.memo((props: ShapeCellProps) => {
    const { iconSize, onAdd, shape } = props;

    const [, drag, connectDragPreview] = useDrag({
        item: shape,
        previewOptions: {
            anchorX: 0,
            anchorY: 0,
        },
        type: 'DND_ASSET',
    });

    React.useEffect(() => {
        connectDragPreview(getEmptyImage(), {
            anchorX: 0,
            anchorY: 0,
            captureDraggingState: true,
        });
    }, [connectDragPreview]);

    const doAdd = React.useCallback(() => {
        onAdd(shape);
    }, [onAdd, shape]);

    return (
        <div ref={drag} className='asset-shape' onDoubleClick={doAdd}>
            <div className='asset-shape-image-row'>
                <ShapeImage shape={shape} width={iconSize.width} height={iconSize.height} />
            </div>

            <div className='asset-shape-title'>{shape.displayName}</div>
        </div>
    );
});

interface ShapeGroupProps {
    // The group title.
    title: string;

    // 分组标识,用于 CSS 固定上下顺序(flowchart / form)。
    groupClass: string;

    // The shapes of this group.
    shapes: ShapeInfo[];

    // Whether the group is collapsed.
    collapsed: boolean;

    // Toggles the collapsed state.
    onToggle: () => void;

    // The cell renderer.
    renderCell: (shape: ShapeInfo) => JSX.Element;

    // The key builder for the virtualized grid.
    keyBuilder: (shape: ShapeInfo) => string;
}

// 一个可折叠的形状分组。展开的分组按 flex 比例分高度,折叠后只留标题栏,
// 剩余空间自动让给另一个分组 —— 这样每个 Grid 始终有确定高度,虚拟滚动才能正确测量。
const ShapeGroup = (props: ShapeGroupProps) => {
    const { collapsed, groupClass, keyBuilder, onToggle, renderCell, shapes, title } = props;

    if (shapes.length === 0) {
        return null;
    }

    return (
        <div className={classNames('asset-shapes-group', `asset-shapes-group-${groupClass}`, { 'asset-shapes-group-collapsed': collapsed })}>
            <div className='asset-shapes-group-title' onClick={onToggle}>
                <span className='asset-shapes-group-arrow'>{collapsed ? '▸' : '▾'}</span>

                <span className='asset-shapes-group-name'>{title}</span>

                <span className='asset-shapes-group-count'>{shapes.length}</span>
            </div>

            {!collapsed &&
                <div className='asset-shapes-group-body'>
                    <Grid className='asset-shapes-list' renderer={renderCell} columns={3} rowHeight={114} items={shapes} keyBuilder={keyBuilder} />
                </div>
            }
        </div>
    );
};

export const Shapes = () => {
    const dispatch = useAppDispatch();
    const shapesFiltered = useStore(getFilteredShapes);
    const shapesFilter = useStore(getShapesFilter);
    const store = useReduxStore<AppState>();
    const listRef = React.useRef<HTMLDivElement>(null);
    const { width: listWidth } = useResizeObserver(listRef);

    const [collapsedGroups, setCollapsedGroups] = React.useState<{ [key: string]: boolean }>(() => {
        // 持久化到 localStorage:切到别的面板(图标/大纲/页面)再切回来时保持折叠状态。
        try {
            return JSON.parse(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    });

    const doToggleGroup = useEventCallback((group: string) => {
        setCollapsedGroups(value => {
            const next = { ...value, [group]: !value[group] };

            try {
                window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // 存储不可用时只在本次会话内保持。
            }

            return next;
        });
    });

    const cellSize = listWidth ? Math.floor((listWidth - 1) / 3) : 0;
    const iconSize = React.useMemo(() => buildIconSize(cellSize), [cellSize]);

    const doAdd = useEventCallback((shape: ShapeInfo) => {
        const selectedDiagramId = getDiagramId(store.getState());

        if (selectedDiagramId) {
            dispatch(addShape(selectedDiagramId, shape.name, { position: { x: 100, y: 100 } }));
        }
    });

    const keyBuilderForSize = React.useCallback((shape: ShapeInfo) => {
        return keyBuilder(shape, iconSize.width);
    }, [iconSize.width]);

    const cellRenderer = React.useCallback((shape: ShapeInfo) => {
        return <ShapeCell iconSize={iconSize} onAdd={doAdd} shape={shape} />;
    }, [doAdd, iconSize]);

    // 拆成两个分组:流程图形状 / 表单形状。表单组内按 Axure 组件库顺序排列,
    // 流程图组保持固定顺序(Rectangle → RoundedRectangle → Diamond)不动。
    const { formShapes, flowchartShapes } = React.useMemo(() => {
        const flowchartShapes: ShapeInfo[] = [];
        const formShapes: ShapeInfo[] = [];

        for (const shape of shapesFiltered) {
            if (FLOWCHART_SHAPES.has(shape.name)) {
                flowchartShapes.push(shape);
            } else {
                formShapes.push(shape);
            }
        }

        // Array.prototype.sort 在现代引擎里是稳定排序:AXURE_ORDER_INDEX 里没有的
        // 形状索引为 undefined(Number(undefined)=NaN),比较结果为 0,保持注册序。
        const order = (shape: ShapeInfo) => AXURE_ORDER_INDEX.get(shape.name) ?? Number.MAX_SAFE_INTEGER;

        formShapes.sort((lhs, rhs) => order(lhs) - order(rhs));

        return { flowchartShapes, formShapes };
    }, [shapesFiltered]);

    // 搜索时强制展开 —— 否则命中的形状可能藏在被折叠的分组里。
    const searching = shapesFilter.length > 0;

    const doFilterShapes = useEventCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(filterShapes(event.target.value));
    });

    const doToggleFlowchart = useEventCallback(() => {
        doToggleGroup(GROUP_FLOWCHART);
    });

    const doToggleForm = useEventCallback(() => {
        doToggleGroup(GROUP_FORM);
    });

    return (
        <>
            <div className='asset-shapes-search'>
                <Input value={shapesFilter} onChange={doFilterShapes}
                    placeholder={texts.common.findShape}
                    prefix={
                        <SearchOutlined style={{ color: 'rgba(0,0,0,.25)' }} />
                    } />
            </div>

            <div ref={listRef} className='asset-shapes-list-wrapper'>
                <ShapeGroup
                    collapsed={!searching && !!collapsedGroups[GROUP_FORM]}
                    groupClass='form'
                    keyBuilder={keyBuilderForSize}
                    onToggle={doToggleForm}
                    renderCell={cellRenderer}
                    shapes={formShapes}
                    title={texts.common.formShapes} />

                <ShapeGroup
                    collapsed={!searching && !!collapsedGroups[GROUP_FLOWCHART]}
                    groupClass='flowchart'
                    keyBuilder={keyBuilderForSize}
                    onToggle={doToggleFlowchart}
                    renderCell={cellRenderer}
                    shapes={flowchartShapes}
                    title={texts.common.flowchartShapes} />
            </div>
        </>
    );
};
