#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axclick_test.py — 最小验证：点击菜单栏后菜单到底展不展开。

为什么单独写：需要区分「click 没生效」和「菜单项 y 不对」这两种失败。
做法是分级验证，每级留截图：
  L1move 到 Publish 上停 1.2s（hover 高亮）
  L2  click Publish
  L3  若仍未展开，试双击 / 试 Alt+F（英文菜单里 File 的助记键）

用法: axclick_test.py <file.rp>
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, click, move, main_window, tap_vk, vk_of, u32, wintypes
from axrun import AX, kill_axure, wait_main, wait_title, close_popups, log
from axshot import shot

MENU_DY = 23
PUB_DX = 182


def fg_pid():
    fg = u32.GetForegroundWindow()
    pid = wintypes.DWORD()
    u32.GetWindowThreadProcessId(fg, ctypes_byref := __import__('ctypes').byref(pid))
    return pid.value


def menu_opened(pid, mw2):
    """判断菜单是否展开：菜单展开时通常会出现新的顶层窗口或主窗口标题变化。"""
    tops = enum_windows(pid)
    log('  顶层窗口数=%d' % len(tops))
    for h, _, t, r in tops:
        log('    title=[%s] rect=%s' % (t, r))
    return len(tops) > 1


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== CLICK TEST %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    log('title ok=%.0fs' % max(wait_title(pid, name, 300), 0))
    time.sleep(6)
    close_popups(pid, mw[0], rounds=8, log_prefix='  ')

    mw2 = main_window(pid)
    rect = mw2[2] if mw2 else (0, 0, 1920, 1080)
    px, py = rect[0] + PUB_DX, rect[1] + MENU_DY
    log('窗口 rect=%s  Publish 目标=(%d,%d)' % (rect, px, py))
    log('当前前台 pid=%s（目标应为 %s）' % (fg_pid(), pid))

    log('--- L1: 只 move 过去 hover ---')
    move(px, py)
    time.sleep(1.2)
    log('shot: %s' % shot('ct_1_hover'))
    log('hover 后前台 pid=%s' % fg_pid())

    log('--- L2: click ---')
    click(px, py)
    time.sleep(1.5)
    log('shot: %s' % shot('ct_2_click'))
    log('click 后前台 pid=%s' % fg_pid())
    if menu_opened(pid, mw2):
        log('★ 菜单展开了！')

    log('--- L3: 试 Alt+F（File 助记键，验证键盘通道）---')
    tap_vk(vk_of('alt'))
    time.sleep(0.7)
    log('shot: %s' % shot('ct_3_alt'))
    tap_vk(vk_of('f'))
    time.sleep(1.5)
    log('shot: %s' % shot('ct_4_altaf'))
    menu_opened(pid, mw2)
    log('当前前台 pid=%s' % fg_pid())

    kill_axure()
    return 0


if __name__ == '__main__':
    import ctypes
    sys.exit(main())
