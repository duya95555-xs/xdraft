/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Keys, sizeInPx, ViewBox } from '@app/core';
import { Engine, EngineHitEvent, Listener } from '@app/wireframes/engine';
import { DefaultAppearance } from '@app/wireframes/interface';
import { Diagram, DiagramItem, DiagramItemSet } from '@app/wireframes/model';
import { Connector, connectorPoints, isConnector } from '@app/wireframes/shapes/neutral/_connector';
import { pointAtDistance, polylineLength } from '@app/wireframes/shapes/neutral/_connector-routing';
import './TextAdorner.scss';

const MIN_WIDTH = 150;
const MIN_HEIGHT = 30;

// 连线标签输入框的固定尺寸(屏幕像素):标签很短,不需要跟着连线长度拉伸。
const LABEL_WIDTH = 150;
const LABEL_HEIGHT = 30;

export interface TextAdornerProps {
    // The viewbox.
    viewBox: ViewBox;

    // The selected diagram.
    selectedDiagram: Diagram;

    // The selected items.
    selectionSet: DiagramItemSet;

    // The engine.
    engine: Engine;

    // A helper function to show adorners.
    showAdorners: () => void;

    // A helper function to hideAdorners adorners.
    hideAdorners: () => void;

    // A function to change the appearance of a visual.
    onChangeItemsAppearance: (diagram: Diagram, visuals: DiagramItem[], key: string, val: any) => any;
}

export class TextAdorner extends React.PureComponent<TextAdornerProps> implements Listener {
    private readonly style = { display: 'none ' };
    private selectedShape: DiagramItem | null = null;
    private textareaElement: HTMLTextAreaElement = null!;

    // 当前输入框编辑的是"连线标签"而不是形状文本(C3)。
    private labelMode = false;

    constructor(props: TextAdornerProps) {
        super(props);
        this.componentDidUpdate({} as any);
    }

    public componentDidMount() {
        window.addEventListener('mousedown', this.handleMouseDown);
    }

    public componentDidUpdate(prevProps: TextAdornerProps) {
        if (this.props.engine !== prevProps.engine) {
            if (prevProps.engine) {
                prevProps.engine.unsubscribe(this);
            }
    
            if (this.props.engine) {
                this.props.engine.subscribe(this);
            }
        }

        if (this.props.selectionSet !== prevProps.selectionSet) {
            this.updateText();
        }
    }

    public componentWillUnmount() {
        if (this.props.engine) {
            this.props.engine.unsubscribe(this);
        }

        window.removeEventListener('mousedown', this.handleMouseDown);
    }

    private handleMouseDown = (e: MouseEvent) => {
        if (e.target !== this.textareaElement) {
            this.hide();
        }
    };

    public onDoubleClick(event: EngineHitEvent) {
        if (event.item) {
            this.editItem(event.item);
        }
    }

    // 判断该 item 是否可以在本输入框里编辑:
    //   · 普通形状 → 有 text 能力(非 textDisabled)即可;
    //   · 连接线(C3)→ 标签固定写 CONNECTOR_TEXT,与 textDisabled 无关。
    private canEdit(item: DiagramItem | null): item is DiagramItem {
        if (!item || item.isLocked) {
            return false;
        }

        if (isConnector(item)) {
            return true;
        }

        return !item.textDisabled;
    }

    // Opens the inline text editor for the given item. Can also be triggered by shortcuts (F2).
    public editItem(item: DiagramItem | null) {
        if (!this.canEdit(item) || !this.textareaElement) {
            return;
        }

        const zoom = this.props.viewBox.zoom;
        const transform = item.transform;

        if (isConnector(item)) {
            // ── C3:连线标签 ────────────────────────────────────────────────
            // 输入框定位到"标签沿路径所在位置"(与渲染端 connect.ts 完全同一套计算),
            // 尺寸固定、居中于该点,这样输入时看到的文字就在最终显示的位置上。
            const box = this.labelBoxOf(item);

            if (!box) {
                return;
            }

            const x = sizeInPx(zoom * (box.x - this.props.viewBox.minX) - LABEL_WIDTH * 0.5);
            const y = sizeInPx(zoom * (box.y - this.props.viewBox.minY) - LABEL_HEIGHT * 0.5);

            this.textareaElement.value = String(item.appearance.get(Connector.TEXT) ?? '');
            this.textareaElement.style.top = y;
            this.textareaElement.style.left = x;
            this.textareaElement.style.width = sizeInPx(LABEL_WIDTH);
            this.textareaElement.style.height = sizeInPx(LABEL_HEIGHT);
            this.textareaElement.style.resize = 'none';
            this.textareaElement.style.display = 'block';
            this.textareaElement.style.position = 'absolute';
            // 让输入框水平/垂直居中于标签点。
            this.textareaElement.style.textAlign = 'center';
            this.textareaElement.style.paddingTop = sizeInPx(6);
            this.textareaElement.focus();
            this.textareaElement.select();

            this.labelMode = true;
            this.props.hideAdorners();
            this.selectedShape = item;
            return;
        }

        const x = sizeInPx(zoom * (transform.position.x - 0.5 * transform.size.x - this.props.viewBox.minX) - 2 );
        const y = sizeInPx(zoom * (transform.position.y - 0.5 * transform.size.y - this.props.viewBox.minY) - 2 );

        const w = sizeInPx(zoom * (Math.max(transform.size.x, MIN_WIDTH)) + 4);
        const h = sizeInPx(zoom * (Math.max(transform.size.y, MIN_HEIGHT)) + 4);

        this.textareaElement.value = item.text;
        this.textareaElement.style.top = y;
        this.textareaElement.style.left = x;
        this.textareaElement.style.width = w;
        this.textareaElement.style.height = h;
        this.textareaElement.style.resize = 'none';
        this.textareaElement.style.display = 'block';
        this.textareaElement.style.position = 'absolute';
        this.textareaElement.style.textAlign = '';
        this.textareaElement.style.paddingTop = '';
        this.textareaElement.focus();

        this.labelMode = false;
        this.props.hideAdorners();
        this.selectedShape = item;
    }

    // 连线标签所在的 diagram 绝对坐标:沿折线走 TEXT_POSITION 比例处的点。
    // 折线本身是局部坐标,需用 Transform 原点换算回绝对坐标。
    private labelBoxOf(item: DiagramItem): { x: number; y: number } | null {
        const local = connectorPoints(item);

        if (!local || local.length < 2) {
            return null;
        }

        const tpRaw = Number(item.appearance.get(Connector.TEXT_POSITION));
        const tp = Number.isFinite(tpRaw) ? Math.min(1, Math.max(0, tpRaw)) : 0.5;

        const at = pointAtDistance(local, tp * polylineLength(local));

        return { x: at.x + item.transform.left, y: at.y + item.transform.top };
    }

    private doInitialize = (textarea: HTMLTextAreaElement) => {
        this.textareaElement = textarea;
    };

    private doHide = () => {
        this.hide();
    };

    private doSubmit = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((Keys.isEnter(event) && !event.shiftKey) || Keys.isEscape(event)) {
            if (Keys.isEnter(event)) {
                this.updateText();
            }

            this.hide();
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private updateText() {
        if (!this.selectedShape) {
            return;
        }

        const textNew = this.textareaElement.value;

        // ── C3:连线标签写 CONNECTOR_TEXT,而不是形状文本 ──
        if (this.labelMode && isConnector(this.selectedShape)) {
            const textOld = String(this.selectedShape.appearance.get(Connector.TEXT) ?? '');

            if (textNew !== textOld) {
                this.props.onChangeItemsAppearance(this.props.selectedDiagram, [this.selectedShape], Connector.TEXT, textNew);
            }

            this.hide();
            return;
        }

        const textOld = this.selectedShape.text;

        if (textNew !== textOld) {
            this.props.onChangeItemsAppearance(this.props.selectedDiagram, [this.selectedShape], DefaultAppearance.TEXT, textNew);
        }

        this.hide();
    }

    private hide() {
        this.selectedShape = null;
        this.labelMode = false;

        this.textareaElement.style.width = '0';
        this.textareaElement.style.display = 'none';

        this.props.showAdorners();
    }

    public render() {
        return (
            <textarea className='ant-input ant-input-outlined ant-input-css-var no-border-radius text-adorner-textarea'
                ref={this.doInitialize}
                onBlur={this.doHide}
                onKeyDown={this.doSubmit}
                style={this.style} />
        );
    }
}
