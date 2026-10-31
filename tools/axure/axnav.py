#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axnav.py — 用方向键在菜单栏里逐格走，每格截图，定位 Publish 的真实位置。

背景：Alt+E / Alt+V / Alt+T 都能稳定展开对应下拉，但 Alt+P 无反应。
可能原因：Publish 在菜单栏里的位置与我数的不符（中间有隐藏项/分隔符），
或它的助记键确实未注册。

做法：Alt 激活菜单栏后，从最左项开始按 Right 逐格走，每格截图 + 检测下拉是否展开。
走到 Publish 时下拉会展开，截图里也能直接看到高亮的是哪一项。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, tap_vk, vk_of
from axrun import AX, kill_axure, wait_main, wait_title, close_popups, log
from axshot import shot


def dropdown(pid):
    out = []
    for h, _, t, r in enum_windows(pid):
        if not t.strip():
            w, hh = r[2] - r[0], r[3] - r[1]
            if w * hh < 500000:
                out.append(r)
    return out


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== MENU NAV SCAN %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')

    # Alt 激活菜单栏
    tap_vk(vk_of('esc'))
    time.sleep(0.4)
    tap_vk(vk_of('alt'))
    time.sleep(1.0)
    log('shot: %s' % shot('nav_0_alt'))

    for i in range(10):
        dd = dropdown(pid)
        log('格 %d: 下拉=%s' % (i, dd if dd else '无'))
        log('shot: %s' % shot('nav_%d' % i))
        if dd:
            # 记录下拉窗口的位置，它决定是哪个菜单项
            log('  → 下拉 rect=%s（宽度可区分菜单项大小）' % (dd[0],))
        tap_vk(vk_of('right'))
        time.sleep(0.8)

    log('shot: %s' % shot('nav_final'))
    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
