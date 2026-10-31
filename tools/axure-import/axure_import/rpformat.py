"""
Axure RP 8 .rp 容器与词法分析。

格式结论(逆向所得,2026-09,样本:Axure 8.0.0.3293):
- .rp = 标准 ZIP,内含 Page/<xx>/<id>.rppkg 等条目
- .rppkg = Axure 自定义二进制序列化:
  * u32 小端长度前缀 + UTF-8 字符串(可含 CJK)
  * 裸 u32 值(计数、ID、哈希表)
  * 结构: item-infos 头(包元数据) -> 类/属性名 schema 表
    ('Axure:DiagramObject:<Type>' + 属性键序列) -> 哈希表区 -> 实例数据区
- 实例几何数据的精确编码仍在逆向中,extract.py 采用启发式提取(带置信度标记)
"""

import struct
import zipfile


class RpEntry:
    """.rp 中的一个条目(页面/母版/配置)。"""

    def __init__(self, kind, entry_id, blob):
        self.kind = kind          # 'Page' | 'Master' | 'DesignDocument' | ...
        self.id = entry_id        # 包内 ID(如 b93e160b...)
        self.blob = blob

    @property
    def size(self):
        return len(self.blob)


def open_rp(path):
    """打开 .rp,返回 RpEntry 列表。"""
    z = zipfile.ZipFile(path)
    entries = []
    for name in z.namelist():
        parts = name.split('/')
        # 形如 Page/25/<id>/<id>.rppkg(两级哈希目录,目录层数可能变化)
        if len(parts) >= 3 and parts[-1].endswith('.rppkg'):
            kind = parts[0]
            blob = z.read(name)
            entries.append(RpEntry(kind, parts[-1][:-7], blob))
    return entries


class Token:
    __slots__ = ('offset', 'kind', 'value')

    def __init__(self, offset, kind, value):
        self.offset = offset   # 字节偏移
        self.kind = kind       # 'S' 字符串 | 'U' u32
        self.value = value

    def __repr__(self):
        return f'Tok({self.offset}, {self.kind}, {self.value!r})'


def tokenize(buf, max_str=2048):
    """将 rppkg 字节流切分为 token 序列。

    规则: 读 u32,若为合法长度且后续字节为可打印 UTF-8 则视为字符串,
    否则视为裸 u32。失败时逐字节重同步(启发式,适合含二进制实例区的流)。
    """
    toks = []
    off = 0
    n = len(buf)
    while off + 4 <= n:
        (length,) = struct.unpack_from('<I', buf, off)
        if 0 < length <= max_str and off + 4 + length <= n:
            chunk = buf[off + 4:off + 4 + length]
            try:
                txt = chunk.decode('utf-8')
                if all(c.isprintable() or c == '\t' for c in txt):
                    toks.append(Token(off, 'S', txt))
                    off += 4 + length
                    continue
            except UnicodeDecodeError:
                pass
        toks.append(Token(off, 'U', struct.unpack_from('<I', buf, off)[0]))
        off += 4
    return toks
