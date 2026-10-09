/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

// 图标字体内联数据。
//
// 本文件由 tools/fetch-icon-fonts.sh 从 tools/icon-fonts.template.ts 生成, 请勿手改
// (下次跑脚本会被覆盖; 要改请改模板)。
//
// 为什么要把字体编进产物:
//   Icon 插件 (shapes/shared/icon.ts) 不是"画图形", 而是渲染 Web Font 的字形 ——
//   往 appearance 里存一个私有区字符(如 U+F2BD)加字体族名。
//   原先这两个字体族的资源来自公网 CDN(index.html 的 <link>), 导致两个问题:
//     1) 离线部署(UOS arm64)时 CDN 请求失败, 图标面板和画布上的 Icon 都不显示;
//     2) 导出图片时 SVG 会被当作 <img> 加载, 浏览器随即进入"安全静态模式",
//        不加载任何外部资源 —— 字体回退后 PUA 字符无字形, 导出结果里图标是一片空白。
//   把 woff2 转成 data URI 编进产物后:
//     字体就在 bundle 里, 断网也能用; 导出时把同一份 data URI 注入 SVG 的 <defs>,
//     data URI 属于内联内容, SVG-as-image 允许加载, 导出也就正常了。
//
// 两个常量为空串表示本机没拿到字体文件, 此时不注册也不注入,
// 运行与导出表现回退到旧版本 —— 不会引入新的报错。

export const FONT_AWESOME_WOFF2 = '__FONT_AWESOME_WOFF2__';

export const MATERIAL_ICONS_WOFF2 = '__MATERIAL_ICONS_WOFF2__';

// 字体族名必须与已保存项目里记录的值完全一致, 否则所有旧项目的图标都会失配变空白。
// 这两个字符串硬编码在 src/icons/font_awesome_unified.ts 与 src/icons/material_icons_unified.ts,
// 已经写进了每一个存过图标的项目文件, 不允许改名。
export const FONT_FAMILY_FONT_AWESOME = 'FontAwesome';

export const FONT_FAMILY_MATERIAL_ICONS = 'Material Icons';

// 实际可用的字体族名列表(字体数据缺失时为空)。
export const ICON_FONT_FAMILIES: string[] = [
    FONT_AWESOME_WOFF2 ? FONT_FAMILY_FONT_AWESOME : '',
    MATERIAL_ICONS_WOFF2 ? FONT_FAMILY_MATERIAL_ICONS : '',
].filter(x => !!x);

// @font-face 规则文本, 用途有二:
//   1) ensureIconFonts() 注入主文档, 让画布和图标面板离线也能显示;
//   2) export-image.tsx 注入导出 SVG, 让图标在 PNG 里不丢。
export const ICON_FONT_FACE_CSS: string = [
    FONT_AWESOME_WOFF2 ? `@font-face{font-family:'${FONT_FAMILY_FONT_AWESOME}';src:url(${FONT_AWESOME_WOFF2}) format('woff2');font-display:block;}` : '',
    MATERIAL_ICONS_WOFF2 ? `@font-face{font-family:'${FONT_FAMILY_MATERIAL_ICONS}';src:url(${MATERIAL_ICONS_WOFF2}) format('woff2');font-display:block;}` : '',
    // 字体"使用规则"必须随 @font-face 一起带上: 原先它们由 CDN CSS 提供,
    // index.html 删掉 <link> 后 .fa / .material-icons 就失去了 font-family 声明,
    // 元素退回系统字体栈 —— PUA 字形全部变成空心方块(tofu)。
    // 以下取自 Font Awesome 4.7 与 Material Icons 官方 CSS 的核心属性;
    // font-size 不写死, 由本地 Icons.scss 控制。
    FONT_AWESOME_WOFF2 ? `.fa{font-family:'${FONT_FAMILY_FONT_AWESOME}';font-style:normal;font-weight:normal;line-height:1;display:inline-block;text-rendering:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}` : '',
    MATERIAL_ICONS_WOFF2 ? `.material-icons{font-family:'${FONT_FAMILY_MATERIAL_ICONS}';font-weight:normal;font-style:normal;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';-webkit-font-smoothing:antialiased;}` : '',
].filter(x => !!x).join('\n');

// 把图标字体注册到当前文档。data URI 是内联内容, 不走网络,
// 因此无需像原来的 CDN <link> 那样做延迟加载, 也不会阻塞首帧。
export function ensureIconFonts() {
    if (!ICON_FONT_FACE_CSS) {
        if (typeof console !== 'undefined') {
            console.warn('[mydraft] 图标字体数据缺失, 画布上的 Icon 与图标面板可能显示异常。请执行 bash tools/fetch-icon-fonts.sh');
        }

        return;
    }

    const style = document.createElement('style');

    style.setAttribute('data-icon-fonts', 'true');
    style.textContent = ICON_FONT_FACE_CSS;

    document.head.appendChild(style);
}

// 等待图标字体完成字面加载。用于导出前的排版稳定:
// 字体未就绪时浏览器会按回退字体测量文本宽度, foreignObject 里的字形位置会偏。
export function waitForIconFonts(): Promise<unknown> {
    const fontSet = (document as any).fonts;

    if (ICON_FONT_FAMILIES.length === 0 || !fontSet?.load) {
        return Promise.resolve();
    }

    return Promise.all(
        ICON_FONT_FAMILIES.map(family =>
            Promise.resolve(fontSet.load(`16px '${family}'`)).catch(() => undefined)),
    );
}
