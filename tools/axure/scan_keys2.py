#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""scan_keys2.py — 找 Axure 菜单项的快捷键定义（放宽编码假设）。

背景：Platform.dll 里菜单文本是英文 `&Generate HTML Files...`（助记键 G），
但「Ctrl+Shift+O」形式的快捷键串没被 UTF-16LE 提取命中。可能是：
  a) 快捷键存成单字母 + 修饰键位掩码（.NET CommandBinding 常见做法）；
  b) 存在另一种编码（UTF-8 / GBK / UTF-16BE）。

本脚本把三种编码都试一遍，并额外打印菜单文本附近 ±600 字节的原始 hexdump，
便于人工判断快捷键是位掩码还是字符串。
"""
import re
import sys

path = sys.argv[1]
center = int(sys.argv[2], 16) if len(sys.argv) > 2 else None

data = open(path, 'rb').read()
print('文件: %s  %.1f MB' % (path, len(data) / 1048576.0))


def extract(data, enc, minlen=3):
    """按给定编码抽可打印串。用正则近似，避免逐字节状态机。"""
    out = []
    if enc == 'utf-16le':
        rx = re.compile(rb'(?:[\x20-\x7e]\x00){%d,}' % minlen)
        for m in rx.finditer(data):
            out.append((m.start(), m.group().decode('utf-16le', 'ignore')))
    elif enc == 'utf-8':
        rx = re.compile(rb'[\x20-\x7e\xc0-\xfe\x80-\xbf]{%d,}' % minlen)
        for m in rx.finditer(data):
            try:
                s = m.group().decode('utf-8')
            except UnicodeDecodeError:
                continue
            if s.isprintable():
                out.append((m.start(), s))
    elif enc == 'gbk':
        rx = re.compile(rb'[\x20-\x7e\x81-\xfe]{%d,}' % minlen)
        for m in rx.finditer(data):
            try:
                s = m.group().decode('gbk')
            except UnicodeDecodeError:
                continue
            if s.isprintable():
                out.append((m.start(), s))
    return out


print('\n=== 各编码下的「快捷键样式的串」命中数 ===')
kbd_rx = re.compile(r'^(Ctrl|Alt|Shift|Control)(\+(Ctrl|Alt|Shift|Control))*\+[A-Z0-9]$', re.I)
allhits = {}
for enc in ('utf-16le', 'utf-8', 'gbk'):
    ss = extract(data, enc)
    hits = [(o, s) for o, s in ss if kbd_rx.match(s.strip())]
    allhits[enc] = (len(ss), hits)
    print('  %-9s 串总数=%-7d 快捷键样式命中=%d' % (enc, len(ss), len(hits)))
    for o, s in hits[:15]:
        print('      @0x%06x  %r' % (o, s))

print('\n=== 找 Ctrl+Shift / Ctrl+Alt 之类片段（可能拆成两段存放）===')
for enc in ('utf-16le', 'utf-8', 'gbk'):
    ss = extract(data, enc)
    frag = [(o, s) for o, s in ss if re.search(r'(Ctrl\+|Control\+|Shift\+|Alt\+)$', s) or s.strip() in ('Ctrl', 'Shift', 'Alt')]
    if frag:
        print('  [%s] %d 条:' % (enc, len(frag)))
        for o, s in frag[:12]:
            print('      @0x%06x  %r' % (o, s))

if center:
    print('\n=== 菜单文本 @0x%06x 附近 ±700 字节 hexdump ===' % center)
    lo = max(0, center - 700)
    hi = min(len(data), center + 700)
    blob = data[lo:hi]
    for row in range(0, len(blob), 32):
        chunk = blob[row:row + 32]
        hexs = ' '.join('%02x' % b for b in chunk)
        asci = ''.join(chr(b) if 0x20 <= b < 0x7f else '.' for b in chunk)
        print('  %08x  %-96s  %s' % (lo + row, hexs, asci))
