#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axdbg_menu.py — 打开文件 → 关弹窗 → 逐行点击 Publish 菜单并截图，用于标定菜单项 y。

用途：菜单项偏移是「点出来看」才能定的。本脚本会为每一行尝试都留截图，
跑完看图即可知道「Generate HTML Files...」在第几行，然后回填到
axrun.py 的 MENU_ITEM_DY / 起始行号。

用法: axdbg_menu.py <file.rp>
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, click, main_window
from axrun import (AX, AX_VER, kill_axure, wait_main, wait_title,
                   find_pub_dialog, close_popups, log)
from axshot import shot

MENU_DY = 23
PUB_DX = 182


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== MENU DEBUG %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    mh, mrect = mw[0], mw[2]
    log('main rect=%s' % (mrect,))
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))

    time.sleep(6)
    close_popups(pid, mh, rounds=8, log_prefix='  ')
    log('shot: %s' % shot('dbg_0_ready'))

    #关键：加载完成后窗口会最大化，wait_main 的 rect 已过期，必须重新取
    mw2 = main_window(pid)
    if mw2:
        mrect = mw2[2]
    log('当前窗口 rect=%s（重取后）' % (mrect,))
    px, py = mrect[0] + PUB_DX, mrect[1] + MENU_DY
    log('click Publish at (%d,%d)' % (px, py))
    click(px, py)
    time.sleep(1.8)
    log('shot: %s' % shot('dbg_1_menu_open'))
    log('打开菜单后的顶层窗口:')
    for h, _, t, r in enum_windows(pid):
        log('  title=[%s] rect=%s' % (t, r))

    # 逐行点击并截图
    for row in range(0, 8):
        gy = py + 22 * row
        gx = px + 70
        log('---试第 %d 行 y=%d---' % (row, gy))
        click(gx, gy)
        time.sleep(2.0)
        dlg = find_pub_dialog(pid)
        if dlg:
            log('★ 命中！row=%d rect=%s' % (row, dlg[2]))
            log('shot: %s' % shot('dbg_2_hit_row%d' % row))
            kill_axure()
            return 0
        log('shot: %s' % shot('dbg_2_row%d' % row))
        # 重新打开菜单
        click(px, py)
        time.sleep(1.3)

    log('8 行都没命中。请看 dbg_1_menu_open.png 量出菜单项的实际 y 偏移')
    kill_axure()
    return 2


if __name__ == '__main__':
    sys.exit(main())
