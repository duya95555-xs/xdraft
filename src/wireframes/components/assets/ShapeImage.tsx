/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import * as React from 'react';
import { ShapeInfo } from '@app/wireframes/model';
import { ShapeRenderer } from '@app/wireframes/shapes/ShapeRenderer';

interface ShapeImageProps {
    // The shape data.
    shape: ShapeInfo;

    // The optional desired width. Defaults to DESIRED_WIDTH.
    width?: number;

    // The optional desired height. Defaults to DESIRED_HEIGHT.
    height?: number;
}

const DESIRED_WIDTH = 88;
const DESIRED_HEIGHT = 54;

// 纯展示组件:拖拽源在卡片上(ShapeCell),这里只负责把形状画出来。
export const ShapeImage = React.memo((props: ShapeImageProps) => {
    const { height, shape, width } = props;

    return (
        <div className='asset-shape-image'>
            <ShapeRenderer
                desiredHeight={height || DESIRED_HEIGHT}
                desiredWidth={width || DESIRED_WIDTH}
                plugin={shape.plugin}
                usePreviewOffset
                usePreviewSize
            />
        </div>
    );
});
