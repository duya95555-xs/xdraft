#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axpubmenu.py — Alt+V 打开 View 下拉后，右移 3 格到 Publish，截图确认下拉内容。

已知：Alt+V 能打开 View 下拉；右移 3 格后下拉仍展开（entry=v+3+g 返回说明
menu_dropdown_open 为 True），但 G 键没命中「Generate HTML Files...」。
本脚本只做一件事：把那个下拉截出来，看清菜单项的排列与实际 y 坐标。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, tap_vk, vk_of, hotkey
from axrun import AX, kill_axure, wait_main, wait_title, close_popups, log
from axshot import shot


def dropdowns(pid):
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
    log('=== PUBLISH MENU SHOT %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')

    tap_vk(vk_of('esc'))
    time.sleep(0.35)
    hotkey('alt')
    time.sleep(0.1)
    tap_vk(vk_of('v'))
    time.sleep(1.2)
    log('View 下拉: %s' % dropdowns(pid))
    log('shot: %s' % shot('pm_1_view'))

    # 逐步截图。★ 关键：每次 Right 前必须先 Esc 收起下拉——
    #   否则 Right 是在下拉列表内移动（实测截图 pm_step1 显示高亮始终在 View，
    #   Right 只是让 Toolbars 展开了子菜单），菜单栏根本不会切换。
    for i in range(6):
        dd = dropdowns(pid)
        log('第 %d 格:下拉=%s' % (i, dd))
        log('shot: %s' % shot('pm_step%d' % i))
        tap_vk(vk_of('esc'))
        time.sleep(0.35)
        tap_vk(vk_of('right'))
        time.sleep(0.5)

    log('最终下拉: %s' % dropdowns(pid))
    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
