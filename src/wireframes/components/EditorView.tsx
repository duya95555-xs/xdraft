/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Dropdown, MenuProps } from 'antd';
import * as React from 'react';
import { DropTargetMonitor, useDrop } from 'react-dnd';
import { NativeTypes } from 'react-dnd-html5-backend';
import { Canvas, Control, loadImagesToClipboardItems, Rect2, Shortcut, useClipboard, useEventCallback, Vec2, ViewBox } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { ShapeSource } from '@app/wireframes/interface';
import { addConnector, addShape, buildConfigFormFromJson, changeItemsAppearance, cropImage, Diagram, DiagramItem, DiagramItemSet, getDiagram, getDiagramId, getEditor, getSelection, parseCrop, PluginRegistry, reconnectConnector, resetCrop, selectItems, setConnectorWaypoints, splitImage, Transform, transformItems, useStore } from '@app/wireframes/model';
import { Editor, EditorHandle } from '@app/wireframes/renderer/Editor';
import { nearestAnchor, nearestAnchorSide, sideAnchorPoint, Side } from '@app/wireframes/shapes/neutral/_connector-routing';
import { toRectLike } from '@app/wireframes/shapes/neutral/_connector';
import { ItemsRef, DiagramRef } from './../model/actions/utils';
import { useContextMenu } from './context-menu';
import './EditorView.scss';

export const EditorView = ({ panMode, connectMode, onPanModeChange, onConnectModeChange: _onConnectModeChange, onControl }: { panMode?: boolean; connectMode?: boolean; onPanModeChange?: (pan: boolean) => void; onConnectModeChange?: (connect: boolean) => void; onControl?: (control: Control) => void }) => {
    const diagram = useStore(getDiagram);
    const editor = useStore(getEditor);


    if (!diagram) {
        return null;
    }

    return (
        <Canvas
            contentWidth={editor.size.x}
            contentHeight={editor.size.y}
            padding={10}
            panMode={panMode}
            connectMode={connectMode}
            onRender={(viewBox, control) => {
                onControl?.(control);

                return <EditorViewInner viewBox={viewBox} panMode={panMode} connectMode={connectMode} onPanModeChange={onPanModeChange} />;
            }}
        />
    );
};

export const EditorViewInner = ({ panMode, connectMode, onPanModeChange, viewBox }: { viewBox: ViewBox; panMode?: boolean; connectMode?: boolean; onPanModeChange?: (pan: boolean) => void }) => {
    const dispatch = useAppDispatch();
    const [cropItemId, setCropItemId] = React.useState<string | null>(null);
    const [splitItemId, setSplitItemId] = React.useState<string | null>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [pendingSourceId, setPendingSourceId] = React.useState<string | null>(null);
    const [pendingSourcePoint, setPendingSourcePoint] = React.useState<{ x: number; y: number } | null>(null);

    // C2:连线模式下鼠标悬停的组件与锚点边(用于浮现四边锚点)。
    const [connectHoverItem, setConnectHoverItem] = React.useState<DiagramItem | null>(null);
    const [connectHoverSide, setConnectHoverSide] = React.useState<Side | null>(null);
    const [pointerScreen, setPointerScreen] = React.useState<{ x: number; y: number } | null>(null);

    // 拉线过程中锚点是"不显示"的(见 doConnectMouseDown),但终点选边仍要沿用用户
    // 释放前最后一次 hover 到的锚点。用 ref 记住它,与"是否显示"解耦。
    const anchorItemAtDragEnd = React.useRef<string | null>(null);
    const anchorAtDragEnd = React.useRef<Side | null>(null);

    // 拖拽期间鼠标下方的目标组件与其最近锚点边。
    // 与 connectHoverItem 的区别:这两个**不**驱动锚点提示显示,只用于:
    //   ① 引导线末端的小圆吸附到锚点   ② 释放时精确定边。
    const [dragTarget, setDragTarget] = React.useState<DiagramItem | null>(null);
    const [dragTargetSide, setDragTargetSide] = React.useState<Side | null>(null);

    const editor = useStore(getEditor);
    const editorColor = editor.color;
    const hitItemRef = React.useRef<any>(null);
    const editorViewRef = React.useRef<HTMLDivElement | null>(null);
    const renderRef = React.useRef<any>();
    const selectedDiagramId = useStore(getDiagramId);
    const selectedPoint = React.useRef({ x: 0, y: 0 });
    // 当前 diagram 直接从 store 派生,不经 props(Canvas 的 render-prop 闭包)传入。
    //
    // 理由:<Canvas onRender={...}/> 的闭包是**在 EditorView 那次渲染时捕获**的。
    // 只要 EditorView 有一次没跟上 store,后续每次 onRender 就会把**旧代 diagram**
    // 递给 EditorViewInner —— 而 inner 自己是实时订阅 store 的,同一个组件内部便出现
    // "有的数据是新的、有的 props 是旧的"这种撕裂状态,而且完全静默、极难定位。
    // 让 diagram 与 selectionSet 同源于一个 state,可以从结构上排除这种不一致。
    //
    // ⚠️ 这里**不做** diagram 空值提前 return —— 下方的 useMemo / useContextMenu /
    // useEventCallback 都是 hook,提前 return 会让 hook 数量在两次渲染间变化,直接
    // 触发 "Rendered fewer hooks than expected"。空值保护统一由外层 EditorView 负责
    // (它已经在最前面 return null),所以这里用 `!` 断言。
    const state = useStore(s => s);
    const diagram = getDiagram(state)!;

    // getSelection 内部按 diagram 实例做了 WeakMap 缓存,引用天然稳定,
    // 无需再包一层 useMemo(那样只是多一次依赖比较)。
    const selectionSet = getSelection(state);
    const baseContextMenu = useContextMenu(menuVisible);

    const doChangeItemsAppearance = useEventCallback((diagram: DiagramRef, visuals: ItemsRef, key: string, value: any) => {
        dispatch(changeItemsAppearance(diagram, visuals, key, value));
    });

    const doSelectItems = useEventCallback((diagram: DiagramRef, items: ItemsRef) => {
        dispatch(selectItems(diagram, items));
    });

    const doTransformItems = useEventCallback((diagram: DiagramRef, items: ItemsRef, oldBounds: Transform, newBounds: Transform) => {
        dispatch(transformItems(diagram, items, oldBounds, newBounds));
    });

    // 拖动连接线拐点手柄后写回固定途经点(FR-6);传空数组即恢复全自动路由。
    const doSetConnectorWaypoints = useEventCallback((diagram: DiagramRef, item: DiagramItem, waypoints: ReadonlyArray<{ x: number; y: number }>) => {
        dispatch(setConnectorWaypoints(diagram, [item], waypoints));
    });

    // 端点改接(C1):把连线的一端拖到另一个组件上。
    const doReconnectConnector = useEventCallback((diagram: DiagramRef, item: DiagramItem, end: 'source' | 'target', target: DiagramItem, point: { x: number; y: number }) => {
        dispatch(reconnectConnector(diagram, [item], end, target, point));
    });

    const doSetPosition = useEventCallback((event: React.MouseEvent) => {
        selectedPoint.current = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    });

    const cropItem = cropItemId ? diagram.items.get(cropItemId) ?? null : null;
    const splitItem = splitItemId ? diagram.items.get(splitItemId) ?? null : null;
    const selectedItem = selectionSet.selectedItems.length === 1 ? selectionSet.selectedItems[0] : null;
    const editorRef = React.useRef<EditorHandle | null>(null);

    // F2 opens the inline text editor for the selected item.
    const canEditText = !!selectedItem && !panMode && !selectedItem.isLocked && !selectedItem.textDisabled;

    const doEditText = useEventCallback(() => {
        if (canEditText) {
            editorRef.current?.editItem(selectedItem!);
        }
    });
    const canCrop = !!selectedItem && (selectedItem.renderer === 'Image' || selectedItem.renderer === 'Raster') && selectedItem.transform.rotation.degree === 0;
    const hasCrop = canCrop && !!parseCrop(selectedItem!.appearance.get('IMAGE_CROP'));

    // Split is possible when the image is splittable at all; the concrete cut
    // lines are chosen afterwards by the split mode (crosshair + second click).
    const canSplit = canCrop && !!selectedItem && !selectedItem.isLocked && !diagram.parent(selectedItem);

    const doStartCrop = useEventCallback(() => {
        if (canCrop) {
            setCropItemId(selectedItem!.id);
        }
    });

    const doResetCrop = useEventCallback(() => {
        if (hasCrop) {
            dispatch(resetCrop(diagram, selectedItem!));
        }
    });

    const doCancelCrop = useEventCallback(() => {
        setCropItemId(null);
    });

    const doStartSplit = useEventCallback(() => {
        if (canSplit) {
            // Split and crop mode are mutually exclusive.
            setCropItemId(null);

            setSplitItemId(selectedItem!.id);
        }
    });

    const doSplit = useEventCallback((item: any, point: Vec2) => {
        dispatch(splitImage(diagram, item, { x: point.x, y: point.y }));

        setSplitItemId(null);
    });

    const doCancelSplit = useEventCallback(() => {
        setSplitItemId(null);
    });

    // In hand mode item interactions are disabled, so a running crop or split is no longer reachable.
    React.useEffect(() => {
        if (panMode) {
            setCropItemId(null);
            setSplitItemId(null);
        }
    }, [panMode]);

    const doCrop = useEventCallback((item: any, relCrop: string, cropRect: Rect2) => {
        const hadCrop = !!parseCrop(item.appearance.get('IMAGE_CROP'));

        dispatch(cropImage(diagram, item, relCrop, Transform.fromRect(cropRect), hadCrop ? null : item.transform));

        setCropItemId(null);
    });

    // Estimated height of the context menu; used to decide the opening direction.
    const MENU_HEIGHT_ESTIMATE = 560;

    const [menuPlacement, setMenuPlacement] = React.useState<'bottomLeft' | 'topLeft'>('bottomLeft');

    const doContextMenu = useEventCallback((event: React.MouseEvent) => {
        const item = hitItemRef.current as DiagramItem | null;

        // 右键落在"未选中"的组件上时,先把它选中再弹菜单(D5)。
        //
        // 两种期望在这里汇合:
        //   · I-02 的守卫(SelectionAdorner / TransformAdorner 的 isLeftMouse 检查)保证
        //     右键**不再破坏已有选区** —— 框选 N 个后在任意位置右键,选区原样保留;
        //   · 本条补的是另一种常见期望 —— 右键一个没被选中的组件时,菜单应当针对它给出
        //     可用项。此前只对 Image / Raster 做了这件事,其余组件右键后菜单仍按旧选区
        //     给出条目,读起来就像"右键这个组件没反应"。
        //
        // 判定要连祖先一起看:命中 Group 的子项时选区里持有的是 Group 本身,
        // 只看 item.id 会误判成"未选中",把已选中的 Group 拆成单个子项。
        if (item && selectedDiagramId && !isItemOrAncestorSelected(diagram, selectionSet, item)) {
            dispatch(selectItems(selectedDiagramId, [item.id]));
        }

        // Open the menu upwards when it would not fit below the cursor and there is more room above.
        // The available space of the chosen side also becomes the menu max height (CSS var), so the
        // menu stays fully visible (scrolling internally) even when neither side is tall enough.
        const below = window.innerHeight - event.clientY;
        const above = event.clientY;
        const openUpwards = below < MENU_HEIGHT_ESTIMATE && above > below;

        setMenuPlacement(openUpwards ? 'topLeft' : 'bottomLeft');
        document.documentElement.style.setProperty('--editor-menu-max-height', `${Math.max(Math.round((openUpwards ? above : below) - 16), 120)}px`);
    });

    // Double click on the empty canvas toggles the pan (drag) mode on.
    const doDoubleClickCanvas = useEventCallback(() => {
        if (!panMode && !hitItemRef.current) {
            onPanModeChange?.(true);
        }
    });

    const mouseDownPoint = React.useRef<{ x: number; y: number } | null>(null);

    // 屏幕坐标 -> 视图框 diagram 坐标。
    const screenToDiagram = useEventCallback((screenX: number, screenY: number) => {
        const editorEl = editorViewRef.current;

        if (!editorEl) {
            return null;
        }

        const rect = editorEl.getBoundingClientRect();
        const sx = screenX - rect.left;
        const sy = screenY - rect.top;

        return {
            x: viewBox.minX + sx / viewBox.zoom,
            y: viewBox.minY + sy / viewBox.zoom,
        };
    });

    // 在 diagram 坐标里找出命中的最顶层的 connectable item(若无则 null)。
    const findConnectableAt = useEventCallback((diagramX: number, diagramY: number): DiagramItem | null => {
        let bestItem: DiagramItem | null = null;

        // 倒序遍历,后添加(高层级)优先。
        const all = [...diagram.items.values];

        for (let i = all.length - 1; i >= 0; i--) {
            const item = all[i];

            if (item.renderer === 'Connector') {
                continue;
            }

            const plugin = PluginRegistry.get(item.renderer);

            if (!plugin?.plugin?.connectable?.()) {
                continue;
            }

            // 锁定的组件不能作为连线端点(CONN-006)。
            if (item.isLocked) {
                continue;
            }

            const sb = item.bounds(diagram).aabb;

            if (diagramX >= sb.x && diagramX <= sb.x + sb.width &&
                diagramY >= sb.y && diagramY <= sb.y + sb.height) {
                bestItem = item;
                break;
            }
        }

        return bestItem;
    });

    // 某组件某条边的中点(diagram 坐标)。用作"锁定该边"的等价按点。
    const anchorPointFor = useEventCallback((item: DiagramItem, side: Side) => {
        const b = item.bounds(diagram).aabb;

        return sideAnchorPoint({ x: b.x, y: b.y, w: b.width, h: b.height }, side, 0.5);
    });

    // connect 模式下鼠标按下:起点只能是 connectable item,否则忽略。
    // C2:若鼠标正悬停在某个锚点上,则边由该锚点显式决定;否则回退"按位置猜最近边"。
    const doConnectMouseDown = useEventCallback((event: React.MouseEvent) => {
        if (!connectMode) {
            return;
        }

        const pos = screenToDiagram(event.clientX, event.clientY);

        if (!pos) {
            return;
        }

        const source = findConnectableAt(pos.x, pos.y);

        if (!source) {
            setPendingSourceId(null);
            setPendingSourcePoint(null);
            setPointerScreen(null);
            return;
        }

        setPendingSourceId(source.id);
        // 记下鼠标按下的位置 —— 它决定连线从源组件的哪条边出去。
        // 显式悬停在锚点上时,把这个锚点的边中点当作"按下位置",选边结果就精确锁定为那一条边。
        setPendingSourcePoint(source.id === connectHoverItem?.id && connectHoverSide ?
            anchorPointFor(source, connectHoverSide) : pos);
        setPointerScreen({ x: event.clientX, y: event.clientY });

        // 开始拉线后立即撤掉锚点提示。
        // doConnectMouseMove 在拖拽期间不再更新 connectHoverItem(避免视觉噪音),
        // 若不在这里清空,它会一直停在上次悬停的组件上,锚点提示便会"偶发"残留在画布上。
        anchorItemAtDragEnd.current = null;
        anchorAtDragEnd.current = null;
        setDragTarget(null);
        setDragTargetSide(null);
        setConnectHoverItem(null);
        setConnectHoverSide(null);
    });

    // connect 模式下鼠标移动:更新指针位置(供引导线 overlay 使用),并追踪悬停组件(C2)。
    const doConnectMouseMove = useEventCallback((event: React.MouseEvent) => {
        if (!connectMode) {
            return;
        }

        const pos = screenToDiagram(event.clientX, event.clientY);

        // 拖拽出线期间:只更新引导线终点 + 用 ref 静默记录"鼠标下的目标组件",
        // 不更新 connectHoverItem/connectHoverSide —— 那两个 state 会驱动锚点提示显示,
        // 拖拽中必须保持隐藏,否则会出现"拉线时目标组件上偶有锚点闪烁"。
        if (pendingSourceId) {
            setPointerScreen({ x: event.clientX, y: event.clientY });

            if (pos) {
                const hover = findConnectableAt(pos.x, pos.y);
                const hoverId = hover && hover.id !== pendingSourceId ? hover.id : null;

                if (hoverId !== anchorItemAtDragEnd.current) {
                    anchorItemAtDragEnd.current = hoverId;
                    anchorAtDragEnd.current = null;
                    setDragTarget(hoverId ? hover : null);
                    setDragTargetSide(null);
                }

                // 已经悬停在某个目标组件上时,实时算出最近的锚点边供释放时使用。
                if (hover && hoverId) {
                    const rect = toRectLike(hover.bounds(diagram).aabb);
                    const side = nearestAnchor(rect, pos, 24 / viewBox.zoom)?.side ?? null;

                    anchorAtDragEnd.current = side;
                    setDragTargetSide(side);
                }
            }

            return;
        }

        if (!pos) {
            return;
        }

        const hover = findConnectableAt(pos.x, pos.y);

        if ((hover?.id ?? null) !== (connectHoverItem?.id ?? null)) {
            setConnectHoverItem(hover);
            setConnectHoverSide(null);
        }
    });

    // connect 模式下鼠标释放:终点为另一个不同 connectable item 时创建连接线。
    const doConnectMouseUp = useEventCallback((event: React.MouseEvent) => {
        if (!connectMode || !pendingSourceId || !selectedDiagramId) {
            return;
        }

        const source = diagram.items.get(pendingSourceId);
        const sourcePoint = pendingSourcePoint;

        setPendingSourceId(null);
        setPendingSourcePoint(null);
        setPointerScreen(null);
        setDragTarget(null);
        setDragTargetSide(null);

        if (!source) {
            return;
        }

        const pos = screenToDiagram(event.clientX, event.clientY);

        if (!pos) {
            return;
        }

        const target = findConnectableAt(pos.x, pos.y);

        if (!target || target.id === pendingSourceId) {
            // 释放到空白或同一个 item:不连线,但保持 connectMode(可继续下一次连线)。
            return;
        }

        // 把"鼠标按下 / 松开的位置"一并交给模型层,由它按"距离该位置最近的边"选锚点。
        // C2:鼠标正对着目标组件的某条边时,用该边的中点替代鼠标位置,精确锁定那一条边。
        // 用 anchorAtDragEnd(拖拽期间由 adorner 持续更新的最近边)而不是 connectHoverSide ——
        // 后者在开始拉线时就被清空了(拖拽期间锚点必须保持隐藏)。
        const hoverSideAtRelease = anchorAtDragEnd.current;

        dispatch(addConnector(selectedDiagramId, source, target, undefined, {
            source: sourcePoint ?? undefined,
            target: hoverSideAtRelease && target.id === anchorItemAtDragEnd.current ?
                anchorPointFor(target, hoverSideAtRelease) : pos,
        }));
    });

    const doMouseDown = useEventCallback((event: React.MouseEvent) => {
        doConnectMouseDown(event);
        mouseDownPoint.current = { x: event.clientX, y: event.clientY };
    });

    // C2:锚点 adorner 报告鼠标悬停到哪条边的锚点上。
    const doConnectHoverAnchor = useEventCallback((side: Side | null) => {
        setConnectHoverSide(side);

        // 供"拉线释放"时精确锁定终点边使用(此时锚点提示已被隐藏,不能读 state)。
        anchorAtDragEnd.current = side;
    });

    // 切换模式时清理 pending 连线状态。
    React.useEffect(() => {
        if (!connectMode) {
            setPendingSourceId(null);
            setPendingSourcePoint(null);
            setPointerScreen(null);
            setConnectHoverItem(null);
            setConnectHoverSide(null);
            setDragTarget(null);
            setDragTargetSide(null);
            anchorItemAtDragEnd.current = null;
            anchorAtDragEnd.current = null;
        }
    }, [connectMode]);

    // A single left click (with less than a small displacement) on the empty canvas leaves the pan (drag) mode.
    const doMouseUp = useEventCallback((event: React.MouseEvent) => {
        doConnectMouseUp(event);

        if (panMode && !hitItemRef.current && mouseDownPoint.current) {
            const dx = event.clientX - mouseDownPoint.current.x;
            const dy = event.clientY - mouseDownPoint.current.y;

            if (dx * dx + dy * dy < 16) {
                onPanModeChange?.(false);
            }
        }

        mouseDownPoint.current = null;
    });

    const contextMenu: MenuProps = {
        ...baseContextMenu,
        items: [
            ...(baseContextMenu.items ?? []),
            { type: 'divider' },
            {
                key: 'cropImage',
                label: texts.common.cropImage,
                title: canCrop ? undefined : texts.common.cropImageDisabled,
                disabled: !canCrop,
                onClick: doStartCrop,
            },
            {
                key: 'resetCrop',
                label: texts.common.resetCrop,
                disabled: !hasCrop,
                onClick: doResetCrop,
            },
            {
                key: 'splitImage',
                label: texts.common.splitImage,
                title: canSplit ? texts.common.splitImageHint : undefined,
                disabled: !canSplit,
                onClick: doStartSplit,
            },
        ],
    };

    const doPaste = useEventCallback((sources: ReadonlyArray<ShapeSource>, x: number, y: number) => {
        if (!selectedDiagramId) {
            return;
        }

        // 配置 JSON 粘贴:形如 JSON 对象的文本自动生成"键标签 + 输入控件"表单,
        // 非 JSON 文本走默认的 Label 粘贴路径。
        const rest: ShapeSource[] = [];

        for (const source of sources) {
            const formShapes = source.type === 'Text' ? buildConfigFormFromJson(source.text, x, y) : null;

            if (formShapes) {
                for (const shape of formShapes) {
                    dispatch(addShape(selectedDiagramId, shape.renderer, {
                        position: shape.position,
                        size: shape.size,
                        appearance: shape.appearance,
                    }));
                }

                continue;
            }

            rest.push(source);
        }

        const shapes = PluginRegistry.createShapes(rest);

        for (const { appearance, renderer, size } of shapes) {
            dispatch(addShape(selectedDiagramId, renderer, { position: { x, y }, size, appearance }));

            x += 40;
            y += 40;
        }
    });

    useClipboard({
        onPaste: event => {
            if (!selectedDiagramId) {
                return;
            }
    
            const x = selectedPoint.current.x;
            const y = selectedPoint.current.y;

            doPaste(event.items, x, y);
        },
    });

    const [, drop] = useDrop({
        accept: [
            NativeTypes.URL,
            NativeTypes.FILE,
            NativeTypes.TEXT,
            'DND_ASSET',
            'DND_ICON',
        ],
        drop: async (item: any, monitor: DropTargetMonitor) => {
            if (!monitor || !renderRef.current || !selectedDiagramId) {
                return;
            }

            // 拖拽源是整张资产卡片(含标题),落点必须按"鼠标指针位置"计算 ——
            // 沿用源元素左上角(getSourceClientOffset)会让落点随卡片尺寸漂移。
            let offset = monitor.getClientOffset();

            if (!offset) {
                offset = monitor.getSourceClientOffset();
            }

            if (!offset) {
                return;
            }

            const componentRect = renderRef.current!.getBoundingClientRect();

            // Convert to the space of the element
            const relativeX = (offset?.x || 0) - componentRect.left;
            const relativeY = (offset?.y || 0) - componentRect.top;

            const x = relativeX / viewBox.zoom + viewBox.minX;
            const y = relativeY / viewBox.zoom + viewBox.minY;

            const itemType = monitor.getItemType();

            switch (itemType) {
                case 'DND_ASSET':
                    dispatch(addShape(selectedDiagramId, item['name'], { position: { x, y } }));
                    break;
                case 'DND_ICON':
                    doPaste([{ type: 'Icon', ...item }], x, y);
                    break;
                case NativeTypes.TEXT:
                    doPaste([{ type: 'Text', ...item }], x, y);
                    break;
                case NativeTypes.URL: {
                    const urls: string[] = item.urls;

                    doPaste(urls.map(url => ({ type: 'Url', url })), x, y);
                    break;
                }
                case NativeTypes.FILE: {
                    const files: FileList | File[] = item.files;

                    doPaste(await loadImagesToClipboardItems(files), x, y);
                    break;
                }
            }
        },
    });

    // react-dnd 需要监测 renderRef.current 变化以便在 editor-diagram 上接住资源。
    drop(renderRef);

    const pendingSourceItem = pendingSourceId ? diagram.items.get(pendingSourceId) : null;

    // 引导线的起点:优先取"鼠标按下的那条边"的中点,让用户在拖拽过程中就能看到
    // 即将采用的锚点(与最终创建的连线保持一致);判断不出意图时退回组件中心。
    const pendingSourceScreen = React.useMemo(() => {
        const editorEl = editorViewRef.current;

        if (!pendingSourceItem || !editorEl || !diagram) {
            return null;
        }

        const sb = pendingSourceItem.bounds(diagram).aabb;
        const rect = editorEl.getBoundingClientRect();

        let diagramX = sb.x + sb.width / 2;
        let diagramY = sb.y + sb.height / 2;

        if (pendingSourcePoint) {
            const rectLike = { x: sb.x, y: sb.y, w: sb.width, h: sb.height };
            const side = nearestAnchorSide(rectLike, pendingSourcePoint);

            if (side) {
                const onSide = sideAnchorPoint(rectLike, side, 0.5);

                diagramX = onSide.x;
                diagramY = onSide.y;
            }
        }

        return {
            x: rect.left + (diagramX - viewBox.minX) * viewBox.zoom,
            y: rect.top + (diagramY - viewBox.minY) * viewBox.zoom,
        };
    }, [pendingSourceItem, pendingSourcePoint, diagram, viewBox, editorViewRef.current]);

    // 终点锚点提示:拖拽悬停到目标组件的某个锚点上时,在引导线末端画一个小圆。
    // 用 dragTarget(拖拽期间的目标组件,不驱动任何锚点提示)而不是 connectHoverItem ——
    // 后者在拖拽期间恒为 null(锚点必须保持隐藏),拿它做判断的话小圆永远不会出现。
    const pendingTargetScreen = React.useMemo(() => {
        const editorEl = editorViewRef.current;

        if (!editorEl || !diagram || !dragTarget || !dragTargetSide || !pendingSourceId) {
            return null;
        }

        const cb = dragTarget.bounds(diagram).aabb;
        const rect = editorEl.getBoundingClientRect();
        const onSide = sideAnchorPoint({ x: cb.x, y: cb.y, w: cb.width, h: cb.height }, dragTargetSide, 0.5);

        return {
            x: rect.left + (onSide.x - viewBox.minX) * viewBox.zoom,
            y: rect.top + (onSide.y - viewBox.minY) * viewBox.zoom,
        };
    }, [dragTarget, dragTargetSide, pendingSourceId, diagram, viewBox, editorViewRef.current]);

    // ── diagram 空值保护(必须放在**所有 hook 之后**)────────────────────────
    //
    // 这个位置很关键:
    //   · 更靠前是不能放的 —— 提前 return 会跳过下方/上方的 useMemo、useContextMenu、
    //     useEventCallback 等 hook,两次渲染的 hook 数量不一致,React 直接抛
    //     "Rendered fewer hooks than expected";
    //   · 但完全不保护也不行 —— 本组件里有大量 `diagram.items` / `diagram.parent(...)`
    //     之类的直接解引用(如 cropItem / splitItem / canSplit),一旦 diagram 为空,
    //     渲染期就抛 TypeError。这个异常没人接 ⇒ React 卸载整棵树 ⇒ **整个页面白屏**。
    //
    // diagram 的来源是 getDiagram(state),它读的是 selectedDiagramId 指向的那一页。
    // 理论上外层 EditorView 已经用同样的 selector 做过一次判断并 return null,这里再
    // 兜一层,是为了挡住"两次读取之间 state 又变了"这类边界情况 —— 渲染崩溃的代价
    // 太高(白屏、且这个环境下用户看不到任何报错),不值得为它省一次判断。
    if (!diagram) {
        return null;
    }

    return (
        <Dropdown rootClassName='editor-dropdown' menu={contextMenu} placement={menuPlacement} trigger={panMode || connectMode ? [] : ['contextMenu']} onOpenChange={setMenuVisible}>
            <div className='editor-view' ref={editorViewRef}
                onContextMenu={doContextMenu}
                onDoubleClick={doDoubleClickCanvas}
                onMouseDown={doMouseDown}
                onMouseMove={doConnectMouseMove}
                onMouseLeave={() => setPointerScreen(null)}
                onMouseUp={doMouseUp}
                style={panMode ? { cursor: 'url(/grab-hand.png) 14 1, grab' } : connectMode ? { cursor: 'crosshair' } : undefined}
                onClick={doSetPosition}>
                <Shortcut disabled={!canEditText} keys='f2' onPressed={doEditText} />

                <div className='editor-diagram' ref={renderRef} >
                    <Editor
                        ref={editorRef}
                        color={editorColor}
                        connectHoverItem={connectHoverItem}
                        connectHoverSide={connectHoverSide}
                        connectMode={connectMode}
                        cropItem={cropItem}
                        diagram={diagram}
                        diagrams={editor.diagrams}
                        hitItem={hitItemRef}
                        interactionDisabled={!!panMode || !!connectMode}
                        isDefaultView={true}
                        onCancelCrop={panMode || connectMode ? undefined : doCancelCrop}
                        onCancelSplit={panMode || connectMode ? undefined : doCancelSplit}
                        onChangeItemsAppearance={panMode || connectMode ? undefined : doChangeItemsAppearance}
                        onConnectHoverAnchor={connectMode ? doConnectHoverAnchor : undefined}
                        onCrop={panMode || connectMode ? undefined : doCrop as any}
                        onReconnectConnector={panMode || connectMode ? undefined : doReconnectConnector}
                        onSelectItems={doSelectItems}
                        onSetConnectorWaypoints={panMode || connectMode ? undefined : doSetConnectorWaypoints}
                        onSplit={panMode || connectMode ? undefined : doSplit as any}
                        onTransformItems={doTransformItems}
                        selectionSet={selectionSet}
                        splitItem={splitItem}
                        useWebGL={state.ui.useWebGL}
                        viewBox={viewBox}
                        viewSize={editor.size}
                    />
                </div>
                {connectMode && pendingSourceScreen && pointerScreen && (
                    <svg className='connect-guide-overlay' style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1000 }}>
                        <line
                            x1={pendingSourceScreen.x}
                            y1={pendingSourceScreen.y}
                            x2={pendingTargetScreen?.x ?? pointerScreen.x}
                            y2={pendingTargetScreen?.y ?? pointerScreen.y}
                            stroke='#1677ff'
                            strokeWidth={2}
                            strokeDasharray='6 4'
                            opacity={0.85}
                        />
                        {pendingTargetScreen && (
                            <circle cx={pendingTargetScreen.x} cy={pendingTargetScreen.y} r={6} fill='#1677ff' opacity={0.9} />
                        )}
                    </svg>
                )}
            </div>
        </Dropdown>
    );
};

// 命中项"自身或它的任一祖先"已在选区里 ⇒ 视为已选中。
//
// 右键 Group 的子项时,选区里持有的是 Group 而不是子项;若只比对 item.id,
// 会把一次"已选中"右键误判为"未选中",进而把 Group 选区拆成单个子项。
function isItemOrAncestorSelected(diagram: Diagram, selectionSet: DiagramItemSet, item: DiagramItem): boolean {
    let current: DiagramItem | undefined = item;

    while (current) {
        if (selectionSet.selection.has(current.id)) {
            return true;
        }

        current = diagram.parent(current);
    }

    return false;
}
