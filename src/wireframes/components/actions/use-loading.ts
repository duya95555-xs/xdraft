/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import * as React from 'react';
import { Rect2, useEventCallback, useOpenFile } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { getDiagrams, getDiagram, loadDiagramFromFile, newDiagram, renameDocument, saveDiagramToFile, saveDiagramToServer, saveDiagramToServerFile, showToast, useStore } from '@app/wireframes/model';
import { saveBlobAsLocal } from '@app/wireframes/model/actions/api';
import { logError, logInfo } from '@app/core';
import { renderDiagramToHtml } from '@app/wireframes/renderer/export-html';
import { downloadBlob, getDiagramContentBounds, renderDiagramToPng } from '@app/wireframes/renderer/export-image';
import { UIAction } from './shared';
import { getSaveTarget, isCloudTargetAvailable, SaveTarget, setSaveTarget } from './save-target';

// ── 导出文件名: 文档名 + 流水号 ─────────────────────────────────────────────
// 例: 文档"登录流程" -> 登录流程-01.png、登录流程-02.png ...
// 流水号按"文档名 + 扩展名"记在 localStorage, 导出成功后才递增(取消不算)。

function exportBaseName(documentName: string | undefined, fallback: string) {
    // 与保存文件名同一套清洗规则, 保证"保存的文件名"和"导出的文件名"一致。
    const name = (documentName || '').trim().replace(/[\\/:*?"<>|]/g, '-');

    return name.length > 0 ? name : fallback;
}

function exportSequenceKey(base: string, ext: string) {
    return `xdraft.exportSeq.${base}.${ext}`;
}

function nextExportSequence(base: string, ext: string) {
    try {
        const current = Number(localStorage.getItem(exportSequenceKey(base, ext)) ?? '0');

        return Number.isFinite(current) && current > 0 ? current + 1 : 1;
    } catch {
        return 1;
    }
}

function commitExportSequence(base: string, ext: string, sequence: number) {
    try {
        localStorage.setItem(exportSequenceKey(base, ext), String(sequence));
    } catch {
        // 流水号存不进去只影响下次的起始值, 不该让导出失败。
    }
}

function formatExportName(base: string, ext: string, sequence: number) {
    return `${base}-${String(sequence).padStart(2, '0')}.${ext}`;
}

export function useLoading() {
    const dispatch = useAppDispatch();
    const diagrams = useStore(getDiagrams);
    const diagram = useStore(getDiagram);
    const size = useStore(x => x.editor.present.size);
    const color = useStore(x => x.editor.present.color);
    const documentName = useStore(x => x.editor.present.documentName);
    const [exporting, setExporting] = React.useState(false);
    const [saveTarget, setSaveTargetState] = React.useState<SaveTarget>(() => getSaveTarget());

    // 打包版里云端入口置灰(保留入口 + tooltip 说明), 见 save-target.ts。
    const cloudTargetAvailable = React.useMemo(() => isCloudTargetAvailable(), []);

    // 用户还没给这份文档起名字。
    //
    // ⚠️ 这条很要命: 没有它会出事 —— documentName 的兜底值是个固定字符串(「未命名文档」),
    // 于是"保存到本机"会把**每一份**没命名的文档都写进同一个 未命名文档.json 互相覆盖,
    // 而且「最近」里所有条目都叫同一个名字, 用户根本分不清。所以:
    //   · 手动保存 → 先弹命名框, 起完名再落盘;
    //   · 自动保存 → 直接跳过(绝不替用户瞎取名), 只把标题栏留在「未保存」。
    const needsDocumentName = useStore(x => !x.editor.present.name?.trim());

    const doSetSaveTarget = useEventCallback((target: SaveTarget) => {
        // 双保险: 菜单项已经 disabled, 但键盘/程序化调用也要挡住。
        if (target === 'cloud' && !isCloudTargetAvailable()) {
            return;
        }

        setSaveTarget(target);
        setSaveTargetState(target);
    });

    const canSave = React.useMemo(() => {
        for (const diagram of diagrams.values) {
            if (diagram.items.size > 0) {
                return true;
            }
        }

        return false;
    }, [diagrams]);
    
    const openHandler = useOpenFile('.json', file => {
        dispatch(loadDiagramFromFile({ file }));
    });

    const doNew = useEventCallback(() => {
        dispatch(newDiagram(true));
    });

    const doSave = useEventCallback(() => {
        if (saveTarget === 'serverFile') {
            dispatch(saveDiagramToServerFile(undefined));
        } else {
            dispatch(saveDiagramToServer({ navigate: true }));
        }
    });

    // 自动保存: 静默(silent) —— 不弹"正在保存 / 已保存"的 toast, 也不改地址栏。
    // 是否该存由调用方按"有没有未保存改动"判断(见 LoadingMenu)。
    const doSaveAutomatically = useEventCallback(() => {
        if (saveTarget === 'serverFile') {
            // 没名字就不存 —— 否则所有"未命名文档"会写进同一个文件互相覆盖。
            if (needsDocumentName) {
                logInfo('save', 'Auto save skipped: the document has no name yet.');

                return;
            }

            dispatch(saveDiagramToServerFile({ silent: true }));
        } else if (isCloudTargetAvailable()) {
            dispatch(saveDiagramToServer({ navigate: false, silent: true }));
        }
    });

    // 能不能自动保存。故意跟 doSaveAutomatically 里的守卫重复一次:
    // 这里返回 false 是为了让 LoadingMenu **不再挂计时器** —— 否则每 8 秒醒一次、
    // 每次都因为"没名字"直接返回, 只是白刷日志。
    const canAutoSave = !(saveTarget === 'serverFile' && needsDocumentName);

    // 改文档名。必须发生在派发保存**之前**: saveDiagramToServerFile 在 thunk 开头就
    // 快照 revision, 先改名能让那次保存把改名后的 revision 一起算进去, 免得刚存完
    // 又因为"名字变了"被判成有改动、8 秒后再存一遍。
    const doRenameDocument = useEventCallback((name: string) => {
        dispatch(renameDocument(name));
    });

    const doSaveToFile = useEventCallback(() => {
        dispatch(saveDiagramToFile());
    });

    // "另存为"确认之后: 先改名再按新名字落盘。文档名跟着另存为走, 符合常规习惯。
    const doSaveDocumentAs = useEventCallback((name: string) => {
        dispatch(renameDocument(name));
        dispatch(saveDiagramToFile(name));
    });

    // 首次"保存到本机"确认之后: 用户刚在命名框里起好名字。
    const doSaveDocumentLocally = useEventCallback((name: string) => {
        dispatch(renameDocument(name));
        dispatch(saveDiagramToServerFile({ fileName: name }));
    });

    const doExportPng = useEventCallback(async (mode: 'page' | 'content') => {
        if (!diagram || exporting) {
            return;
        }

        setExporting(true);

        try {
            const bounds = mode === 'page' ?
                new Rect2(0, 0, size.x, size.y) :
                getDiagramContentBounds(diagram);

            const { blob, externalImages } =
                await renderDiagramToPng({ diagram, diagrams, bounds, background: color.toString() });

            // 文件名跟随已保存的文档名 + 流水号(登录流程-01.png)。
            const base = exportBaseName(documentName, 'diagram');
            const sequence = nextExportSequence(base, 'png');
            const fileName = formatExportName(base, 'png', sequence);

            // Electron / 支持的浏览器: 弹"另存为"对话框(默认上次目录); 否则直接下载。
            const saved = await saveBlobAsLocal(fileName, blob, 'PNG 图片', ['png']);

            if (saved) {
                if (saved.canceled) {
                    return;
                }
            } else {
                downloadBlob(blob, fileName);
            }

            commitExportSequence(base, 'png', sequence);

            if (externalImages > 0) {
                dispatch(showToast(texts.common.exportExternalImages, 'warning'));
            } else {
                dispatch(showToast(texts.common.exportPngDone, 'success'));
            }

            logInfo('export', `PNG exported (${mode}, ${blob.size} bytes).`);
        } catch (ex) {
            logError('export', 'PNG export failed.', ex instanceof Error ? ex.message : ex);

            dispatch(showToast(texts.common.exportImageFailed, 'error'));
        } finally {
            setExporting(false);
        }
    });

    const doExportPngPage = useEventCallback(() => doExportPng('page'));
    const doExportPngBounds = useEventCallback(() => doExportPng('content'));

    const doExportHtml = useEventCallback(async () => {
        if (!diagram || exporting) {
            return;
        }

        setExporting(true);

        try {
            const bounds = getDiagramContentBounds(diagram);

            const { html, externalImages } =
                await renderDiagramToHtml({ diagram, diagrams, bounds, background: color.toString() }, diagram.title || 'diagram');

            // 与 PNG 导出同一套规则: 文档名 + 流水号。
            const base = exportBaseName(documentName, 'diagram');
            const sequence = nextExportSequence(base, 'html');
            const fileName = formatExportName(base, 'html', sequence);

            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });

            const saved = await saveBlobAsLocal(fileName, blob, 'HTML 文件', ['html']);

            if (saved) {
                if (saved.canceled) {
                    return;
                }
            } else {
                downloadBlob(blob, fileName);
            }

            commitExportSequence(base, 'html', sequence);

            if (externalImages > 0) {
                dispatch(showToast(texts.common.exportExternalImages, 'warning'));
            } else {
                dispatch(showToast(texts.common.exportHtmlDone, 'success'));
            }

            logInfo('export', `HTML exported (${html.length} characters).`);
        } catch (ex) {
            logError('export', 'HTML export failed.', ex instanceof Error ? ex.message : ex);

            dispatch(showToast(texts.common.exportImageFailed, 'error'));
        } finally {
            setExporting(false);
        }
    });

    const newDiagramAction: UIAction = React.useMemo(() => ({
        disabled: false,
        icon: 'icon-new',
        label: texts.common.newDiagram,
        shortcut: 'MOD + N',
        tooltip: texts.common.newDiagramTooltip,
        onAction: doNew,
    }), [doNew]);

    const saveDiagram: UIAction = React.useMemo(() => ({
        disabled: !canSave,
        icon: 'icon-save',
        label: saveTarget === 'serverFile' ? texts.common.saveDiagramLocal : texts.common.saveDiagramTooltip,
        shortcut: 'MOD + S',
        tooltip: saveTarget === 'serverFile' ? texts.common.saveDiagramLocalTooltip : texts.common.saveDiagramTooltip,
        onAction: doSave,
    }), [doSave, canSave, saveTarget]);

    const saveDiagramToFileAction: UIAction = React.useMemo(() => ({
        disabled: !canSave,
        icon: 'icon-save',
        label: texts.common.saveDiagramToFileTooltip,
        tooltip: texts.common.saveDiagramToFileTooltip,
        onAction: doSaveToFile,
    }), [doSaveToFile, canSave]);

    const openDiagramAction: UIAction = React.useMemo(() => ({
        disabled: false,
        icon: 'icon-folder-open',
        label: texts.common.openFromFile,
        tooltip: texts.common.openFromFileTooltip,
        onAction: openHandler,
    }), [openHandler]);

    const exportPngPage: UIAction = React.useMemo(() => ({
        disabled: !canSave || exporting,
        icon: 'icon-save',
        label: texts.common.exportPngPage,
        tooltip: texts.common.exportPngPage,
        onAction: doExportPngPage,
    }), [doExportPngPage, canSave, exporting]);

    const exportPngBounds: UIAction = React.useMemo(() => ({
        disabled: !canSave || exporting,
        icon: 'icon-save',
        label: texts.common.exportPngBounds,
        tooltip: texts.common.exportPngBounds,
        onAction: doExportPngBounds,
    }), [doExportPngBounds, canSave, exporting]);

    const exportHtml: UIAction = React.useMemo(() => ({
        disabled: !canSave || exporting,
        icon: 'icon-save',
        label: texts.common.exportHtml,
        tooltip: texts.common.exportHtml,
        onAction: doExportHtml,
    }), [doExportHtml, canSave, exporting]);

    return {
        newDiagram: newDiagramAction,
        openDiagramAction,
        saveDiagram,
        saveAutomatically: doSaveAutomatically,
        canAutoSave,
        needsDocumentName,
        renameDocument: doRenameDocument,
        saveDocumentAs: doSaveDocumentAs,
        saveDocumentLocally: doSaveDocumentLocally,
        isCloudTargetAvailable: cloudTargetAvailable,
        saveTarget,
        setSaveTarget: doSetSaveTarget,
        saveDiagramToFile: saveDiagramToFileAction,
        exportPngPage,
        exportPngBounds,
        exportHtml,
    };
}
