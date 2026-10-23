/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Button, Input } from 'antd';
import * as React from 'react';
import { useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { getSelection, Serializer, showToast, useStore } from '@app/wireframes/model';

// 与 use-clipboard 的粘贴前缀保持一致: 以该前缀开头的文本被粘贴到画布时,
// 会反序列化成图元 —— 右侧面板展示的"代码"正是这种可以直接再生图元的格式。
const PREFIX = 'my-draft:';

// 右侧属性面板的「代码」分组: 展示当前选中图元的可粘贴代码(my-draft:{...})。
// 复制后在画布上 Ctrl+V 即可在别处生成一模一样的图元(含外观与相对位置)。
export const ShapeCode = React.memo(() => {
    const dispatch = useAppDispatch();
    const selectionSet = useStore(getSelection);

    const code = React.useMemo(() => {
        if (selectionSet.selectedItems.length === 0) {
            return '';
        }

        return PREFIX + JSON.stringify(Serializer.serializeSet(selectionSet), undefined, 2);
    }, [selectionSet]);

    const doCopy = useEventCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);

            dispatch(showToast(texts.common.shapeCodeCopied, 'success'));
        } catch {
            dispatch(showToast(texts.common.shapeCodeCopyFailed, 'error'));
        }
    });

    if (selectionSet.selectedItems.length === 0) {
        return null;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', rowGap: 8 }}>
            <Input.TextArea
                readOnly
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                value={code} />
            <Button block onClick={doCopy}>
                {texts.common.copy}
            </Button>
        </div>
    );
});
