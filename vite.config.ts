import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import favicons from '@peterek/vite-plugin-favicons';

// Electron 包使用相对路径加载静态资源(file:// 协议),
// 因此 base 改为 './', 且输出到 dist-electron。
const isElectron = process.env.ELECTRON === 'true';

// 把 index.html 里的 __BUILD_STAMP__ 换成"真实的构建时间"(本地时区)。
// 为什么需要: 标题里原来写死的 `[BUILD:2026-09-12-02]` 是上游仓库留下来的历史字符串,
// 构建多少次都不会变 —— 每次打开都像是"跑的还是旧版本", 排查问题时极易误判。
function buildStampPlugin(): Plugin {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return {
        name: 'xdraft-build-stamp',
        transformIndexHtml: (html: string) => html.replace(/__BUILD_STAMP__/g, stamp),
    };
}

export default defineConfig({
    // Electron 包内使用相对路径,避免 file:// 协议加载失败。
    base: isElectron ? './' : '/',

    resolve: {
        alias: {
            '@app': path.resolve(__dirname, './src/'),
        },
    },

    build: {
        chunkSizeWarningLimit: 2000,
        outDir: isElectron ? 'dist-electron' : 'dist',
    },

    // Dev proxy for the local diagram storage API (server.py).
    // Start it with: python server.py --port 8901 --directory <any-folder-with-index.html>
    server: {
        port: 5173,
        proxy: {
            '/api/diagrams': {
                target: 'http://127.0.0.1:8901',
                changeOrigin: true,
            },
        },
    },

    plugins: [
        // Electron 包不需要 PWA 和 favicons,Vite 7 下 vite-plugin-pwa 存在入口解析兼容问题,也一并跳过。
        (!isElectron && process.env.NODE_ENV === 'production' ?
            [
                VitePWA({
                    injectRegister: null,
                    workbox: {
                        maximumFileSizeToCacheInBytes: 3_000_000,
                    }
                }),
                favicons('public/logo-square.svg', {
                    appName: 'xdraft',
                    appDescription: 'Open Source Wireframing Tool',
                    developerName: 'Sebastian Stehle',
                    developerURL: 'https://suquidex.io',
                    start_url: '/',
                    theme_color: '#fda100',
                })
            ] : []),
        buildStampPlugin(),
        react({}),
    ],
});
