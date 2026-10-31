"""
页面级语义提取: 从 rppkg token 流中提取控件树要素。

提取策略(M1 阶段,按置信度分级):
- HIGH: 控件类型清单  — 'Axure:DiagramObject:<Type>' schema 类名(每个出现即该类有实例/定义)
- HIGH: 实例文本      — schema 区之外的 CJK/标签字符串(含默认文本与实例文本)
- MED : 页面名        — item-infos 头中的 'name' 值 / page 类内 'Name'
- LOW : 几何四元组    — 全流扫描 x,y,w,h 坐标簇(启发式,供 M2 精确化)
"""

import re
from collections import Counter

from .rpformat import tokenize

# Axure 类名 -> 控件类型(出现在 'Axure:DiagramObject:Xxx')
RE_DOBJ = re.compile(r'^Axure:DiagramObject:(\w+)$')

# 值得作为"实例文本"记录的字符串特征: 含 CJK 或常见 ASCII 标签
RE_CJK = re.compile(r'[\u4e00-\u9fff]')

# schema 键(用于区分 schema 区与实例区,粗略: 这些键后面的字符串多为属性名)
SCHEMA_KEYS = {
    'type', 'label', 'diagram-object-id', 'parent-diagram-id', 'parent-panel-name',
    'tooltip', 'IsContained', 'IsLocked', 'SelectedStyleGroup', 'Annotation',
    'MyStyle', 'SubmitButton', 'Disabled', 'Selected', 'VisibleFromSettings',
    'name-block', '*type', 'text-block', 'text', 'property-dictionary',
}


def extract_page(entry):
    """提取单页信息,返回 dict。"""
    toks = tokenize(entry.blob)
    result = {
        'package_id': entry.id,
        'kind': entry.kind,
        'blob_size': entry.size,
        'widget_types': {},      # type -> count (HIGH)
        'texts': [],             # [(offset, text), ...] (HIGH, 去重保留顺序)
        'page_name': None,       # (MED)
        'geometry_candidates': [],  # [(offset, x, y, w, h), ...] (LOW)
        'token_stats': {'strings': 0, 'u32': 0},
    }

    str_count = 0
    for t in toks:
        if t.kind == 'S':
            str_count += 1
            m = RE_DOBJ.match(t.value)
            if m:
                wt = m.group(1)
                result['widget_types'][wt] = result['widget_types'].get(wt, 0) + 1
        else:
            result['token_stats']['u32'] += 1
    result['token_stats']['strings'] = str_count

    # item-infos 头: 'name' 之后的字符串即页面名;
    # 注意 Axure 8 存的是包 ID(hex32),真名在 DesignDocument 的 SiteTreeMap 里(M2 精确绑定)
    hex32 = re.compile(r'^[0-9a-f]{32}$')
    for i, t in enumerate(toks[:200]):
        if t.kind == 'S' and t.value == 'name' and i + 1 < len(toks) \
                and toks[i + 1].kind == 'S':
            candidate = toks[i + 1].value
            if hex32.match(candidate):
                continue
            if candidate not in ('package',) and len(candidate) < 100:
                result['page_name'] = candidate
                break

    # 实例文本: 含 CJK 直接收;纯 ASCII 要求含空格且非 schema 风格(滤掉属性名噪音)
    seen = set()
    for t in toks:
        if t.kind != 'S':
            continue
        v = t.value
        if v in seen or len(v) > 200:
            continue
        if RE_CJK.search(v):
            seen.add(v)
            result['texts'].append((t.offset, v))
        elif ' ' in v and v[0].isupper() and len(v) >= 2 \
                and not v.startswith('Axure:') and not v.startswith('MyStyle'):
            seen.add(v)
            result['texts'].append((t.offset, v))

    # 几何候选: u32 对齐扫描 x,y,w,h 四元组(LOW 置信度)
    result['geometry_candidates'] = _scan_geometry(entry.blob)

    return result


def _scan_geometry(blob):
    """扫描可能的坐标四元组,返回簇摘要(最多 50 条)。"""
    import struct
    words = struct.unpack_from('<%dI' % (len(blob) // 4), blob, 0)
    quads = []
    n = len(words)
    for i in range(n - 4):
        x, y, w, h = words[i:i + 4]
        if (0 <= x <= 1500 and 0 <= y <= 5000 and 5 <= w <= 1500
                and 5 <= h <= 1500 and x + w <= 2000 and y + h <= 6000):
            # 排除 header 小数字区(前 512 字节)
            if i * 4 > 512:
                quads.append((i * 4, x, y, w, h))
    return quads[:50]


def summarize_pages(entries):
    """汇总多个页面的提取结果。"""
    pages = []
    type_counter = Counter()
    for e in entries:
        if e.kind not in ('Page', 'Master'):
            continue
        info = extract_page(e)
        pages.append(info)
        for wt, c in info['widget_types'].items():
            type_counter[wt] += c
    return pages, type_counter
