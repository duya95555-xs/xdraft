#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""axsetpub.py — 修改 Axure RP8 配置里的默认发布根目录（DefaultPrototypePath）。

═══ 用途 ═══
把「Use Default」重置后的落点从
    C:\\Users\\xiaos\\Documents\\Axure\\HTML
改为
    D:\\KimiData\\kimi\\Workspaces\\prototype-3in1\\1.0.1\\axure-html
这样点一下「Use Default」就落到项目内，不需要事后搬移。

═══ 文件格式（2026-10-02 hexdump 实测确证）═══
%LOCALAPPDATA%\\Axure\\settings.8.0.bin 是**长度前缀的键值序列**（非 .NET 序列化），
每个条目形如：
    [4 字节 u32 小端 长度][ASCII 内容]
例如：
    14 00 00 00 "DefaultPrototypePath"     ← 0x14 = 20 = 键长
    23 00 00 00 "C:\Users\xiaos\...\HTML"   ← 0x23 = 35 = 路径长
    18 00 00 00 "DefaultSpecificationPath"  ← 0x18 = 24
→ 改路径 = 改「路径那个条目」的长度字段 + 内容，并插入/删除差额字节。
   键名条目不动，后续所有条目的偏移自动顺延，结构保持有效。

用法:
  axsetpub.py --show
  axsetpub.py --set "D:\\path\\dir"   # 注意要用双反斜杠或单反斜杠均可
  axsetpub.py --reset
"""
import io
import os
import shutil
import struct
import sys

KEY = b'DefaultPrototypePath'
DEF_PUB = r'C:\Users\xiaos\Documents\Axure\HTML'
TARGET = r'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\axure-html'
CFG = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Axure', 'settings.8.0.bin')


def read_cfg(path=CFG):
    if not os.path.isfile(path):
        raise SystemExit('配置不存在: %s' % path)
    return io.open(path, 'rb').read()


def find_entry(data, key):
    """找到 [len][key] 这个条目，返回 (key_start, val_start)。

    val_start 由「键条目结束」推出：键条目占 4+len(key)，
    紧接着的就是值条目的 4 字节长度字段。
    """
    k = bytes([len(key)]) + b'\x00\x00\x00' + key
    i = data.find(k)
    if i < 0:
        return None, None
    return i, i + len(k)


def get_current(data):
    ks, vs = find_entry(data, KEY)
    if vs is None:
        return None, None
    vlen = struct.unpack_from('<I', data, vs)[0]
    return data[vs + 4:vs + 4 + vlen].decode('ascii', 'replace'), vs


def set_value(newval, path=CFG):
    data = read_cfg(path)
    cur, vs = get_current(data)
    if cur is None:
        raise SystemExit('找不到 %s 条目，放弃修改。' % KEY.decode())
    if cur == newval:
        print('已是目标值，无需修改: %s' % cur)
        return
    vlen = struct.unpack_from('<I', data, vs)[0]
    old_raw = data[vs + 4:vs + 4 + vlen]
    new_raw = newval.encode('ascii')
    delta = len(new_raw) - vlen

    bak = path + '.bak'
    if not os.path.isfile(bak):
        shutil.copy2(path, bak)
        print('已备份 -> %s' % bak)

    # 重建：[4字节新长度][新内容] + 其余（原值条目之后的一切）
    out = (data[:vs]
           + struct.pack('<I', len(new_raw)) + new_raw
           + data[vs + 4 + vlen:])
    io.open(path, 'wb').write(out)
    print('原值 (%d 字节): %s' % (vlen, cur))
    print('新值 (%d 字节): %s' % (len(new_raw), newval))
    print('字节差: %+d' % delta)
    print('文件: %d -> %d 字节' % (len(data), len(out)))


def main():
    args = sys.argv[1:]
    data = read_cfg()
    cur, _ = get_current(data)
    print('配置: %s (%.1f KB)' % (CFG, len(data) / 1024.0))
    print('当前 %s = %s' % (KEY.decode(), cur))
    if not args or args[0] == '--show':
        return 0
    if args[0] == '--set' and len(args) >= 2:
        set_value(args[1])
        print('→ 需重启 Axure 生效（正在运行的实例要先退出）')
        return 0
    if args[0] == '--reset':
        set_value(DEF_PUB)
        return 0
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main())
