/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import * as React from 'react';
import { IconInfo } from '@app/wireframes/model';

interface IconProps {
    // The icon data.
    icon: IconInfo;
}

// 纯展示组件:拖拽源在卡片上(IconCell),这里只负责把图标字形画出来。
export const Icon = React.memo((props: IconProps) => {
    const { icon } = props;

    return (
        <i className={icon.fontClass}>{icon.text}</i>
    );
});
