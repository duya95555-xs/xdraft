/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { renderDiagramToSvg } from './export-image';

/* Builds a self-contained HTML document around the given SVG xml. */
export function buildStandaloneHtml(svgXml: string, title: string, background: string): string {
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
    html, body { margin: 0; padding: 24px; background: #f0f2f5; }
    .canvas { background: ${background}; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); margin: 0 auto; max-width: 100%; width: fit-content; }
    .canvas svg { display: block; height: auto; max-width: 100%; }
    .footer { color: #999999; font-family: sans-serif; font-size: 12px; margin: 12px auto 0; text-align: center; }
</style>
</head>
<body>
<div class="canvas">${svgXml}</div>
<div class="footer">Exported by xdraft (based on mydraft.cc)</div>
</body>
</html>`;
}

/* Renders the given region of a diagram as a self-contained HTML document. */
export async function renderDiagramToHtml(region: Parameters<typeof renderDiagramToSvg>[0], title: string): Promise<{ html: string; externalImages: number }> {
    const { xml, externalImages } = await renderDiagramToSvg(region, 1);

    const html = buildStandaloneHtml(xml, title, region.background);

    return { html, externalImages };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
