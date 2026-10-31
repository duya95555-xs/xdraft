# -*- coding: utf-8 -*-
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import axrun
from axauto import force_foreground_pid, tap_vk, vk_of, hotkey, enum_windows

rp = r'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_one\t02.rp'
name = 't02'
axrun.kill_axure()
predir = os.path.join(axrun.PUBROOT, name)
os.makedirs(predir, exist_ok=True)
print('predir created:', predir, os.path.isdir(predir), flush=True)

proc = subprocess.Popen([axrun.AX, rp]); pid = proc.pid
print('pid', pid, flush=True)
mw = axrun.wait_main(pid, proc); print('main', mw, flush=True)
if not mw: sys.exit(1)
dt = axrun.wait_title(pid, name); print('title ok after %.1fs' % dt, flush=True)

pop = None; t0 = time.time()
while time.time() - t0 < 35:
    pop = axrun.find_popup(pid, mw[0])
    if pop: break
    time.sleep(0.7)
print('popup:', pop, flush=True)
if pop:
    print('focus', force_foreground_pid(pid), flush=True)
    tap_vk(vk_of('enter')); time.sleep(1.5)
print('popup after enter:', axrun.find_popup(pid, mw[0]), flush=True)

dlg = axrun.find_pub_dialog(pid)
if not dlg:
    force_foreground_pid(pid); hotkey('ctrl+shift+o')
    t0 = time.time()
    while time.time() - t0 < 30:
        time.sleep(0.8); dlg = axrun.find_pub_dialog(pid)
        if dlg: break
print('dlg:', dlg, flush=True)
if dlg:
    dl, dtt, dr, db = dlg[2]
    print('dlg size %dx%d' % (dr - dl, db - dtt), flush=True)
    print('chk blue =', axrun.count_blue(dl + axrun.CHK_DX, dtt + axrun.CHK_DY, 8), flush=True)
    print('btn blue =', axrun.count_blue(dl + axrun.BTN_DX, dtt + axrun.BTN_DY, 8), flush=True)
print('--- all windows ---', flush=True)
for w in enum_windows(pid): print('  hwnd=%s rect=%s title=[%s]' % (w[0], w[3], w[1]), flush=True)
print('DONE (axure left running pid=%s)' % pid, flush=True)
