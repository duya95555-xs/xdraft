/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

/* eslint-disable react-hooks/exhaustive-deps */

import * as React from 'react';
import { Color, ImmutableMap, Rect2, Subscription, Vec2, ViewBox } from '@app/core';
import { Engine, EngineLayer, EngineRect } from '@app/wireframes/engine';
import { PixiCanvasView } from '@app/wireframes/engine/pixi/canvas/PixiCanvas';
import { SvgCanvasView } from '@app/wireframes/engine/svg/canvas/SvgCanvas';
import { Diagram, DiagramItem, DiagramItemSet, Transform } from '@app/wireframes/model';
import { Side } from '@app/wireframes/shapes/neutral/_connector-routing';
import { useOverlayContext } from './../contexts/OverlayContext';
import { ItemsLayer } from './ItemsLayer';
import { CropAdorner } from './CropAdorner';
import { ConnectorAdorner } from './ConnectorAdorner';
import { ConnectorAnchorAdorner } from './ConnectorAnchorAdorner';
import { HitAdorner } from './HitAdorner';
import { NavigateAdorner } from './NavigateAdorner';
import { QuickbarAdorner } from './QuickbarAdorner';
import { RadiusAdorner } from './RadiusAdorner';
import { SelectionAdorner } from './SelectionAdorner';
import { SplitAdorner } from './SplitAdorner';
import { TextAdorner } from './TextAdorner';
import { TransformAdorner } from './TransformAdorner';
import { InteractionOverlays } from './interaction-overlays'; 
import { PreviewEvent } from './preview';
import './Editor.scss';

export interface EditorProps {
    // The selected diagram.
    diagram: Diagram;

    // All diagrams.
    diagrams: ImmutableMap<Diagram>;

    // The selected items.
    selectionSet: DiagramItemSet;

    // The color.
    color: Color;

    // The viewbox.
    viewBox: ViewBox;

    // The view size.
    viewSize: Vec2;

    // Use WebGL renderer.
    useWebGL?: boolean;

    // True, if it is the default view.
    isDefaultView: boolean;

    // True when rendered.
    onRender?: () => void;

    // A function to select a set of items.
    onSelectItems?: (diagram: Diagram, itemIds: ReadonlyArray<string>) => any;

    // A function to change the appearance of a visual.
    onChangeItemsAppearance?: (diagram: Diagram, visuals: ReadonlyArray<DiagramItem>, key: string, val: any) => any;

    // A function that is invoked when the user clicked a link.
    onNavigate?: (item: DiagramItem, link: string) => void;

    // A function to transform a set of items.
    onTransformItems?: (diagram: Diagram, items: ReadonlyArray<DiagramItem>, oldBounds: Transform, newBounds: Transform) => any;

    // 写回连接线的固定途经点(拐点拖拽,FR-6)。
    onSetConnectorWaypoints?: (diagram: Diagram, item: DiagramItem, waypoints: ReadonlyArray<{ x: number; y: number }>) => any;

    // 端点改接(C1):把连线的一端改接到另一个组件上。
    onReconnectConnector?: (diagram: Diagram, item: DiagramItem, end: 'source' | 'target', target: DiagramItem, point: { x: number; y: number }) => any;

    // The image item that is currently cropped. Null when the crop mode is inactive.
    cropItem?: DiagramItem | null;

    // Invoked when the user has finished a valid crop selection.
    onCrop?: (item: DiagramItem, relCrop: string, cropRect: Rect2) => void;

    // Invoked when the user cancels the crop mode.
    onCancelCrop?: () => void;

    // The image item that is currently in split mode. Null when the split mode is inactive.
    splitItem?: DiagramItem | null;

    // True when the connect mode is active.
    connectMode?: boolean;

    // 连线模式下鼠标悬停的组件(C2 锚点提示用)。
    connectHoverItem?: DiagramItem | null;

    // 连线模式下鼠标悬停的锚点边(C2 锚点提示用)。
    connectHoverSide?: Side | null;

    // 连线模式下锚点悬停变化时回调(C2)。
    onConnectHoverAnchor?: (side: Side | null) => void;

    // Invoked when the user has clicked a valid split position.
    onSplit?: (item: DiagramItem, point: Vec2) => void;

    // Invoked when the user cancels the split mode.
    onCancelSplit?: () => void;

    // Records the last hit item for context menu interactions.
    hitItem?: React.MutableRefObject<DiagramItem | null>;

    // 手型 / 连线模式下为 true:选框与手柄保持渲染(选中态可见),
    // 但 adorner 不响应鼠标/键盘,不干扰平移 / 连线。
    interactionDisabled?: boolean;
}

type Layers = {
    adornerCropLayer: EngineLayer;
    adornerSelectLayer: EngineLayer;
    adornerTransformLayer: EngineLayer;
    backgroundRect: EngineRect;
    engine: Engine;
    overlayLayer: EngineLayer;
    renderMainLayer: EngineLayer;
    renderMasterLayer: EngineLayer;
};

export interface EditorHandle {
    // Opens the inline text editor for the given item (e. g. triggered by the F2 shortcut).
    editItem(item: DiagramItem): void;
}

export const Editor = React.memo(React.forwardRef<EditorHandle, EditorProps>((props, ref) => {
    const {
        color,
        cropItem,
        diagram,
        diagrams,
        isDefaultView,
        onCancelCrop,
        onCancelSplit,
        onChangeItemsAppearance,
        onCrop,
        onNavigate,
        onRender,
        onSelectItems,
        onSplit,
        onTransformItems,
        selectionSet,
        viewBox,
        viewSize,
        useWebGL,
    } = props;

    const [layers, setLayers] = React.useState<Layers>();
    const renderWebGL = React.useRef(useWebGL);
    const renderPreview = React.useRef(new Subscription<PreviewEvent>());
    const textAdornerRef = React.useRef<TextAdorner | null>(null);

    // Expose the text editing to the outside, so that shortcuts can trigger it.
    React.useImperativeHandle(ref, () => ({
        editItem: (item: DiagramItem) => {
            textAdornerRef.current?.editItem(item);
        },
    }), []);
    const overlayContext = useOverlayContext();
    const masterDiagrams = React.useMemo(() => diagram.masterDiagrams(diagrams), [diagram, diagrams]);
    
    const doInit = React.useCallback((engine: Engine) => {
        // Might be called multiple times in dev mode!
        if (!engine) {
            return;
        }

        // Create these layers in the correct order.
        const backgroundRect = engine.layer('background').rect();
        backgroundRect.disable();
        backgroundRect.fill(color.toString());
        backgroundRect.strokeWidth(1);
        backgroundRect.strokeColor('#efefef');

        const renderMasterLayer = engine.layer('masterLayer');
        const renderMainLayer = engine.layer('mainLayer');
        const overlayLayer = engine.layer('overlaysLayer');
        const adornerSelectLayer = engine.layer('selectLayer');
        const adornerTransformLayer = engine.layer('transformLayer');
        const adornerCropLayer = engine.layer('cropLayer');

        engine.setClickLayer(renderMainLayer);

        if (isDefaultView) {
            overlayContext.overlayManager = new InteractionOverlays(overlayLayer);
        }

        setLayers({
            adornerCropLayer,
            adornerSelectLayer,
            adornerTransformLayer,
            backgroundRect,
            engine,
            overlayLayer,
            renderMainLayer,
            renderMasterLayer,
        });
    }, []);

    React.useEffect(() => {
        layers?.backgroundRect?.plot({ x: 0, y: 0, w: viewSize.x, h: viewSize.y });
    }, [layers, viewSize]);

    React.useEffect(() => {
        layers?.backgroundRect?.fill(color.toString());
    }, [layers, color]);

    React.useEffect(() => {
        overlayContext.snapManager.prepare(diagram, viewSize);
    }, [diagram, overlayContext.snapManager, viewSize]);
    
    React.useEffect(() => {
        (overlayContext.overlayManager as any)['setZoom']?.(viewBox.zoom);
    }, [diagram, overlayContext.overlayManager, viewBox.zoom]);

    const showAdorners = React.useCallback(() => {
        layers?.adornerSelectLayer.show();
        layers?.adornerTransformLayer.show();
    }, []);

    const hideAdorners = React.useCallback(() => {
        layers?.adornerSelectLayer.hide();
        layers?.adornerTransformLayer.hide();
    }, []);

    return (
        <div className='editor' ref={element => overlayContext.element = element}>
            {renderWebGL.current ? (
                <div className='pixi'>
                    <PixiCanvasView onInit={doInit} viewBox={viewBox} background='#f0f2f5' />
                </div>
            ) : (
                <SvgCanvasView onInit={doInit} viewBox={viewBox} />
            )}

            {diagram && layers && (
                <>
                    <ItemsLayer
                        diagrams={masterDiagrams}
                        diagramLayer={layers.renderMasterLayer}
                        onRender={onRender}
                    />

                    <ItemsLayer
                        diagrams={[diagram]}
                        diagramLayer={layers.renderMainLayer}
                        preview={renderPreview.current}
                        onRender={onRender}
                    />

                    {props.hitItem &&
                        <HitAdorner
                            engine={layers.engine}
                            hitItem={props.hitItem}
                        />
                    }

                    {onCrop &&
                        <CropAdorner
                            cropItem={cropItem ?? null}
                            engine={layers.engine}
                            layer={layers.adornerCropLayer}
                            onCancel={onCancelCrop!}
                            onCrop={onCrop}
                            overlayManager={overlayContext.overlayManager}
                            selectedDiagram={diagram}
                            viewBox={viewBox}
                            viewSize={viewSize}
                            zoom={viewBox.zoom}
                        />
                    }

                    {onSplit &&
                        <SplitAdorner
                            engine={layers.engine}
                            layer={layers.adornerCropLayer}
                            onCancel={onCancelSplit!}
                            onSplit={onSplit}
                            overlayManager={overlayContext.overlayManager}
                            selectedDiagram={diagram}
                            splitItem={props.splitItem ?? null}
                            viewBox={viewBox}
                            viewSize={viewSize}
                            zoom={viewBox.zoom}
                        />
                    }

                    {props.connectMode &&
                        <ConnectorAnchorAdorner
                            engine={layers.engine}
                            hoverItem={props.connectHoverItem ?? null}
                            hoverSide={props.connectHoverSide ?? null}
                            layer={layers.adornerCropLayer}
                            onHoverAnchor={props.onConnectHoverAnchor}
                            selectedDiagram={diagram}
                            zoom={viewBox.zoom}
                        />
                    }

                    {(props.onSetConnectorWaypoints || props.onReconnectConnector) &&
                        <ConnectorAdorner
                            engine={layers.engine}
                            layer={layers.adornerCropLayer}
                            onReconnectConnector={props.onReconnectConnector}
                            onSetConnectorWaypoints={props.onSetConnectorWaypoints}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            zoom={viewBox.zoom}
                        />
                    }

                    {onChangeItemsAppearance &&
                        <RadiusAdorner
                            disabled={props.interactionDisabled}
                            engine={layers.engine}
                            layer={layers.adornerCropLayer}
                            onChangeItemsAppearance={onChangeItemsAppearance}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            zoom={viewBox.zoom}
                        />
                    }

                    {onTransformItems &&
                        <TransformAdorner
                            cropActive={!!cropItem}
                            disabled={props.interactionDisabled}
                            engine={layers.engine}
                            layer={layers.adornerTransformLayer}
                            mainLayer={layers.renderMainLayer}
                            onSelectItems={onSelectItems}
                            onTransformItems={onTransformItems}
                            overlayManager={overlayContext.overlayManager}
                            previewStream={renderPreview.current}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            snapManager={overlayContext.snapManager}
                            viewSize={viewSize}
                            zoom={viewBox.zoom}
                        />
                    }

                    {onSelectItems &&
                        <SelectionAdorner
                            disabled={props.interactionDisabled}
                            engine={layers.engine}
                            layer={layers.adornerSelectLayer}
                            onSelectItems={onSelectItems}
                            previewStream={renderPreview.current}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            zoom={viewBox.zoom}
                        />
                    }

                    {onChangeItemsAppearance &&
                        <TextAdorner
                            ref={textAdornerRef}
                            engine={layers.engine}
                            hideAdorners={hideAdorners}
                            onChangeItemsAppearance={onChangeItemsAppearance}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            showAdorners={showAdorners}
                            viewBox={viewBox}
                        />
                    }

                    {onTransformItems && !props.interactionDisabled &&
                        <QuickbarAdorner
                            previewStream={renderPreview.current}
                            selectedDiagram={diagram}
                            selectionSet={selectionSet}
                            viewBox={viewBox}
                        />
                    }

                    {onNavigate &&
                        <NavigateAdorner engine={layers.engine} onNavigate={onNavigate} />
                    }
                </>
            )}
        </div>
    );
}));
