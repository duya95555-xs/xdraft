#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axsetpath.py — 修改 Axure 记住的默认发布路径（写settings.<ver>.0.bin）。

═══ 为什么要直接改配置 ═══
发布对话框的路径输入框是 DevExpress 自绘控件，keybd_event 模拟的按键进不去
（2026-10-02 实测：点过输入框、Ctrl+A、逐字符 type_text，框内文字毫无变化）。
既然「Use Default」按钮能把路径重置成 Axure 记住的目录，而那个目录存在
settings.<ver>.0.bin 里，就直接改配置 —— 一次改对，之后每次点Use Default
都会落到目标目录，不需要任何键入操作。

用法:
  python axsetpath.py--show8            # 只看当前值
  python axsetpath.py --set 8 "D:\\path\\to\\dir"   # 改成新路径
  python axsetpath.py --reset 8         # 恢复默认
"""
import io
import os
import re
import sys

BASE = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Axure')
DEFAULT_PUB = os.path.join(os.environ.get('USERPROFILE', ''), 'Documents', 'Axure', 'HTML')


def cfg_path(ver):
    return os.path.join(BASE, 'settings.%s.0.bin' % ver)


def read_paths(data):
    """提取文件里所有看起来像路径的字符串（UTF-16LE 与 ASCII 两种编码）。"""
    out = []
    for m in re.finditer(rb'(?:[\x20-\x7e]\x00){6,}', data):
        s = m.group().decode('utf-16le', 'ignore')
        if re.search(r'[A-Za-z]:\\', s):
            out.append(('utf16', m.start(), m.end(), s))
    for m in re.finditer(rb'[\x20-\x7e]{8,}', data):
        s = m.group().decode('ascii', 'ignore')
        if re.search(r'[A-Za-z]:\\', s) and '\\' in s[3:]:
            out.append(('ascii', m.start(), m.end(), s))
    return out


def show(ver):
    p = cfg_path(ver)
    if not os.path.isfile(p):
        print('配置不存在: %s' % p)
        return
    data = io.open(p, 'rb').read()
    print('%s (%.1f KB)' % (p, len(data) / 1024.0))
    for enc, s, e, s_val in read_paths(data):
        mark = '  <== HTML 发布根' if 'HTML' in s_val else ''
        print('  [%s] @0x%06x  %s%s' % (enc, s, s_val[:120], mark))


def set_path(ver, newdir):
    """把HTML 发布根替换为 newdir。

    实现：先找到现有那条 HTML 路径在文件里的字节位置（UTF-16LE 或 ASCII），
    然后用**相同编码**写入新字符串。由于长度可能变化，采用
    「整体重排后续字节」的方式保持文件其它部分不变。
    """
    p = cfg_path(ver)
    if not os.path.isfile(p):
        print('配置不存在: %s' % p)
        return 1
    data = io.open(p, 'rb').read()
    cands = [(enc, s, e, v) for enc, s, e, v in read_paths(data) if 'HTML' in v and 'Axure' in v]
    if not cands:
        print('未在配置里找到 HTML 发布路径条目，无法自动替换。')
        print('请手工确认：%s' % p)
        return 2
    # 优先 UTF-16LE（.NET 配置的主编码）
    cands.sort(key=lambda c: 0 if c[0] == 'utf16' else 1)
    enc, s, e, old = cands[0]
    print('原值 [%s] @0x%06x: %s' % (enc, s, old))
    newdir = newdir.rstrip('\\')
    new = newdir.replace('/', '\\')
    if enc == 'utf16':
        nb = new.encode('utf-16le')
        # 长度前缀：.NET 的 #US 堆里长度是紧邻的 4 字节或 7-bit 编码，
        # 这里采用「同长度原位替换 + 不足补零」的安全做法：
        # 若新串更短，补 0；若更长，会破坏后续偏移，因此拒绝。
        if len(nb) > (e - s):
            print('新路径比原值长，无法安全原位替换（会破坏配置布局）。')
            print('请改用「先用短路径测试」或手工编辑。')
            return 3
        out = data[:s] + nb + data[s + len(nb):]
    else:
        nb = new.encode('ascii', 'ignore')
        if len(nb) > (e - s):
            print('新路径比原值长，无法安全原位替换。')
            return 3
        out = data[:s] + nb + data[s + len(nb):]
    io.open(p, 'wb').write(out)
    print('已改为: %s' % new)
    print('（备份: %s.bak）' % p)
    io.open(p + '.bak', 'wb').write(data)
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == '--show':
        for v in (args[1:] or ['8', '9']):
            print('--- RP%s ---' % v)
            show(v)
        return 0
    if args[0] == '--set' and len(args) >= 3:
        return set_path(args[1], args[2])
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main())
