/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { GithubOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Button, Modal, Tooltip } from 'antd';
import { MenuProps } from 'antd/lib';
import * as React from 'react';
import { MarkerButton, Title, useEventCallback } from '@app/core';
import { downloadLogs } from '@app/core';
import text from '@app/legal.html?raw';
import { texts } from '@app/texts';
import { useStore } from '@app/wireframes/model';
import { ActionDropdownButton, ActionMenuButton, buildMenuItem, useLoading } from './../actions';
import { SaveFileDialog } from './SaveFileDialog';

// 自动保存: 有改动后空闲 8 秒才落盘(连续编辑会不断把计时重置)。
const AUTO_SAVE_IDLE_MS = 8000;

// 失败退避: 30s → 60s → 120s → 240s → 300s(封顶)。
const AUTO_SAVE_RETRY_BASE_MS = 30000;
const AUTO_SAVE_RETRY_MAX_MS = 300000;

// 命名弹窗的两种用途: 另存为 / 首次保存到本机。
type NameDialogMode = 'none' | 'export' | 'firstSave';

export const LoadingMenu = React.memo(() => {
    const forLoading = useLoading();
    const revision = useStore(s => s.editor.revision);
    const savedRevision = useStore(s => s.loading.savedRevision);
    const isSaving = useStore(s => s.loading.isSaving);
    const autoSaveFailCount = useStore(s => s.loading.autoSaveFailCount);

    const saveAutomatically = React.useRef(forLoading.saveAutomatically);
    const [isOpen, setIsOpen] = React.useState(false);
    const [nameDialog, setNameDialog] = React.useState<NameDialogMode>('none');

    saveAutomatically.current = forLoading.saveAutomatically;

    // 有没有未保存的改动: 与"上次成功落盘时的 revision"比较。
    // 被忽略的动作(选中图元 / 切换页面)不会让 revision 变大, 所以不会误触发。
    const isDirty = revision !== savedRevision;

    const doToggleInfoDialog = useEventCallback(() => {
        setIsOpen(x => !x);
    });

    const doOpenExportDialog = useEventCallback(() => {
        setNameDialog('export');
    });

    const doCloseNameDialog = useEventCallback(() => {
        setNameDialog('none');
    });

    const doConfirmName = useEventCallback((name: string) => {
        if (nameDialog === 'firstSave') {
            forLoading.saveDocumentLocally(name);
        } else if (nameDialog === 'export') {
            forLoading.saveDocumentAs(name);
        }
    });

    // 主保存按钮(含 Ctrl+S)。
    //
    // "保存到本机"落盘用的是文档名。文档还是匿名状态时先要个名字 —— 否则每份未命名的
    // 文档都会写进同一个 未命名文档.json 互相覆盖, 用户在「最近」里也只能看到同一个名字。
    // 云端目标不需要命名(名字由服务器发 token 决定), 所以直接放行。
    const doPrimarySave = useEventCallback(() => {
        if (forLoading.needsDocumentName && forLoading.saveTarget === 'serverFile') {
            setNameDialog('firstSave');
        } else {
            forLoading.saveDiagram.onAction();
        }
    });

    const primarySaveAction = React.useMemo(() => ({
        ...forLoading.saveDiagram,
        onAction: doPrimarySave,
    }), [forLoading.saveDiagram, doPrimarySave]);

    const doDownloadLogs = useEventCallback(() => {
        downloadLogs();
    });

    // ── 自动保存 ────────────────────────────────────────────────────────────
    //
    // 旧实现: saveTarget === 'serverFile' 时挂一个 setInterval(30 秒), 判据只是
    // "有没有内容" —— 完全不看有没有改动。于是打包版开箱即每 30 秒无条件重写整份
    // 文档、弹两次 toast, 失败还无限重试(真机日志里每半分钟一条 Failed to fetch)。
    //
    // 新实现: 只在"有未保存改动"时计时, 空闲 8 秒才落盘; 保存中不重复触发;
    // 失败按指数退避重试。成功与失败都不弹提示 —— 成功只在标题栏更新"已保存 HH:mm"。
    //
    // canAutoSave 为 false 时干脆不挂计时器: 那种情况下(文档还没命名)每次醒来都会
    // 直接返回, 挂着只是白刷日志。
    React.useEffect(() => {
        if (!isDirty || isSaving || !forLoading.canAutoSave) {
            return undefined;
        }

        const delay = autoSaveFailCount === 0 ?
            AUTO_SAVE_IDLE_MS :
            Math.min(AUTO_SAVE_RETRY_BASE_MS * Math.pow(2, autoSaveFailCount - 1), AUTO_SAVE_RETRY_MAX_MS);

        const timer = setTimeout(() => {
            saveAutomatically.current();
        }, delay);

        return () => clearTimeout(timer);
    }, [isDirty, isSaving, autoSaveFailCount, revision, forLoading.canAutoSave]);

    const saveMenuItems: MenuProps['items'] = [
        { key: 'target-header', type: 'group', label: texts.common.saveTargetLabel },
        { key: 'serverFile', label: texts.common.saveTargetLocal, onClick: () => forLoading.setSaveTarget('serverFile') },
        {
            key: 'cloud',
            // 打包版置灰但保留入口(D3=B): 隐藏会让用户以为功能被砍了。
            disabled: !forLoading.isCloudTargetAvailable,
            label: forLoading.isCloudTargetAvailable ?
                texts.common.saveTargetCloud :
                <Tooltip title={texts.common.saveTargetCloudDisabled} placement='left'>
                    <span>{texts.common.saveTargetCloud}</span>
                </Tooltip>,
            onClick: () => forLoading.setSaveTarget('cloud'),
        },
        { type: 'divider' },
        buildMenuItem({ ...forLoading.saveDiagramToFile, onAction: doOpenExportDialog }, 'save'),
        { type: 'divider' },
        buildMenuItem(forLoading.exportPngPage, 'exportPngPage'),
        buildMenuItem(forLoading.exportPngBounds, 'exportPngBounds'),
        buildMenuItem(forLoading.exportHtml, 'exportHtml'),
        { type: 'divider' },
        { key: 'exportLogs', label: texts.common.exportLogs, onClick: doDownloadLogs },
    ];

    return (
        <>
            <CustomTitle />

            <ActionMenuButton displayMode='IconLabel' action={forLoading.newDiagram} />
            <ActionMenuButton displayMode='Icon' action={forLoading.openDiagramAction} />

            <ActionDropdownButton className='menu-dropdown' displayMode='IconLabel' action={primarySaveAction} type='primary' menu={{ items: saveMenuItems, selectable: true, selectedKeys: [forLoading.saveTarget] }} />

            <Button className='menu-item' onClick={doToggleInfoDialog}
                icon={<QuestionCircleOutlined />} />

            <Button className='menu-item' href='https://github.com/mydraft-cc/ui' target='_blank'
                icon={<GithubOutlined />} />

            <MarkerButton />

            <Modal title={texts.common.about} open={isOpen} onCancel={doToggleInfoDialog} onOk={doToggleInfoDialog}>
                <div dangerouslySetInnerHTML={{ __html: text }} />
            </Modal>

            <SaveFileDialog
                open={nameDialog !== 'none'}
                title={nameDialog === 'firstSave' ? texts.common.nameDocumentTitle : texts.common.saveDialogTitle}
                onConfirm={doConfirmName}
                onClose={doCloseNameDialog} />
        </>
    );
});

// 标题栏: 文档名 + 保存状态。
// 原来是 "mydraft.cc - Diagram <token>": token 只有云文档才有, 本机文档永远显示"未保存",
// 用户根本看不出到底存没存。现在改成"文档名 · 状态", 状态由 revision 与 savedRevision 决定。
const CustomTitle = React.memo(() => {
    const name = useStore(s => s.editor.present.documentName);
    const revision = useStore(s => s.editor.revision);
    const savedRevision = useStore(s => s.loading.savedRevision);
    const lastSavedAt = useStore(s => s.loading.lastSavedAt);
    const isSaving = useStore(s => s.loading.isSaving);

    let status: string;

    if (isSaving) {
        status = texts.common.savingNow;
    } else if (revision !== savedRevision) {
        status = texts.common.unsavedShort;
    } else if (lastSavedAt) {
        status = texts.common.savedAt(formatTime(lastSavedAt));
    } else {
        status = texts.common.neverSaved;
    }

    return (
        <Title text={`xdraft - ${name} - ${status}`} />
    );
});

function formatTime(timestamp: number) {
    const date = new Date(timestamp);
    const pad = (value: number) => `${value}`.padStart(2, '0');

    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
