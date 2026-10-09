/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { ImmutableList,  Subscription } from '@app/core';
import { EngineItem, EngineLayer } from '@app/wireframes/engine';
import { Diagram, DiagramItem, PluginRegistry } from '@app/wireframes/model';
import { PreviewEvent } from './preview';

export interface ItemsLayerProps {
    // The selected diagram.
    diagrams: Diagram[];

    // The container to render on.
    diagramLayer: EngineLayer;

    // The preview subscription.
    preview?: Subscription<PreviewEvent>;

    // True when rendered.
    onRender?: () => void;
}

export const ItemsLayer = React.memo((props: ItemsLayerProps) => {
    const {
        diagrams,
        diagramLayer,
        onRender,
        preview,
    } = props;

    const shapesRendered = React.useRef(onRender);
    const shapeRefsById = React.useRef<Record<string, ItemWithPreview>>({});
    const lastShapeIds = React.useRef<string>('');

    const orderedShapes = React.useMemo(() => {
        const result: DiagramItem[] = [];

        for (const diagram of diagrams) {
            const handleContainer: (itemIds: ImmutableList<string>) => void 
            = itemIds => {
                for (const id of itemIds.values) {
                    const item = diagram.items.get(id);

                    if (item) {
                        if (item.type === 'Shape') {
                            result.push(item);
                        }

                        if (item.type === 'Group') {
                            handleContainer(item.childIds);
                        }
                    }
                }
            };

            handleContainer(diagram.rootIds);
        }

        return result;
    }, [diagrams]);

    React.useEffect(() => {
        const allShapesById: { [id: string]: boolean } = {};
        const allShapes = orderedShapes;

        allShapes.forEach(item => {
            allShapesById[item.id] = true;
        });

        const references = shapeRefsById.current;

        // Delete old shapes.
        for (const [id, ref] of Object.entries(references)) {
            if (!allShapesById[id]) {
                ref.remove();

                delete references[id];
            }
        }

        // Create missing shapes.
        for (const shape of allShapes) {
            if (!references[shape.id]) {
                const plugin = PluginRegistry.get(shape.renderer)?.plugin;

                if (!plugin) {
                    throw new Error(`Cannot find renderer for ${shape.renderer}.`);
                }

                references[shape.id] = new ItemWithPreview(diagramLayer.item(plugin));
            }
        }

        // ── DOM 与 allShapes 保持一致:按"形状 id 序列"判定是否需要整体重挂 ──────
        //
        // 判据用 **id 序列**(`id1,id2,...`),而不是每个元素的下标。下标簿记有两个隐患:
        //   · 它依赖有副作用的 checkIndex(),一旦某轮比较被提前中断,
        //     后面元素的 currentIndex 会停留在旧值,下一轮结果就是错的;
        //   · 它只能发现"位置变了",发现不了"旧节点没被摘掉"这类残留。
        //
        // 「删 1 个、加 4 个」这类重排会让元素数量与顺序同时变化。只要序列与上一轮不同,
        // 就把**所有**节点先 detach 再按新顺序 plot(),图层 DOM 的元素与顺序因此严格
        // 等于 allShapes —— 旧节点不可能残留(残留节点仍会被命中测试命中,表现为
        // "点击一个已经被删除的形状仍有反应")。
        const currentIds = allShapes.map(x => x.id).join(',');
        const mustReattach = currentIds !== lastShapeIds.current;

        lastShapeIds.current = currentIds;

        if (mustReattach) {
            for (const ref of Object.values(references)) {
                ref.detach();
            }
        }

        for (const shape of allShapes) {
            references[shape.id].plot(shape);
        }

        if (shapesRendered.current) {
            shapesRendered.current();
        }
    }, [diagramLayer, orderedShapes]);

    React.useEffect(() => {
        return preview?.subscribe(event => {
            if (event.type === 'Update') {
                for (const item of Object.values(event.items)) {
                    shapeRefsById.current[item.id]?.preview(item);
                }
            } else {
                for (const reference of Object.values(shapeRefsById.current)) {
                    reference.preview(null);
                }
            }
        });
    }, [preview]);

    return null;
});

class ItemWithPreview {
    private shapePreview: DiagramItem | null = null;
    private shapeStatic: DiagramItem | null = null;

    constructor(
        private readonly engineItem: EngineItem,
    ) {
    }

    public plot(shape: DiagramItem) {
        this.shapeStatic = shape;
        this.shapePreview = null;
        this.render();
    }

    public preview(shape: DiagramItem | null) {
        this.shapePreview = shape;
        this.render();
    }

    public detach() {
        this.engineItem.detach();
    }
    
    public remove() {
        this.engineItem.remove();
    }

    private render() {
        this.engineItem.plot(this.shapePreview || this.shapeStatic);
    }
}
