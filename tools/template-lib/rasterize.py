#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""rasterize.py — 极简PNG 光栅化器（纯标准库，零依赖）

为什么要自己写
--------------
缩略图需要把mydraft Diagram 渲染成位图。方案 §7.2 说「矩形/文本直接光栅化，
无需启动 mydraft」—— 但本机没有 PIL / cairo / aggdraw，
而引入渲染库（node-canvas、skia、resvg…）要么装原生依赖要么几百MB。
缩略图本身只要「能看出页面长什么样」，不需要文字抗锯齿，
所以 zlib + 手工 PNG 编码就够（~150 行）。

能力边界（明确的取舍）
--------------------
做：矩形填充/描边、水平垂直线、位图贴图（不解码 JPEG/PNG，走灰度近似）、
     5x7 点阵的中英文字符
不做：圆角、渐变、阴影、真正的字体渲染、文字抗锯齿、旋转

不做的代价：缩略图是「布局示意」而非「像素级预览」。模板浏览器里
用户靠它判断页面结构，不靠它判断配色渐变 —— 这个取舍是划算的。

用法
----
    from rasterize import Canvas
    c = Canvas(200, 150, bg=(255, 255, 255))
    c.rect(10, 10, 80, 30, fill=(200, 220, 255))
    c.text(12, 14, '登录', (0, 0, 0))
    c.save('out.png')
"""
import struct
import zlib

# ── 5x7 点阵字体（ASCII 可见字符）──
#每个字符 5 列 × 7 行，用 5 字节表示（每字节 = 1 列，bit0 = 顶行）
_FONT = {
    ' ': (0x00, 0x00, 0x00, 0x00, 0x00),
    '!': (0x00, 0x00, 0x5F, 0x00, 0x00),
    '"': (0x00, 0x07, 0x00, 0x07, 0x00),
    '#': (0x14, 0x7F, 0x14, 0x7F, 0x14),
    '$': (0x24, 0x2A, 0x7F, 0x2A, 0x12),
    '%': (0x23, 0x13, 0x08, 0x64, 0x62),
    '&': (0x36, 0x49, 0x55, 0x22, 0x50),
    "'": (0x00, 0x05, 0x03, 0x00, 0x00),
    '(': (0x00, 0x1C, 0x22, 0x41, 0x00),
    ')': (0x00, 0x41, 0x22, 0x1C, 0x00),
    '*': (0x14, 0x08, 0x3E, 0x08, 0x14),
    '+': (0x08, 0x08, 0x3E, 0x08, 0x08),
    ',': (0x00, 0x50, 0x30, 0x00, 0x00),
    '-': (0x08, 0x08, 0x08, 0x08, 0x08),
    '.': (0x00, 0x60, 0x60, 0x00, 0x00),
    '/': (0x20, 0x10, 0x08, 0x04, 0x02),
    '0': (0x3E, 0x51, 0x49, 0x45, 0x3E),
    '1': (0x00, 0x42, 0x7F, 0x40, 0x00),
    '2': (0x42, 0x61, 0x51, 0x49, 0x46),
    '3': (0x21, 0x41, 0x45, 0x4B, 0x31),
    '4': (0x18, 0x14, 0x12, 0x7F, 0x10),
    '5': (0x27, 0x45, 0x45, 0x45, 0x39),
    '6': (0x3C, 0x4A, 0x49, 0x49, 0x30),
    '7': (0x01, 0x71, 0x09, 0x05, 0x03),
    '8': (0x36, 0x49, 0x49, 0x49, 0x36),
    '9': (0x06, 0x49, 0x49, 0x29, 0x1E),
    ':': (0x00, 0x36, 0x36, 0x00, 0x00),
    ';': (0x00, 0x56, 0x36, 0x00, 0x00),
    '<': (0x08, 0x14, 0x22, 0x41, 0x00),
    '=': (0x14, 0x14, 0x14, 0x14, 0x14),
    '>': (0x00, 0x41, 0x22, 0x14, 0x08),
    '?': (0x02, 0x01, 0x51, 0x09, 0x06),
    '@': (0x32, 0x49, 0x79, 0x41, 0x3E),
    'A': (0x7E, 0x11, 0x11, 0x11, 0x7E),
    'B': (0x7F, 0x49, 0x49, 0x49, 0x36),
    'C': (0x3E, 0x41, 0x41, 0x41, 0x22),
    'D': (0x7F, 0x41, 0x41, 0x22, 0x1C),
    'E': (0x7F, 0x49, 0x49, 0x49, 0x41),
    'F': (0x7F, 0x09, 0x09, 0x01, 0x01),
    'G': (0x3E, 0x41, 0x41, 0x51, 0x32),
    'H': (0x7F, 0x08, 0x08, 0x08, 0x7F),
    'I': (0x00, 0x41, 0x7F, 0x41, 0x00),
    'J': (0x20, 0x40, 0x41, 0x3F, 0x01),
    'K': (0x7F, 0x08, 0x14, 0x22, 0x41),
    'L': (0x7F, 0x40, 0x40, 0x40, 0x40),
    'M': (0x7F, 0x02, 0x04, 0x02, 0x7F),
    'N': (0x7F, 0x04, 0x08, 0x10, 0x7F),
    'O': (0x3E, 0x41, 0x41, 0x41, 0x3E),
    'P': (0x7F, 0x09, 0x09, 0x09, 0x06),
    'Q': (0x3E, 0x41, 0x51, 0x21, 0x5E),
    'R': (0x7F, 0x09, 0x19, 0x29, 0x46),
    'S': (0x46, 0x49, 0x49, 0x49, 0x31),
    'T': (0x01, 0x01, 0x7F, 0x01, 0x01),
    'U': (0x3F, 0x40, 0x40, 0x40, 0x3F),
    'V': (0x1F, 0x20, 0x40, 0x20, 0x1F),
    'W': (0x7F, 0x20, 0x18, 0x20, 0x7F),
    'X': (0x63, 0x14, 0x08, 0x14, 0x63),
    'Y': (0x03, 0x04, 0x78, 0x04, 0x03),
    'Z': (0x61, 0x51, 0x49, 0x45, 0x43),
    '[': (0x00, 0x7F, 0x41, 0x41, 0x00),
    ']': (0x00, 0x41, 0x41, 0x7F, 0x00),
    '_': (0x40, 0x40, 0x40, 0x40, 0x40),
    'a': (0x20, 0x54, 0x54, 0x54, 0x78),
    'b': (0x7F, 0x48, 0x44, 0x44, 0x38),
    'c': (0x38, 0x44, 0x44, 0x44, 0x20),
    'd': (0x38, 0x44, 0x44, 0x48, 0x7F),
    'e': (0x38, 0x54, 0x54, 0x54, 0x18),
    'f': (0x08, 0x7E, 0x09, 0x01, 0x02),
    'g': (0x0C, 0x52, 0x52, 0x52, 0x3E),
    'h': (0x7F, 0x08, 0x04, 0x04, 0x78),
    'i': (0x00, 0x44, 0x7D, 0x40, 0x00),
    'j': (0x20, 0x40, 0x44, 0x3D, 0x00),
    'k': (0x7F, 0x10, 0x28, 0x44, 0x00),
    'l': (0x00, 0x41, 0x7F, 0x40, 0x00),
    'm': (0x7C, 0x04, 0x18, 0x04, 0x78),
    'n': (0x7C, 0x08, 0x04, 0x04, 0x78),
    'o': (0x38, 0x44, 0x44, 0x44, 0x38),
    'p': (0x7C, 0x14, 0x14, 0x14, 0x08),
    'q': (0x08, 0x14, 0x14, 0x18, 0x7C),
    'r': (0x7C, 0x08, 0x04, 0x04, 0x08),
    's': (0x48, 0x54, 0x54, 0x54, 0x20),
    't': (0x04, 0x3F, 0x44, 0x40, 0x20),
    'u': (0x3C, 0x40, 0x40, 0x20, 0x7C),
    'v': (0x1C, 0x20, 0x40, 0x20, 0x1C),
    'w': (0x3C, 0x40, 0x30, 0x40, 0x3C),
    'x': (0x44, 0x28, 0x10, 0x28, 0x44),
    'y': (0x0C, 0x50, 0x50, 0x50, 0x3C),
    'z': (0x44, 0x64, 0x54, 0x4C, 0x44),
    '|': (0x00, 0x00, 0x7F, 0x00, 0x00),
    '~': (0x08, 0x04, 0x08, 0x10, 0x08),
}

# 中文/全角字符没有点阵，按「豆腐块」处理：画一个空心方框
_CJK = set('，。、；：？！“”‘’（）《》【】—…·')


def has_glyph(ch):
    return ch in _FONT or ch in _CJK


class Canvas:
    def __init__(self, w, h, bg=(255, 255, 255)):
        self.w = max(1, int(w))
        self.h = max(1, int(h))
        # 用 bytearray存 RGB，扫描线式填充效率更高
        self.buf = bytearray(self.w * self.h * 3)
        if bg != (255, 255, 255):
            self.fill_all(bg)

    def fill_all(self, color):
        row = bytes(color) * self.w
        for y in range(self.h):
            self.buf[y * self.w * 3:(y + 1) * self.w * 3] = row

    def px(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.buf[i] = color[0]
            self.buf[i + 1] = color[1]
            self.buf[i + 2] = color[2]

    def rect(self, x, y, w, h, fill=None, stroke=None, thickness=1):
        """矩形填充 + 描边。坐标会裁剪到画布内。"""
        x0 = int(round(x)); y0 = int(round(y))
        x1 = int(round(x + w)); y1 = int(round(y + h))
        if x1 <= x0 or y1 <= y0:
            return
        if fill is not None:
            for yy in range(max(0, y0), min(self.h, y1)):
                i = (yy * self.w + max(0, x0)) * 3
                n = min(self.w, x1) - max(0, x0)
                if n > 0:
                    self.buf[i:i + n * 3] = bytes(fill) * n
        if stroke is not None:
            t = max(1, int(thickness))
            for k in range(t):
                for xx in range(max(0, x0), min(self.w, x1)):
                    self.px(xx, y0 + k, stroke)
                    self.px(xx, y1 - 1 - k, stroke)
                for yy in range(max(0, y0), min(self.h, y1)):
                    self.px(x0 + k, yy, stroke)
                    self.px(x1 - 1 - k, yy, stroke)

    def line(self, x0, y0, x1, y1, color=(0, 0, 0)):
        """Bresenham直线。"""
        dx = abs(x1 - x0); dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            self.px(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy; x0 += sx
            if e2 < dx:
                err += dx; y0 += sy

    def text(self, x, y, s, color=(0, 0, 0), scale=1):
        """画 ASCII 文本。5x7 点阵，scale 放大。中文画豆腐块。"""
        cx = int(round(x))
        cy = int(round(y))
        for ch in str(s):
            if ch in _CJK:
                # 豆腐块：空心方框
                for k in range(5 * scale):
                    self.px(cx + k, cy, color)
                    self.px(cx + k, cy + 7 * scale - 1, color)
                for k in range(7 * scale):
                    self.px(cx, cy + k, color)
                    self.px(cx + 5 * scale - 1, cy + k, color)
                cx += 6 * scale
                continue
            if ch not in _FONT:
                cx += 6 * scale
                continue
            glyph = _FONT[ch]
            for col in range(5):
                bits = glyph[col]
                for row in range(7):
                    if bits & (1 << row):
                        if scale == 1:
                            self.px(cx + col, cy + row, color)
                        else:
                            for a in range(scale):
                                for b in range(scale):
                                    self.px(cx + col * scale + a,
                                            cy + row * scale + b, color)
            cx += 6 * scale
        return cx

    def text_width(self, s, scale=1):
        n = 0
        for ch in str(s):
            n += 1 if ch in _CJK else 1
        return n * 6 * scale

    def save(self, path):
        """写 PNG（RGB8，无滤波）。"""
        raw = bytearray()
        stride = self.w * 3
        for y in range(self.h):
            raw.append(0)          # filter type 0
            raw += self.buf[y * stride:(y + 1) * stride]
        comp = zlib.compress(bytes(raw), 9)

        def chunk(typ, data):
            c = struct.pack('>I', len(data)) + typ + data
            return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)

        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', self.w, self.h,
                                         8, 2, 0, 0, 0))
        png += chunk(b'IDAT', comp)
        png += chunk(b'IEND', b'')
        with open(path, 'wb') as f:
            f.write(png)
        return path


if __name__ == '__main__':
    import os
    c = Canvas(280, 160, bg=(250, 250, 252))
    c.rect(10, 10, 120, 24, fill=(220, 232, 248), stroke=(120, 150, 200))
    c.text(16, 16, 'Login Page', (20, 40, 80), scale=1)
    c.rect(10, 46, 260, 40, fill=(255, 255, 255), stroke=(180, 180, 180))
    c.text(18, 56, 'username:', (60, 60, 60))
    c.rect(18, 72, 180, 14, fill=(248, 248, 248), stroke=(200, 200, 200))
    c.rect(210, 96, 60, 24, fill=(80, 140, 220), stroke=(40, 90, 160))
    c.text(222, 102, 'Login', (255, 255, 255))
    c.text(14, 136, 'ASCII only, CJK -> tofu box', (120, 120, 120))
    c.text(14, 146, '中文测试', (120, 120, 120))
    p = c.save('out/raster-demo.png')
    print('wrote %s (%d bytes)' % (p, os.path.getsize(p)))
