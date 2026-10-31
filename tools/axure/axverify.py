#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
axverify.py — 验证 Axure「发布之后在浏览器中打开」的勾选状态是否被记住。

流程（全程 ctypes，无 PowerShell 依赖）:
  杀 Axure → 清 *.PID → 启动 Axure <file> → 等主窗口 → 等标题含文件名
  → 等 8s（载入完成弹窗）→ Enter 关弹窗 → Ctrl+Shift+O 开发布对话框
  → 打印对话框 rect（用于校验相对坐标）→ 截图（外部 axcrop 做）
"""
import ctypes
import os
import subprocess
import sys
import time
from ctypes import wintypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import u32, k32, enum_windows, main_window, win_title

AX = r'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe'
AXDATA = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Axure', 'Axure-9-0')

VK_CONTROL = 0x11
VK_SHIFT = 0x10
VK_MENU = 0x12
VK_RETURN = 0x0D
VK_O = 0x4F
KEYEVENTF_KEYUP = 0x0002

u32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ulong, ctypes.c_void_p]
u32.keybd_event.restype = None


def key_down(vk):
    u32.keybd_event(vk, 0, 0, 0)


def key_up(vk):
    u32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def tap(vk, hold=0.05):
    key_down(vk)
    time.sleep(hold)
    key_up(vk)


def combo(*vks):
    for v in vks[:-1]:
        key_down(v)
        time.sleep(0.03)
    key_down(vks[-1])
    time.sleep(0.05)
    key_up(vks[-1])
    for v in reversed(vks[:-1]):
        time.sleep(0.03)
        key_up(v)


def focus_hwnd(hwnd):
    u32.ShowWindow(hwnd, 9)
    time.sleep(0.25)
    u32.BringWindowToTop(hwnd)
    u32.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    return u32.GetForegroundWindow() == hwnd


def kill_axure():
    subprocess.run(['taskkill', '/F', '/IM', 'AxureRP9.exe'], capture_output=True)
    time.sleep(2)
    if os.path.isdir(AXDATA):
        for f in os.listdir(AXDATA):
            if f.lower().endswith('.pid'):
                try:
                    os.remove(os.path.join(AXDATA, f))
                except OSError:
                    pass


def find_dialog(pid):
    for hwnd, wpid, title, rect in enum_windows(pid):
        if '发布' in title or 'Publish' in title:
            return hwnd, title, rect
    return None


def main():
    rp = sys.argv[1] if len(sys.argv) > 1 else r'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_one\t01.rp'
    name = os.path.splitext(os.path.basename(rp))[0]
    print('=== axverify ===')
    print('file:', rp)
    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    print('started pid=%s' % pid)

    mw = None
    t0 = time.time()
    while time.time() - t0 < 120:
        time.sleep(1.0)
        if proc.poll() is not None:
            print('EXITED early rc=%s' % proc.returncode)
            return 1
        mw = main_window(pid)
        if mw:
            break
    if not mw:
        print('NO MAIN WINDOW')
        return 1
    hwnd, title, rect = mw
    print('main hwnd=%s rect=%s title=[%s]' % (hwnd, rect, title))

    # 等标题含文件名
    t0 = time.time()
    while time.time() - t0 < 180:
        mw = main_window(pid)
        if mw and name in mw[1]:
            print('loaded after %.1fs' % (time.time() - t0))
            break
        time.sleep(1.0)
    hwnd, title, rect = main_window(pid)
    print('title now=[%s]' % title)

    # 等「载入完成」弹窗出现
    time.sleep(8)
    ok = focus_hwnd(hwnd)
    print('focus main = %s (fg=%s)' % (ok, u32.GetForegroundWindow()))
    tap(VK_RETURN)
    print('sent ENTER (close 载入完成)')
    time.sleep(2.5)

    # Ctrl+Shift+O
    dlg = find_dialog(pid)
    if not dlg:
        focus_hwnd(hwnd)
        combo(VK_CONTROL, VK_SHIFT, VK_O)
        print('sent Ctrl+Shift+O')
        time.sleep(4)
        dlg = find_dialog(pid)
    if dlg:
        print('DLG hwnd=%s title=[%s] rect=%s' % dlg)
        l, t, r, b = dlg[2]
        print('DLG size=%dx%d' % (r - l, b - t))
        print('checkbox abs = (%d, %d)' % (l + 25, t + 267))
        print('button   abs = (%d, %d)' % (l + 130, t + 299))
    else:
        print('NO PUBLISH DIALOG FOUND')
        return 1
    print('=== axverify done (Axure left running pid=%s) ===' % pid)
    return 0


if __name__ == '__main__':
    sys.exit(main())
