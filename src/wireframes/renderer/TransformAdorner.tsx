/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { isLeftMouse, Rotation, Subscription, Timer, Vec2 } from '@app/core';
import { Engine, EngineHitEvent, EngineLayer, EngineMouseEvent, EngineRect, Listener } from '@app/wireframes/engine';
import { ASPECT_RATIO, applyAspectRatio, calculateSelection, Diagram, DiagramItem, DiagramItemSet, parseAspectRatio, SnapManager, SnapMode, Transform } from '@app/wireframes/model';
import { texts } from '@app/texts';
import { OverlayManager } from './../contexts/OverlayContext';
import { PreviewEvent } from './preview';

enum Mode { None, Resize, Move, Rotate }

const DEBUG_SIDES = false;
const DEBUG_DISTANCES = false;

const TRANSFORMER_STROKE_COLOR = '#080';
const TRANSFORMER_FILL_COLOR = '#0f0';

export interface TransformAdornerProps {
    // The current zoom value.
    zoom: number;

    // The view size of the editor.
    viewSize: Vec2;

    // The current engine.
    engine: Engine;

    // The adorner scope.
    layer: EngineLayer;

    // 主图层(真正渲染组件的那一层)。
    // 用于在 event.item 拿不到的时候,用几何命中补出"被点中的那一个组件" ——
    // 详见 onMouseDown 里 moveShape 分支的说明。
    mainLayer?: EngineLayer;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The selected items.
    selectionSet: DiagramItemSet;

    // The snap manager.
    snapManager: SnapManager;

    // The overlay manager.
    overlayManager: OverlayManager;

    // The preview subscription.
    previewStream: Subscription<PreviewEvent>;

    // A function to transform a set of items.
    onTransformItems: (diagram: Diagram, items: ReadonlyArray<DiagramItem>, oldBounds: Transform, newBounds: Transform) => void;

    // True when the crop mode is active; the transform handles are hidden then.
    cropActive?: boolean;

    // 手型/连线模式下为 true:选框与手柄照常渲染(保持选中态可见),
    // 但一切鼠标/键盘操作直接放行,不干扰画布平移 / 连线。
    disabled?: boolean;

    // 单击"已经处于选中状态"的组件时,把选区收敛到被点中的那一个。
    //
    // 为什么必须由本 adorner 来做:点击落在选区包围盒内部时,mousedown 会被
    // moveShape 命中,本 adorner 直接进入 Move 模式并**不调用 next(event)**,
    // SelectionAdorner 完全没有机会重算选区。若此后鼠标没有产生任何位移(纯单击),
    // onMouseUp 里 `!manipulated` 又会直接 return —— 于是"多选状态下单击其中一个"
    // 永远收敛不了。表现就是第五轮第 6 条:分割成 4 块后单击某个 tile,4 块仍然
    // 全都处于选中状态,4 个相邻外框拼起来在视觉上和"整张图被选中"一模一样。
    onSelectItems?: (diagram: Diagram, itemIds: ReadonlyArray<string>) => any;
}

const DRAG_SIZE = 12;

// 「单击」与「拖拽」的区分阈值(屏幕像素)。
//
// 原实现只要鼠标位移不为零就 manipulated = true。鼠标在按下与抬起之间的 1px 抖动
// 于是被当成一次拖拽:onMouseUp 走 onTransformItems 分支,选区不收敛 ——
// 表现就是"分割后单击某个 tile,第一下点不中、第二下才行"(第五轮第 6 条)。
// 换算成图形坐标时要除以 zoom,保证不同缩放下手感一致。
const CLICK_DRAG_THRESHOLD_PX = 3;

export class TransformAdorner extends React.PureComponent<TransformAdornerProps> implements Listener {
    private allElements: EngineRect[] = [];
    private aspectLockRatio: number | null = null;
    private canResizeX = false;
    private canResizeY = false;
    private manipulated = false;
    private manipulationMode = Mode.None;
    private manipulationOffset = Vec2.ZERO;
    private moveShape: EngineRect = null!;
    private moveTimer?: Timer | null;
    private resizeShapes: EngineRect[] = [];
    private rotateShape: EngineRect = null!;
    private rotation = Rotation.ZERO;
    private startPosition = Vec2.ZERO;
    private startTransform = Transform.ZERO;
    private transform = Transform.ZERO;
    private clickItem: DiagramItem | null = null;
    private clickShift = false;

    // 本次按压是否已经真的拖动了(超过 CLICK_DRAG_THRESHOLD_PX)。
    //
    // ⚠️ 为什么不能用 `manipulated` 判"是否只是单击":componentDidUpdate() 会把
    // `manipulated` 重置为 false(那是为了清掉上一轮残留的手柄),只要在按下与抬起
    // 之间发生过一次带新 props 的重渲染,这个值就不可信了。本字段只在
    // startManipulation / stopTransform 里复位,中途不被动过。
    private dragMoved = false;

    constructor(props: TransformAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidUpdate(prevProps: TransformAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }
    
            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }

            this.createRotateShape();
            this.createMoveShape();
            this.createResizeShapes();
            this.allElements = [...this.resizeShapes, this.moveShape, this.rotateShape];
            this.hideShapes();
        }

        if (this.props.selectedDiagram.selectedIds !== prevProps.selectedDiagram?.selectedIds) {
            this.rotation = Rotation.ZERO;
        }

        // 上一次拖拽结束时留下了"正在操作"的标记,必须连带把这一轮的临时手柄清掉 ——
        // 拖动过程中 TransformAdorner 的手柄会跟着鼠标走,而 transformItems 派发后
        // React 若因为其他原因跳过了本次更新(PureComponent 浅比较命中、或图层被临时
        // 隐藏),手柄就会以旧几何停在画布上,表现为"拖动组件后残留一个绿框"。
        const wasManipulating = this.manipulationMode !== Mode.None || this.manipulated;

        this.manipulationMode = Mode.None;
        this.manipulated = false;

        if (!this.hasSelection()) {
            this.hideShapes();
        } else if (this.isSelectionLocked() || this.props.cropActive) {
            this.hideShapes();
        } else {
            // 先无条件清一遍,确保上一帧的几何不会残留;renderShapes() 会把当前
            // 选区的手柄重新画到正确位置。
            if (wasManipulating) {
                this.hideShapes();
            }

            this.calculateInitializeTransform();
            this.calculateResizeRestrictions();
            this.renderShapes();
        }
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        // Remove all shapes, otherwise they would stay on the persistent layer as
        // frozen handles whenever the adorner unmounts (e. g. hand mode).
        this.allElements.forEach(s => s.remove());
        this.allElements = [];
    }

    private isSelectionLocked(): boolean {
        return this.props.selectionSet.selectedItems.some(item => item.isLocked);
    }

    private hasSelection(): boolean {
        // 连接线等不可变换对象不算"有选择",否则选中一条连线会看到一堆无意义的手柄(CONN-008)。
        return this.props.selectionSet.editableItems.length > 0;
    }

    private calculateInitializeTransform() {
        const items = this.props.selectionSet.editableItems;

        let transform: Transform;
        if (items.length === 0) {
            transform = Transform.ZERO;
        } else if (items.length === 1) {
            transform = items[0].bounds(this.props.selectedDiagram);
        } else {
            const bounds = items.map(x => x.bounds(this.props.selectedDiagram));

            transform = Transform.createFromTransformationsAndRotation(bounds, this.rotation);
        }

        this.transform = transform;
    }

    private calculateResizeRestrictions() {
        this.canResizeX = false;
        this.canResizeY = false;

        for (const item of this.props.selectionSet.selectedItems) {
            if (item.constraint) {
                if (!item.constraint.calculateSizeX()) {
                    this.canResizeX = true;
                }

                if (!item.constraint.calculateSizeY()) {
                    this.canResizeY = true;
                }
            } else {
                this.canResizeX = true;
                this.canResizeY = true;
            }
        }
    }

    public onKeyDown(event: KeyboardEvent, next: (event: KeyboardEvent) => void) {
        // 手型/连线模式:不拦截键盘,直接放行。
        if (this.props.disabled) {
            next(event);
            return;
        }

        // If the manipulation with the mouse is still in progress we do not handle the event.
        if (isInputFocused() || !this.hasSelection() || this.isSelectionLocked() || this.manipulationMode != Mode.None) {
            next(event);
            return;
        }

        let xd = 0;
        let yd = 0;

        // Calculate the movement direction from the keys.
        switch (event.key) {
            case 'ArrowLeft':
                xd = -1;
                break;
            case 'ArrowRight':
                xd = +1;
                break;
            case 'ArrowUp':
                yd = -1;
                break;
            case 'ArrowDown':
                yd = 1;
                break;
        }

        // If the wrong keys are pressed, we just stop here.
        if (xd === 0 && yd === 0) {
            next(event);
            return;
        }

        stopEvent(event);

        // If the manipulation with the mouse is still in progress we do not handle the event.
        if (this.moveTimer) {
            next(event);
            return;
        }

        let counter = 1;
        this.startManipulation(null!, this.transform);

        const run = () => {
            const delta = new Vec2(xd * counter, yd * counter);

            // Reset the overlay to show all markers.
            this.props.overlayManager.reset();

            // Show the overlay after a few movements, not the first click.
            this.move(delta, 'None', false);

            this.renderPreview();
            this.renderShapes();

            // We have kept the keyboard pressed and therefore also updated at least one shape.
            this.manipulated = true;
    
            counter++;
        };

        run();

        this.moveTimer = new Timer(() => run(), 200, 1000);
    }

    public onKeyUp(event: KeyboardEvent, next: (event: KeyboardEvent) => void) {
        if (!this.moveTimer) {
            next(event);
            return;
        }

        try {
            this.props.overlayManager.reset();

            // If none the timer has never been triggered we have not moved the shape and we can just stop here.
            if (!this.manipulated) {
                return;
            }

            this.rotation = this.transform.rotation;
            this.props.onTransformItems(
                this.props.selectedDiagram,
                this.props.selectionSet.selectedItems,
                this.startTransform,
                this.transform);
        } finally {
            this.stopTransform();
        }
    }

    public onMouseDown(event: EngineHitEvent, next: (event: EngineHitEvent) => void) {
        // 手型/连线模式:只展示选框,不接管任何鼠标操作。
        if (this.props.disabled) {
            next(event);
            return;
        }

        // ── 只有左键能进"变换"分支(I-02)────────────────────────────────────
        //
        // 引擎对任意按键都派发 mousedown(engine/svg/engine.ts 无按键过滤)。右键若在这里
        // 命中 moveShape,会进入 Move 模式并吞掉事件,随后 onMouseUp 的"纯单击收敛"
        // 分支把**多选选区塌成单选** —— 而右键菜单是在这之后才打开的,于是
        // 复制 / 复制成图片 / 组合 全部变灰。
        //
        // 这里用 next(event) 转发而不是直接 return:让后面的 SelectionAdorner 也能
        // 收到并各自做同样的守卫,避免"挡了一层、另一层照样处理"。
        // 中键(button === 1)由本守卫一并放行,pan / zoom 由 d3-zoom 直接监听 DOM。
        if (!isLeftMouse(event.source)) {
            next(event);
            return;
        }

        // If the manipulation with the keyboard is still in progress we do not handle the event.
        if (event.source.ctrlKey || this.moveTimer || this.manipulationMode != Mode.None || this.isSelectionLocked() || this.props.cropActive) {
            next(event);
            return;
        }

        const hitItem = this.hitTest(event.position);

        if (!hitItem) {
            // 没命中任何手柄 ⇒ 本 adorner 不处理,交给后面的 SelectionAdorner。
            next(event);
            return;
        }

        // Reset the flag to indicate whether something has been manipulated.
        this.startManipulation(event.position!, this.transform);

        if (hitItem === this.moveShape) {
            this.manipulationMode = Mode.Move;

            // 记下被点中的组件与 Shift 状态:这次 mousedown 不会传给 SelectionAdorner,
            // 所以"纯单击"要收敛选区只能在这个 adorner 里补做(见 onMouseUp)。
            //
            // event.item 来自引擎对 mousedown 的 DOM 目标做向上遍历
            // (engine.ts 的 buildHitEvent):moveShape 是 fill('none'),鼠标事件会
            // 穿透到下面的图片/图形上,正常情况下 event.item 就是被点中的那个组件。
            // 但当按下点正好落在"选框边线 / 变换手柄"这类非组件节点上时,event.item
            // 会是 null —— 此时用主图层的几何命中补一次,否则这次纯单击在 mouseup
            // 时没有可收敛的目标,表现就是"第一下点不中、第二下才行"。
            this.clickItem = event.item ? event.item : this.hitMainItem(event.position);
            this.clickShift = event.source.shiftKey;
        } else if (hitItem === this.rotateShape) {
            this.manipulationMode = Mode.Rotate;
        } else {
            this.manipulationMode = Mode.Resize;
            this.manipulationOffset = (hitItem as any)['offset'] as Vec2;

            // Enforce the aspect ratio when locked by appearance, or temporarily when holding Alt.
            this.aspectLockRatio = this.getAspectRatio(event.source.altKey);
        }
    }

    private getAspectRatio(temporary: boolean): number | null {
        const items = this.props.selectionSet.selectedItems;

        if (items.length !== 1) {
            return null;
        }

        const stored = parseAspectRatio(items[0].appearance.get(ASPECT_RATIO));

        if (stored) {
            return stored;
        }

        if (!temporary) {
            return null;
        }

        // Temporarily lock the current aspect ratio.
        const size = this.startTransform.size;

        return size.y > 0 ? size.x / size.y : null;
    }

    private hitTest(point: Vec2) {
        return this.props.layer.hitTest(point.x, point.y)[0];
    }

    // 在**主图层**上做一次几何命中,用于 event.item 为 null 时补出被点中的组件。
    //
    // 为什么需要:SvgLayer.hitTest 是按各子元素的外接矩形 / 插件精确命中做几何判定的,
    // 与"指针事件落在哪个 DOM 节点上"无关;而 event.item 来自 buildHitEvent 对
    // mousedown 的 DOM 目标做向上遍历。当按下点落在选框边线、变换手柄这类非组件节点上,
    // 后者会得到 null,而前者依然正确。
    private hitMainItem(point: Vec2): DiagramItem | null {
        const hits = this.props.mainLayer?.hitTest(point.x, point.y);

        if (!hits || hits.length === 0) {
            return null;
        }

        // hitTest 按 DOM 顺序(自底向上)返回,最后一个才是视觉上最上层的那一个。
        for (let i = hits.length - 1; i >= 0; i--) {
            const shape = (hits[i] as any).shape as DiagramItem | undefined;

            if (shape && typeof shape.id === 'string') {
                return shape;
            }
        }

        return null;
    }

    public onMouseDrag(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (this.props.disabled || this.manipulationMode === Mode.None || !this.startPosition) {
            next(event);
            return;
        }

        // Reset the overlay to show all markers.
        this.props.overlayManager.reset();

        const delta = event.position.sub(this.startPosition);

        // 位移小于阈值的一律不算拖拽 —— 这是"单击"与"拖拽"的分界线。
        // 见 CLICK_DRAG_THRESHOLD_PX 的注释:少了这道判断,鼠标的 1px 抖动会让
        // 一次纯单击走进 onTransformItems 分支,选区永远不收敛。
        const threshold = CLICK_DRAG_THRESHOLD_PX / (this.props.zoom || 1);

        if (delta.lengtSquared < threshold * threshold) {
            return;
        }

        // We have moved the mouse and therefore also updated at least one shape.
        this.manipulated = true;
        this.dragMoved = true;
        if (this.manipulationMode === Mode.Move) {
            this.move(delta, getSnapMode(event.source));
        } else if (this.manipulationMode === Mode.Rotate) {
            this.rotate(event, getSnapMode(event.source));
        } else {
            this.resize(delta, getSnapMode(event.source));
        }

        this.renderPreview();
        this.renderShapes();
    }

    private renderPreview() {
        const items: Record<string, DiagramItem> = {};

        for (const item of this.props.selectionSet.editableItems) {
            items[item.id] = item.transformByBounds(this.startTransform, this.transform);
        }

        // Use a stream of preview updates to bypass react for performance reasons.
        this.props.previewStream.next({ type: 'Update', items });
    }

    private move(delta: Vec2, snapMode: SnapMode, showOverlay = true) {
        const snapResult = this.props.snapManager.snapMoving(this.startTransform, delta, snapMode, this.props.selectionSet.editableIds);

        // A resize is very often also a movement, because the center is in the middle.
        this.transform = this.startTransform.moveBy(snapResult.delta);

        if (showOverlay) {
            this.props.overlayManager.showSnapAdorners(snapResult);

            const x = Math.floor(this.transform.aabb.x);
            const y = Math.floor(this.transform.aabb.y);

            this.props.overlayManager.showInfo(this.transform, texts.common.positionInfo(x, y));
        }

        this.debug();
    }

    private rotate(event: EngineMouseEvent, snapMode: SnapMode, showOverlay = true) {
        const deltaValue = this.getCummulativeRotation(event);
        const deltaRotation = this.props.snapManager.snapRotating(this.startTransform, deltaValue, snapMode);

        this.transform = this.startTransform.rotateBy(Rotation.fromDegree(deltaRotation));

        if (showOverlay) {
            this.props.overlayManager.showInfo(this.transform, texts.common.rotationInfo(this.transform.rotation.degree));
        }
    }

    private getCummulativeRotation(event: EngineMouseEvent): number {
        const center = this.startTransform.position;

        const eventPoint = event.position;
        const eventStart = this.startPosition;

        const cummulativeRotation = Vec2.angleBetween(eventStart.sub(center), eventPoint.sub(center));

        return cummulativeRotation;
    }

    private resize(delta: Vec2, snapMode: SnapMode, showOverlay = true) {
        const startRotation = this.startTransform.rotation;

        // Do not snap when the aspect ratio is enforced, because the ratio always wins.
        const deltaSize = this.getResizeDeltaSize(startRotation, delta, this.aspectLockRatio ? 'None' : snapMode);

        let deltaValue = deltaSize.delta;

        if (this.aspectLockRatio) {
            const startSize = this.startTransform.size;

            // Side handles are driven by the axis they can change, corner handles by the axis that moves more.
            const driven = this.manipulationOffset.x === 0
                ? 'y' as const
                : (this.manipulationOffset.y === 0 ? 'x' as const : (Math.abs(deltaValue.x) >= Math.abs(deltaValue.y) ? 'x' as const : 'y' as const));

            deltaValue = applyAspectRatio(startSize.add(deltaValue), this.aspectLockRatio, driven).sub(startSize);
        }

        const deltaMove = this.getResizeDeltaPosition(startRotation, deltaValue);

        // A resize is very often also a movement, because the center is in the middle.
        this.transform = this.startTransform.resizeAndMoveBy(deltaValue, deltaMove);

        if (showOverlay) {
            this.props.overlayManager.showSnapAdorners(deltaSize);

            const w = this.transform.size.x;
            const h = this.transform.size.y;
            const x = this.transform.aabb.x;

            this.props.overlayManager.showInfo(this.transform, texts.common.resizeInfo(w, h, this.aspectLockRatio, x));
        }

        this.debug();
    }

    private getResizeDeltaSize(angle: Rotation, cummulativeTranslation: Vec2, snapMode: SnapMode) {
        const delta = Vec2.rotated(cummulativeTranslation.mul(2), Vec2.ZERO, angle.negate()).mul(this.manipulationOffset);

        const snapResult =
            this.props.snapManager.snapResizing(this.startTransform, delta, snapMode,
                this.manipulationOffset.x,
                this.manipulationOffset.y,
                this.props.selectionSet.editableIds);

        return snapResult;
    }

    private debug() {
        if (DEBUG_SIDES || DEBUG_DISTANCES) {
            const { xLines, yLines } = this.props.snapManager.getDebugLines(this.props.selectionSet.editableIds);
    
            for (const line of xLines) {
                if ((line.positions && DEBUG_DISTANCES) || DEBUG_SIDES) {
                    this.props.overlayManager.renderXLine(line);
                }
            }

            for (const line of yLines) {
                if ((line.positions && DEBUG_DISTANCES) || DEBUG_SIDES) {
                    this.props.overlayManager.renderYLine(line);
                }
            }
        }
    }

    private getResizeDeltaPosition(angle: Rotation, dSize: Vec2) {
        let x = 0;
        let y = 0;

        if (this.manipulationOffset.y !== 0) {
            y += this.manipulationOffset.y * dSize.y * angle.cos;
            x -= this.manipulationOffset.y * dSize.y * angle.sin;
        }

        if (this.manipulationOffset.x !== 0) {
            y += this.manipulationOffset.x * dSize.x * angle.sin;
            x += this.manipulationOffset.x * dSize.x * angle.cos;
        }

        return new Vec2(x, y);
    }

    public onMouseUp(event: EngineMouseEvent, next: (event: EngineMouseEvent) => void) {
        if (this.props.disabled) {
            next(event);
            return;
        }

        // ── 纯单击:把选区收敛到被点中的那一个 ────────────────────────────────
        //
        // 判据刻意用 `clickItem` + `dragMoved`,而**不是** `manipulationMode` /
        // `manipulated`:componentDidUpdate() 会把后两者重置成 None / false
        // (那是为了清掉上一轮残留的手柄),只要在按下与抬起之间发生过一次带新 props
        // 的重渲染,它们就不再可信。
        //
        // 为什么必须在这里补做:按下点落在选区包围盒内部时,mousedown 会被 moveShape
        // 命中,本 adorner 直接进入 Move 模式并且**不调用 next(event)** ——
        // SelectionAdorner 完全没有机会重算选区。若不补做,"多选状态下单击其中一个"
        // 永远收敛不了。表现就是第五轮第 6 条:分割成 4 块后单击某个 tile,4 块仍然
        // 全部选中,而 4 个相邻外框拼起来在视觉上和"整张图被选中"一模一样。
        //
        // 用 calculateSelection(...) 而不是自己写收敛逻辑,是为了与
        // SelectionAdorner.onMouseDown 的语义完全一致(Shift 单击 = 加入 / 移出选区)。
        const clicked = this.clickItem;
        const wasDrag = this.dragMoved;

        this.clickItem = null;

        if (clicked && !wasDrag && this.props.onSelectItems) {
            try {
                this.props.overlayManager.reset();
            } catch { /* 覆盖层收起失败不影响选区 */ }

            this.props.onSelectItems(
                this.props.selectedDiagram,
                calculateSelection([clicked], this.props.selectedDiagram, true, this.clickShift));

            this.stopTransform();
            return;
        }

        if (this.manipulationMode === Mode.None) {
            next(event);
            return;
        }

        try {
            this.props.overlayManager.reset();

            // 键盘连按 / 鼠标拖动都没发生过 ⇒ 没有任何几何变化需要提交。
            if (!this.manipulated) {
                return;
            }

            this.rotation = this.transform.rotation;

            this.props.onTransformItems(
                this.props.selectedDiagram,
                this.props.selectionSet.editableItems,
                this.startTransform,
                this.transform);
        } finally {
            this.stopTransform();
        }
    }

    public onBlur(event: FocusEvent, next: (event: FocusEvent) => void) {
        if (this.props.disabled || (this.manipulationMode === Mode.None && !this.moveTimer)) {
            next(event);
            return;
        }

        this.stopTransform();
    }

    private startManipulation(position: Vec2, transform: Transform) {
        // Use a stream of preview updates to bypass react for performance reasons.
        this.props.previewStream.next({ type: 'Start' });

        this.moveTimer?.destroy();
        this.moveTimer = null;

        this.manipulationMode = Mode.None;
        this.manipulated = false;

        this.aspectLockRatio = null;

        // 每次开始一次新的按压都清掉"待判定的单击",避免上一轮的残留值
        // 在 mouseup 时被误当成点击目标。
        this.clickItem = null;
        this.clickShift = false;
        this.dragMoved = false;

        this.startPosition = position;
        this.startTransform = transform;
    }

    private stopTransform() {
        // Use a stream of preview updates to bypass react for performance reasons.
        this.props.previewStream.next({ type: 'End' });

        this.moveTimer?.destroy();
        this.moveTimer = null;

        this.manipulationMode = Mode.None;
        this.manipulated = false;
        this.dragMoved = false;

        this.aspectLockRatio = null;
    }

    private renderShapes() {
        if (this.resizeShapes === null) {
            return;
        }

        const stroke = 1 / this.props.zoom;
        const transformSize = this.transform.size;
        const transformRotation = this.transform.rotation.degree;
        const transformPosition = this.transform.position;
        const adornerSize = DRAG_SIZE / this.props.zoom;
        const adornerHalfSize = adornerSize / 2;

        for (const resizeShape of this.resizeShapes) {
            const offset = (resizeShape as any)['offset'] as Vec2;

            const visible =
                (offset.x === 0 || this.canResizeX) &&
                (offset.y === 0 || this.canResizeY);

            if (!visible) {
                resizeShape.hide();
                continue;
            }

            resizeShape.show();
            resizeShape.strokeWidth(stroke);
            resizeShape.plot({
                x: transformPosition.x - adornerHalfSize + offset.x * (transformSize.x + adornerHalfSize),
                y: transformPosition.y - adornerHalfSize + offset.y * (transformSize.y + adornerHalfSize),
                w: adornerSize,
                h: adornerSize,
                rotation: transformRotation,
                rx: transformPosition.x,
                ry: transformPosition.y,
            });
        }

        this.rotateShape.show();
        this.rotateShape.strokeWidth(stroke);
        this.rotateShape.plot({
            x: transformPosition.x - adornerHalfSize,
            y: transformPosition.y - adornerHalfSize - transformSize.y * 0.5 - 30 / this.props.zoom,
            w: adornerSize,
            h: adornerSize,
            rotation: transformRotation,
            rx: transformPosition.x,
            ry: transformPosition.y,
        });

        this.moveShape.show();
        this.moveShape.strokeWidth(stroke);
        this.moveShape.plot({
            x: transformPosition.x - 0.5 * transformSize.x,
            y: transformPosition.y - 0.5 * transformSize.y,
            w: transformSize.x,
            h: transformSize.y,        
            rotation: transformRotation,
            rx: transformPosition.x,
            ry: transformPosition.y,
        });
    }

    private hideShapes() {
        this.allElements.forEach(s => s.hide());
    }

    private createMoveShape() {
        const moveShape = this.props.layer.rect();
        moveShape.cursor('move');
        moveShape.fill('none');
        moveShape.strokeColor(TRANSFORMER_STROKE_COLOR);
        moveShape.strokeWidth(1);
        this.moveShape = moveShape;
    }

    private createRotateShape() {
        const rotateShape = this.props.layer.ellipse();
        rotateShape.cursor('pointer');
        rotateShape.fill(TRANSFORMER_FILL_COLOR);
        rotateShape.strokeColor(TRANSFORMER_STROKE_COLOR);
        rotateShape.strokeWidth(1);
        this.rotateShape = rotateShape;
    }

    private createResizeShapes() {
        const ys = [-0.5, -0.5, -0.5,  0.0, 0.0,  0.5, 0.5, 0.5];
        const xs = [-0.5,  0.0,  0.5, -0.5, 0.5, -0.5, 0.0, 0.5];
        const cursors = ['nw-resize', 'n-resize', 'ne-resize', 'w-resize', 'e-resize', 'sw-resize', 's-resize', 'se-resize'];

        for (let i = 0; i < xs.length; i++) {
            const resizeShape = this.props.layer.rect();
            resizeShape.cursor(cursors[i]);
            resizeShape.fill(TRANSFORMER_FILL_COLOR);
            resizeShape.strokeColor(TRANSFORMER_STROKE_COLOR);
            resizeShape.strokeWidth(1);
            this.resizeShapes.push(resizeShape);

            (resizeShape as any)['offset'] = new Vec2(xs[i], ys[i]);
        }
    }

    public render(): any {
        return null;
    }
}

function isInputFocused() {
    const focusedElement = document.activeElement?.tagName?.toLowerCase();

    return focusedElement === 'input' || focusedElement === 'textarea';
}

function stopEvent(event: Event) {
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
}

function getSnapMode(event: KeyboardEvent | MouseEvent) {
    if (event.shiftKey) {
        return 'Grid';
    } else if (event.ctrlKey) {
        return 'None';
    } else {
        return 'Shapes';
    }
}
