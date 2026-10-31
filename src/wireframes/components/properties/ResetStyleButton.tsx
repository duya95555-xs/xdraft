/*
 * xdraft - 恢复默认外观按钮 (1.0.4-5)
 *
 * 选中形状后出现在"视觉"分组的末尾:一键把该形状的外观重置回插件默认值,
 * 同时清除这种形状的"样式记忆"(今后拖入的同类型形状不再套用被记住的风格)。
*/

import { ClearOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { getDiagramId, getSelection, resetItemsAppearance, useStore } from '@app/wireframes/model';

export const ResetStyleButton = () => {
    const dispatch = useAppDispatch();
    const selectedDiagramId = useStore(getDiagramId);
    const selectionSet = useStore(getSelection);

    // 只对"单个形状"开放:多选时各形状类型不同,"默认值"语义模糊。
    const shape = selectionSet.selectedItems.length === 1 ? selectionSet.selectedItems[0] : undefined;

    const doReset = useEventCallback(() => {
        if (selectedDiagramId && shape) {
            dispatch(resetItemsAppearance(selectedDiagramId, selectionSet.selectedItems));
        }
    });

    if (!shape || shape.type !== 'Shape') {
        return null;
    }

    return (
        <div className='property' style={{ padding: '8px 12px' }}>
            <Tooltip title={texts.common.resetStyleTooltip}>
                <Button block icon={<ClearOutlined />} onClick={doReset}>
                    {texts.common.resetStyle}
                </Button>
            </Tooltip>
        </div>
    );
};
