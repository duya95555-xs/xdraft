/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { useDragLayer, XYCoord } from 'react-dnd';
import { DefaultAppearance, ShapePlugin } from '@app/wireframes/interface';
import { getViewBox, ShapeRenderer } from './../shapes/ShapeRenderer';
import './CustomDragLayer.scss';

export const CustomDragLayer = () => {
    const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
        currentOffset: monitor.getClientOffset(),
        isDragging: monitor.isDragging(),
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
    }));

    function renderItem() {
        switch (itemType) {
            case 'DND_ASSET':
                const plugin = item['plugin'] as ShapePlugin;

                return (
                    <div style={getItemStyles(currentOffset, plugin)}>
                        <ShapeRenderer plugin={plugin} appearance={getVisibleAppearance(plugin)} />
                    </div>
                );
            default:
                return null;
        }
    }

    // 拖动预览的可见性兜底:
    // 部分组件(如某些图标/占位图形)默认前景色为纯白,在浅色画布上几乎看不见。
    // 预览时把纯白前景换成中灰;同时不强行加边框,避免改变组件本来的外观。
    function getVisibleAppearance(plugin: ShapePlugin) {
        const defaults = plugin.defaultAppearance();

        if (defaults[DefaultAppearance.FOREGROUND_COLOR] === 0xFFFFFF) {
            return { [DefaultAppearance.FOREGROUND_COLOR]: 0x666666 };
        }

        return undefined;
    }
    
    if (!isDragging) {
        return null;
    }

    return (
        <div className='drag-layer'>
            {renderItem()}
        </div>
    );
};

// 预览锚点用「鼠标指针位置」而不是「拖拽源元素左上角」:
// 拖拽源现在是整张资产卡片(含标题),继续用源左上角会让预览随卡片尺寸漂移。
// 这样「预览图形左上角」与「形状实际落点」严格重合,所见即所得。
function getItemStyles(currentOffset: XYCoord | null, plugin: ShapePlugin) {
    if (!currentOffset) {
        return { display: 'none' };
    }
  
    const transform = `translate(${currentOffset.x}px, ${currentOffset.y}px)`;

    const { size } = getViewBox(plugin);

    // 分离感用 outline 而不用 drop-shadow filter:filter 会创建独立合成层,
    // 在 Edge/Chrome 里与 SVG 叠加时偶发"描边不重绘"的显示残留,切窗口才恢复。
    return { transform, WebkitTransform: transform, width: size.x, height: size.y, outline: '1px solid rgba(0, 0, 0, 0.18)' };
}
