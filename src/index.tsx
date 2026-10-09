/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

/* eslint-disable @typescript-eslint/indent */

import type { ReactNode } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { ensureIconFonts } from './fonts/icon-fonts';
import { registerServiceWorker } from './registerServiceWorker';
import './index.scss';
import { getLanguage } from './texts';
import { store } from './store';

// 图标字体(Material Icons / Font Awesome)原先来自公网 CDN, 在 index.html 里以
// data-deferred-css + media="print" 的方式延迟加载, 避免离线时阻塞首帧导致白屏。
//
// 现在字体数据已经内联进 bundle(见 src/fonts/icon-fonts.ts), 不再有任何网络请求:
// data URI 是内联内容, 注册即刻生效, 也不需要再绕"先异步下载再切换 media"那一套。
// 离线部署时画布上的 Icon 与图标面板都能正常显示。
ensureIconFonts();

// Electron 打包后页面是通过 file:// 协议加载的, 此时 BrowserRouter 会把磁盘路径
// (file:///home/.../app.asar/dist-electron/index.html) 当成路由路径, 于是 /:token? 匹配不上,
// <Routes> 渲染出空内容 —— 表现就是启动后整页白屏, 而且控制台没有任何报错。
// 另外在 file:// 下 history.pushState/replaceState 也可能因 origin 为 null 抛 SecurityError。
// 因此 file:// 环境改用 HashRouter (路径放在 # 后面, 不参与 file:// 的解析);
// 网页版 (http/https) 仍用 BrowserRouter, 保持原来的 URL 形式不变。
function AppRouter({ children }: { children: ReactNode }) {
    if (window.location.protocol === 'file:') {
        return <HashRouter>{children}</HashRouter>;
    }

    return <BrowserRouter>{children}</BrowserRouter>;
}

const Root = (
    <ConfigProvider locale={getLanguage() === 'zh' ? zhCN : enUS}>
        <DndProvider backend={HTML5Backend}>
            <Provider store={store}>
                <AppRouter>
                    <Routes>
                        <Route path='/:token?' element={<App />} />
                    </Routes>
                </AppRouter>
            </Provider>
        </DndProvider>
    </ConfigProvider>
);

registerServiceWorker(store);

const container = document.getElementById('root-layout');
if (container) {
    const root = createRoot(container);
    root.render(Root);
}
