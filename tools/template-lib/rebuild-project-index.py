#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""rebuild-project-index.py — 重建 templates/index.json（项目级索引）

背景
----
M3 的 build-library.py 初版把模板目录误写成 templates/index.json，
覆盖掉了原本的项目级索引。本脚本重建它。

以后两级索引语义不同，必须分开：
  templates/index.json    项目级（转换产物视角）
  templates/catalog.json  模板级（模板库视角，M3 写）

数据来源
--------
· .rp 源路径 / 发布状态← cook/_logs/batch*.json（发布阶段产物）
· 控件数 / 图元数 / 文本数← templates/data/<项目>/{tree,diagram}.json（M2 产物）
  ★ 两者来自不同阶段，字段名也不同：batch 报告是 Axure 发布阶段的记录，
    里面没有图元数（图元是 M2 才产出的）。别把detail.datajs_count
    当成图元数 —— 那是发布产物的页面数。

用法
----
    python rebuild-project-index.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# 本文件在 1.0.1/tools/template-lib/ → 上溯两级到 1.0.1
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TPL = os.path.join(ROOT, 'templates')
LOGS = os.path.join(ROOT, 'cook', '_logs')

REPORTS = ['batch163.json', 'batch117.json', 'retry3b.json']


def scan_m2(project):
    """从 M2 产物统计图元/控件/文本。返回 (pages, items, shapes, groups, cnTexts)。"""
    d = os.path.join(TPL, 'data', project)
    tp = os.path.join(d, 'tree.json')
    dp = os.path.join(d, 'diagram.json')
    sp = os.path.join(d, 'texts.json')
    pages = objs = 0
    if os.path.isfile(tp):
        try:
            t = json.load(open(tp, encoding='utf-8'))
            pages = len(t.get('pages', []))
            objs = sum(len(p.get('objects', [])) for p in t.get('pages', []))
        except Exception:
            pass
    items = groups = cn = 0
    if os.path.isfile(dp):
        try:
            m = json.load(open(dp, encoding='utf-8'))
            for dg in m.get('editor', {}).get('diagrams', []):
                for it in dg.get('items', []):
                    items += 1
                    if (it.get('type') or '') != 'Shape':
                        groups += 1
                    else:
                        t = (it.get('appearance', {}) or {}).get('TEXT') or ''
                        if t.strip():
                            cn += 1
        except Exception:
            pass
    return pages, objs, items, groups, cn


def main():
    if not os.path.isdir(LOGS):
        print('找不到报告目录: %s' % LOGS)
        return 1

    by_file = {}
    used = []
    for r in REPORTS:
        p = os.path.join(LOGS, r)
        if not os.path.isfile(p):
            continue
        used.append(r)
        for rec in json.load(open(p, encoding='utf-8')):
            key = rec.get('file', '').replace('\\', '/')
            if not key:
                continue
            # 后跑的覆盖先跑的（retry3b 里的修正优先）
            by_file[key] = rec

    if not by_file:
        print('三份报告都没有可用记录')
        return 1

    projects = []
    for key, rec in by_file.items():
        name = rec.get('name', '')
        pages, objs, items, groups, cn = scan_m2(name)
        projects.append({
            'file': rec.get('file', ''),
            'name': name,
            'status': rec.get('status', ''),
            'sec': rec.get('sec', 0),
            'publishOut': rec.get('out', ''),
            'pages': pages,
            'objects': objs,
            'shapes': items,
            'groups': groups,
            'texts': cn,
        })
    projects.sort(key=lambda x: x['name'])

    ok = [p for p in projects if p['status'] in ('OK', 'SKIP')]
    out = {
        'generatedAt': __import__('time').strftime('%Y-%m-%d %H:%M:%S'),
        'note': '项目级索引。.rp源路径/发布状态来自 batch 报告（发布阶段），'
                '图元/控件/文本来自 templates/data/*/（M2 阶段）。'
                '模板级索引在 catalog.json。',
        'publishReports': used,
        'total': len(projects),
        'ok': len(ok),
        'failed': len(projects) - len(ok),
        'pages': sum(p['pages'] for p in projects),
        'objects': sum(p['objects'] for p in projects),
        'shapes': sum(p['shapes'] for p in projects),
        'groups': sum(p['groups'] for p in projects),
        'texts': sum(p['texts'] for p in projects),
        'projects': projects,
    }
    dst = os.path.join(TPL, 'index.json')
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print('已重建: %s' % dst)
    print('  项目 %d  成功 %d  失败 %d'
          % (out['total'], out['ok'], out['failed']))
    print('  页面 %d   控件 %d   图元 %d   文本 %d'
          % (out['pages'], out['objects'], out['shapes'], out['texts']))
    print('  含.rp 源路径 %d / %d'
          % (sum(1 for p in projects if p['file']), len(projects)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
