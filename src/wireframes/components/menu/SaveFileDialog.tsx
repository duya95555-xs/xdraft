/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { Button, Input, Modal } from 'antd';
import * as React from 'react';
import { texts } from '@app/texts';
import { useStore } from '@app/wireframes/model';
import { useEventCallback } from '@app/core';

export interface SaveFileDialogProps {
    // True when the dialog is open.
    open: boolean;

    // 标题。默认是"保存原型文件"; 首次保存到本机时换成"给文档起个名字"。
    title?: string;

    // 确认按钮文案。
    okText?: string;

    // 用户确认时回调, 参数是清洗前的原始输入(落盘时还会再清洗一次)。
    onConfirm: (fileName: string) => void;

    // Closes the dialog.
    onClose: () => void;
}

export const SaveFileDialog = React.memo((props: SaveFileDialogProps) => {
    const { open, title, okText, onConfirm, onClose } = props;

    // 预填名来自**文档名**(没起过名字时退回第一页标题),不再直接取"当前选中页的标题" ——
    // 后者会让"切到第 3 页再另存"得到三个互不相干的文件名。
    const suggestedName = useStore(x => x.editor.present.suggestedName);
    const [fileName, setFileName] = React.useState('');

    // ── 保存目录(本机服务器) ──────────────────────────────────────────────
    // 仅浏览器+本地服务器模式可用:对话框打开时问 8901 服务器当前目录,
    // 服务器没起(Electron 模式/未启动)就整行不显示。
    const [saveDir, setSaveDir] = React.useState<string | null>(null);
    const [dirDraft, setDirDraft] = React.useState('');
    const [dirStatus, setDirStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // Prefill the file name each time the dialog opens.
    React.useEffect(() => {
        if (open) {
            setFileName(suggestedName);
        }
    }, [open, suggestedName]);

    React.useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;

        setDirStatus('idle');

        fetch('/api/config')
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((c: { saveDir?: string }) => {
                if (!cancelled && c?.saveDir) {
                    setSaveDir(c.saveDir);
                    setDirDraft(c.saveDir);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSaveDir(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const doChangeFileName = useEventCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFileName(event.target.value);
    });

    const doChangeDir = useEventCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setDirDraft(event.target.value);
        setDirStatus('idle');
    });

    // 空名字不能提交: 落盘会退回兜底名「未命名文档」, 又回到"多份文档互相覆盖"的老问题。
    const doSubmit = useEventCallback(() => {
        const name = fileName.trim();

        if (!name) {
            return;
        }

        onConfirm(name);
        onClose();
    });

    const doApplyDir = useEventCallback(() => {
        const dir = dirDraft.trim();

        if (!dir || dirStatus === 'saving') {
            return;
        }

        setDirStatus('saving');

        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saveDir: dir }),
        })
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((c: { saveDir?: string }) => {
                setSaveDir(c.saveDir || dir);
                setDirDraft(c.saveDir || dir);
                setDirStatus('saved');
            })
            .catch(() => setDirStatus('error'));
    });

    return (
        <Modal
            cancelText={texts.common.dialogCancel}
            okText={okText || texts.common.dialogOk}
            okButtonProps={{ disabled: fileName.trim().length === 0 }}
            open={open}
            onCancel={onClose}
            onOk={doSubmit}
            title={title || texts.common.saveDialogTitle}>
            <Input autoFocus value={fileName} onChange={doChangeFileName} placeholder={texts.common.fileNameLabel} onPressEnter={doSubmit} />

            {saveDir !== null &&
                <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#666' }}>{texts.common.saveDirLabel}</div>

                    <Input
                        value={dirDraft}
                        onChange={doChangeDir}
                        onPressEnter={doApplyDir}
                        status={dirStatus === 'error' ? 'error' : undefined}
                    />

                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Button size='small' type='primary' ghost loading={dirStatus === 'saving'} disabled={!dirDraft.trim() || dirDraft.trim() === saveDir} onClick={doApplyDir}>
                            {texts.common.saveDirApply}
                        </Button>

                        {dirStatus === 'saved' &&
                            <span style={{ fontSize: 12, color: '#52c41a' }}>{texts.common.saveDirSaved}</span>
                        }

                        {dirStatus === 'error' &&
                            <span style={{ fontSize: 12, color: '#ff4d4f' }}>{texts.common.saveDirInvalid}</span>
                        }
                    </div>
                </div>
            }
        </Modal>
    );
});
