/*
 * xdraft - 问题记录输入框 (1.0.4-7)
 *
 * 需求:测试时发现问题,直接在顶部输入一句,保存下来,能回看。
 * 存储在 localStorage["xdraft.issueNotes"](刷新/重启都在);
 * 弹出面板里可以浏览全部、复制全部、清空。
*/

import { BulbOutlined, ClearOutlined, CopyOutlined } from '@ant-design/icons';
import { Button, Empty, Input, message, Popover, Space, Tooltip } from 'antd';
import * as React from 'react';
import { useEventCallback } from '@app/core';
import { texts } from '@app/texts';
import './IssueReporter.scss';

const STORAGE_KEY = 'xdraft.issueNotes';

interface IssueNote {
    // ISO 时间。
    t: string;

    // 问题内容。
    text: string;
}

function loadNotes(): IssueNote[] {
    try {
        return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') || [];
    } catch {
        return [];
    }
}

function saveNotes(notes: IssueNote[]) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
        // 存储不可用时静默降级。
    }
}

export const IssueReporter = () => {
    const [value, setValue] = React.useState('');
    const [notes, setNotes] = React.useState<IssueNote[]>(() => loadNotes());

    const doSubmit = useEventCallback(() => {
        const text = value.trim();

        if (!text) {
            return;
        }

        const next = [...notes, { t: new Date().toISOString(), text }];

        setNotes(next);
        saveNotes(next);
        setValue('');

        message.success(texts.common.issueSaved);
    });

    const doCopyAll = useEventCallback(async () => {
        const text = notes.map(note => `${note.t.replace('T', ' ').replace('Z', '')}  ${note.text}`).join('\n');

        try {
            await navigator.clipboard.writeText(text);

            message.success(texts.common.logCopied);
        } catch {
            message.error(texts.common.logCopyFailed);
        }
    });

    const doClear = useEventCallback(() => {
        setNotes([]);
        saveNotes([]);
    });

    const content = (
        <div className='issue-reporter-panel'>
            {notes.length === 0 ?
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={texts.common.issueEmpty} /> :
                <div className='issue-reporter-list'>
                    {[...notes].reverse().map((note, index) =>
                        <div key={`${note.t}-${index}`} className='issue-reporter-entry'>
                            <span className='issue-reporter-entry-time'>{note.t.replace('T', ' ').slice(0, 19)}</span>
                            <span className='issue-reporter-entry-text'>{note.text}</span>
                        </div>,
                    )}
                </div>
            }

            <Space className='issue-reporter-actions'>
                <Button size='small' icon={<CopyOutlined />} disabled={notes.length === 0} onClick={doCopyAll}>
                    {texts.common.logCopyAll}
                </Button>
                <Button size='small' icon={<ClearOutlined />} disabled={notes.length === 0} onClick={doClear}>
                    {texts.common.logClear}
                </Button>
            </Space>
        </div>
    );

    return (
        <div className='issue-reporter'>
            <Input
                className='issue-reporter-input'
                value={value}
                onChange={event => setValue(event.target.value)}
                onPressEnter={doSubmit}
                placeholder={texts.common.issuePlaceholder}
                allowClear />

            <Popover content={content} trigger='click' placement='bottomRight' overlayClassName='issue-reporter-popover'>
                <Tooltip title={texts.common.issueHistory}>
                    <Button size='small' icon={<BulbOutlined />} />
                </Tooltip>
            </Popover>
        </div>
    );
};
