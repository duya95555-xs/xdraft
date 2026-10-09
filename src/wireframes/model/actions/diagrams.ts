/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ActionReducerMapBuilder, createAction } from '@reduxjs/toolkit';
import { Color, MathHelper, Vec2 } from '@app/core/utils';
import { Diagram, EditorState } from './../internal';
import { createDiagramAction, DiagramRef } from './utils';

export const addDiagram =
    createAction('diagram/add', (diagramId?: string) => {
        return { payload: createDiagramAction(diagramId || MathHelper.nextId()) };
    });

export const selectDiagram =
    createAction('diagram/select', (diagram: DiagramRef) => {
        return { payload: createDiagramAction(diagram) };
    });

export const removeDiagram =
    createAction('diagram/remove', (diagram: DiagramRef) => {
        return { payload: createDiagramAction(diagram) };
    });

export const duplicateDiagram =
    createAction('diagram/diagram', (diagram: DiagramRef) => {
        return { payload: createDiagramAction(diagram) };
    });

export const moveDiagram =
    createAction('diagram/move', (diagram: DiagramRef, index: number) => {
        return { payload: createDiagramAction(diagram, { index }) };
    });

export const renameDiagram =
    createAction('diagram/rename', (diagram: DiagramRef, title: string) => {
        return { payload: createDiagramAction(diagram, { title }) };
    });

export const setDiagramMaster =
    createAction('diagram/master', (diagram: DiagramRef, master: string | undefined) => {
        return { payload: createDiagramAction(diagram, { master }) };
    });

export const changeSize =
    createAction('editor/size', (width: number, height: number) => {
        return { payload:  { width, height } };
    });

export const changeColor =
    createAction('editor/color', (color: Color) => {
        return { payload:  { color: color.toString() } };
    });

// 文档名(文档级, 不是页标题)。
//
// 与 renameDiagram(改某一页的标题)是两件事 —— 文档名决定"存到哪个文件",
// 页标题只影响画布上显示的名字。混用正是"切页就换文件"的老毛病。
export const renameDocument =
    createAction('editor/rename', (name: string | undefined) => {
        return { payload: { name } };
    });

export function buildDiagrams(builder: ActionReducerMapBuilder<EditorState>) {
    return builder
        .addCase(selectDiagram, (state, action) => {
            const { diagramId } = action.payload;

            return state.selectDiagram(diagramId);
        })
        .addCase(renameDiagram, (state, action) => {
            const { diagramId, title } = action.payload;

            return state.updateDiagram(diagramId, diagram => diagram.rename(title));
        })
        .addCase(setDiagramMaster, (state, action) => {
            const { diagramId, master } = action.payload;

            return state.updateDiagram(diagramId, diagram => diagram.setMaster(master));
        })
        .addCase(removeDiagram, (state, action) => {
            const { diagramId } = action.payload;

            return state.removeDiagram(diagramId);
        })
        .addCase(moveDiagram, (state, action) => {
            const { diagramId, index } = action.payload;

            return state.moveDiagram(diagramId, index);
        })
        .addCase(changeSize, (state, action) => {
            const { width, height } = action.payload;

            return state.changeSize(new Vec2(width, height));
        })
        .addCase(changeColor, (state, action) => {
            const { color } = action.payload;

            return state.changeColor(Color.fromString(color));
        })
        .addCase(renameDocument, (state, action) => {
            const { name } = action.payload;

            return state.rename(name);
        })
        .addCase(duplicateDiagram, (state, action) => {
            const { diagramId } = action.payload;

            const diagram = state.diagrams.get(diagramId);

            if (!diagram) {
                return state;
            }

            return state.addDiagram(diagram.clone());
        })
        .addCase(addDiagram, (state, action) => {
            const { diagramId } = action.payload;

            let newState = state.addDiagram(Diagram.create({ id: diagramId }));

            if (newState.diagrams.size === 1) {
                newState = newState.selectDiagram(diagramId);
            }

            return newState;
        });
}
