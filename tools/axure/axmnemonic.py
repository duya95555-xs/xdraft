#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axmnemonic.py — 逐个试菜单栏助记键，找出能展开 Publish 下拉的那个。

为什么需要：Platform.dll 的字符串表里只扫到菜单**项**的助记键
（&Generate HTML Files / &Regenerate Current Page / Generate &Word），
没扫到菜单**栏**那一行的助记键。英文菜单栏是
File Edit View Project Arrange Publish Team Account Help，
Publish 的助记键可能是 P，也可能是别的字母，或根本没设。

做法：Alt 之后依次试 P/G/B/N 等键，每次看是否出现下拉窗口（无标题顶层窗口）。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, main_window, tap_vk, vk_of, hotkey
from axrun import AX, kill_axure, wait_main, wait_title, close_popups, log
from axshot import shot

CANDS = 'abcdefghijklmnopqrstuvwxyz'


def dropdown_open(pid):
    out = []
    for hwnd, wpid, title, rect in enum_windows(pid):
        if not title.strip():
            w, h = rect[2] - rect[0], rect[3] - rect[1]
            if w * h < 500000:
                out.append((rect, w, h))
    return out


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== MNEMONIC SCAN %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')
    time.sleep(0.6)

    # ★ 关键：Alt 与字母必须**快速连发**（间隔 ≤120ms）。
    #   实测：Alt 后等 700ms 再按字母 → 菜单栏无高亮、按键无效。
    for ch in CANDS:
        tap_vk(vk_of('esc'))
        time.sleep(0.35)
        tap_vk(vk_of('esc'))
        time.sleep(0.35)
        hotkey('alt')
        time.sleep(0.1)
        tap_vk(vk_of(ch))
        time.sleep(1.3)
        dd = dropdown_open(pid)
        if dd:
            log('★ 助记键 "%s" 展开了下拉：%s' % (ch.upper(), dd))
            log('shot: %s' % shot('mn_%s' % ch))
        else:
            log('  "%s" 无反应' % ch.upper())
    log('shot: %s' % shot('mn_final'))
    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
