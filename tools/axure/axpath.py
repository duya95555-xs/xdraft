#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axpath.py — 从 Axure 配置文件里读出「上次发布路径」。

为什么需要：Axure 会记住上次发布路径（见 axrun.py 注释里的「使用默认」逻辑）。
批量跑批时若某次Use Default 没点上，产物就会落到一个我们不知道的地方，
而 scan_output() 只扫 PUBROOT，就会误判成NO_OUTPUT。
所以需要能随时查「Axure 当前记住的路径是什么」，用于诊断。

配置在 %LOCALAPPDATA%\\Axure\\settings.8.0.bin（RP8）或 settings.9.0.bin（RP9）。
它是二进制，但路径是明文，用 UTF-16LE 提取即可。

用法: python axpath.py [8|9]
"""
import os
import re
import sys

ver = sys.argv[1] if len(sys.argv) > 1 else '8'
base = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Axure')
paths = [
    os.path.join(base, 'settings.%s.0.bin' % ver),
    os.path.join(base, 'settings.%s.0' % ver),
]

for p in paths:
    if not os.path.isfile(p):
        print('(不存在) %s' % p)
        continue
    data = open(p, 'rb').read()
    print('%s  (%.1f KB)' % (p, len(data) / 1024.0))

    # 提取 UTF-16LE 串
    s = re.findall(rb'(?:[\x20-\x7e]\x00){4,}', data)
    strs = [x.decode('utf-16le', 'ignore') for x in s]
    # 提取 ASCII 串（路径可能以ANSI 存）
    a = re.findall(rb'[\x20-\x7e]{6,}', data)
    strs += [x.decode('ascii', 'ignore') for x in a]

    hits = [x for x in strs if re.search(r'(HTML|Axure|Publish|Output|\\\\|://)', x, re.I)]
    if hits:
        print('  路径/发布相关字符串:')
        for h in dict.fromkeys(hits):
            print('    %s' % h[:160])
    else:
        print('  未找到路径相关字符串')
    print()
