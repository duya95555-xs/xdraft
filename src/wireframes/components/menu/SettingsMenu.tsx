/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { CheckOutlined, ExportOutlined, GlobalOutlined, PrinterOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { MenuProps } from 'antd/lib';
import * as React from 'react';
import { getLanguage, languageNames, LanguageKey, setLanguage, texts } from '@app/texts';

export interface SettingsMenuProps {
    // The print callback.
    onPrint: () => void;
}

export const SettingsMenu = React.memo((props: SettingsMenuProps) => {
    const { onPrint } = props;

    const exportMenuItems: MenuProps['items'] = [
        {
            key: 'print',
            icon: <PrinterOutlined />,
            label: texts.common.printDiagrams,
            onClick: onPrint,
        },
    ];

    const language = getLanguage();

    const languageMenuItems: MenuProps['items'] =
        (Object.keys(languageNames) as LanguageKey[]).map(key => ({
            key,
            icon: key === language ? <CheckOutlined /> : <span style={{ display: 'inline-block', width: 14 }} />,
            label: languageNames[key],
            onClick: () => {
                if (key !== language) {
                    setLanguage(key);
                    location.reload();
                }
            },
        }));

    return (
        <>
            <Dropdown menu={{ items: languageMenuItems }} placement='bottomRight'>
                <Button className='menu-item' size='large' title={texts.common.language}>
                    <GlobalOutlined />
                </Button>
            </Dropdown>
            <Dropdown menu={{ items: exportMenuItems }} placement='bottomRight'>
                <Button className='menu-item' size='large'>
                    <ExportOutlined />
                </Button>
            </Dropdown>
        </>
    );
});
