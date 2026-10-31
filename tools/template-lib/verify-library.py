#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""verify-library.py — 模板库完整性校验

入库之后必须校验的三件事（每一件都对应一类真实故障）：
  1. 三层齐全   —— catalog / meta / diagram 数量与 id 对得上
  2. meta 字段完整 —— 方案 §7.1 要求的字段一个不缺
  3. diagram 可加载 —— 抽检若干个，确认 JSON 合法且结构符合 mydraft 格式

另附质量分布统计，用于判断规则覆盖情况。

用法
----
    python verify-library.py            # 全量校验
    python verify-library.py --sample 30# diagram 抽检 30 个
"""
import argparse
import collections
import glob
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TPL = os.path.join(ROOT, 'templates')

REQUIRED_META = ['id', 'name', 'source', 'domain', 'tags', 'granularity',
                 'widgets', 'widgetKeywords', 'questions', 'diagram',
                 'stats', 'thumb', 'version', 'createdAt']
REQUIRED_STAT = ['itemCount', 'width', 'height', 'textCount']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', type=int, default=40, help='diagram 抽检数')
    a = ap.parse_args()

    cat_p = os.path.join(TPL, 'catalog.json')
    if not os.path.isfile(cat_p):
        print('缺少 catalog.json，先跑 build-library.py')
        return 1
    cat = json.load(open(cat_p, encoding='utf-8'))
    entries = cat.get('templates', [])
    total = cat.get('total', 0)
    print('=' * 66)
    print('模板库完整性校验')
    print('=' * 66)
    print('catalog 总数: %d' % total)
    print()

    # ── 1. 三层齐全 ──
    meta_files = glob.glob(os.path.join(TPL, 'meta', '*.json'))
    diag_files = glob.glob(os.path.join(TPL, 'diagram', '*.json'))
    ids = set(t['id'] for t in entries)
    meta_ids = set(os.path.splitext(os.path.basename(f))[0] for f in meta_files)
    diag_ids = set(os.path.splitext(os.path.basename(f))[0] for f in diag_files)

    print('--- 1. 三层齐全 ---')
    print('  catalog   %d' % len(entries))
    print('  meta/     %d' % len(meta_ids))
    print('  diagram/  %d' % len(diag_ids))
    miss_meta = ids - meta_ids
    miss_diag = ids - diag_ids
    orphan_meta = meta_ids - ids
    orphan_diag = diag_ids - ids
    print('  缺 meta    %d' % len(miss_meta))
    print('  缺 diagram %d' % len(miss_diag))
    print('  孤儿 meta  %d' % len(orphan_meta))
    print('  孤儿 diagram %d' % len(orphan_diag))
    ok1 = not (miss_meta or miss_diag)
    print('  → %s' % ('通过' if ok1 else '不通过'))
    print()

    # ── 2. meta 字段完整 ──
    print('--- 2. meta 字段完整性（全量扫）---')
    bad_field = collections.Counter()
    bad_example = {}
    no_question = 0
    for f in meta_files:
        try:
            m = json.load(open(f, encoding='utf-8'))
        except Exception as e:
            bad_field['JSON 解析失败'] += 1
            continue
        for k in REQUIRED_META:
            if k not in m:
                bad_field['缺 ' + k] += 1
                bad_example.setdefault('缺 ' + k, os.path.basename(f))
        for k in REQUIRED_STAT:
            if k not in (m.get('stats') or {}):
                bad_field['stats 缺 ' + k] += 1
        if not m.get('questions'):
            no_question += 1
    if bad_field:
        for k, v in bad_field.most_common():
            print('  %-24s %d   例: %s' % (k, v, bad_example.get(k, '')))
    else:
        print('  全部 %d 个 meta 字段完整' % len(meta_files))
    print('  无 questions 的模板: %d' % no_question)
    ok2 = not bad_field
    print('  → %s' % ('通过' if ok2 else '不通过'))
    print()

    # ── 3. diagram 可加载 ──
    print('--- 3. diagram 结构抽检 ---')
    random.seed(42)
    pick = random.sample(sorted(diag_ids), min(a.sample, len(diag_ids)))
    bad_diag = []
    empty_diag = 0
    items_total = 0
    for i in pick:
        f = os.path.join(TPL, 'diagram', i + '.json')
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception as e:
            bad_diag.append((i, '解析失败: %s' % str(e)[:40]))
            continue
        ed = d.get('editor') or {}
        dgs = ed.get('diagrams') or []
        if not dgs:
            bad_diag.append((i, '无 diagrams'))
            continue
        dg = dgs[0]
        items = dg.get('items') or []
        items_total += len(items)
        if not items:
            empty_diag += 1
        if not dg.get('title'):
            bad_diag.append((i, '缺 title'))
        if not ed.get('selectedDiagramId'):
            bad_diag.append((i, '缺 selectedDiagramId'))
        if len(ed.get('diagramIds') or []) != len(dgs):
            bad_diag.append((i, 'diagramIds 数量不符'))
    print('  抽检 %d 个，item 总数 %d' % (len(pick), items_total))
    print('  结构异常 %d' % len(bad_diag))
    for i, why in bad_diag[:8]:
        print('    %s  %s' % (i, why))
    print('  空图（items=0）%d' % empty_diag)
    ok3 = not bad_diag
    print('  → %s' % ('通过' if ok3 else '不通过'))
    print()

    # ── 3.5 缩略图齐全且合法 ──
    print('--- 3.5 缩略图 ---')
    thumb_dir = os.path.join(TPL, 'thumbs')
    if not os.path.isdir(thumb_dir):
        print('  thumbs/ 目录不存在（还没跑 make-thumbs.py）')
        ok35 = True
    else:
        th = glob.glob(os.path.join(thumb_dir, '*.png'))
        th_ids = set(os.path.splitext(os.path.basename(f))[0] for f in th)
        miss_th = ids - th_ids
        # PNG 头校验：\x89PNG + IHDR 里的宽高
        bad_png = []
        small = 0
        sizes = []
        for f in th:
            try:
                with open(f, 'rb') as fp:
                    head = fp.read(24)
                if head[:8] != b'\x89PNG\r\n\x1a\n':
                    bad_png.append((os.path.basename(f), '头非法'))
                    continue
                import struct as _s
                w, h = _s.unpack('>II', head[16:24])
                sz = os.path.getsize(f)
                sizes.append(sz)
                if w < 8 or h < 8:
                    small += 1
                if sz < 120:
                    bad_png.append((os.path.basename(f), '过小 %d' % sz))
            except Exception as e:
                bad_png.append((os.path.basename(f), str(e)[:30]))
        print('  thumb 文件 %d' % len(th))
        print('  缺缩略图%d' % len(miss_th))
        print('  非法 PNG    %d' % len(bad_png))
        print('  过小(<120B) %d' % small)
        if sizes:
            sizes.sort()
            print('  体积 中位 %dB  最大 %dB  合计 %.1f MB'
                  % (sizes[len(sizes) // 2], sizes[-1], sum(sizes) / 1048576.0))
        for nm, why in bad_png[:5]:
            print('    %s  %s' % (nm, why))
        ok35 = not miss_th and not bad_png and not small
        print('  → %s' % ('通过' if ok35 else '不通过'))
    print()

    # ── 4. 质量分布 ──
    print('--- 4. 质量分布 ---')
    dom = collections.Counter(t['domain'] for t in entries)
    tag = collections.Counter()
    for t in entries:
        for x in t['tags']:
            tag[x] += 1
    nq = collections.Counter(len(json.load(open(
        os.path.join(TPL, 'meta', t['id'] + '.json'),
        encoding='utf-8')).get('questions') or []) for t in entries[:200])
    print('  业务域: %d 类，通用占 %.0f%%'
          % (len(dom), 100.0 * dom.get('通用', 0) / max(len(entries), 1)))
    print('  有类型标签的页: %d / %d  (%.0f%%)'
          % (len(entries) - tag.get('未分类', 0), len(entries),
             100.0 * (len(entries) - tag.get('未分类', 0)) / max(len(entries), 1)))
    print('  questions 数量分布(前200):', dict(sorted(nq.items())))
    items = [t['itemCount'] for t in entries]
    if items:
        items.sort()
        print('  itemCount: 中位 %d  均值 %d  最大 %d'
              % (items[len(items) // 2], sum(items) // len(items), items[-1]))
    # 尺寸检查
    nosize = [t for t in entries if t['width'] <= 0 or t['height'] <= 0]
    print('  尺寸为 0 的模板: %d' % len(nosize))
    print()

    allok = ok1 and ok2 and ok3 and ok35
    print('=' * 66)
    print('总体: %s' % ('全部通过' if allok else '存在问题，见上方 ✗'))
    print('=' * 66)
    return 0 if allok else 2


if __name__ == '__main__':
    sys.exit(main())
