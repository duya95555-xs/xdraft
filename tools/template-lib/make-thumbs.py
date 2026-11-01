#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""make-thumbs.py — 把模板页渲染成缩略图 PNG

用rasterize.py（纯标准库）把 templates/diagram/<tpl>.json 画成
templates/thumbs/<tpl>.png。

渲染策略
--------
目标：让用户在模板浏览器里**一眼看出页面结构**，不是像素级预览。
所以做三件事：
  1. 等比缩放到固定画布（默认 320x240），保留纵横比
  2. 按 renderer 区分视觉：Rectangle 实心块 / Label 文本条 / Image 灰块
  3. 页面标题画在顶部标签栏上

不做：真图片解码（Image 画灰块占位）、真字体渲染（ASCII 点阵 + CJK 豆腐块）、
     圆角/渐变/阴影

为什么不做真图片
---------------
Axure 产物里每页平均 94 张图（1511 页 × 图元），全是 PNG/JPEG。
要真渲染就得引入图片解码库，而缩略图上9px 高的图片本来也看不清。
用灰块占位反而能更清楚地区分「这里是图」vs「这里是文字」。

用法
----
    python make-thumbs.py# 全量
    python make-thumbs.py --limit 20   # 试跑
    python make-thumbs.py --width 400 --height 300
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rasterize import Canvas   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TPL = os.path.join(ROOT, 'templates')
DIAG = os.path.join(TPL, 'diagram')
THUMB = os.path.join(TPL, 'thumbs')

# 视觉语言
BG = (248, 249, 251)
FRAME = (206, 210, 216)
TITLEBAR = (238, 241, 245)
TITLE_FG = (70, 78, 90)
RENDER_COLOR = {
    # renderer -> (填充, 描边)
    'Rectangle': ((222, 226, 232), (176, 182, 190)),
    'Label':     ((255, 255, 255), (198, 202, 208)),
    'Image':     ((206, 214, 224), (170, 180, 192)),
    'Group':     None,                # Group 只是容器，不画
    'Checkbox':  ((255, 255, 255), (150, 156, 164)),
    'ComboBox':  ((255, 255, 255), (150, 156, 164)),
    'RadioButton': ((255, 255, 255), (150, 156, 164)),
    'TextArea':  ((255, 255, 255), (150, 156, 164)),
}
DEFAULT_COLOR = ((236, 238, 242), (200, 204, 210))
TITLEBAR_H = 18
# 缩到这么小就不画文本了（看不清且噪声大）
MIN_TEXT_H = 6


def rgb(v, default=None):
    """mydraft 的颜色是 0xRRGGBB 整数。0 视为「未设置」。"""
    if v is None or v == 0:
        return default
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def render(diagram, meta, w, h):
    c = Canvas(w, h, bg=BG)
    # 页面边框
    c.rect(0, 0, w - 1, h - 1, stroke=FRAME)
    # 标题栏
    c.rect(1, 1, w - 3, TITLEBAR_H, fill=TITLEBAR)
    title = meta.get('name') or diagram.get('title') or ''
    t = str(title)[:int((w - 12) / 6)]
    c.text(5, 5, t, TITLE_FG)

    items = diagram.get('items') or []
    if not items:
        c.text(8, h // 2 - 4, '(empty)', (150, 155, 162))
        return c

    # 画布范围
    xs = [it['transform'].get('x', 0) for it in items
          if isinstance(it.get('transform'), dict)]
    ys = [it['transform'].get('y', 0) for it in items
          if isinstance(it.get('transform'), dict)]
    xe = [it['transform'].get('x', 0) + it['transform'].get('w', 0)
          for it in items if isinstance(it.get('transform'), dict)]
    ye = [it['transform'].get('y', 0) + it['transform'].get('h', 0)
          for it in items if isinstance(it.get('transform'), dict)]
    if not xs:
        return c
    minx, miny = min(xs), min(ys)
    maxx, maxy = max(xe), max(ye)
    sw = max(maxx - minx, 1)
    sh = max(maxy - miny, 1)

    # 视口（标题栏以下）
    vx0, vy0 = 1, TITLEBAR_H + 1
    vw = w - 3
    vh = h - TITLEBAR_H - 3
    # 等比缩放，居中
    scale = min(vw / sw, vh / sh)
    if scale > 1:
        scale = 1        # 不放大，小图放大只会模糊
    ox = vx0 + (vw - sw * scale) / 2
    oy = vy0 + (vh - sh * scale) / 2

    for it in items:
        r = it.get('renderer') or it.get('type')
        if r == 'Group':
            continue
        tr = it.get('transform') or {}
        tw = tr.get('w', 0) or 0
        th = tr.get('h', 0) or 0
        if tw <= 0 or th <= 0:
            continue
        x = int(ox + (tr.get('x', 0) - minx) * scale)
        y = int(oy + (tr.get('y', 0) - miny) * scale)
        rw = max(1, int(tw * scale))
        rh = max(1, int(th * scale))
        if x > w or y > h or x + rw < 0 or y + rh < 0:
            continue

        pair = RENDER_COLOR.get(r, DEFAULT_COLOR)
        ap = it.get('appearance') or {}
        if pair is None:
            continue
        fill, stroke = pair
        # 有 BACKGROUND_COLOR 且非 0 时用它（实心块）
        bc = rgb(ap.get('BACKGROUND_COLOR'))
        if r == 'Rectangle' and bc:
            fill = bc
        c.rect(x, y, rw, rh, fill=fill, stroke=stroke)

        # 文本：够大才画
        txt = (ap.get('TEXT') or '').strip()
        if txt and rh >= MIN_TEXT_H and rw >= 12:
            max_ch = max(1, (rw - 4) // 6)
            s = str(txt)[:max_ch]
            ty = y + max(0, (rh - 7) // 2)
            fg = rgb(ap.get('FOREGROUND_COLOR'), (90, 96, 104))
            c.text(x + 2, ty, s, fg)
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--width', type=int, default=320)
    ap.add_argument('--height', type=int, default=240)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    if not os.path.isdir(DIAG):
        print('缺少 diagram 目录，先跑 build-library.py')
        return 1
    os.makedirs(THUMB, exist_ok=True)

    files = sorted(f for f in os.listdir(DIAG) if f.endswith('.json'))
    if a.limit:
        files = files[:a.limit]
    print('待渲染: %d  画布 %dx%d' % (len(files), a.width, a.height))
    print('-' * 60)

    t0 = time.time()
    n_ok = n_skip = n_err = 0
    errs = []
    for i, f in enumerate(files, 1):
        tid = f[:-5]
        out = os.path.join(THUMB, tid + '.png')
        if not a.force and os.path.isfile(out) and os.path.getsize(out) > 200:
            n_skip += 1
            continue
        dp = os.path.join(DIAG, f)
        mp = os.path.join(TPL, 'meta', tid + '.json')
        try:
            d = json.load(open(dp, encoding='utf-8'))
            meta = {}
            if os.path.isfile(mp):
                try:
                    meta = json.load(open(mp, encoding='utf-8'))
                except Exception:
                    meta = {}
            dgs = (d.get('editor') or {}).get('diagrams') or []
            if not dgs:
                n_err += 1
                errs.append((tid, '无 diagrams'))
                continue
            c = render(dgs[0], meta, a.width, a.height)
            c.save(out)
            n_ok += 1
        except Exception as e:
            n_err += 1
            errs.append((tid, str(e)[:60]))
        if i % 200 == 0 or i == len(files):
            print('  [%4d/%d] 生成 %d  跳过 %d  失败 %d  (%.1fs)'
                  % (i, len(files), n_ok, n_skip, n_err, time.time() - t0))

    print('-' * 60)
    print('生成 %d  跳过 %d  失败 %d  (%.1f 秒)'
          % (n_ok, n_skip, n_err, time.time() - t0))
    if errs:
        print()
        print('失败样例:')
        for tid, why in errs[:8]:
            print('  %s  %s' % (tid, why))
    # 体积统计
    tot = 0
    for f in os.listdir(THUMB):
        try:
            tot += os.path.getsize(os.path.join(THUMB, f))
        except OSError:
            pass
    print('thumbs/ 总体积 %.1f MB（平均 %.1f KB）'
          % (tot / 1048576.0, tot / 1024.0 / max(len(files), 1)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
