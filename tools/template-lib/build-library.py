#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""build-library.py — M3 模板库入库

把按项目组织的转换产物拆成**按页**的模板条目，产出方案 §4.1 约定的三层：

    templates/
    ├── index.json              总目录（id → 名称/域/标签/粒度/缩略图路径）
    ├── meta/<tpl_id>.json      单模板元数据（方案 §7.1）
    └── diagram/<tpl_id>.json   mydraft Diagram 序列化 JSON（单页）

为什么按页拆而不是按项目
------------------------
方案 §7.1 的meta 结构（source.page / granularity / stats.itemCount）本身就是
页粒度的。RAG 检索要返回「可直接插入画布的模板」—— 用户要的是「一个登录页」，
不是「一个包含 47 页的 CRM 项目」。按项目入库无法定位到页。

粒度只做 page
-------------
方案列了 page/master/fragment 三种。本次只产出 page：
- master（母版片段）：实测母版实例已作为 referenceDiagramObject 展开进页面，
  它的内容已经包含在 page 里了，再单独入库是重复。
- fragment（规则切出的小组件）：需要组件识别规则，收益不确定，
  留到 M4 之后按评测结果决定。

字段设计（对齐方案 §7.1 + 实测可得的数据）
--------------------------------------
- id          tpl_<8位hash>，hash 取「项目名+页名」的 md5 前8 位，稳定可重现
- name        页名（清洗掉 Axure 的英文/乱码后缀）
- source      { project, page, rp } —— rp 从 index.json 的 file 字段取
- domain      业务域推断（见infer_domain）
- tags       页面类型标签（见 PAGE_TYPE_RULES）
- granularity 固定 "page"
- widgets     renderer 构成 Top8（Rectangle/Label/Image/...）
- widgetKeywords  该页出现频次最高的业务词（从 texts 提取，去掉按钮/导航类噪声）
- questions   逆向 RAG 用，按 §8.1 一期规则法生成（见 gen_questions）
- stats       { itemCount, width, height, textCount }
- thumb       thumbs/<tpl_id>.png（由 make-thumbs.py 生成，此处只填路径）
- version/createdAt

用法
----
    python build-library.py                # 全量
    python build-library.py --limit 20# 试跑
    python build-library.py --force        # 覆盖已有
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TPL = os.path.join(ROOT, 'templates')
META = os.path.join(TPL, 'meta')
DIAG = os.path.join(TPL, 'diagram')

# 页面类型识别规则：按页名关键词 → 标签
# ★ 规则基于 1511 个真实页名的词频统计制定（2026-10-03），
#   不是凭想象 —— 初版只有 22 条规则，跑完发现 70% 落到「其他」。
#   词频来源：主页25/注册24/首页23/订单详情18/home17/搜索17/排行榜17/
#            登陆16/个人中心16/找回密码14/购物车12/优惠券10/分类8…
# 匹配顺序：先具体后泛化（同理，泛化规则放最后）。
PAGE_TYPE_RULES = [
    # ── 认证类 ──
    (r'登录|登陆|login|signin', '登录页'),
    (r'注册|signup|register', '注册页'),
    (r'忘记|找回密码|重置密码|修改密码|forgot', '密码找回'),
    (r'实名|认证|verify', '认证页'),
    # ── 个人中心类 ──
    (r'个人中心|个人资料|用户中心|我的资料|profile', '个人中心'),
    (r'我的订单|订单列表|订单详情|order', '订单页'),
    (r'购物车|购物清单|cart', '购物车'),
    (r'我的收藏|收藏夹|收藏', '收藏页'),
    (r'我的钱包|钱包|wallet', '钱包页'),
    (r'消息|通知|私信|message|notice', '消息页'),
    (r'设置|配置|setting|config', '设置页'),
    (r'关注|粉丝|好友', '关注页'),
    # ── 内容浏览类 ──
    (r'详情|明细|介绍|detail', '详情页'),
    (r'列表|目录|一览|list', '列表页'),
    (r'排行|榜单|排名|rank', '排行榜'),
    (r'搜索|查询|search', '搜索页'),
    (r'分类|筛选|过滤|category|filter', '分类页'),
    (r'首页|主页|home|index', '首页'),
    # ── 交易类 ──
    (r'支付|结算|收银|pay|checkout', '支付页'),
    (r'订单|order', '订单页'),
    (r'优惠券|红包|活动|优惠|coupon', '活动页'),
    (r'购物|商城|商品|goods|product', '商品页'),
    (r'直播|在直播|视频|live|video', '直播页'),
    # ── 业务类 ──
    (r'地图|定位|导航|map', '地图页'),
    (r'聊天|会话|私聊|交谈|联系人|好友列表|chat', '聊天页'),
    (r'权限|角色|permission|role', '权限页'),
    (r'报表|统计|图表|chart|report', '报表页'),
    (r'弹窗|对话框|弹框|popup|modal|dialog', '弹窗'),
    (r'标签|选项卡|tab', '标签页'),
    (r'关于我们|^关于|简介|帮助中心|about|help', '关于页'),
    (r'攻略|指南|教程|教程|strategy|guide', '攻略页'),
    (r'记录|历史|record|history', '记录页'),
    (r'日历|日程|calendar|schedule', '日历页'),
    (r'评论|评价|回复|comment|reply', '评论页'),
    (r'相册|图片|photo|gallery', '相册页'),
    (r'会员|积分|vip|point', '会员页'),
    (r'登录首页|引导页|启动页|splash', '启动页'),
    # ── 长尾兜底（2026-10-03 全量跑完后补：659 个未分类的真实形态）──
    (r'^我的|我的$|我的收益|我的收藏|我的订单|我的钱包|我的消息|我的足迹|我的历史',
     '个人中心'),
    (r'管理$|管理页|后台管理|用户管理|地址管理|角色管理|菜单管理|分类管理',
     '管理页'),
    (r'分析|统计|报表|走势|占比', '分析页'),
    (r'发布|投稿|发贴|发布页', '发布页'),
    (r'反馈|意见|投诉|建议', '反馈页'),
    (r'联系我们|contact us', '关于页'),
    (r'地址|收货|配送|地址簿', '地址页'),
    (r'专题|活动页|话题', '专题页'),
    (r'附近|定位|地图', '地图页'),
    (r'交谈|会话|聊天|私聊', '聊天页'),
    (r'^页面_?\d*$|^copy of|^untitled|^页面$', '未命名页'),
]

# 业务域识别：从项目名推断
DOMAIN_RULES = [
    (r'电商|商城|购物|shop|mall|store', '电商'),
    (r'银行|金融|理财|钱包|bank|finance|pay', '金融'),
    (r'医疗|医院|健康|问诊|doctor', '医疗'),
    (r'教育|学习|课程|school|edu|course', '教育'),
    (r'后台|管理|admin|manage|erp|crm|oa', '后台系统'),
    (r'app|移动|手机|android|ios', '移动应用'),
    (r'旅游|旅行|酒店|hotel|travel|tour', '旅游'),
    (r'物流|快递|运输|express|logistics', '物流'),
    (r'社交|社区|论坛|social|community', '社交'),
    (r'视频|直播|影音|video|live', '视频'),
    (r'招聘|求职|job|recruit', '招聘'),
    (r'能源|电力|能耗|energy|power', '能源'),
    (r'停车|车位|park', '停车'),
    (r'宠物|超市|便利', '生活服务'),
]

# widgetKeywords 要过滤的噪声词：按钮/导航/通用标签
KEYWORD_STOP = {
    '确定', '取消', '提交', '保存', '删除', '编辑', '返回', '关闭', '搜索', '更多',
    '首页', '上一页', '下一页', '共', '条', '登录', '注册', '退出', '菜单',
    '查看', '详情', '操作', '状态', '名称', '类型', '序号', '备注', '添加',
    '修改', '查询', '重置', '展开', '收起', '暂无数据', '加载中', '请选择',
    '请输入', '标题', '内容', '描述', '时间', '创建', '更新', '图片', '链接',
}

# 纯数字/符号/单字母不算业务词
NOT_KEYWORD = re.compile(r'^[\d\s\W_]+$')
# HTML 实体（&gt; &nbsp; &#39; …）—— 从页面 HTML 抽文本时会带进来
HTML_ENT = re.compile(r'&[#a-zA-Z0-9]+;')
# 明显是整句而非词汇的：含「的了是在和与或」等虚词连接，或长度 > 8且无标点
SENTENCE_LIKE = re.compile(r'(包括|如下|以下|请问|如下所示|该|我们|可以|需要|进行|通过|以及|或者)')


def pad(s, n):
    s = str(s)
    return s + ' '.repeat(max(0, n - len(s)))


def make_id(project, page):
    """稳定 id：项目名+页名的 md5 前 8 位。"""
    h = hashlib.md5((project + '::' + page).encode('utf-8')).hexdigest()
    return 'tpl_' + h[:8]


def infer_domain(project, page):
    """从项目名推断业务域。页名作为次级依据。"""
    for pat, dom in DOMAIN_RULES:
        if re.search(pat, project, re.I):
            return dom
    for pat, dom in DOMAIN_RULES:
        if re.search(pat, page, re.I):
            return dom
    return '通用'


def infer_tags(page, renderers):
    """页名 → 类型标签。命中即止（取最具体的一个）。

    匹配不上时返回 ['未分类'] 而不是 ['其他'] —— 「其他」在统计里会和无意义的
    页面混在一起，「未分类」明确表示「规则没覆盖到」，方便后续补规则时定位。
    """
    for pat, tag in PAGE_TYPE_RULES:
        if re.search(pat, page, re.I):
            tags = [tag]
            # 命中泛化标签时，按 renderer 补一个结构标签
            if tag in ('列表页', '详情页', '首页'):
                if renderers.get('ComboBox', 0) or renderers.get('checkbox', 0):
                    tags.append('含筛选器')
                if renderers.get('Image', 0) >= 3:
                    tags.append('图文混排')
            return tags
    return ['未分类']


def extract_keywords(texts, limit=10):
    """从页面文本里提业务词。

    三层过滤（实测需要，缺一层就会把检索词污染）：
    1. 剥掉 HTML 实体 —— 页面 HTML 抽出来的文本会带 &gt; &nbsp; 等
    2. 丢掉「整句」—— 含「包括/如下/我们…」这类虚词的其实是句子不是词汇，
       直接当关键词会让检索命中一堆无意义的長句
    3. 丢掉按钮/导航类通用词 —— 「确定/取消/提交」这类词每个页面都有，
       完全没有区分度
    """
    freq = {}
    for t in texts:
        s = HTML_ENT.sub(' ', str(t))
        for w in re.split(r'[\s,，。；;：:、|/\\()（）\[\]【】""\'?!？!+_-]+', s):
            w = w.strip()
            if len(w) < 2 or len(w) > 12:
                continue
            if NOT_KEYWORD.match(w):
                continue
            if w in KEYWORD_STOP:
                continue
            if SENTENCE_LIKE.search(w):
                continue
            freq[w] = freq.get(w, 0) + 1
    # 频次优先，同频次取更长的（信息量更大）
    items = sorted(freq.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [w for w, _ in items[:limit]]


def gen_questions(name, domain, tags, keywords):
    """逆向 RAG：按方案 §8.1 一期规则法生成「可能被问到的问题」。

    零LLM 成本，纯句式拼装。目标是覆盖不同说法（口语化/正式/带约束）。

    ★ 「未分类」不能进句式 ★
      未分类是「规则没覆盖到」的标记，不是页面类型。
      早期版本直接拼进模板导致生成「画一个未分类」这种废问句，
      检索时毫无意义。这里遇到未分类就退回到「用页名 + 关键词」组句。
    """
    qs = []
    primary = tags[0] if tags else ''
    typed = primary and primary != '未分类'
    kw = '、'.join(keywords[:3]) if keywords else ''

    if typed:
        # 句式 1：最直接 —— 「画一个{domain}的{primary}」
        if domain and domain != '通用':
            qs.append('画一个%s的%s' % (domain, primary))
        else:
            qs.append('画一个%s' % primary)
        # 句式 4：口语化
        qs.append('%s界面大概是什么样子' % primary)
        # 句式 5：带业务域的正式表述
        if domain and domain != '通用':
            qs.append('%s%s界面设计' % (domain, primary))

    # 句式 2：带页面名 —— 「做一个 XXX 页面」（任何情况下都有效）
    if name:
        qs.append('做一个 %s 页面' % name)

    # 句式 3：带控件/内容关键词
    if kw:
        if typed:
            qs.append('有%s的%s' % (kw, primary))
        else:
            qs.append('%s，%s' % (name or '页面', kw))

    seen = set()
    out = []
    for q in qs:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:5]


def clean_name(page):
    """清洗页名：Axure 里常有英文/乱码后缀。"""
    n = page.strip()
    # 去掉纯英文的框架页名
    if re.match(r'^(page_\d+|home|index|untitled)$', n, re.I):
        return n
    return n


def build_one(project, page_rec, project_index):
    """构造单个模板的 meta。返回 (tpl_id, meta) 或 None。"""
    title = page_rec['title']
    if not title:
        return None
    tpl_id = make_id(project, title)
    renderers = page_rec.get('renderers') or {}
    texts = page_rec.get('texts') or []
    box = page_rec.get('box') or [0, 0, 0, 0]
    w = box[2] - box[0]
    h = box[3] - box[1]

    domain = infer_domain(project, title)
    tags = infer_tags(title, renderers)
    keywords = extract_keywords(texts)
    name = clean_name(title)

    # 源 .rp 文件名（从项目索引里查）
    src = project_index.get(project, {})

    meta = {
        'id': tpl_id,
        'name': name,
        'source': {
            'project': project,
            'page': title,
            'rp': src.get('rp', ''),
        },
        'domain': domain,
        'tags': tags,
        'granularity': 'page',
        'widgets': [k for k, _ in sorted(renderers.items(), key=lambda kv: -kv[1])[:8]],
        'widgetKeywords': keywords,
        'questions': gen_questions(name, domain, tags, keywords),
        'diagram': {'__ref': '../diagram/%s.json' % tpl_id},
        'stats': {
            'itemCount': page_rec.get('shapes', 0),
            'width': max(w, 0),
            'height': max(h, 0),
            'textCount': len(texts),
        },
        'thumb': 'thumbs/%s.png' % tpl_id,
        'version': 1,
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
    return tpl_id, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tpl', default=TPL, help='模板库根目录')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--no-diagram', action='store_true', help='只生成 meta，不拆 diagram')
    a = ap.parse_args()

    meta_dir = os.path.join(a.tpl, 'meta')
    diag_dir = os.path.join(a.tpl, 'diagram')
    os.makedirs(meta_dir, exist_ok=True)
    if not a.no_diagram:
        os.makedirs(diag_dir, exist_ok=True)

    idx_path = os.path.join(a.tpl, 'page-index.json')
    if not os.path.isfile(idx_path):
        print('缺少 page-index.json，请先跑 page-stats.py')
        return 1
    pi = json.load(open(idx_path, encoding='utf-8'))
    pages = [p for p in pi['pages'] if p['kind'] == 'usable']
    if a.limit:
        pages = pages[:a.limit]

    # 项目索引：项目名 → {rp 路径}
    project_index = {}
    ix_path = os.path.join(a.tpl, 'index.json')
    if os.path.isfile(ix_path):
        for x in json.load(open(ix_path, encoding='utf-8')).get('projects', []):
            if x.get('status') in ('OK', 'SKIP'):
                project_index[x['name']] = {'rp': x.get('file', '')}

    print('待入库页面: %d（一级可用）' % len(pages))
    print('输出: %s' % a.tpl)
    print('-' * 68)

    t0 = time.time()
    run_start = t0 - 1   # 允许 1 秒时钟误差
    entries = []# index.json 用
    n_meta = n_diag = 0
    stat_domain = {}
    stat_tag = {}
    # diagram 源缓存：项目名 → {pageTitle: diagram}
    diag_cache = {}

    for i, p in enumerate(pages, 1):
        r = build_one(p['project'], p, project_index)
        if not r:
            continue
        tpl_id, meta = r
        stat_domain[meta['domain']] = stat_domain.get(meta['domain'], 0) + 1
        for t in meta['tags']:
            stat_tag[t] = stat_tag.get(t, 0) + 1

        # 写 meta
        # ★ 判据用「比本次启动早」而不是「文件存在」——
        #   规则改动后重跑时已存在的旧 meta 会被跳过，导致
        #   index.json 反映新规则而 meta 仍是旧内容（实测踩过：meta 0）。
        mp = os.path.join(meta_dir, tpl_id + '.json')
        need = (a.force or not os.path.isfile(mp)
                or os.path.getmtime(mp) < run_start
                or os.path.getsize(mp) < 32)
        if need:
            with open(mp, 'w', encoding='utf-8') as f:
                json.dump(meta, f, ensure_ascii=False, indent=1)
            n_meta += 1

        # 拆 diagram：把单页从项目级diagram.json 里取出
        if not a.no_diagram:
            proj = p['project']
            if proj not in diag_cache:
                dp = os.path.join(a.tpl, 'data', proj, 'diagram.json')
                if os.path.isfile(dp):
                    try:
                        md = json.load(open(dp, encoding='utf-8'))
                        m = {d.get('title'): d for d in md['editor']['diagrams']}
                        diag_cache[proj] = (md, m)
                    except Exception:
                        diag_cache[proj] = None
                else:
                    diag_cache[proj] = None
            cached = diag_cache.get(proj)
            if cached:
                _, page_map = cached
                d = page_map.get(p['title'])
                if d:
                    one = {
                        'version': '1',
                        'name': meta['name'],
                        'savedAt': meta['createdAt'],
                        'editor': {
                            'id': d['id'],
                            'name': meta['name'],
                            'size': {'x': max(meta['stats']['width'], 1),
                                     'y': max(meta['stats']['height'], 1)},
                            'color': None,
                            'diagrams': [d],
                            'diagramIds': [d['id']],
                            'selectedDiagramId': d['id'],
                        },
                    }
                    out = os.path.join(diag_dir, tpl_id + '.json')
                    with open(out, 'w', encoding='utf-8') as f:
                        json.dump(one, f, ensure_ascii=False)
                    n_diag += 1

        entries.append({
            'id': tpl_id,
            'name': meta['name'],
            'project': meta['source']['project'],
            'page': meta['source']['page'],
            'domain': meta['domain'],
            'tags': meta['tags'],
            'granularity': meta['granularity'],
            'itemCount': meta['stats']['itemCount'],
            'textCount': meta['stats']['textCount'],
            'width': meta['stats']['width'],
            'height': meta['stats']['height'],
            'thumb': meta['thumb'],
            'keywords': meta['widgetKeywords'][:5],
        })

        if i % 100 == 0 or i == len(pages):
            print('  [%4d/%d] meta %d  diagram %d' % (i, len(pages), n_meta, n_diag))

    # index.json
    # ★★ 写到 templates/catalog.json 而不是 templates/index.json ★★
    #   templates/index.json 是 batch-convert.py 写的**项目级**索引
    #   （含每个项目对应的 .rp 源路径、图元数、状态），M3 之前只有它。
    #   初版误写成 index.json，直接覆盖掉了它 —— rp 源路径全丢。
    #   两层索引语义不同、生命周期不同，必须分开：
    #     index.json   项目级（转换产物视角，M2 写）
    #     catalog.json 模板级（模板库视角，M3 写）
    index = {
        'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
        'granularity': 'page',
        'total': len(entries),
        'domains': dict(sorted(stat_domain.items(), key=lambda kv: -kv[1])),
        'tags': dict(sorted(stat_tag.items(), key=lambda kv: -kv[1])),
        'templates': entries,
    }
    cat_path = os.path.join(a.tpl, 'catalog.json')
    with open(cat_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    idx_sz = os.path.getsize(cat_path) / 1048576.0

    print('-' * 68)
    print('完成: %d 个模板  meta %d  diagram %d  (%.1f 秒)'
          % (len(entries), n_meta, n_diag, time.time() - t0))
    print('index.json %.1f MB' % idx_sz)
    print()
    print('业务域分布:')
    for k, v in sorted(stat_domain.items(), key=lambda kv: -kv[1])[:12]:
        print('  %-10s %d' % (k, v))
    print()
    print('页面类型 TOP12:')
    for k, v in sorted(stat_tag.items(), key=lambda kv: -kv[1])[:12]:
        print('  %-12s %d' % (k, v))
    return 0


if __name__ == '__main__':
    sys.exit(main())
