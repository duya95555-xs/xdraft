# -*- coding: utf-8 -*-
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import axrun
from axauto import click, enum_windows, force_foreground_pid, tap_vk, vk_of

pid = 20768
for i in range(12):
    wins = enum_windows(pid)
    print('t=+%ds windows:' % i, flush=True)
    for w in wins:
        print('   hwnd=%s pid=%s rect=%s title=[%s]' % (w[0], w[1], w[3], w[2]), flush=True)
    extra = [w for w in wins if ('目标目录' in w[2]) or ('不存在' in w[2]) or ('创建' in w[2]) or ('错误' in w[2])]
    if extra:
        print('  -> CONFIRM DIALOG: %s ; sending ENTER' % extra[0][2], flush=True)
        force_foreground_pid(pid)
        tap_vk(vk_of('enter'))
        time.sleep(2.0)
    tgt = os.path.join(axrun.PUBROOT, 't02')
    idx = os.path.join(tgt, 'index.html')
    if os.path.exists(idx) and os.path.getmtime(idx) > time.time() - 600:
        n = sum(len(fs) for _, _, fs in os.walk(tgt))
        print('  index.html fresh, files=%d' % n, flush=True)
        break
    time.sleep(1.5)

tgt = os.path.join(axrun.PUBROOT, 't02')
idx = os.path.join(tgt, 'index.html')
print('final index exists:', os.path.exists(idx), flush=True)
print('DONE', flush=True)
