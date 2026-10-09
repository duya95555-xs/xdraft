/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { Alert, Button, Modal } from 'antd';
import * as React from 'react';
import { getDesktopBridge, useEventCallback } from '@app/core';
import { texts } from '@app/texts';
import { useStore } from '@app/wireframes/model';
import { useLoading } from './../actions';

// 关窗保护。
//
// 主进程在窗口即将关闭时先拦住, 把 `beforeClose` 发过来。这里按"有没有未保存改动"决定:
//   · 没有改动 ⇒ 直接放行。
//   · 有改动   ⇒ 弹三选一: 保存并关闭 / 不保存 / 取消。
//
// 原先 main.js 完全没有 close 拦截, 点关闭 = 直接丢内容。
export const CloseGuardDialog = React.memo(() => {
    const bridge = React.useMemo(() => getDesktopBridge(), []);
    const forLoading = useLoading();

    const revision = useStore(s => s.editor.revision);
    const savedRevision = useStore(s => s.loading.savedRevision);
    const isSaving = useStore(s => s.loading.isSaving);
    const autoSaveFailCount = useStore(s => s.loading.autoSaveFailCount);

    const [visible, setVisible] = React.useState(false);

    // "保存并关闭"但文档还没命名: 自动保存会(刻意地)跳过, 此时不能关窗口也不该
    // 静默把对话框收起来 —— 否则用户看到的是"点了按钮什么都没发生"。改为在框里
    // 明确告诉他先去命名。
    const [blocked, setBlocked] = React.useState(false);

    // 用户点了"保存并关闭"后置 true, 保存完成(或失败)时复位。
    const pendingClose = React.useRef(false);
    const failCountAtRequest = React.useRef(0);
    const live = React.useRef({ revision, savedRevision, saveAutomatically: forLoading.saveAutomatically });

    live.current = { revision, savedRevision, saveAutomatically: forLoading.saveAutomatically };

    React.useEffect(() => {
        if (!bridge?.onBeforeClose) {
            return undefined;
        }

        return bridge.onBeforeClose(() => {
            const current = live.current;

            // 先接管决策权(allow = false), 让主进程取消它的 5 秒超时兜底 ——
            // 否则用户还在看这个对话框, 窗口就被强制关掉了。
            bridge.closeConfirmed?.(false);

            if (current.revision === current.savedRevision) {
                bridge.closeConfirmed?.(true);
            } else {
                setBlocked(false);
                setVisible(true);
            }
        });
    }, [bridge]);

    // "保存并关闭": 等这一轮保存落地后再放行。
    React.useEffect(() => {
        if (pendingClose.current && !isSaving && revision === savedRevision) {
            pendingClose.current = false;
            bridge?.closeConfirmed?.(true);
        }
    }, [bridge, isSaving, revision, savedRevision]);

    // 保存失败(例如目标磁盘不可写): 把对话框放回来, 别让用户以为已经不保存就关了。
    React.useEffect(() => {
        if (pendingClose.current && autoSaveFailCount > failCountAtRequest.current) {
            pendingClose.current = false;
            setVisible(true);
        }
    }, [autoSaveFailCount]);

    const doCancel = useEventCallback(() => {
        pendingClose.current = false;
        setBlocked(false);
        setVisible(false);
    });

    const doDiscard = useEventCallback(() => {
        pendingClose.current = false;
        setBlocked(false);
        setVisible(false);
        bridge?.closeConfirmed?.(true);
    });

    const doSaveAndClose = useEventCallback(() => {
        // 没名字就没法落盘(会自动保存会跳过)。留着对话框 + 明说原因, 而不是
        // 把框收起来、窗口却关不掉。
        if (forLoading.needsDocumentName && forLoading.saveTarget === 'serverFile') {
            setBlocked(true);

            return;
        }

        pendingClose.current = true;
        failCountAtRequest.current = autoSaveFailCount;
        setBlocked(false);
        setVisible(false);

        live.current.saveAutomatically();
    });

    return (
        <Modal
            title={texts.common.closeGuardTitle}
            open={visible}
            onCancel={doCancel}
            maskClosable={false}
            footer={[
                <Button key='save' type='primary' onClick={doSaveAndClose}>{texts.common.closeGuardSave}</Button>,
                <Button key='discard' danger onClick={doDiscard}>{texts.common.closeGuardDiscard}</Button>,
                <Button key='cancel' onClick={doCancel}>{texts.common.dialogCancel}</Button>,
            ]}>
            {blocked &&
                <Alert type='warning' showIcon message={texts.common.closeGuardNeedsName} style={{ marginBottom: 12 }} />
            }

            {texts.common.closeGuardMessage}
        </Modal>
    );
});
