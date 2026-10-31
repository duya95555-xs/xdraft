#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axdlgshot.py — 打开发布对话框并截图，用于标定按钮偏移。

为什么需要：axrun.py 里的 CHK_DX/CHK_DY、BTN_DX/BTN_DY、DEF_DX/DEF_DY
是按 RP9 的对话框（260x392）校准的。RP8 的对话框实测是 314x214，尺寸完全不同，
所以点「使用默认」「Publish Locally」全部落空 → 点了没反应 → 无产物。

本脚本：走到对话框 → 截图 → 打印 rect，人工量出各控件的相对偏移。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import enum_windows, tap_vk, vk_of, hotkey
from axrun import (AX, AX_VER, kill_axure, wait_main, wait_title, close_popups,
                   find_pub_dialog, open_publish_dialog, log, CHK_DX, CHK_DY,
                   BTN_DX, BTN_DY, DEF_DX, DEF_DY)
from axshot import shot


def main():
    rp = sys.argv[1]
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== DIALOG SHOT %s ===' % name)

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
    log('open_publish_dialog -> %s (%s)' % (ok, how))
    dlg = find_pub_dialog(pid)
    if not dlg:
        log('未找到对话框，窗口列表：')
        for h, _, t, r in enum_windows(pid):
            log('  title=[%s] rect=%s' % (t, r))
        kill_axure()
        return 2

    hwnd, title, (l, t, r, b) = dlg
    w, h = r - l, b - t
    log('发布对话框 rect=(%d,%d,%d,%d) size=%dx%d title=[%s]' % (l, t, r, b, w, h, title))
    log('')
    log('★ 请看截图量出三个控件的中心相对偏移，然后回填 axrun.py 的常量：')
    log('  「使用默认」链接      建议 DEF_DX,DEF_DY = ?, ?')
    log('  勾选「发布后打开浏览器」建议 CHK_DX,CHK_DY = ?, ?   （当前值 %d,%d 是 RP9 的）' % (CHK_DX, CHK_DY))
    log('  「Publish Locally」按钮建议 BTN_DX,BTN_DY = ?, ?   （当前值 %d,%d 是 RP9 的）' % (BTN_DX, BTN_DY))
    log('')
    log('shot: %s' % shot('dlg_full'))
    # 裁剪出对话框区域，便于精确量坐标
    log('对话框区域: 左上=(%d,%d) 右下=(%d,%d)' % (l, t, r, b))
    log('（截图分辨率 1920x1080，屏幕上直接按像素量即可）')

    kill_axure()
    return 0


if __name__ == '__main__':
    sys.exit(main())
