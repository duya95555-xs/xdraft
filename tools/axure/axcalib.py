#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axcalib.py — 精确标定 RP8 发布对话框的控件坐标（截图像素法）。

为什么必须标定：对话框 820x804，按钮位置与 RP9 的 260x392 完全不同。
之前凭截图估算 BTN_DY=387 点空了（Generate 没被点到，对话框一直在）。

本脚本做两件事：
  1. 打开对话框后截图，同时打印对话框 rect；
  2. 在截图像素上量出 Use Default / Do not open / Generate 三个点，
     由使用者填回 axrun.py 的常量。
为了方便量坐标，本脚本会额外输出一张「带网格」的截图（每 50px 一条线），
量的时候直接对着网格数即可。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, tap_vk, vk_of
from axrun import (AX, AX_VER, kill_axure, wait_main, wait_title, close_popups,
                   find_pub_dialog, open_publish_dialog, log, PUBROOT)
from axshot import _grab_rgb, _png


def save_png(path, w, h, rgb):
    with open(path, 'wb') as f:
        f.write(_png(w, h, rgb))


def grid_png(path, w, h, rgb, step=50):
    """在截图上叠 50px 网格，方便量坐标。"""
    buf = bytearray(rgb)
    for x in range(0, w, step):
        major = (x % 100 == 0)
        for y in range(h):
            i = (y * w + x) * 3
            if major:
                buf[i:i + 3] = b'\xff\x00\x00'        # 红=百位
            else:
                buf[i:i + 3] = b'\x00\x80\xff'        # 蓝=50 位
    for y in range(0, h, step):
        major = (y % 100 == 0)
        for x in range(w):
            i = (y * w + x) * 3
            if major:
                buf[i:i + 3] = b'\xff\x00\x00'
            else:
                buf[i:i + 3] = b'\x00\x80\xff'
    return _png(w, h, bytes(buf))


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== CALIBRATE %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')

    ok, how = open_publish_dialog(pid, AX_VER, mw[2])
    log('open -> %s (%s)' % (ok, how))
    dlg = find_pub_dialog(pid)
    if not dlg:
        log('未找到对话框')
        kill_axure()
        return 2
    hwnd, title, (l, t, r, b) = dlg
    w, h = r - l, b - t
    log('对话框 rect=(%d,%d,%d,%d) size=%dx%d title=[%s]' % (l, t, r, b, w, h, title))

    outdir = os.path.join(os.environ.get('TEMP', '.'), 'axshots')
    os.makedirs(outdir, exist_ok=True)
    W, H, rgb = _grab_rgb()
    p1 = os.path.join(outdir, 'calib_plain.png')
    p2 = os.path.join(outdir, 'calib_grid.png')
    save_png(p1, W, H, rgb)
    with open(p2, 'wb') as f:
        f.write(grid_png(p2, W, H, rgb))
    log('截图（无网格）: %s' % p1)
    log('截图（50px网格，红=100倍位，蓝=50倍位）: %s' % p2)
    log('')
    log('★ 请在 grid 图上量出三个点的**屏幕绝对坐标**，然后填到 axrun.py：')
    log('  「Use Default」  → DEF_DX = x - %d, DEF_DY = y - %d' % (l, t))
    log('  「Do not open」   → NOOPEN_DX = x - %d, NOOPEN_DY = y - %d' % (l, t))
    log('  「Generate」      → BTN_DX = x - %d, BTN_DY = y - %d' % (l, t))
    log('')
    log('（当前值 DEF=(168,40) NOOPEN=(-123,303) BTN=(98,387)，明显需要修正）')
    log('提示：Generate 按钮在对话框底部靠右，蓝色实心按钮；'
        'Use Default 在路径输入框右侧；Do not open 在 Open With 组里第二行。')
    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
