/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { isLeftMouse, isModKey, Rect2, Subscription, Vec2 } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { calculateSelection, Diagram, DiagramItem, DiagramItemSet, PluginRegistry } from '@app/wireframes/model';
import { PreviewEvent } from './preview';

const SELECTION_STROKE_COLOR = '#080';
const SELECTION_STROKE_LOCK_COLOR = '#f00';
const SELECTOR_STROKE_COLOR = '#0a0';

export interface SelectionAdornerProps {
    // The current zoom value.
    zoom: number;

    // The target layer
    layer: EngineLayer;

    // The current engine
    engine: Engine;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The selected items.
    selectionSet: DiagramItemSet;

    // The preview subscription.
    previewStream: Subscription<PreviewEvent>;

    // A function to select a set of items.
    onSelectItems: (diagram: Diagram, itemIds: ReadonlyArray<string>) => any;

    // 手型/连线模式下为 true:选框照常渲染(保持选中态可见),
    // 但不响应任何鼠标操作,不干扰画布平移 / 连线。
    disabled?: boolean;
}

export class SelectionAdorner extends React.Component<SelectionAdornerProps> implements Listener {
    private selectionMarkers: EngineRect[] = [];
    private selectionShape!: EngineRect;
    private dragStart: Vec2 | null = null;

    constructor(props: SelectionAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: SelectionAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }
    
            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.selectionShape = this.props.layer.rect();
            this.selectionShape.fill('#00aa0044');
            this.selectionShape.strokeWidth(1);
            this.selectionShape.strokeColor(SELECTOR_STROKE_COLOR);
            this.selectionShape.hide();
            this.selectionMarkers = [];
        }

        if (this.props.previewStream !== prevProps.previewStream) {
            if (this.props.previewStream) {
                // Use a stream of preview updates to bypass react for performance reasons.
                this.props.previewStream.subscribe(event => {
                    if (event.type === 'Update') {
                        this.markItems(event.items);
                    } else if (event.type === 'Start') {
                        // 变换开始:先收起选框,拖动过程中由 TransformAdorner 接手显示手柄。
                        this.hideMarkers();
                    } else {
                        // 变换结束:此时 props.selectionSet 可能仍是变换前的旧值,
                        // 直接 markItems() 会把选框画在旧位置上并残留下来。
                        // 先收起,等 componentDidUpdate 用新选区重画。
                        this.hideMarkers();
                    }
                });
            }
        }

        this.markItems();
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        // Remove all shapes, otherwise they would stay on the persistent layer as
        // frozen markers whenever the adorner unmounts (e. g. hand mode).
        this.selectionShape?.remove();
        this.selectionMarkers.forEach(s => s.remove());
        this.selectionMarkers = [];
    }

    // 拖动/变换结束时必须由 adorner 自己收起所有选框。
    // previewStream 的 'End' 事件发生在 transformItems 派发之后,但 React 的
    // componentDidUpdate 不一定紧随其后 —— 若两者之间发生任何一次提前 return,
    // 选框就会以"拖动过程中的旧几何"冻结在 adorner 层上(残留绿框)。
    public hideMarkers() {
        this.selectionShape?.hide();
        this.selectionMarkers.forEach(s => s.hide());
    }

    public onMouseDown(event: EngineHitEvent) {
        // 手型/连线模式:不响应鼠标,只保留选框展示。
        if (this.props.disabled) {
            return;
        }

        // 只有左键参与选中/框选(I-02)。引擎对任意按键都会派发 mousedown,
        // 右键(button === 2)若继续往下走,会在这里走完 selectSingle():
        //   点空白 = 返回 [] 清空选区;点组件 = 塌成单选。
        // 而 antd 的右键菜单是在这之后才打开的(EditorView.tsx 的 onContextMenu),
        // 于是"框选之后右键"看到的菜单里 复制 / 剪切 / 复制成图片 / 组合 / 对齐 / 分布 全部置灰。
        // 中键同样在这里退出 —— pan / zoom 由 d3-zoom 直接监听 DOM,不依赖本调用链。
        if (!isLeftMouse(event.source)) {
            return;
        }

        if (!event.source.shiftKey) {
            const selection = this.selectSingle(event, this.props.selectedDiagram);

            this.props.onSelectItems(this.props.selectedDiagram, selection);
        }

        if (!event.object) {
            this.dragStart = event.position;
        }
    }

    public onMouseDrag(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (this.props.disabled || !this.dragStart) {
            next(event);
            return;
        }

        const rect = Rect2.fromVecs([this.dragStart, event.position]);

        this.transformShape(this.selectionShape, new Vec2(rect.x, rect.y), new Vec2(rect.w, rect.h), 0);
                    
        // Use the inverted zoom level as stroke width to have a constant stroke width.
        this.selectionShape.strokeWidth(1 / this.props.zoom);
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (this.props.disabled || !this.dragStart) {
            next(event);
            return;
        }

        try {
            const rect = Rect2.fromVecs([this.dragStart, event.position]);

            if (rect.area < 100) {
                return;
            }

            const selection = this.selectMultiple(rect, this.props.selectedDiagram);

            if (selection) {
                this.props.onSelectItems(this.props.selectedDiagram, selection!);
            }
        } finally {
            this.stopDrag();
        }
    }

    public onBlur(event: FocusEvent, next: (event: FocusEvent) => void) {
        if (this.props.disabled || !this.dragStart) {
            next(event);
            return;
        }

        this.stopDrag();
    }

    private stopDrag() {
        this.selectionShape.hide();

        this.dragStart = null;
    }

    private selectMultiple(rect: Rect2, diagram: Diagram): ReadonlyArray<string> {
        const selectedItems = diagram.rootItems.filter(i => rect.contains(i.bounds(diagram).aabb));

        return calculateSelection(selectedItems, diagram, false);
    }

    private selectSingle(event: EngineHitEvent, diagram: Diagram): ReadonlyArray<string> {
        const isMod = isModKey(event.source);

        if (isMod) {
            event.source.preventDefault();
        }

        if (event.item) {
            return calculateSelection([event.item], diagram, true, isMod);
        } else {
            return [];
        }
    }

    private markItems(preview?: { [id: string]: DiagramItem }) {
        for (const adorner of this.selectionMarkers) {
            adorner.hide();
        }

        const selection = preview ? Object.values(preview) : Array.from(this.props.selectionSet.selection.values());

        // Add more markers if we do not have enough.
        while (this.selectionMarkers.length < selection.length) {
            const marker = this.props.layer.rect();

            this.selectionMarkers.push(marker);
        }

        // Use the inverted zoom level as stroke width.
        const strokeWidth = 1 / this.props.zoom;

        selection.forEach((item, i) => {
            const marker = this.selectionMarkers[i];

            // 连接线等"AABB 远大于实体"的形状不画矩形选框(CONN-009),
            // 否则选中一条斜线会看到一个把下方组件也框住的大矩形。
            const plugin = PluginRegistry.get(item.renderer)?.plugin;

            if (plugin?.showSelectionBounds?.() === false) {
                marker.hide();
                return;
            }

            const color =
                item.isLocked ?
                    SELECTION_STROKE_LOCK_COLOR :
                    SELECTION_STROKE_COLOR;
                    
            // Use the inverted zoom level as stroke width to have a constant stroke style.
            marker.strokeWidth(strokeWidth);
            marker.strokeColor(color);
            marker.fill('none');
            
            const actualItem = item;
            const actualBounds = actualItem.bounds(this.props.selectedDiagram);

            // Also adjust the bounds by the border width, to show the border outside of the shape.
            this.transformShape(marker, actualBounds.position.sub(actualBounds.halfSize), actualBounds.size, 0, actualBounds.rotation.degree);
        });
    }

    protected transformShape(shape: EngineRect, position: Vec2, size: Vec2, offset: number, rotation = 0) {
        // 退化尺寸(框选拖拽刚开始、或选区被清空时 size 为 0)必须 hide 而不是只跳过 show:
        // plot() 已经把上一次的几何改成 0×0,若此时不 hide,图元会保留"上一帧的可见状态"
        // 并以异常几何留在 adorner 层上 —— 表现为拖动组件后残留一个绿框。
        if (size.x <= 2 || size.y <= 2) {
            shape.hide();
            return;
        }

        shape.plot({
            x: position.x - 0.5 * offset,
            y: position.y - 0.5 * offset,
            w: size.x + offset,
            h: size.y + offset,
            rotation,
        });

        shape.show();
    }

    public render(): any {
        return null;
    }
}
