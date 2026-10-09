/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { SearchOutlined } from '@ant-design/icons';
import { Input, Select } from 'antd';
import * as React from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useStore as useReduxStore } from 'react-redux';
import { Grid, useEventCallback } from '@app/core';
import { AppState, useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { addShape, filterIcons, getDiagramId, getFilteredIcons, getIconSet, getIconSets, getIconsFilter, IconInfo, PluginRegistry, selectIcons, useStore } from '@app/wireframes/model';
import { Icon } from './Icon';
import './Icons.scss';

// 图标网格列数。刻意保持 5 列(比形状页的 3 列密):
// 图标是单个字形,视觉重量远小于形状,5 列更符合图标浏览习惯。
const ICON_COLUMNS = 5;

// 单行高度。必须传入 Grid,否则 Grid 会退化成"正方形格子"(rowHeight = cellSize),
// 行高随容器宽度浮动,滚动区测量与卡片边线都会跟着抖。
// 取值口径与形状页的 114 一致:预览区 + 标题行 + 上下边线。
const ICON_ROW_HEIGHT = 96;

// key 只用到图标身份,不需要拼格子宽度。
//
// 对照形状页:那边 key 里拼了 iconWidth,是因为 ShapeImage 把 width/height 当 props,
// 内容和格子宽度强相关 —— 而 Grid 的单元格缓存是**模块级全局字典**
// (见 core/react/Grid.tsx 的 `const cache`)且永不清理,key 不带宽度就会复用旧尺寸的卡片。
//
// 图标页刻意不做那套自适应:预览字号固定 28px、行高固定,卡片内容与容器宽度无关,
// 所以 key 也不该带宽度 —— 否则每次拖侧边栏都会生成一整批新 key,
// 把全局缓存越撑越大,而渲染结果其实完全一样。
const keyBuilder = (icon: IconInfo) => {
    return icon.name;
};

interface IconCellProps {
    // The icon to render.
    icon: IconInfo;

    // Adds the icon to the diagram (double click).
    onAdd: (icon: IconInfo) => void;
}

// 资产卡片。**整个卡片(含标题)都是拖拽源** —— 拖住标题文字也能把图标放到画布上;
// 卡片设置了 user-select: none,避免拖动时把标题当成文本选中。
//
// 结构与形状页的 ShapeCell 一一对应(外层卡片 → 预览行 → 标题),
// 这样两页的边线划分、标题行高、拖拽行为完全一致。
const IconCell = React.memo((props: IconCellProps) => {
    const { icon, onAdd } = props;

    const [, drag, connectDragPreview] = useDrag({
        item: { text: icon.text, fontFamily: icon.fontFamily },
        type: 'DND_ICON',
    });

    // 用"空图"作为拖拽预览,避免浏览器默认的"元素半透明截图"跟着鼠标跑。
    // 与形状页保持一致(DND_ASSET 侧同样是 getEmptyImage)。
    React.useEffect(() => {
        connectDragPreview(getEmptyImage(), {
            anchorX: 0,
            anchorY: 0,
            captureDraggingState: true,
        });
    }, [connectDragPreview]);

    const doAdd = React.useCallback(() => {
        onAdd(icon);
    }, [icon, onAdd]);

    return (
        <div ref={drag} className='asset-icon' onDoubleClick={doAdd}>
            <div className='asset-icon-preview'>
                <Icon icon={icon} />
            </div>

            <div className='asset-icon-title'>{icon.displayName}</div>
        </div>
    );
});

export const Icons = React.memo(() => {
    const dispatch = useAppDispatch();
    const iconSet = useStore(getIconSet);
    const iconSets = useStore(getIconSets);
    const iconsFilter = useStore(getIconsFilter);
    const iconsFiltered = useStore(getFilteredIcons);
    const store = useReduxStore<AppState>();

    const doAdd = useEventCallback((icon: IconInfo) => {
        const selectedDiagramId = getDiagramId(store.getState() as any);

        if (selectedDiagramId) {
            const shapes = PluginRegistry.createShapes([{ type: 'Icon', ...icon }]);

            for (const { size, appearance, renderer } of shapes) {
                dispatch(addShape(selectedDiagramId, renderer, { position: { x: 100, y: 100 }, size, appearance }));
            }
        }
    });

    const cellRenderer = React.useCallback((icon: IconInfo) => {
        return <IconCell icon={icon} onAdd={doAdd} />;
    }, [doAdd]);

    const doFilterIcons = useEventCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(filterIcons(event.target.value));
    });

    const doSelectIcons = useEventCallback((iconSet: string) => {
        dispatch(selectIcons(iconSet));
    });

    return (
        <>
            <div className='asset-icons-search'>
                <Input value={iconsFilter} onChange={doFilterIcons}
                    placeholder={texts.common.findIcon}
                    prefix={
                        <SearchOutlined style={{ color: 'rgba(0,0,0,.25)' }} />
                    }
                />

                <Select value={iconSet} onChange={doSelectIcons}>
                    {iconSets.map(x =>
                        <Select.Option key={x} value={x}>{x}</Select.Option>,
                    )}
                </Select>
            </div>

            {/* wrapper 负责 flex 链:让下面的 Grid 拿到"确定高度",虚拟滚动才能正确测量。
                形状页有同名的 list-wrapper,这里对齐同一结构。 */}
            <div className='asset-icons-list-wrapper'>
                <Grid className='asset-icons-list' renderer={cellRenderer} columns={ICON_COLUMNS}
                    rowHeight={ICON_ROW_HEIGHT} items={iconsFiltered} keyBuilder={keyBuilder} />
            </div>
        </>
    );
});

