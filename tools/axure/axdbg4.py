# -*- coding: utf-8 -*-
"""调试：读取发布对话框里的目标路径（纯 ctypes 读剪贴板）。"""
import ctypes
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import axrun
from axauto import (force_foreground_pid, tap_vk, vk_of, hotkey, enum_windows, click)

user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)


def get_clipboard():
    """读 CF_UNICODETEXT(13)。"""
    if not user32.OpenClipboard(0):
        return ''
    try:
        h = user32.GetClipboardData(13)
        if not h:
            return ''
        ptr = kernel32.GlobalLock(h)
        if not ptr:
            return ''
        try:
            return ctypes.c_wchar_p(ptr).value or ''
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


RP = r'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_one\t02.rp'
NAME = 't02'

axrun.kill_axure()
shutil.rmtree(os.path.join(axrun.PUBROOT, NAME), ignore_errors=True)
print('cleaned target dir', flush=True)

proc = subprocess.Popen([axrun.AX, RP])
pid = proc.pid
print('pid', pid, flush=True)
mw = axrun.wait_main(pid, proc)
print('main ok', flush=True)
dt = axrun.wait_title(pid, NAME)
print('title %.1fs' % dt, flush=True)

pop = None
t0 = time.time()
while time.time() - t0 < 35:
    pop = axrun.find_popup(pid, mw[0])
    if pop:
        break
    time.sleep(0.7)
print('popup', pop, flush=True)
if pop:
    force_foreground_pid(pid)
    tap_vk(vk_of('enter'))
    time.sleep(1.5)
print('popup after enter', axrun.find_popup(pid, mw[0]), flush=True)

dlg = axrun.find_pub_dialog(pid)
if not dlg:
    force_foreground_pid(pid)
    hotkey('ctrl+shift+o')
    t0 = time.time()
    while time.time() - t0 < 30:
        time.sleep(0.8)
        dlg = axrun.find_pub_dialog(pid)
        if dlg:
            break
print('dlg', dlg, flush=True)
if not dlg:
    sys.exit(1)

dl, dtt, dr, db = dlg[2]
print('dlg rect', dl, dtt, dr, db, 'size', dr - dl, db - dtt, flush=True)
force_foreground_pid(pid)
time.sleep(0.6)

for label, (dx, dy) in [('nameField', (80, 98)), ('pathField', (60, 123)),
                        ('pathField2', (100, 123)), ('defaultLink', (43, 141))]:
    try:
        click(dl + dx, dtt + dy)
        time.sleep(0.4)
        hotkey('ctrl+a')
        time.sleep(0.2)
        hotkey('ctrl+c')
        time.sleep(0.5)
        print('%s @(%d,%d) clip=[%s]' % (label, dl + dx, dtt + dy, get_clipboard().strip()), flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

print('--- windows ---', flush=True)
for w in enum_windows(pid):
    print('  hwnd=%s rect=%s title=[%s]' % (w[0], w[3], w[2]), flush=True)
print('DONE', flush=True)
