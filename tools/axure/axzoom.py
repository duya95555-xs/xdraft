#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axzoom.py — 放大截取发布对话框并叠绝对坐标网格，用于精确标定按钮位置。

为什么需要：肉眼估坐标一直偏（Use Default 估成 170→210 都没点中）。
这张图会：① 只截对话框区域；② 放大 2 倍；③ 叠 10px 网格且每 20px 标注
**屏幕绝对坐标**。这样量出来的就是能直接用的值。

用法: axzoom.py <file.rp> [--crop x,y,w,h]
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, tap_vk, vk_of
from axrun import (AX, AX_VER, kill_axure, wait_main, wait_title, close_popups,
                   find_pub_dialog, open_publish_dialog, log)
from axshot import _grab_rgb


def save_png(path, w, h, rgb):
    import struct
    import zlib

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
                + chunk(b'IEND', b''))


def zoom_grid(rgb, W, H, crop, scale=2, step=20):
    """裁剪 crop=(x,y,w,h)，放大 scale 倍，叠 step 网格 + 每 2 格标注绝对坐标。

    标注用极简 3x5 像素点阵，只画数字和字母，省掉字体依赖。
    """
    cx, cy, cw, ch = crop
    # 放大
    ow, oh = cw * scale, ch * scale
    out = bytearray(ow * oh * 3)
    for y in range(oh):
        sy = cy + y // scale
        if not (0 <= sy < H):
            continue
        for x in range(ow):
            sx = cx + x // scale
            if not (0 <= sx < W):
                continue
            si = (sy * W + sx) * 3
            di = (y * ow + x) * 3
            out[di:di + 3] = rgb[si:si + 3]

    def setpx(x, y, c):
        if 0 <= x < ow and 0 <= y < oh:
            di = (y * ow + x) * 3
            out[di:di + 3] = c

    # 网格
    for gx in range(0, cw + 1, step):
        for y in range(oh):
            abs_x = cx + gx
            major = (abs_x % 100 == 0)
            setpx(gx * scale, y, b'\xff\x00\x00' if major else b'\x00\x90\xff')
    for gy in range(0, ch + 1, step):
        for x in range(ow):
            abs_y = cy + gy
            major = (abs_y % 100 == 0)
            setpx(x, gy * scale, b'\xff\x00\x00' if major else b'\x00\x90\xff')
    return ow, oh, bytes(out)


# 极简 3x5 点阵：只标数字与 x/y，用于标注绝对坐标
FONT = {
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
    'x': ['101', '101', '010', '101', '101'], 'y': ['101', '101', '111', '001', '001'],
    '=': ['000', '111', '000', '111', '000'], '.': ['000', '000', '000', '000', '010'],
    ',': ['000', '000', '000', '010', '100'], '#': ['101', '111', '101', '111', '101'],
    ':': ['000', '010', '000', '010', '000'],
}


def draw_text(out, ow, oh, text, px, py, color=b'\x00\x00\x00'):
    for i, ch in enumerate(text):
        g = FONT.get(ch)
        if not g:
            continue
        for ry, row in enumerate(g):
            for rx, v in enumerate(row):
                if v == '1':
                    for dy in range(2):
                        for dx in range(2):
                            x = px + i * 8 + rx * 2 + dx
                            y = py + ry * 2 + dy
                            if 0 <= x < ow and 0 <= y < oh:
                                di = (y * ow + x) * 3
                                out[di:di + 3] = color


def main():
    rp = sys.argv[1]
    log('=== ZOOM 标定 %s ===' % os.path.basename(rp))
    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, os.path.splitext(os.path.basename(rp))[0], 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')
    ok, how = open_publish_dialog(pid, AX_VER, mw[2])
    log('dialog open=%s (%s)' % (ok, how))
    dlg = find_pub_dialog(pid)
    if not dlg:
        log('未找到对话框')
        kill_axure()
        return 2
    h, title, (l, t, r, b) = dlg
    W, H, rgb = _grab_rgb()
    # 裁剪：对话框内上半部分（路径区 + 按钮区），放大 2 倍
    crop = (l, t, min(900, r - l), 260)
    ow, oh, zrgb = zoom_grid(rgb, W, H, crop, scale=2, step=20)
    out = bytearray(zrgb)
    # 标注：对角刻度处写绝对坐标，便于换算
    for gx in range(0, crop[2] + 1, 100):
        draw_text(out, ow, oh, 'x=%d' % (crop[0] + gx), gx * 2 + 2, 2, b'\xff\x00\x00')
    for gy in range(0, crop[3] + 1, 40):
        draw_text(out, ow, oh, 'y=%d' % (crop[1] + gy), 2, gy * 2 + 2, b'\x00\x90\x00')
    p = os.path.join(os.environ.get('TEMP', '.'), 'axshots', 'zoom_dialog.png')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    save_png(p, ow, oh, bytes(out))
    log('对话框 rect=(%d,%d,%d,%d) size=%dx%d' % (l, t, r, b, r - l, b - t))
    log('放大标定图: %s' % p)
    log('（图中红色横线每 100px，标注为绝对 x；绿色文字为绝对 y）')
    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
