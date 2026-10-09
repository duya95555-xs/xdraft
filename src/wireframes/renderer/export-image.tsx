/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { createRoot } from 'react-dom/client';
import { Color, ImmutableMap, Rect2, Vec2 } from '@app/core';
import { ICON_FONT_FACE_CSS, waitForIconFonts } from '@app/fonts/icon-fonts';
import { Diagram, DiagramItemSet } from '@app/wireframes/model';
import { Editor } from './Editor';

/* The padding around the content bounds of a diagram. */
const CONTENT_PADDING = 20;

/* The timeout for the offscreen rendering. */
const RENDER_TIMEOUT = 10000;

/* The svg namespace, needed to create nodes that survive XML serialization. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/* Placeholder for external images that cannot be rasterized. */
const PLACEHOLDER_IMAGE =
    `data:image/svg+xml;charset=utf-8,` +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e8e8e8"/><rect x="1" y="1" width="198" height="198" fill="none" stroke="#bbbbbb" stroke-dasharray="6 4"/></svg>`);

export interface ExportRegion {
    // The diagram to export.
    diagram: Diagram;

    // All diagrams (master components).
    diagrams: ImmutableMap<Diagram>;

    // The region to render, in diagram coordinates.
    bounds: Rect2;

    // The background color of the output.
    background: string;
}

export interface ExportResult {
    // The serialized SVG xml.
    xml: string;

    // The number of external images that have been replaced by placeholders.
    externalImages: number;
}

/* Computes the bounds of all items of the diagram, inflated by a padding. */
export function getDiagramContentBounds(diagram: Diagram): Rect2 {
    const aabbs = Array.from(diagram.items.values, x => x.bounds(diagram).aabb);

    if (aabbs.length === 0) {
        return new Rect2(0, 0, 200, 200);
    }

    return Rect2.fromRects(aabbs).inflate(CONTENT_PADDING);
}

/* Renders the given region of a diagram and returns it as a serialized SVG. */
export function renderDiagramToSvg(region: ExportRegion, scale = 1): Promise<ExportResult> {
    return new Promise((resolve, reject) => {
        const container = document.createElement('div');

        container.style.position = 'fixed';
        container.style.left = '-100000px';
        container.style.top = '0px';
        container.style.width = `${region.bounds.w}px`;
        container.style.height = `${region.bounds.h}px`;
        container.style.overflow = 'hidden';

        document.body.appendChild(container);

        let done = false;

        const cleanup = () => {
            root.unmount();
            container.remove();
        };

        const doFinish = () => {
            try {
                const result = serialize(container, region, scale);

                cleanup();
                resolve(result);
            } catch (error) {
                cleanup();
                reject(error);
            }
        };

        const doRendered = () => {
            // Wait for a frame and a short delay to ensure all items have been painted.
            requestAnimationFrame(() => {
                setTimeout(() => {
                    if (done) {
                        return;
                    }

                    // 离屏 Editor 里的 Icon 是按字体渲染的字形。字体没就绪时浏览器会按
                    // 回退字体测量文本宽度, 字形位置会偏。这里等一下再截图。
                    // 字体数据缺失时该 promise 立即 resolve, 不改变原有行为。
                    waitForIconFonts().then(() => {
                        if (done) {
                            return;
                        }

                        done = true;

                        doFinish();
                    });
                }, 50);
            });
        };

        const doFailed = () => {
            if (done) {
                return;
            }

            done = true;

            cleanup();
            reject(new Error('Timeout: The diagram could not be rendered.'));
        };

        const root = createRoot(container);

        root.render(
            <Editor
                color={Color.fromValue(region.background)}
                diagram={region.diagram}
                diagrams={region.diagrams}
                isDefaultView={false}
                onRender={doRendered}
                selectionSet={DiagramItemSet.EMPTY}
                viewBox={{
                    minX: region.bounds.x,
                    minY: region.bounds.y,
                    maxX: region.bounds.w,
                    maxY: region.bounds.h,
                    zoom: 1,
                }}
                viewSize={new Vec2(region.bounds.w, region.bounds.h)}
            />,
        );

        setTimeout(doFailed, RENDER_TIMEOUT);
    });
}

/* Rasterizes the given region of a diagram to a PNG blob. */
export async function renderDiagramToPng(region: ExportRegion, scale = 2): Promise<{ blob: Blob; externalImages: number }> {
    const { xml, externalImages } = await renderDiagramToSvg(region, scale);

    const blob = await xmlToPngBlob(xml, region.bounds.w * scale, region.bounds.h * scale);

    return { blob, externalImages };
}

/* Converts a serialized SVG to a PNG blob with the given pixel size. */
export function xmlToPngBlob(xml: string, width: number, height: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
        const image = new Image();

        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');

                canvas.width = Math.ceil(width);
                canvas.height = Math.ceil(height);

                const context = canvas.getContext('2d')!;

                context.drawImage(image, 0, 0, canvas.width, canvas.height);

                canvas.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('The canvas could not be converted to a PNG.'));
                    }
                }, 'image/png');
            } catch (error) {
                reject(error);
            }
        };

        image.onerror = () => reject(new Error('The SVG could not be rasterized.'));

        image.src = url;
    });
}

/* Triggers a download of the given blob. */
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 5000);
}

function serialize(container: HTMLElement, region: ExportRegion, scale: number): ExportResult {
    const svgElement = container.querySelector('svg');

    if (!svgElement) {
        throw new Error('No SVG element has been rendered.');
    }

    // Remove helper layers that must not appear in the output.
    for (const id of ['background', 'selectLayer', 'transformLayer', 'cropLayer', 'overlaysLayer']) {
        svgElement.querySelector(`g#${id}`)?.remove();
    }

    // 把图标字体一起写进 SVG。
    //
    // Icon 组件渲染的是字体字形(PUA 字符 + font-family), 而这份 SVG 随后会被当作
    // <img src="data:image/svg+xml,..."> 加载 —— 浏览器在这种模式下运行在
    // "安全静态模式", 不加载任何外部资源: @font-face 里指向文件或 http 的 src 都会失效,
    // 字体回退后 PUA 字符没有字形, 导出结果里图标就是一片空白。
    //
    // data URI 属于内联内容而非外部资源, SVG-as-image 允许加载, 所以这里连同字体数据
    // 一起塞进 <defs>。没有字体数据时跳过, 行为与旧版本一致。
    if (ICON_FONT_FACE_CSS) {
        const defs = document.createElementNS(SVG_NS, 'defs');
        const style = document.createElementNS(SVG_NS, 'style');

        style.setAttribute('type', 'text/css');
        style.textContent = ICON_FONT_FACE_CSS;

        defs.appendChild(style);
        svgElement.insertBefore(defs, svgElement.firstChild);
    }

    // Set an explicit output size and viewbox.
    svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svgElement.setAttribute('width', `${Math.ceil(region.bounds.w * scale)}`);
    svgElement.setAttribute('height', `${Math.ceil(region.bounds.h * scale)}`);
    svgElement.setAttribute('viewBox', `${region.bounds.x} ${region.bounds.y} ${region.bounds.w} ${region.bounds.h}`);
    svgElement.style.backgroundColor = region.background;

    // Replace external images that would taint the canvas on rasterization.
    let externalImages = 0;

    for (const image of Array.from(svgElement.querySelectorAll('image'))) {
        const href = image.getAttribute('href') || image.getAttribute('xlink:href') || '';

        if (/^https?:\/\//i.test(href)) {
            externalImages++;

            if (image.hasAttribute('href')) {
                image.setAttribute('href', PLACEHOLDER_IMAGE);
            }

            if (image.hasAttribute('xlink:href')) {
                image.setAttribute('xlink:href', PLACEHOLDER_IMAGE);
            }
        }
    }

    const xml = new XMLSerializer().serializeToString(svgElement);

    return { xml, externalImages };
}
