#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""search-test.py — 检索原型（验证 M3 入库的数据真能支撑 M4）

不是正式的M4 服务，是**验证入库数据是否够用**的探针。
用 BM25 风格的词频打分，零依赖，够跑通「查询 → 排序 → top-N」链路。

★ 权重设计来自实测结论（不是拍脑袋）★
2026-10-03 对page-index 做过对比实验：
    查询          正文全文命中    页名命中
    商品详情页         2        7
    购物车            63       14
`购物车` 全文命中 63 页但大多是「加入购物车」按钮文案 —— 真正叫「购物车」
的页只有 10 个。**所以页名/项目名权重必须远高于正文文本。**

字段权重：
  页面名 / tags / domain  ×5   ← 高权重，区分度好
  questions             ×3     ← 逆向 RAG 生成的问法，覆盖口语化
  widgetKeywords        ×2     ← 业务词
  正文文本              ×1     ← 辅助，容易被按钮文案污染

用法
----
    python search-test.py "登录页面"
    python search-test.py "带筛选器的商品列表" --top 8
    python search-test.py --bench         # 跑内置评测集
"""
import argparse
import json
import math
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TPL = os.path.join(ROOT, 'templates')

FIELDS = [
    ('name', 5.0),
    ('tags', 5.0),
    ('domain', 5.0),
    ('questions', 3.0),
    ('keywords', 2.0),
    ('texts', 1.0),
]

SPLIT = re.compile(r'[\s,，。；;：:、|/\\()（）\[\]【】""\'?!？!+_=\-]+')


def tokenize(s):
    """中文按 2-gram + 英文数字按词切。

    中文不分词的话「商品列表」无法匹配「列表」——但引入分词库不划算，
    2-gram 对模板检索这种短查询足够。
    """
    if not s:
        return []
    out = []
    for w in SPLIT.split(str(s)):
        w = w.strip()
        if not w:
            continue
        if re.match(r'^[\x00-\x7f]+$', w):
            out.append(w.lower())
        else:
            if len(w) == 1:
                out.append(w)
            else:
                for i in range(len(w) - 1):
                    out.append(w[i:i + 2])
                # 整词也留一份，便于精确匹配
                out.append(w)
    return out


class Index:
    def __init__(self):
        self.tpls = []
        # 字段名 -> {token: [(tpl_idx, tf), ...]}
        self.inv = {f: {} for f, _ in FIELDS}
        self.len = {f: [] for f, _ in FIELDS}
        self.df = {f: Counter() for f, _ in FIELDS}

    def add(self, tpl):
        i = len(self.tpls)
        self.tpls.append(tpl)
        for f, _ in FIELDS:
            toks = tokenize(tpl.get(f))
            self.len[f].append(len(toks))
            for t in toks:
                self.inv[f].setdefault(t, []).append((i, 1))
                self.df[f][t] += 1

    def search(self, query, top=5):
        q = tokenize(query)
        if not q:
            return []
        scores = [0.0] * len(self.tpls)
        n = len(self.tpls)
        for f, w in FIELDS:
            inv = self.inv[f]
            df = self.df[f]
            avg = (sum(self.len[f]) / n) if n else 1.0
            for t in set(q):
                if t not in inv:
                    continue
                idf = math.log(1 + n / (1 + df[t]))
                for i, _ in inv[t]:
                    tf = self.len[f][i] or 1
                    # BM25 饱和项
                    s = idf * (1 * 2.2) / (1 + 1.2 * (0.25 + 0.75 * tf / avg))
                    scores[i] += w * s
        ranked = sorted(range(n), key=lambda i: -scores[i])
        return [(self.tpls[i], scores[i]) for i in ranked[:top] if scores[i] > 0]


def load_index():
    cat_p = os.path.join(TPL, 'catalog.json')
    if not os.path.isfile(cat_p):
        print('缺少 catalog.json，先跑 build-library.py')
        return None
    cat = json.load(open(cat_p, encoding='utf-8'))
    idx = Index()
    for t in cat['templates']:
        #把 meta 里的 questions / keywords 合进来（catalog 里只有前5个 keywords）
        mp = os.path.join(TPL, 'meta', t['id'] + '.json')
        m = {}
        if os.path.isfile(mp):
            try:
                m = json.load(open(mp, encoding='utf-8'))
            except Exception:
                m = {}
        idx.add({
            'id': t['id'],
            'name': t.get('name', ''),
            'project': t.get('project', ''),
            'page': t.get('page', ''),
            'domain': t.get('domain', ''),
            'tags': ' '.join(t.get('tags', [])),
            'keywords': ' '.join(m.get('widgetKeywords', [])),
            'questions': ' '.join(m.get('questions', [])),
            'texts': ' '.join(t.get('keywords', [])),   # catalog 的 keywords 实为部分文本
            'itemCount': t.get('itemCount', 0),
        })
    return idx


# 内置评测集：查询 + 期望命中的页名关键词（人工标注的弱 ground-truth）
BENCH = [
    ('登录页面', ['登录', '登陆', 'login']),
    ('商品列表', ['商品', '产品列表', '列表']),
    ('购物车', ['购物车']),
    ('个人中心', ['个人中心', '我的']),
    ('订单详情', ['订单详情', '订单']),
    ('搜索结果页', ['搜索', '查询']),
    ('首页', ['首页', '主页', 'home']),
    ('消息中心', ['消息', '通知', '私信']),
    ('设置页面', ['设置', '配置']),
    ('详情页', ['详情', '明细']),
    ('注册账号', ['注册']),
    ('找回密码', ['找回', '密码']),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('query', nargs='*')
    ap.add_argument('--top', type=int, default=5)
    ap.add_argument('--bench', action='store_true')
    a = ap.parse_args()

    idx = load_index()
    if idx is None:
        return 1
    print('索引规模: %d 个模板 × %d 个字段' % (len(idx.tpls), len(FIELDS)))
    print()

    if a.bench:
        print('=' * 66)
        print('内置评测集（%d 条查询，弱 ground-truth = 页名关键词）' % len(BENCH))
        print('=' * 66)
        hit1 = hit3 = 0
        for q, want in BENCH:
            res = idx.search(q, top=10)
            got = [r[0] for r in res]
            rank = -1
            for i, t in enumerate(got):
                if any(w in t['page'] or w in t['name'] for w in want):
                    rank = i + 1
                    break
            if rank == 1:
                hit1 += 1
            if 1 <= rank <= 3:
                hit3 += 1
            mark = '✓' if rank == 1 else ('~' if 1 <= rank <= 3 else '✗')
            top1 = ('%s/%s' % (got[0]['project'][:12], got[0]['page'][:12])) if got else '(无)'
            print('  %s %-12s rank=%-3s top1=%s' % (mark, q, rank or '-', top1))
        print()
        print('  top-1 命中率 %.0f%%   top-3 命中率 %.0f%%'
              % (100.0 * hit1 / len(BENCH), 100.0 * hit3 / len(BENCH)))
        return 0

    if not a.query:
        ap.print_help()
        return 1

    q = ' '.join(a.query)
    print('查询: %s' % q)
    print('-' * 66)
    res = idx.search(q, top=a.top)
    if not res:
        print('无命中')
        return 0
    for i, (t, s) in enumerate(res, 1):
        print('%d. [%s] %s / %s  (score %.2f)'
              % (i, t['domain'], t['project'][:16], t['page'][:18], s))
        # tags 存的是「空格分隔的字符串」（为检索用的形态），
        # 直接按空格切回列表 —— 用 ','.join 会逐字符拆成单字
        print('   tags=%s  图元=%d'
              % ('/'.join(t['tags'].split()), t['itemCount']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
