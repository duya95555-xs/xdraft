#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axshot.py — 抓全屏并存成 PNG（零第三方依赖，纯 ctypes/GDI + zlib）。

为什么不用 PIL/Pillow：批量调试时不想引入依赖；且 PowerShell 的
Add-Type -TypeDefinition 在本机被环境块大小限制挡住（见记忆），Python 是
唯一可靠的截图路径。

为什么自己写 PNG 编码：Read 工具能预览 PNG 但不能预览 BMP，而调试截图
必须能被我自己看到。PNG 的 zlib 压缩在标准库里，手写编码器只需约 40 行，
省掉一个依赖。
"""
import ctypes
import os
import struct
import zlib

_gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)
_u32 = ctypes.WinDLL('user32', use_last_error=True)


class _BMIH(ctypes.Structure):
    _fields_ = [('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32),
                ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
                ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32),
                ('biSizeImage', ctypes.c_uint32), ('biXPelsPerMeter', ctypes.c_int32),
                ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32),
                ('biClrImportant', ctypes.c_uint32)]


def _grab_rgb():
    """抓全屏，返回 (w, h, RGB bytes)。"""
    try:
        _u32.SetProcessDPIAware()
    except Exception:
        pass
    w, h = _u32.GetSystemMetrics(0), _u32.GetSystemMetrics(1)
    hdc = _u32.GetDC(0)
    mdc = _gdi32.CreateCompatibleDC(hdc)
    bmp = _gdi32.CreateCompatibleBitmap(hdc, w, h)
    old = _gdi32.SelectObject(mdc, bmp)
    _gdi32.BitBlt(mdc, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)
    bi = _BMIH()
    bi.biSize = ctypes.sizeof(_BMIH)
    bi.biWidth, bi.biHeight = w, -h          # 负高度 = 自上而下
    bi.biPlanes, bi.biBitCount = 1, 32
    buf = ctypes.create_string_buffer(w * h * 4)
    _gdi32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0)
    _gdi32.SelectObject(mdc, old)
    _gdi32.DeleteObject(bmp)
    _gdi32.DeleteDC(mdc)
    _u32.ReleaseDC(0, hdc)

    raw = buf.raw
    rgb = bytearray(w * h * 3)
    for i in range(w * h):
        j = i * 4
        k = i * 3
        rgb[k] = raw[j + 2]      # R
        rgb[k + 1] = raw[j + 1]  # G
        rgb[k + 2] = raw[j]      # B
    return w, h, bytes(rgb)


def _png(w, h, rgb):
    """把 RGB 数据编码成 PNG 字节流。"""
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)          # filter type 0 (None)
        raw += rgb[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)   # 8bit truecolor
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
            + chunk(b'IEND', b''))


def shot(tag, outdir=None):
    """抓全屏存 PNG，返回路径。"""
    outdir = outdir or os.path.join(os.environ.get('TEMP', '.'), 'axshots')
    os.makedirs(outdir, exist_ok=True)
    p = os.path.join(outdir, '%s.png' % tag)
    w, h, rgb = _grab_rgb()
    with open(p, 'wb') as f:
        f.write(_png(w, h, rgb))
    return p


#兼容旧名
grab_bmp = shot


if __name__ == '__main__':
    import sys
    print(shot(sys.argv[1] if len(sys.argv) > 1 else 'shot'))
