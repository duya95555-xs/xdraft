/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { Button, Empty, message, Tooltip } from 'antd';
import * as React from 'react';
import { hasLocalDiagrams, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { loadDiagramFromFile, loadDiagramFromLocal, loadDiagramFromServer, useStore } from '@app/wireframes/model';
import { chooseLocalSaveDir, canChooseSaveDir, getLocalSaveDir, listLocalDiagrams, saveBlobAsLocal } from '@app/wireframes/model/actions/api';
import { RecentItem } from './RecentItem';
import './Recent.scss';

// 导出最近文档清单为 CSV: 文件名、修改时间、完整路径。
// 带 BOM, Excel 直接双击打开不乱码。
function buildRecentListCsv(items: { name: string; savedAt: number; path?: string }[]) {
    const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
        [escape('name'), escape('savedAt'), escape('path')].join(','),
    ];

    for (const item of items) {
        const time = new Date(item.savedAt).toLocaleString();
        const name = item.path ? `${item.name}.json` : item.name;

        lines.push([escape(name), escape(time), escape(item.path || '')].join(','));
    }

    // \uFEFF = UTF-8 BOM。
    return '\uFEFF' + lines.join('\r\n');
}

export const Recent = () => {
    const dispatch = useAppDispatch();
    const recentDiagrams = useStore(x => x.loading.recentDiagrams);
    const recentLocal = useStore(x => x.loading.recentLocal);

    // 本机文档: 直接问主进程要目录列表, 而不是读 localStorage 的缓存 ——
    // 用户在文件管理器里删掉的文件不该还留在列表里。
    // 浏览器里没有这个能力, 初值就是 null, 整块不渲染。
    const [localDocs, setLocalDocs] = React.useState<{ name: string; savedAt: number; path?: string }[] | null>(
        () => hasLocalDiagrams() ? [] : null,
    );

    // 当前保存目录(只在 Electron 里可见), 展示在"本机文档"标题旁。
    const [saveDir, setSaveDir] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!hasLocalDiagrams()) {
            return undefined;
        }

        let cancelled = false;

        listLocalDiagrams().then(items => {
            if (!cancelled) {
                setLocalDocs(items.map(x => ({ name: x.name, savedAt: x.savedAt, path: x.path })));
            }
        }).catch(() => {
            if (!cancelled) {
                setLocalDocs([]);
            }
        });

        getLocalSaveDir().then(info => {
            if (!cancelled && info) {
                setSaveDir(info.dir);
            }
        }).catch(() => {
            // 浏览器或旧版 preload 没这个通道, 静默忽略。
        });

        return () => {
            cancelled = true;
        };
    }, [recentLocal]);

    const doLoadLocal = useEventCallback((name: string) => {
        dispatch(loadDiagramFromLocal({ name }));
    });

    // 弹目录选择框, 选中的目录由主进程持久化; 之后读写文档都走它, 直到再次更改。
    const doChooseSaveDir = useEventCallback(async () => {
        const result = await chooseLocalSaveDir();

        if (!result.canceled && result.dir) {
            setSaveDir(result.dir);

            // 目录换了, 本机文档列表也要按新目录重新拉。
            listLocalDiagrams().then(items => {
                setLocalDocs(items.map(x => ({ name: x.name, savedAt: x.savedAt, path: x.path })));
            }).catch(() => {
                setLocalDocs([]);
            });

            message.success(`${texts.common.saveDirChanged}: ${result.dir}`);
        }
    });

    // 导出最近文档清单(CSV): 文件名、修改时间、完整路径。
    const doExportRecentList = useEventCallback(async () => {
        const items = localDocs || [];

        if (items.length === 0) {
            return;
        }

        const stamp = new Date();
        const pad = (v: number) => String(v).padStart(2, '0');
        const fileName = `xdraft-recent-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.csv`;
        const csv = buildRecentListCsv(items);

        const result = await saveBlobAsLocal(fileName, new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'CSV', ['csv']);

        if (result && !result.canceled) {
            message.success(`${texts.common.recentListExported}: ${result.file || fileName}`);
        }
    });

    const doLoadCloudItem = useEventCallback((tokenToRead: string, tokenToWrite?: string) => {
        // 旧版本把"另存为文件"也记进过这张表(local://名字)。那种条目在浏览器里没有
        // 真实路径可回读, 只能让用户重新挑一次文件。
        if (tokenToRead.startsWith('local://')) {
            const input = document.createElement('input');

            input.type = 'file';
            input.accept = '.json';
            input.onchange = async () => {
                const file = input.files?.[0];

                if (file) {
                    dispatch(loadDiagramFromFile({ file }));
                }
            };

            input.click();

            return;
        }

        dispatch(loadDiagramFromServer({ tokenToRead, tokenToWrite, navigate: true }));
    });

    const cloudDocs = React.useMemo(() => {
        return Object.entries(recentDiagrams)
            .map(([tokenToRead, value]) => ({ ...value, tokenToRead }))
            .sort((lhs, rhs) => rhs.date - lhs.date);
    }, [recentDiagrams]);

    const emptyCloud = cloudDocs.length === 0 ?
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={texts.common.noRecentDocument} /> :
        undefined;

    // 浏览器里没有本机文档这一块(没有 IPC 桥, 也没有可回读的路径)。
    if (!hasLocalDiagrams()) {
        return (
            <>
                <div className='recent-list'>
                    {cloudDocs.map(item =>
                        <RecentItem key={item.tokenToRead} name={item.tokenToRead} date={item.date}
                            onLoad={() => doLoadCloudItem(item.tokenToRead, item.tokenToWrite)} />,
                    )}

                    {emptyCloud}
                </div>
            </>
        );
    }

    const localItems = localDocs || [];
    const showDirActions = canChooseSaveDir();

    return (
        <>
            <div className='recent-caption'>
                <div className='recent-caption-row'>
                    <span>{texts.common.recentLocal}{saveDir ? <span className='recent-dir'>（{saveDir}）</span> : null}</span>
                    {showDirActions &&
                        <span className='recent-actions'>
                            <Tooltip title={texts.common.exportRecentListTooltip}>
                                <Button size='small' onClick={doExportRecentList}>{texts.common.exportRecentList}</Button>
                            </Tooltip>
                            <Tooltip title={texts.common.chooseSaveDirTooltip}>
                                <Button size='small' onClick={doChooseSaveDir}>{texts.common.chooseSaveDir}</Button>
                            </Tooltip>
                        </span>
                    }
                </div>
            </div>

            <div className='recent-list'>
                {localItems.map(item =>
                    <RecentItem key={item.name} name={item.name} date={item.savedAt}
                        onLoad={() => doLoadLocal(item.name)} />,
                )}

                {localItems.length === 0 &&
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={texts.common.noRecentDocument} />
                }
            </div>

            <div className='recent-caption'>{texts.common.recentCloud}</div>

            <div className='recent-list'>
                {cloudDocs.map(item =>
                    <RecentItem key={item.tokenToRead} name={item.tokenToRead} date={item.date}
                        onLoad={() => doLoadCloudItem(item.tokenToRead, item.tokenToWrite)} />,
                )}

                {emptyCloud}
            </div>
        </>
    );
};
