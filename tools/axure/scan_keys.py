#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""scan_keys.py — 从 AxureRP8.exe 扫描「生成 HTML 文件」菜单项的快捷键定义。

为什么需要：RP8 汉化版的菜单助记键可能与 RP9 不同（RP9 是「发布(U)」→ Ctrl+Shift+O），
实测 Ctrl+Shift+O 在 RP8 下打不开对话框。本脚本从 exe 的字符串表里找菜单项文本与
其绑定的快捷键字符，用于确定 RP8 真正的快捷键。

用法: python scan_keys.py <AxureRP8.exe> [--grep 发布]
"""
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r'D:\Program Files (x86)\Axure\Axure RP 8\AxureRP8.exe'
pat = sys.argv[3] if len(sys.argv) > 3 else '发布'

data = open(path, 'rb').read()
print('文件: %s  大小: %.1f MB' % (path, len(data) / 1048576.0))

# Axure 是 .NET/F# 单体，菜单项与快捷键以 UTF-16LE 存放在 #US 堆里。
# 策略：抽出所有可打印的 UTF-16LE 串，再找含关键词的条目与其邻近的按键提示。
strings = []
cur = []
cur_start = 0
i = 0
n = len(data)
while i + 1 < n:
    lo, hi = data[i], data[i + 1]
    # UTF-16LE 可打印 ASCII：低字节=ASCII，高字节=0x00
    if hi == 0 and 0x20 <= lo < 0x7f:
        if not cur:
            cur_start = i
        cur.append(chr(lo))
        i += 2
        continue
    if len(cur) >= 3:
        strings.append((cur_start, ''.join(cur)))
    cur = []
    i += 1
if len(cur) >= 3:
    strings.append((cur_start, ''.join(cur)))

print('UTF-16LE 字符串总数: %d' % len(strings))

kw = ['发布', 'Publish', '生成', 'Generate', 'HTML', 'html']
hits = [(off, s) for off, s in strings if any(k in s for k in kw)]
print('含关键词的条目: %d\n' % len(hits))
for off, s in hits[:40]:
    print('  @0x%06x  %s' % (off, s[:90]))

# 找形如 "Ctrl+Shift+O" / "Ctrl+Alt+P" 的快捷键串
kbds = [(off, s) for off, s in strings
        if re.match(r'^(Ctrl|Alt|Shift)(\+(Ctrl|Alt|Shift))*\+[A-Z0-9]$', s.strip())]
print('\n快捷键定义串: %d 条' % len(kbds))
for off, s in kbds[:40]:
    print('  @0x%06x  %s' % (off, s))
