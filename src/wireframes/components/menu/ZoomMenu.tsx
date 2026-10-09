/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { MinusCircleOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import * as React from 'react';
import { Shortcut } from '@app/core';
import { texts } from '@app/texts';

export interface ZoomMenuProps {
    // Zooms the canvas in, anchored at the viewport center.
    onZoomIn: () => void;

    // Zooms the canvas out, anchored at the viewport center.
    onZoomOut: () => void;
}

export const ZoomMenu = React.memo((props: ZoomMenuProps) => {
    const { onZoomIn, onZoomOut } = props;

    return (
        <>
            {/* Alt + Minus zooms out. The different bindings cover the main keyboard and the numpad. */}
            <Shortcut onPressed={onZoomOut} keys='alt+-' />
            <Shortcut onPressed={onZoomIn} keys='alt+=' />
            <Shortcut onPressed={onZoomIn} keys='alt+shift+=' />
            <Shortcut onPressed={onZoomIn} keys='alt+plus' />

            <Tooltip mouseEnterDelay={1} title={texts.common.zoomOut}>
                <Button
                    className='menu-item'
                    icon={<MinusCircleOutlined />}
                    onClick={onZoomOut}
                    size='large'
                    title={texts.common.zoomOut}
                    type='text' />
            </Tooltip>

            <Tooltip mouseEnterDelay={1} title={texts.common.zoomIn}>
                <Button
                    className='menu-item'
                    icon={<PlusCircleOutlined />}
                    onClick={onZoomIn}
                    size='large'
                    title={texts.common.zoomIn}
                    type='text' />
            </Tooltip>
        </>
    );
});
