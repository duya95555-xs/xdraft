/*
 * xdraft - 应用日志面板 (1.0.4-8)
 *
 * 需求:日志全程打开、可看可复制可浏览。
 * 数据源是 core/logger 的环形缓冲(logInfo/logWarn/logError 全程写入,
 * localStorage 持久化,重启也在)。这个组件只是它的"可视面板":
 * 实时滚动、复制全部、下载 txt、清空。
*/

import { DownloadOutlined, ClearOutlined, CopyOutlined } from '@ant-design/icons';
import { Button, Drawer, Empty, message, Space, Tag, Tooltip } from 'antd';
import * as React from 'react';
import { clearLogs, downloadLogs, getLogs, LogEntry, subscribeLogs } from '@app/core';
import { useEventCallback } from '@app/core';
import { texts } from '@app/texts';

const LEVEL_COLOR: Record<string, string> = {
    info: 'blue',
    warn: 'orange',
    error: 'red',
};

const formatEntry = (entry: LogEntry) =>
    `${entry.t.replace('T', ' ').replace('Z', '')} [${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}${entry.detail ? ` - ${entry.detail}` : ''}`;

export const LogPanel = () => {
    const [open, setOpen] = React.useState(false);
    const [logs, setLogs] = React.useState<ReadonlyArray<LogEntry>>(() => getLogs());

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }

        // 打开时先全量同步一次,再订阅增量(新日志到达自动重渲染)。
        setLogs(getLogs());

        return subscribeLogs(() => {
            setLogs(getLogs());
        });
    }, [open]);

    const doCopyAll = useEventCallback(async () => {
        const text = getLogs().map(formatEntry).join('\n');

        try {
            await navigator.clipboard.writeText(text);

            message.success(texts.common.logCopied);
        } catch {
            message.error(texts.common.logCopyFailed);
        }
    });

    const doClear = useEventCallback(() => {
        clearLogs();

        setLogs(getLogs());
    });

    // 最新一条在最上面,看问题不用滚到底。
    const entries = React.useMemo(() => [...logs].reverse(), [logs]);

    return (
        <>
            <Button size='small' onClick={() => setOpen(true)}>{texts.common.logPanel}</Button>

            <Drawer title={texts.common.logPanel}
                width={640}
                open={open}
                onClose={() => setOpen(false)}
                extra={
                    <Space>
                        <Tooltip title={texts.common.logCopyAll}>
                            <Button size='small' icon={<CopyOutlined />} onClick={doCopyAll} />
                        </Tooltip>
                        <Tooltip title={texts.common.logDownload}>
                            <Button size='small' icon={<DownloadOutlined />} onClick={() => downloadLogs()} />
                        </Tooltip>
                        <Tooltip title={texts.common.logClear}>
                            <Button size='small' icon={<ClearOutlined />} onClick={doClear} />
                        </Tooltip>
                    </Space>
                }>
                {entries.length === 0 ?
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={texts.common.logEmpty} /> :
                    <div className='log-panel-list'>
                        {entries.map((entry, index) =>
                            <div key={`${entry.t}-${index}`} className='log-panel-entry'>
                                <div className='log-panel-entry-head'>
                                    <Tag color={LEVEL_COLOR[entry.level] || 'default'}>{entry.level.toUpperCase()}</Tag>
                                    <span className='log-panel-entry-time'>{entry.t.replace('T', ' ').replace('Z', '')}</span>
                                    <span className='log-panel-entry-scope'>[{entry.scope}]</span>
                                </div>
                                <div className='log-panel-entry-message'>{entry.message}</div>
                                {entry.detail &&
                                    <pre className='log-panel-entry-detail'>{entry.detail}</pre>
                                }
                            </div>,
                        )}
                    </div>
                }
            </Drawer>
        </>
    );
};
