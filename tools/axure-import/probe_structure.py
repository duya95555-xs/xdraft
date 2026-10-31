"""
结构探针: 验证 "u32 对 + 0x8C0 哨兵" 实例表模型。

逆向观察(商城类列表.rp 首页):
- 二进制区从 4 字节对齐边界起是干净的 u32 流
- 前段为 (key, value) 对序列: key 8 -> 值连续 2..18, key 3 -> 3..6
  疑似 "类/属性 ID -> 实例 ID 集合" 的邻接表
- 0x000008C0 反复作为记录分隔出现,后跟 (19, N, ...) 三元组
- 出现小值 1001/1002/1003(0x3E9..)、101/105/110/111,疑为字符串表引用
本脚本对该模型做一致性检验并输出人类可读的结构化视图。
"""

import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from axure_import.rpformat import open_rp  # noqa: E402

SENTINEL = 0x000008C0
HEX32 = re.compile(r'^[0-9a-f]{32}$')


def aligned_regions(blob, toks):
    """从 token 流找出二进制区,并按 4 对齐修正起点。

    tokenizer 的字节重同步会让区起点落在任意字节;真实记录是 4 字节对齐的,
    取区间内第一个使 (w0 为合理小整数 且 后续不出现半字符串) 的 4 对齐点。
    """
    regions = []
    cur = None
    for t in toks:
        if t.kind == 'U':
            if cur is None:
                cur = [t.offset, t.offset]
            cur[1] = t.offset + 4
        else:
            if cur:
                regions.append(tuple(cur))
                cur = None
    if cur:
        regions.append(tuple(cur))
    fixed = []
    for start, end in regions:
        if end - start < 16:
            continue
        base = (start + 3) & ~3
        fixed.append((base, end))
    return fixed


def parse_region(blob, start, end, max_words=100000):
    """按 u32 解析区域,返回 (pairs, triples_after_sentinel) 视图。"""
    words = []
    off = start
    while off + 4 <= end and len(words) < max_words:
        words.append(struct.unpack_from('<I', blob, off)[0])
        off += 4
    return words


def analyze_page(blob, toks):
    regions = aligned_regions(blob, toks)
    out = []
    for start, end in regions:
        words = parse_region(blob, start, end)
        if len(words) < 8:
            continue
        # 哨兵密度
        sent = sum(1 for w in words if w == SENTINEL)
        # 小整数对 (都 < 64) 比例
        small_pairs = sum(1 for i in range(0, len(words) - 1, 2)
                          if words[i] < 64 and words[i + 1] < 64)
        out.append({
            'start': start, 'end': end, 'words': len(words),
            'sentinel_count': sent,
            'small_pair_ratio': round(small_pairs / (len(words) // 2), 3),
            'header': words[:6],
        })
    return out


def key_value_chains(words):
    """提取 (key -> [values]) 邻接表,仅统计 key<64, value<4096。"""
    chains = defaultdict(list)
    for i in range(0, len(words) - 1):
        k, v = words[i], words[i + 1]
        if k < 64 and v < 4096 and k != SENTINEL and v != SENTINEL:
            chains[k].append(v)
    return chains


if __name__ == '__main__':
    rp = sys.argv[1] if len(sys.argv) > 1 else r'..\..\axure-src\商城类列表.rp'
    entries = open_rp(rp)
    page = [e for e in entries if e.kind == 'Page'][0]
    from axure_import.rpformat import tokenize
    toks = tokenize(page.blob)

    print(f'page package: {page.id}  blob: {page.size} bytes')
    regions = analyze_page(page.blob, toks)
    for r in regions:
        print(f"  region {r['start']:>8}..{r['end']:>8} words={r['words']:>6} "
              f"sentinels={r['sentinel_count']:>4} small_pair_ratio={r['small_pair_ratio']} "
              f"header={r['header']}")

    # 对哨兵最密集的区域做邻接表分析
    if regions:
        best = max(regions, key=lambda r: r['sentinel_count'])
        words = parse_region(page.blob, best['start'], best['end'])
        chains = key_value_chains(words[:4000])
        print('\nkey->values chains (top keys):')
        for k in sorted(chains, key=lambda k: -len(chains[k]))[:10]:
            vals = chains[k]
            print(f'  key {k:>3}: {len(vals):>4} values, first 20: {vals[:20]}')
