/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { ConfigurableFactory, DefaultAppearance, Rect2, RenderContext, Shape, ShapePlugin } from '@app/wireframes/interface';
import { Connector, connectorPoints } from './_connector';
import { CONNECTOR_CORNER_RADIUS, distanceToPolyline, pathFromPoints, pointAtDistance, polylineLength, Pt } from './_connector-routing';
import { CommonTheme } from './_theme';

// curved 类型在未指定 Curve Amount 时使用的默认圆角半径。
const DEFAULT_CURVED_RADIUS = 24;

// 标注默认底色 = 画布默认底色(EditorState.color 默认 Color.WHITE = 0xffffff)。
// 用字面量而不是 import Color,是为了让本文件保持"叶子模块"(零模型层依赖),
// 避免与 _connector.ts / diagram 之间引入循环引用。
//
// ⚠️ 必须声明在 DEFAULT_APPEARANCE 之前:const 不像 var 有变量提升,
// DEFAULT_APPEARANCE 的初始化表达式在模块求值时就要求值,此时若该常量还在
// 暂时性死区(TDZ)内会直接抛 ReferenceError,导致整个模块加载失败 → 页面白屏。
const DEFAULT_LABEL_BACKGROUND = 0xffffff;

// 标注区尺寸(局部坐标,px)。高亮背景高度固定,宽度按文字实测撑开。
const LABEL_WIDTH = 60;
const LABEL_HEIGHT = 20;
const LABEL_FONT_SIZE = 13;
const LABEL_PADDING_X = 6;

const DEFAULT_APPEARANCE: { [key: string]: any } = {
    // 标注文字的字号与颜色。颜色与流程图形状描边统一为 #5D5D5D(可右侧面板改)。
    // (填充色按既有口径**不**提供给线条类;标注底色另有 TEXT_BACKGROUND 键。)
    [DefaultAppearance.FONT_SIZE]: LABEL_FONT_SIZE,
    [DefaultAppearance.FOREGROUND_COLOR]: CommonTheme.FLOWCHART_COLOR,
    [DefaultAppearance.STROKE_COLOR]: CommonTheme.FLOWCHART_COLOR,
    [DefaultAppearance.STROKE_THICKNESS]: 2,
    [Connector.TYPE]:       'orthogonal',
    [Connector.HEAD_START]: 'none',
    [Connector.HEAD_END]:   'arrow',
    [Connector.STROKE_DASH]: 'solid',
    [Connector.BEND_POSITION]: 0.5,
    [Connector.CURVE_AMPLITUDE]: 0,
    [Connector.TEXT]:       '',
    [Connector.TEXT_POSITION]: 0.5,
    // 标注底色:默认与画布一致(白),保证文字压到线/网格上依然可读。
    // 用户可在右侧属性面板里改成任何颜色,改成与画布同色即等于"看起来透明"。
    [Connector.TEXT_BACKGROUND]: DEFAULT_LABEL_BACKGROUND,
};

// 箭头三角形的半宽(线端垂直方向)与半长(沿线方向),单位 px(按 1/zoom 缩放在渲染时处理)。
const ARROW_HALF_WIDTH = 5;
const ARROW_LENGTH = 10;

// 路由无解时的降级描边色(红)与虚线样式。
const DEGRADED_STROKE_COLOR = '#d4380d';
const DEGRADED_DASH = '6 4';

// 命中容差下限:太细的线不容易点中(FR-5 要求"可点中线条本体",但不等于"AABB 全可点")。
//
// 取值 10:用户实测 6px 太难点中,10px 手感更接近主流绘图工具。
// 注意这个值只在"鼠标点击"这一侧起作用(AABB 垫片已退出命中,见 item.ts 的
// shouldIgnoreSelectorPointer);框选仍走 SvgLayer.hitTest 的 distanceToPolyline。
export const MIN_HIT_TOLERANCE = 10;

// 隐形命中带的描边宽度 = 容差 * 2。
// pointer-events:stroke 的命中区就是描边自身宽度,所以要让"距中心线 10px 内都可点中",
// 就必须给这条路径 stroke-width = 20。
export const HIT_STROKE_WIDTH = MIN_HIT_TOLERANCE * 2;

export class Connect implements ShapePlugin {
    public identifier(): string {
        return 'Connector';
    }

    public defaultAppearance() {
        return DEFAULT_APPEARANCE;
    }

    public defaultSize() {
        // 大小由 maintainConnectors 动态管理;默认值仅用于插件注册表内部校验。
        return { x: 100, y: 100 };
    }

    // 连接线不是业务图元,不允许手动放置到画布(仅由连接线工具创建)。
    public showInGallery?(): boolean {
        return false;
    }

    // 连线的 AABB 只是折线的外接矩形,空白角落不应命中 → 不画矩形选框(CONN-009)。
    public showSelectionBounds?(): boolean {
        return false;
    }

    public configurables(factory: ConfigurableFactory) {
        return [
            // 线型 / 箭头(连接线专属)
            factory.selection(Connector.TYPE, 'Connection Type', ['straight', 'orthogonal', 'curved']),
            factory.selection(Connector.HEAD_START, 'Head Start', ['none', 'arrow']),
            factory.selection(Connector.HEAD_END, 'Head End', ['none', 'arrow']),
            // 线型: 实线 / 虚线 / 点线(渲染时按线宽缩放 dash 节距)
            factory.selection(Connector.STROKE_DASH, 'Stroke Style', ['solid', 'dashed', 'dotted']),
            // 圆角强度(curved 类型时的拐角圆角半径,0 = 使用默认值)
            factory.slider(Connector.CURVE_AMPLITUDE, 'Curve Amount', 0, 100),
            // 文本标注(连接线专属)
            factory.text(Connector.TEXT, 'Label'),
            factory.slider(Connector.TEXT_POSITION, 'Label Position', 0, 1),
            // 标注底色。默认与画布一致;调成透明感就把颜色设成与画布相同。
            factory.color(Connector.TEXT_BACKGROUND, 'Label Background'),
        ];
    }

    public render(ctx: RenderContext) {
        const points = this.resolvePoints(ctx.shape);

        const thick = num(ctx.shape.getAppearance(DefaultAppearance.STROKE_THICKNESS)) || 2;
        const degraded = ctx.shape.getAppearance(Connector.DEGRADED) === true;

        const d = pathFromPoints(points, this.cornerRadius(ctx.shape));

        ctx.renderer2.path(thick, d, p => {
            p.setStrokeColor(degraded ? DEGRADED_STROKE_COLOR : ctx.shape);
            p.setStrokeStyle('round', 'round');

            // 用户选择的线型(实线/虚线/点线); 路由降级时强制红色虚线, 覆盖用户选择。
            if (degraded) {
                p.setStrokeDash?.(DEGRADED_DASH);
            } else {
                const dash = strokeDashPattern(String(ctx.shape.getAppearance(Connector.STROKE_DASH) || 'solid'), thick);

                if (dash) {
                    p.setStrokeDash?.(dash);
                }
            }
        });

        // ── 隐形命中带(第 7 条)──────────────────────────────────────────────
        // AABB 垫片已被置为 pointer-events:none(item.ts),命中改由这条"宽而透明"的路径承担。
        //
        // 为什么不能靠主 path 自己命中:
        //   主 path 的 stroke-width 是用户设置的真实粗细(可低至 1~2px),
        //   在 SVG 里可点击区就等于这 1~2px,细线几乎点不中。
        //
        // 为什么必须 stroke 有值且非 none:
        //   pointer-events:stroke 只在"描边属性有效"时才响应。若 stroke: none
        //   会被判定为"无描边"而彻底失效,所以显式给 transparent ——
        //   transparent 是颜色(alpha=0),不是 none(无描边)。
        //
        // 为什么不能顺手 setOpacity(0):
        //   pointer-events:stroke 虽然不看 paint,但不同浏览器内核在 opacity:0 时的
        //   行为并不完全一致(部分实现会因为"元素整体不可见"而跳过命中)。
        //   用 stroke:transparent 已经达成"看不见",再叠 opacity 是纯粹的额外风险。
        //
        // 为什么放在箭头与标签之前:
        //   SVG 后绘制的元素在上层。命中带需要"垫在"箭头和标签下面,
        //   让标签(可双击编辑)与箭头保留各自的点击语义,不被这条宽带抢走。
        //
        // 只有能算出路径时才画;d 为空时跳过,避免生成非法 path。
        if (d && d.length > 0) {
            ctx.renderer2.path(HIT_STROKE_WIDTH, d, p => {
                p.setStrokeColor('transparent');
                p.setStrokeStyle('round', 'round');
                p.setPointerEvents?.('stroke');
            });
        }

        // 箭头端。
        if (points.length >= 2) {
            const first = points[0];
            const second = points[1];
            const last = points[points.length - 1];
            const beforeLast = points[points.length - 2];

            if (ctx.shape.getAppearance(Connector.HEAD_END) === 'arrow') {
                this.drawArrow(ctx, beforeLast.x, beforeLast.y, last.x, last.y);
            }

            if (ctx.shape.getAppearance(Connector.HEAD_START) === 'arrow') {
                this.drawArrow(ctx, second.x, second.y, first.x, first.y);
            }
        }

        // 文本标注。
        const text = ctx.shape.getAppearance(Connector.TEXT);

        if (text && points.length >= 1) {
            const tp = clamp01(num(ctx.shape.getAppearance(Connector.TEXT_POSITION), 0.5));
            const at = pointAtDistance(points, tp * polylineLength(points));

            const label = String(text);

            // 背景块按实际文字宽度撑开(加左右内边距),否则长标签会被 60px 的固定框裁掉。
            // 拿不到宽度测量时回退到 LABEL_WIDTH。
            let labelWidth = LABEL_WIDTH;

            try {
                const measured = ctx.renderer2.getTextWidth(label, ctx.shape.fontSize || LABEL_FONT_SIZE, ctx.shape.fontFamily);

                if (Number.isFinite(measured) && measured > 0) {
                    labelWidth = measured + LABEL_PADDING_X * 2;
                }
            } catch {
                // 某些渲染后端可能未实现测量,忽略并使用默认宽度。
            }

            const labelRect = new Rect2(
                at.x - labelWidth * 0.5,
                at.y - LABEL_HEIGHT * 0.5,
                labelWidth,
                LABEL_HEIGHT);

            // 标注底色。必须在画文字**之前**铺,否则会把文字盖住。
            // 颜色缺省 = 画布底色,所以默认看到的是"不透明的画布色块"而不是透明背景。
            const labelBackground = ctx.shape.getAppearance(Connector.TEXT_BACKGROUND);

            if (labelBackground !== undefined && labelBackground !== null && labelBackground !== '') {
                ctx.renderer2.rectangle(0, 0, labelRect, p => {
                    p.setBackgroundColor(labelBackground);
                    p.setStrokeColor(labelBackground);
                });
            }

            ctx.renderer2.text({ fontSize: ctx.shape.fontSize || LABEL_FONT_SIZE, text: label },
                labelRect,
                p => p.setForegroundColor(ctx.shape), false);
        }
    }

    // 精确命中测试:点到折线的距离在容差内才算命中(CONN-004 / FR-5)。
    public hitTest(shape: Shape, point: Pt): boolean {
        const points = this.resolvePoints(shape);

        if (points.length < 2) {
            return false;
        }

        const thickness = num(shape.getAppearance(DefaultAppearance.STROKE_THICKNESS)) || 2;
        const tolerance = Math.max(MIN_HIT_TOLERANCE, thickness * 0.5 + 4);

        return distanceToPolyline(point, points) <= tolerance;
    }

    // 折线点:优先用模型层算好的 CONNECTOR_PTS(局部坐标);
    // 老图纸在首次 maintainConnectors 之前没有该 key,回退到旧的三分支几何。
    private resolvePoints(shape: Shape): Pt[] {
        const cached = connectorPoints(shape);

        if (cached && cached.length >= 2) {
            return cached;
        }

        const x1 = num(shape.getAppearance(Connector.X1));
        const y1 = num(shape.getAppearance(Connector.Y1));
        const x2 = num(shape.getAppearance(Connector.X2));
        const y2 = num(shape.getAppearance(Connector.Y2));

        const type = shape.getAppearance(Connector.TYPE) || 'straight';
        const bendPos = clamp01(num(shape.getAppearance(Connector.BEND_POSITION), 0.5));
        const amp = num(shape.getAppearance(Connector.CURVE_AMPLITUDE), 0);

        return legacyPoints(type, x1, y1, x2, y2, bendPos, amp);
    }

    private cornerRadius(shape: Shape): number {
        const type = shape.getAppearance(Connector.TYPE) || 'straight';

        if (type !== 'curved') {
            return 0;
        }

        const amp = num(shape.getAppearance(Connector.CURVE_AMPLITUDE), 0);

        return amp > 0 ? Math.min(amp, CONNECTOR_CORNER_RADIUS) : DEFAULT_CURVED_RADIUS;
    }

    // 在端点(tx,ty)按方向(cx,cy)->(tx,ty)叠加一个实心三角箭头 path。
    private drawArrow(ctx: RenderContext, cx: number, cy: number, tx: number, ty: number) {
        const dx = tx - cx;
        const dy = ty - cy;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len < 0.001) return;

        // 单位方向 + 法向
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;

        // 箭头尖端 = (tx,ty);两点底边 = 尖端 - 方向*ARROW_LENGTH ± 法向*ARROW_HALF_WIDTH
        const bx = tx - ux * ARROW_LENGTH;
        const by = ty - uy * ARROW_LENGTH;

        const leftX = bx + nx * ARROW_HALF_WIDTH;
        const leftY = by + ny * ARROW_HALF_WIDTH;
        const rightX = bx - nx * ARROW_HALF_WIDTH;
        const rightY = by - ny * ARROW_HALF_WIDTH;

        const d = `M ${tx} ${ty} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`;

        ctx.renderer2.path(2, d, p => {
            p.setStrokeColor(ctx.shape);
            p.setBackgroundColor(ctx.shape);
        });
    }
}

// 旧几何(CONNECTOR_PTS 缺失时的兜底),与改造前的渲染分支保持像素级一致。
function legacyPoints(type: string, x1: number, y1: number, x2: number, y2: number, bendPos: number, amp: number): Pt[] {
    if (type === 'curved') {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;

        const cx = mx + (-dy / len) * amp;
        const cy = my + (dx / len) * amp;

        const steps = 16;
        const pts: Pt[] = [];

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;

            pts.push({ x: quadraticBezier(x1, cx, x2, t), y: quadraticBezier(y1, cy, y2, t) });
        }

        return pts;
    }

    if (type === 'orthogonal') {
        const dx = x2 - x1;
        const dy = y2 - y1;

        if (Math.abs(dx) >= Math.abs(dy)) {
            const midX = x1 + dx * bendPos;

            return [{ x: x1, y: y1 }, { x: midX, y: y1 }, { x: midX, y: y2 }, { x: x2, y: y2 }];
        }

        const midY = y1 + dy * bendPos;

        return [{ x: x1, y: y1 }, { x: x1, y: midY }, { x: x2, y: midY }, { x: x2, y: y2 }];
    }

    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

function num(v: any, fallback = 0): number {
    const n = Number(v);

    return Number.isFinite(n) ? n : fallback;
}

// 线型对应的 SVG stroke-dasharray 节距。按线宽缩放, 保证粗线时虚线段不会显得过密。
// solid 返回 undefined(不设置 dasharray); 配合 setStrokeStyle 的 round 端帽,
// dotted 渲染为圆点串。
function strokeDashPattern(style: string, thick: number): string | undefined {
    if (style === 'dashed') {
        return `${thick * 4} ${thick * 2.5}`;
    }

    if (style === 'dotted') {
        return `1 ${thick * 2.5}`;
    }

    return undefined;
}

// 夹紧到 [0,1]。
function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

// 二次贝塞尔点。
function quadraticBezier(p0: number, p1: number, p2: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}
