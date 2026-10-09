/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as svg from '@svgdotjs/svg.js';
import * as React from 'react';
import { CanvasProps } from '../../canvas';
import { SvgEngine } from './../engine';

export const SvgCanvasView = (props: CanvasProps<SvgEngine>) => {
    const {
        className,
        onInit,
        style,
        viewBox,
    } = props;

    const [engine, setEngine] = React.useState<SvgEngine>();

    const doInit = React.useCallback((ref: HTMLDivElement) => {
        if (!ref) {
            return;
        }

        const doc = svg.SVG().addTo(ref).css({ position: 'relative', overflow: 'visible' }).attr('tabindex', 0);

        setEngine(new SvgEngine(doc));
    }, []);

    React.useEffect(() => {
        if (engine && onInit) {
            onInit(engine);
        }
    }, [engine, onInit]);

    // 卸载时必须 dispose 引擎:SvgEngine 在 window/document 上挂了全局监听,
    // 不清理的话每销毁一个 SvgCanvasView(资产面板切 tab / 拖动预览结束)就泄漏一套。
    React.useEffect(() => {
        return () => {
            engine?.dispose();
        };
    }, [engine]);

    React.useEffect(() => {
        if (!engine) {
            return;
        }

        if (viewBox) {
            engine.doc.viewbox(viewBox.minX, viewBox.minY, viewBox.maxX, viewBox.maxY);
        } else {
            engine.doc.viewbox(null!);
        }

    }, [engine, viewBox]);

    return (
        <div style={style} className={className} ref={doInit} />
    );
};
