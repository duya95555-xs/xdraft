/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
 */

import { Empty } from 'antd';
import * as React from 'react';
import { hasLocalDiagrams, useEventCallback } from '@app/core';
import { useAppDispatch } from '@app/store';
import { texts } from '@app/texts';
import { loadDiagramFromFile, loadDiagramFromLocal, loadDiagramFromServer, useStore } from '@app/wireframes/model';
import { listLocalDiagrams } from '@app/wireframes/model/actions/api';
import { RecentItem } from './RecentItem';
import './Recent.scss';

export const Recent = () => {
    const dispatch = useAppDispatch();
    const recentDiagrams = useStore(x => x.loading.recentDiagrams);
    const recentLocal = useStore(x => x.loading.recentLocal);

    // 本机文档: 直接问主进程要目录列表, 而不是读 localStorage 的缓存 ——
    // 用户在文件管理器里删掉的文件不该还留在列表里。
    // 浏览器里没有这个能力, 初值就是 null, 整块不渲染。
    const [localDocs, setLocalDocs] = React.useState<{ name: string; savedAt: number }[] | null>(
        () => hasLocalDiagrams() ? [] : null,
    );

    React.useEffect(() => {
        if (!hasLocalDiagrams()) {
            return undefined;
        }

        let cancelled = false;

        listLocalDiagrams().then(items => {
            if (!cancelled) {
                setLocalDocs(items.map(x => ({ name: x.name, savedAt: x.savedAt })));
            }
        }).catch(() => {
            if (!cancelled) {
                setLocalDocs([]);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [recentLocal]);

    const doLoadLocal = useEventCallback((name: string) => {
        dispatch(loadDiagramFromLocal({ name }));
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

    return (
        <>
            <div className='recent-caption'>{texts.common.recentLocal}</div>

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
