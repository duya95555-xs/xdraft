#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""probe-visual.py — 摸清 diagram 里可用于渲染的视觉信息

在写光栅化器之前先量化：
- 颜色分布（背景/前景/描边）
- 尺寸缺失率
- 文本长度分布
- renderer 构成
避免基于假设写渲染器。
"""
import collections
import glob
import json
import os
import random

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
TPL = os.path.join(ROOT, 'templates')
DIAG = os.path.join(TPL, 'diagram')

files = sorted(glob.glob(os.path.join(DIAG, '*.json')))
print('diagram 文件: %d' % len(files))
random.seed(11)
sample = random.sample(files, min(60, len(files)))

rend = collections.Counter()
color = collections.Counter()
nosize = 0
total = 0
textlen = []
pagesize = []
for f in sample:
    try:
        d = json.load(open(f, encoding='utf-8'))
    except Exception:
        continue
    for dg in d['editor']['diagrams']:
        xs = []
        ys = []
        xe = []
        ye = []
        for it in dg.get('items', []):
            total += 1
            rend[it.get('renderer') or it.get('type')] += 1
            ap = it.get('appearance') or {}
            tr = it.get('transform') or {}
            for k in ('FOREGROUND_COLOR', 'BACKGROUND_COLOR', 'STROKE_COLOR'):
                v = ap.get(k)
                if v is not None:
                    color['%s=%d' % (k[:5], v)] += 1
            w = tr.get('w', 0)
            h = tr.get('h', 0)
            x = tr.get('x', 0)
            y = tr.get('y', 0)
            if not w or not h:
                nosize += 1
            else:
                xs.append(x); ys.append(y); xe.append(x + w); ye.append(y + h)
            t = ap.get('TEXT')
            if t and t.strip():
                textlen.append(len(t))
        if xs:
            pagesize.append((min(xs), min(ys), max(xe), max(ye)))

print('图元总数: %d  平均 %d/页' % (total, total // max(len(sample), 1)))
print()
print('--- renderer 构成 ---')
for k, v in rend.most_common(12):
    print('  %-16s %6d  %.1f%%' % (k, v, 100.0 * v / total))
print()
print('--- 缺 w/h 的图元: %d / %d  (%.1f%%) ---' % (nosize, total, 100.0 * nosize / total))
print()
print('--- 颜色取值 TOP12 ---')
for k, v in color.most_common(12):
    print('  %-22s %6d' % (k, v))
print()
if textlen:
    textlen.sort()
    print('--- 文本长度: 中位 %d  均值 %d  最大 %d  无文本图元 %d ---'
          % (textlen[len(textlen) // 2], sum(textlen) // len(textlen),
             textlen[-1], total - len(textlen)))
print()
if pagesize:
    ws = sorted(p[2] - p[0] for p in pagesize)
    hs = sorted(p[3] - p[1] for p in pagesize)
    print('--- 页面尺寸 ---')
    print('  宽: 中位 %d  最小 %d  最大 %d' % (ws[len(ws) // 2], ws[0], ws[-1]))
    print('  高: 中位 %d  最小 %d  最大 %d' % (hs[len(hs) // 2], hs[0], hs[-1]))
    big = sum(1 for p in pagesize if p[2] - p[0] > 3000 or p[3] - p[1] > 3000)
    print('  超大页(>3000px): %d / %d' % (big, len(pagesize)))
