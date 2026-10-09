/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { createAction, createAsyncThunk, createReducer, Middleware } from '@reduxjs/toolkit';
import { saveAs } from 'file-saver';
import { AnyAction, Reducer } from 'redux';
import { isPackagedApp, logError, logInfo, logWarn } from '@app/core';
import { texts } from '@app/texts';
import { EditorState, EditorStateInStore, LoadingState, LoadingStateInStore, saveRecentDiagrams, saveRecentLocal, Serializer, trimRecentLocal, UndoableState } from './../internal';
import { getDiagram, postDiagram, putDiagram, putDiagramToServerFile, readLocalDiagram, saveDiagramAsToLocal } from './api';
import { addDiagram, selectDiagram } from './diagrams';
import { selectItems } from './items';
import { migrateOldAction } from './obsolete';
import { showToast } from './ui';

export const newDiagram =
    createAction('diagram/new', (navigate: boolean) => {
        return { payload: { navigate } };
    });

export const loadDiagramFromFile =
    createAsyncThunk('diagram/load/file', async (args: { file: File }) => {
        const stored = JSON.parse(await args.file.text());

        return { stored };
    });

export const loadDiagramFromServer =
    createAsyncThunk('diagram/load/server', async (args: { tokenToRead: string; tokenToWrite?: string; navigate: boolean }) => {
        const stored = await getDiagram(args.tokenToRead);

        return { tokenToRead: args.tokenToRead, tokenToWrite: args.tokenToWrite, stored };
    });

export const loadDiagramInternal =
    createAction('diagram/load/actions', (stored: any, requestId: string) => {
        return { payload: { stored, requestId } };
    });

// 从本机目录打开(Electron IPC)。以前"最近"里的 local:// 条目只能弹一个文件选择框
// (浏览器安全限制, 拿不到真实路径), 现在能真正按名字读回来。
export const loadDiagramFromLocal =
    createAsyncThunk('diagram/load/local', async (args: { name: string }) => {
        const stored = await readLocalDiagram(args.name);

        return { name: args.name, stored };
    });

// ── 保存状态(供自动保存使用) ────────────────────────────────────────────────
//
// loading slice 的 reducer 看不到 editor slice, 拿不到 revision, 因此由中间件在
// thunk 结束后把这些"跨 slice 的事实"派发进来。

export const saveStarted =
    createAction('diagram/save/started');

export const saveSucceeded =
    createAction('diagram/save/succeeded', (revision: number, at: number) => {
        return { payload: { revision, at } };
    });

export const saveCancelled =
    createAction('diagram/save/cancelled');

// 加载完成后对齐"已保存基线"。
//
// ⚠️ 不能简单地把 savedRevision 置 0: 旧格式要逐条重放动作, revision 会累积到动作条数
// (最多 50)。那样刚打开的文件立刻被判为"有未保存改动", 8 秒后就被自动保存一次 ——
// 而且会把用户"从文件打开"的文档悄悄另存到本机目录。
export const loadCompleted =
    createAction('diagram/load/completed', (revision: number) => {
        return { payload: { revision } };
    });

export const saveFailed =
    createAction('diagram/save/failed', (message: string, at: number) => {
        return { payload: { message, at } };
    });

export const saveDiagramToFile =
    createAsyncThunk('diagram/save/file', async (fileName: string | undefined, thunkAPI) => {
        const state = thunkAPI.getState() as EditorStateInStore;

        // 快照当前 revision: 保存是异步的, 期间用户可能继续编辑, 不能用"完成那一刻"的 revision。
        const revision = state.editor.revision;
        const body = getSaveState(state);

        // 文件名来自**文档名**,不再取"当前选中页的标题" —— 后者会让"切页 / 改页名"
        // 变成换文件。没起过名字时用 suggestedName(第一页标题),这只是一次性预填。
        const name = sanitizeFileName(fileName || state.editor.present.suggestedName);

        // Electron: 走系统"另存为"对话框(有真实路径和覆盖确认);
        // 浏览器: 返回 null, 回落到 file-saver 的下载。
        const result = await saveDiagramAsToLocal(body, name);

        if (result) {
            if (result.canceled) {
                return { canceled: true, fileName: '', revision };
            }

            return { canceled: false, fileName: result.file, revision };
        }

        const bodyText = JSON.stringify(body, undefined, 4);
        const bodyBlob = new Blob([bodyText], { type: 'application/json' });

        saveAs(bodyBlob, `${name}.json`);

        return { canceled: false, fileName: `local://${name}`, revision };
    });

// Removes characters that are not allowed in file names.
function sanitizeFileName(fileName: string) {
    const name = fileName.trim().replace(/[\\/:*?"<>|]/g, '-');

    return name.length > 0 ? name : 'diagram';
}

export const saveDiagramToServer =
    createAsyncThunk('diagram/save/server', async (args: { navigate?: boolean; operationId?: string; silent?: boolean }, thunkAPI) => {
        // 打包版不随包提供后端, 云端链路注定失败。这里直接挡住 —— 免得残留的
        // saveTarget = 'cloud' 偏好(或程序化调用)又去发一个必然失败的请求。
        if (isPackagedApp()) {
            throw Error('Cloud storage is not available in the packaged app');
        }

        const state = thunkAPI.getState() as LoadingStateInStore & EditorStateInStore;

        const revision = state.editor.revision;
        const tokenToWrite = state.loading.tokenToWrite;
        const tokenToRead = state.loading.tokenToRead;

        if (tokenToRead && tokenToWrite) {
            await putDiagram(tokenToRead, tokenToWrite, getSaveState(state));

            return { tokenToRead, tokenToWrite, update: true, navigate: args.navigate, revision };
        } else {
            const { readToken, writeToken } = await postDiagram(getSaveState(state));

            // 显式给 update: false —— 两个分支形状一致, 免得 payload 变成 union 后
            // `action.payload.update` 在类型上不存在。
            return { tokenToRead: readToken, tokenToWrite: writeToken, update: false, navigate: args.navigate, revision };
        }
    });

export const saveDiagramToServerFile =
    createAsyncThunk('diagram/save/serverFile', async (args: { fileName?: string; silent?: boolean } | undefined, thunkAPI) => {
        const state = thunkAPI.getState() as EditorStateInStore;

        const revision = state.editor.revision;

        // 同上:落盘名一律取文档名。
        const name = sanitizeFileName(args?.fileName || state.editor.present.documentName);

        const result = await putDiagramToServerFile(name, getSaveState(state));

        return { file: result.file, name, revision };
    });

export function loadingMiddleware(): Middleware {
    const middleware: Middleware = store => next => action => {        
        // 反序列化就在紧接着的 next(action) 里发生(reducer 是同步的),所以计数必须
        // 在它**之前**清零 —— 不能用异步方式推迟。
        if (loadDiagramInternal.match(action)) {
            Serializer.resetSkippedItems();
        }

        const isLoadStarted =
            loadDiagramFromServer.pending.match(action) ||
            loadDiagramFromFile.pending.match(action) ||
            loadDiagramFromLocal.pending.match(action);

        const isSaveStarted =
            saveDiagramToServer.pending.match(action) ||
            saveDiagramToFile.pending.match(action) ||
            saveDiagramToServerFile.pending.match(action);

        // 自动保存不弹任何提示: 每 8 秒闪一次"正在保存 / 已保存"只会把界面变成噪声。
        const silent = !!(action as any).meta?.arg?.silent;

        if (isLoadStarted) {
            logInfo('load', `Loading diagram started (request ${action.meta.requestId}).`);

            store.dispatch(showToast(texts.common.loadingDiagram, 'loading', action.meta.requestId));
        } else if (isSaveStarted) {
            logInfo('save', `Saving diagram started${silent ? ' (auto)' : ''} (request ${action.meta.requestId}).`);

            store.dispatch(saveStarted());

            if (!silent) {
                store.dispatch(showToast(texts.common.savingDiagram, 'loading', action.meta.requestId));
            }
        }

        try {
            const result = next(action);

            if (loadDiagramFromServer.fulfilled.match(action)) {
                store.dispatch(loadDiagramInternal(action.payload.stored, action.meta.requestId));
            } else if (loadDiagramFromFile.fulfilled.match(action)) {
                logInfo('load', `Diagram loaded from file "${action.meta.arg.file.name}".`);

                store.dispatch(loadDiagramInternal(action.payload.stored, action.meta.requestId));
            } else if (loadDiagramFromLocal.fulfilled.match(action)) {
                logInfo('load', `Diagram loaded from local store "${action.payload.name}".`);

                store.dispatch(loadDiagramInternal(action.payload.stored, action.meta.requestId));
            } else if (loadDiagramFromServer.rejected.match(action) ||
                       loadDiagramFromFile.rejected.match(action) ||
                       loadDiagramFromLocal.rejected.match(action)) {
                logError('load', 'Loading diagram failed.', action.error?.message);

                store.dispatch(showToast(texts.common.loadingDiagramFailed, 'error', action.meta.requestId));
            } else if (loadDiagramInternal.match(action)) {
                // 加载完成后把"已保存基线"对齐到 editor 当前的 revision(旧格式重放后不为 0)。
                store.dispatch(loadCompleted((store.getState() as EditorStateInStore).editor.revision));

                const skipped = Serializer.getSkippedItems();

                if (skipped > 0) {
                    // "内容不完整"比"加载成功"重要得多,优先提示这一条。
                    logWarn('load', `Diagram loaded, but ${skipped} unsupported item(s) were skipped.`);

                    store.dispatch(showToast(texts.common.loadingDiagramSkipped(skipped), 'warning', action.payload.requestId));
                } else {
                    store.dispatch(showToast(texts.common.loadingDiagramDone, 'success', action.payload.requestId));
                }
            } else if (saveDiagramToServer.fulfilled.match(action)) {
                logInfo('save', action.payload.update ?
                    `Diagram saved to server (token ${action.payload.tokenToRead}).` :
                    `Diagram created on server (token ${action.payload.tokenToRead}).`);

                store.dispatch(saveSucceeded(action.payload.revision, Date.now()));

                saveRecentDiagrams((store.getState() as LoadingStateInStore).loading.recentDiagrams);

                if (!silent) {
                    const content = action.payload.update ? 
                        texts.common.savingDiagramDone :
                        texts.common.savingDiagramDoneUrl(`${window.location.protocol}//${window.location.host}/${action.payload.tokenToRead}`);

                    store.dispatch(showToast(content, 'success', action.meta.requestId, 1000));
                }
            } else if (saveDiagramToServerFile.fulfilled.match(action)) {
                const { recentLocal } = (store.getState() as LoadingStateInStore).loading;

                logInfo('save', `Diagram saved to local store "${action.payload.file}" (request ${action.meta.requestId}).`);

                store.dispatch(saveSucceeded(action.payload.revision, Date.now()));

                saveRecentLocal(recentLocal);

                if (!silent) {
                    store.dispatch(showToast(texts.common.savingDiagramDoneLocal(action.payload.name), 'success', action.meta.requestId));
                }
            } else if (saveDiagramToFile.fulfilled.match(action)) {
                if (action.payload.canceled) {
                    // 用户在"另存为"对话框里点了取消 —— 既不是失败,也不能算已保存。
                    logInfo('save', `Saving diagram to file was cancelled (request ${action.meta.requestId}).`);

                    store.dispatch(saveCancelled());
                } else {
                    logInfo('save', `Diagram saved to file "${action.payload.fileName}" (request ${action.meta.requestId}).`);

                    store.dispatch(saveSucceeded(action.payload.revision, Date.now()));

                    saveRecentDiagrams((store.getState() as LoadingStateInStore).loading.recentDiagrams);

                    store.dispatch(showToast(texts.common.savingDiagramDone, 'success', action.meta.requestId));
                }
            } else if (saveDiagramToServer.rejected.match(action) ||
                       saveDiagramToFile.rejected.match(action) ||
                       saveDiagramToServerFile.rejected.match(action)) {
                const message = action.error?.message || 'unknown error';

                logError('save', `Saving diagram failed${silent ? ' (auto)' : ''}.`, message);

                store.dispatch(saveFailed(message, Date.now()));

                // 自动保存失败只提示一次(此时 autoSaveFailCount 已含本次),之后交给退避重试;
                // 手动保存每次都提示。
                const failCount = (store.getState() as LoadingStateInStore).loading.autoSaveFailCount;

                if (!silent || failCount <= 1) {
                    store.dispatch(showToast(`${texts.common.savingDiagramFailed} ${texts.common.saveFailedHint}`, 'error', action.meta.requestId));
                }
            }

            return result;
        } catch (ex) {
            if (loadDiagramInternal.match(action)) {
                logError('load', 'Loading diagram failed.', ex instanceof Error ? ex.message : ex);

                store.dispatch(showToast(texts.common.loadingDiagramFailed, 'error', action.payload.requestId));
            } else {
                logWarn('app', 'Unexpected error while processing action.', ex instanceof Error ? ex.message : ex);
            }
            
            console.error(ex);
            throw ex;
        }
    };

    return middleware;
}

export function loading(initialState: LoadingState) {
    return createReducer(initialState, builder => builder
        .addCase(newDiagram, (state) => {
            state.isLoading = false;
            state.tokenToRead = null;
            state.tokenToWrite = null;
            forgetSaveTracking(state);
        })
        .addCase(loadDiagramFromServer.pending, (state) => {
            state.isLoading = true;
        })
        .addCase(loadDiagramFromServer.rejected, (state) => {
            state.isLoading = false;
        })
        .addCase(loadDiagramFromServer.fulfilled, (state, action) => {
            state.isLoading = false;
            state.tokenToRead = action.payload?.tokenToRead;
            state.tokenToWrite = action.payload?.tokenToWrite;
            forgetSaveTracking(state);
        })
        .addCase(loadDiagramFromFile.fulfilled, (state) => {
            // 打开本地文件后必须把云 token 清掉(S-04)。
            //
            // 否则这条路径会出事:先打开云文档 A → 再"从文件打开"本地 B.json →
            // tokenToRead / tokenToWrite 仍然是 A 的 ⇒ 只要 saveTarget = 'cloud',
            // Ctrl+S 或自动保存就会把 **B 的内容 PUT 覆盖到 A 上**。
            //
            // ⚠️ 不能改在 loadDiagramInternal 里清 —— 云端加载同样会派发它,
            // 那样会把刚在 loadDiagramFromServer.fulfilled 里设好的 token 立刻清掉。
            state.isLoading = false;
            state.tokenToRead = null;
            state.tokenToWrite = null;
            forgetSaveTracking(state);
        })
        .addCase(loadDiagramFromLocal.pending, (state) => {
            state.isLoading = true;
        })
        .addCase(loadDiagramFromLocal.rejected, (state) => {
            state.isLoading = false;
        })
        .addCase(loadDiagramFromLocal.fulfilled, (state) => {
            // 本机文档同样不是云文档。
            state.isLoading = false;
            state.tokenToRead = null;
            state.tokenToWrite = null;
            forgetSaveTracking(state);
        })
        .addCase(saveStarted, (state) => {
            state.isSaving = true;
        })
        .addCase(loadCompleted, (state, action) => {
            // 刚打开的文档 = 与磁盘一致, 无论它的 revision 被重放到多少。
            state.isSaving = false;
            state.savedRevision = action.payload.revision;
            state.lastSavedAt = null;
            state.autoSaveFailCount = 0;
        })
        .addCase(saveSucceeded, (state, action) => {
            state.isSaving = false;
            state.savedRevision = action.payload.revision;
            state.lastSavedAt = action.payload.at;
            state.autoSaveFailCount = 0;
        })
        .addCase(saveCancelled, (state) => {
            // 取消不算失败, 不动 autoSaveFailCount(否则一次取消就会触发退避)。
            state.isSaving = false;
        })
        .addCase(saveFailed, (state) => {
            state.isSaving = false;
            state.autoSaveFailCount += 1;
        })
        .addCase(saveDiagramToServerFile.pending, (state) => {
            state.isLoading = true;
        })
        .addCase(saveDiagramToServerFile.rejected, (state) => {
            state.isLoading = false;
        })
        .addCase(saveDiagramToServerFile.fulfilled, (state, action) => {
            state.isLoading = false;
            // 顺带裁剪: 这张表不裁会随使用无限增长。
            state.recentLocal = trimRecentLocal({ ...state.recentLocal, [action.payload.name]: new Date().getTime() });
        })
        .addCase(saveDiagramToServer.pending, (state) => {
            state.isLoading = true;
        })
        .addCase(saveDiagramToServer.rejected, (state) => {
            state.isLoading = false;
        })
        .addCase(saveDiagramToFile.fulfilled, (state, action) => {
            const { canceled, fileName } = action.payload;

            // 只有浏览器"下载"那种没有路径的情形才记(local://<名字>), 它至少能提示用户
            // 刚才存过什么。Electron 的"另存为"拿到的是真实文件路径, 按它没法回读,
            // 记进这张按 token 打开的云端表反而会多出一个点不开的死条目。
            if (!canceled && fileName.startsWith('local://')) {
                state.recentDiagrams[fileName] = { date: new Date().getTime() };
            }
        })
        .addCase(saveDiagramToServer.fulfilled, (state, action) => {
            const { tokenToRead, tokenToWrite } = action.payload;

            state.isLoading = false;
            state.tokenToRead = tokenToRead;
            state.tokenToWrite = tokenToWrite;
            state.recentDiagrams[tokenToRead] = { date: new Date().getTime(), tokenToWrite };
        }));
}

// 刚新建 / 刚打开的文档 = 与磁盘(或服务器)一致, 没有未保存改动。
// 这里把 savedRevision 归零, 与 rootLoading 里重建 editor 后的 revision = 0 对齐;
// 否则"打开文档后立刻被自动保存一次"会重演。
function forgetSaveTracking(state: LoadingState) {
    state.isSaving = false;
    state.savedRevision = 0;
    state.lastSavedAt = null;
    state.autoSaveFailCount = 0;
}

export function rootLoading(undoableReducer: Reducer<UndoableState<EditorState>>, editorReducer: Reducer<EditorState>): Reducer<any> {
    return (state: any, action: any) => {
        if (newDiagram.match(action)) {
            const initialAction = addDiagram();
            const initialState = editorReducer(EditorState.create(), initialAction);

            state = UndoableState.create(initialState, initialAction);
        } else if (loadDiagramInternal.match(action)) {
            const stored = action.payload.stored;

            let editor = isVersion2Format(stored) ?
                loadVersion2(stored) :
                loadLegacy(stored, editorReducer, undoableReducer);

            // 恢复"上次选中的页"(v2 的快照里才存了它)。
            // 若该页已不存在(旧文件、或页面被删过),退回第一页 —— 与以前的行为一致。
            const selectedDiagram = editor.present.diagrams.get(editor.present.selectedDiagramId!);

            if (!selectedDiagram) {
                const firstDiagram = editor.present.orderedDiagrams[0];

                if (firstDiagram) {
                    editor = undoableReducer(editor, selectDiagram(firstDiagram));
                }
            }

            state = editor;
        }

        return undoableReducer(state, action);
    };
}

// 旧格式:基线快照 + ≤51 条动作日志,必须逐条重放。仍然保留 —— 用户手上已有这类文件。
function loadLegacy(stored: any, editorReducer: Reducer<EditorState>, undoableReducer: Reducer<UndoableState<EditorState>>): UndoableState<EditorState> {
    const initialState = stored.initial ?
        Serializer.deserializeEditor(stored.initial) :
        EditorState.create();

    const actions: AnyAction[] = stored.actions || stored;

    let firstAction = actions[0];

    if (!firstAction) {
        firstAction = addDiagram();
    }

    let editor = UndoableState.create(editorReducer(initialState, firstAction), firstAction);

    for (const loadedAction of actions.slice(1).filter(handleAction)) {
        editor = undoableReducer(editor, migrateOldAction(loadedAction));
    }

    return editor;
}

// v2:纯快照,一次反序列化搞定,不需要重放。
// 撤销栈从"打开这一刻"重新开始(有意为之,见 getSaveState 的说明)。
function loadVersion2(stored: any): UndoableState<EditorState> {
    return UndoableState.create(Serializer.deserializeEditor(stored.editor));
}

// ── 存档格式 v2(纯快照)────────────────────────────────────────────────────
//
// 旧格式 { initial: 全量快照, actions: ≤51 条动作日志 } 的问题:
//   · 体积约等于文档的两倍;
//   · 加载必须逐条重放,并依赖 migrateOldAction 做兼容;
//   · 只保护"快照 + 最近 50 步",更早的信息(如画布底色)一旦掉出窗口就永久丢失。
//
// v2 直接存当前状态:{ version: 2, name, savedAt, editor: serializeEditor(present) }。
// 更小、可读、免重放,并且因为存的是 present,color / selectedDiagramId 这些
// "只在 present 上才正确"的字段终于能被完整保存。
//
// ⚠️ 代价(已确认接受):不再携带动作日志 ⇒ **重开文件后撤销栈为空**。
const SAVE_FORMAT_VERSION = 2;

function getSaveState(state: EditorStateInStore) {
    const editor = state.editor.present;

    return {
        version: SAVE_FORMAT_VERSION,
        name: editor.documentName,
        savedAt: new Date().getTime(),
        editor: Serializer.serializeEditor(editor),
    };
}

// 判别存档格式:v2 有 version 与 editor,旧格式有 initial / actions。
function isVersion2Format(stored: any): boolean {
    return !!stored && stored.version >= SAVE_FORMAT_VERSION && !!stored.editor;
}

function handleAction(action: AnyAction) {
    return !selectItems.match(action) && !selectDiagram.match(action);
}