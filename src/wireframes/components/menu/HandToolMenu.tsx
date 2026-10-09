/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { DragOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import * as React from 'react';
import { texts } from '@app/texts';

export interface HandToolMenuProps {
    // True when the hand tool is active.
    active: boolean;

    // Called when the hand tool is toggled.
    onToggle: () => void;
}

export const HandToolMenu = React.memo((props: HandToolMenuProps) => {
    const { active, onToggle } = props;

    return (
        <Tooltip mouseEnterDelay={1} title={texts.common.handToolTooltip}>
            <Button
                className={active ? undefined : 'menu-item'}
                icon={<DragOutlined />}
                onClick={onToggle}
                size='large'
                title={texts.common.handTool}
                type={active ? 'primary' : 'text'} />
        </Tooltip>
    );
});
