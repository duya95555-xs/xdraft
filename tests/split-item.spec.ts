/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

// 分割图片 reducer + 选区投影的回归测试(纯逻辑,jsdom 即可)。
// 运行:CI=1 npx vitest run tests/split-item.spec.ts
//
// 覆盖第五轮第 6 条:
//   ① 分割后原图必须从 diagram 中彻底消失
//   ② 分割后 selectedIds 必须换成 4 个 tile
//   ③ getSelection 投影必须返回 4 个 tile(而不是记忆化命中旧的原图集合)

import { describe, expect, it } from 'vitest';
import { Rect2 } from '@app/core';
import {
    ASPECT_RATIO,
    computeSplitTiles,
    createClassReducer,
    Diagram,
    DiagramItem,
    DiagramItemSet,
    EditorState,
    IMAGE_CROP,
    splitImage,
    Transform,
} from '@app/wireframes/model';
import { buildSplit } from '@app/wireframes/model/actions/split';

const DIAGRAM_ID = 'd1';

// 图片尺寸:400x300,原点在 (100, 100)。
const IMAGE_RECT = new Rect2(100, 100, 400, 300);

function createImage(id = 'img'): DiagramItem {
    return DiagramItem.createShape({
        id,
        renderer: 'Image',
        transform: Transform.fromRect(IMAGE_RECT),
        appearance: {
            [IMAGE_CROP]: '0,0,1,1',
            [ASPECT_RATIO]: '',
        },
    });
}

// 真实 reducer:直接复用 createClassReducer + buildSplit,避免测试里再抄一遍逻辑。
function createEditorReducer() {
    const initial = EditorState.create({
        diagrams: { [DIAGRAM_ID]: Diagram.create({ id: DIAGRAM_ID }) },
        diagramIds: [DIAGRAM_ID],
    });

    return createClassReducer(initial, builder => buildSplit(builder));
}

function seed(image: DiagramItem): EditorState {
    return EditorState.create({
        diagrams: { [DIAGRAM_ID]: Diagram.create({ id: DIAGRAM_ID }) },
        diagramIds: [DIAGRAM_ID],
    }).updateDiagram(DIAGRAM_ID, d => d.addShape(image).selectItems([image.id]));
}

function diagramOf(state: EditorState): Diagram {
    return state.diagrams.get(DIAGRAM_ID)!;
}

// 复刻 projections.ts 里的 getSelection(不依赖 react-redux / reselect)。
function selectProjection(state: EditorState): DiagramItemSet {
    const diagram = diagramOf(state);

    return DiagramItemSet.createFromDiagram(diagram.selectedIds.values, diagram);
}

const POINT = { x: 300, y: 250 };

describe('computeSplitTiles', () => {
    it('把点切成 2x2 = 4 块', () => {
        expect(computeSplitTiles(IMAGE_RECT, POINT)).toHaveLength(4);
    });

    it('点在图片外但纵向穿过时切成上下 2 块', () => {
        expect(computeSplitTiles(IMAGE_RECT, { x: 300, y: 10 })).toHaveLength(2);
    });

    it('点完全在图片外(横纵都不穿)时不出块', () => {
        expect(computeSplitTiles(IMAGE_RECT, { x: 10, y: 10 })).toHaveLength(0);
    });

    it('切块几何相邻且拼回原图', () => {
        const merged = Rect2.fromRects(computeSplitTiles(IMAGE_RECT, POINT));

        expect(merged.x).toBeCloseTo(IMAGE_RECT.x);
        expect(merged.y).toBeCloseTo(IMAGE_RECT.y);
        expect(merged.w).toBeCloseTo(IMAGE_RECT.w);
        expect(merged.h).toBeCloseTo(IMAGE_RECT.h);
    });
});

describe('splitImage reducer', () => {
    it('① 原图必须从 items / rootIds 中彻底消失', () => {
        const reducer = createEditorReducer();
        const image = createImage();

        let state = seed(image);
        expect(diagramOf(state).items.size).toBe(1);

        state = reducer(state, splitImage(DIAGRAM_ID, image, POINT));

        const diagram = diagramOf(state);

        expect(diagram.items.get(image.id)).toBeUndefined();
        expect(diagram.rootIds.values).not.toContain(image.id);
        expect(diagram.items.size).toBe(4);
        expect(diagram.rootIds.values).toHaveLength(4);
    });

    it('② selectedIds 必须是 4 个 tile,不能残留原图 id', () => {
        const reducer = createEditorReducer();
        const image = createImage();

        let state = seed(image);
        state = reducer(state, splitImage(DIAGRAM_ID, image, POINT));

        const diagram = diagramOf(state);
        const selected = diagram.selectedIds.values;

        expect(selected).toHaveLength(4);
        expect(selected).not.toContain(image.id);

        for (const id of selected) {
            expect(diagram.items.get(id)).toBeDefined();
        }
    });

    it('③ getSelection 投影必须是 4 个 tile,且没有覆盖整图的 bounds', () => {
        const reducer = createEditorReducer();
        const image = createImage();

        let state = seed(image);
        state = reducer(state, splitImage(DIAGRAM_ID, image, POINT));

        const set = selectProjection(state);

        expect(set.selectedItems).toHaveLength(4);

        const diagram = diagramOf(state);

        for (const item of set.selectedItems) {
            const b = item.bounds(diagram).aabb;

            // 没有一个 tile 的 bounds 等于原图 —— 这是"选框盖住整个大图"的直接判据。
            expect(b.w).toBeLessThan(IMAGE_RECT.w + 1);
            expect(b.h).toBeLessThan(IMAGE_RECT.h + 1);
        }

        // 投影里的 id 必须全部存在于 diagram 中(否则 marker 会画在幽灵对象上)。
        for (const item of set.selectedItems) {
            expect(diagram.items.get(item.id)).toBeDefined();
        }
    });

    it('④ 每个 tile 面积之和约等于原图面积', () => {
        const reducer = createEditorReducer();
        const image = createImage();

        let state = seed(image);
        state = reducer(state, splitImage(DIAGRAM_ID, image, POINT));

        const diagram = diagramOf(state);
        const area = diagram.selectedIds.values
            .map(id => diagram.items.get(id)!.bounds(diagram).aabb)
            .reduce((sum, r) => sum + r.w * r.h, 0);

        expect(area).toBeCloseTo(IMAGE_RECT.w * IMAGE_RECT.h, 0);
    });

    it('⑤ 二次分割某一块 tile 后只剩该块的子块', () => {
        const reducer = createEditorReducer();
        const image = createImage();

        let state = seed(image);
        state = reducer(state, splitImage(DIAGRAM_ID, image, POINT));

        const diagram1 = diagramOf(state);
        const tileId = diagram1.selectedIds.values[0];
        const tile = diagram1.items.get(tileId)!;
        const tileRect = tile.bounds(diagram1).aabb;

        // 在该 tile 内部再切一刀。
        const innerPoint = { x: tileRect.x + tileRect.w * 0.5, y: tileRect.y + tileRect.h * 0.5 };

        state = reducer(state, splitImage(DIAGRAM_ID, tile, innerPoint));

        const diagram2 = diagramOf(state);

        // 原 4 块中,被切的这块消失,取代为 4 个小块 => 3 + 4 = 7。
        expect(diagram2.items.get(tileId)).toBeUndefined();
        expect(diagram2.items.size).toBe(7);
        expect(diagram2.items.get(image.id)).toBeUndefined();
    });
});
