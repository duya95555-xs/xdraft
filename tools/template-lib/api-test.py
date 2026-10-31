#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""api-test.py — 模板库 API 端到端测试（不依赖 curl，避免中文 body 转义问题）"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:8901'


def get(path, params=None):
    url = BASE + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.status, r.read(), r.headers.get('Content-Type', '')


def post(path, body):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read(), r.headers.get('Content-Type', '')


def jget(path, params=None):
    st, body, ct = get(path, params)
    return st, json.loads(body.decode('utf-8'))


def jpost(path, obj):
    st, body, ct = post(path, obj)
    return st, json.loads(body.decode('utf-8'))


def main():
    ok = 0
    bad = 0

    def check(label, cond, extra=''):
        nonlocal ok, bad
        if cond:
            ok += 1
            print('  [OK]   %-34s %s' % (label, extra))
        else:
            bad += 1
            print('  [FAIL] %-34s %s' % (label, extra))

    print('=== 1. GET /api/templates（列表）===')
    st, d = jget('/api/templates', {'limit': 5})
    check('状态码 200', st == 200, 'st=%d' % st)
    check('返回模板', d['total'] > 0, 'total=%d indexed=%d' % (d['total'], d['indexed']))
    check('带业务域清单', len(d.get('domains', [])) > 0,
          ','.join(d.get('domains', [])[:5]))
    check('带标签清单', len(d.get('tags', [])) > 0,
          ','.join(d.get('tags', [])[:6]))
    t0 = d['templates'][0]
    check('卡片字段完整',
          all(k in t0 for k in ('id', 'name', 'domain', 'tags', 'itemCount', 'thumb', 'reason')),
          'id=%s' % t0['id'])

    print()
    print('=== 2. 筛选 ===')
    st, d2 = jget('/api/templates', {'domain': '电商', 'limit': 5})
    check('domain 筛选生效',
          d2['total'] > 0 and all(x['domain'] == '电商' for x in d2['templates']),
          'total=%d' % d2['total'])
    st, d3 = jget('/api/templates', {'tag': '登录页', 'limit': 5})
    check('tag 筛选生效',
          d3['total'] > 0 and all('登录页' in x['tags'] for x in d3['templates']),
          'total=%d' % d3['total'])

    print()
    print('=== 3. POST /api/templates/search（检索）===')
    queries = ['登录页面', '商品详情页', '购物车', '数据报表', '个人中心', '设置']
    for q in queries:
        st, r = jpost('/api/templates/search', {'query': q, 'limit': 3})
        hit = r['total'] > 0
        names = ' | '.join('%s/%s' % (x['project'][:8], x['page'][:10]) for x in r['templates'])
        check('检索「%s」' % q, hit, names[:64])

    print()
    print('=== 4. 单模板详情 ===')
    st, r = jpost('/api/templates/search', {'query': '登录页面', 'limit': 1})
    tid = r['templates'][0]['id']
    st, meta = jget('/api/templates/%s' % tid)
    check('meta 可取', st == 200 and meta['id'] == tid,
          'domain=%s tags=%s' % (meta.get('domain'), meta.get('tags')))
    check('meta 含 questions', len(meta.get('questions', [])) > 0,
          str(meta.get('questions', [])[:2]))
    check('meta 含 source.rp', bool(meta.get('source', {}).get('rp')),
          str(meta.get('source', {}).get('rp', ''))[-40:])

    st, body, ct = get('/api/templates/%s/diagram' % tid)
    dg = json.loads(body.decode('utf-8'))
    items = len(dg['editor']['diagrams'][0]['items'])
    check('diagram 可取且非空', st == 200 and items > 0, '%d 图元' % items)

    st, body, ct = get('/api/templates/%s/thumb' % tid)
    check('缩略图可取', st == 200 and body[:4] == b'\x89PNG',
          '%d bytes  %s' % (len(body), ct))

    print()
    print('=== 5. 错误处理 ===')
    try:
        jget('/api/templates/tpl_ffffffff')
        check('不存在的 id 返回 404', False, '居然成功了')
    except urllib.error.HTTPError as e:
        check('不存在的 id 返回 404', e.code == 404, 'code=%d' % e.code)
    try:
        jget('/api/templates/bad-id')
        check('非法 id 被拒', False, '居然成功了')
    except urllib.error.HTTPError as e:
        check('非法 id 被拒', e.code == 400, 'code=%d' % e.code)
    try:
        jpost('/api/templates/search', {'limit': 3})
        check('空 query 返回 400', False, '居然成功了')
    except urllib.error.HTTPError as e:
        check('空 query 返回 400', e.code == 400, 'code=%d' % e.code)

    print()
    print('=== 6. 原接口未受影响 ===')
    st, d = jget('/api/config')
    check('GET /api/config', st == 200 and 'saveDir' in d, str(d.get('saveDir'))[:44])
    # /api/diagrams 返回的是数组（不是 {diagrams:[...]}）——按实际形态断言
    st, d = jget('/api/diagrams')
    check('GET /api/diagrams', st == 200 and isinstance(d, list),
          '返回 %s，%d 条' % (type(d).__name__, len(d) if isinstance(d, list) else -1))

    print()
    print('=' * 60)
    print('通过 %d  失败 %d' % (ok, bad))
    print('=' * 60)
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
