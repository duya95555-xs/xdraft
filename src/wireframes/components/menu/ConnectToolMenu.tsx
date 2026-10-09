/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ApartmentOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import * as React from 'react';
import { texts } from '@app/texts';

export interface ConnectToolMenuProps {
    // True when the connect tool is active.
    active: boolean;

    // Called when the connect tool is toggled.
    onToggle: () => void;
}

export const ConnectToolMenu = React.memo((props: ConnectToolMenuProps) => {
    const { active, onToggle } = props;

    return (
        <Tooltip mouseEnterDelay={1} title={texts.common.connectToolTooltip}>
            <Button
                className={active ? undefined : 'menu-item'}
                icon={<ApartmentOutlined />}
                onClick={onToggle}
                size='large'
                title={texts.common.connectTool}
                type={active ? 'primary' : 'text'} />
        </Tooltip>
    );
});
