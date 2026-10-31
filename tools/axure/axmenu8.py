#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""axmenu8.py — 在 RP8 里通过「点击菜单」打开发布对话框（坐标路线）。

═══ 为什么必须用点击而不是按键 ═══
2026-10-02 实测：Axure RP 8 的窗口无法通过 SetForegroundWindow / AttachThreadInput
真正夺回前台（Windows 前台锁 + 本会话有其他前台应用）。截图证据：
按 Alt+G 之后前台仍是别的程序，Axure 窗口在后面。
→ 结论：**键盘输入这条路在当前会话下不可靠**，必须走「鼠标点击」——
   鼠标点击靠绝对坐标，不依赖前台焦点，这是唯一稳的通道。

═══ 已实测的界面事实（2026-10-02，截图证据）═══
- RP8 是**英文界面**（未汉化），窗口标题 `... : Licensed to www.jb51.net`（第三方授权）
- 窗口加载后**会弹 Alert**：`This file was created in Axure RP 5. Files saved in
  Axure RP 8 will not open in version 5.` —— RP5 文件必弹，**它会吞掉菜单交互**，
  必须先点掉。它的确定按钮在弹窗内右下角。
- 菜单栏在窗口**顶部 y≈+23**（窗口最大化时），菜单顺序：
  File Edit View Project Arrange Publish Team Account Help
  → `Publish` 的 x 偏移约 +182（窗口最大化、1920宽时）
- 文件能正常打开并渲染，所以「打不开文件」不是问题
- 关键：菜单栏 y 会随窗口状态变化（最大化≈23，之前非最大化时≈107），
  所以**必须按当前窗口 rect 动态推算**，不能写死屏幕绝对坐标。

用法: axmenu8.py <file.rp> [--shot]
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import (enum_windows, click, main_window, force_foreground_pid,
                    tap_vk, vk_of)
from axrun import AX, kill_axure, wait_main, wait_title, find_pub_dialog, log
from axshot import shot

# 菜单栏与菜单项相对**窗口左上角**的偏移（截图实测）
MENU_DY = 23           # 菜单栏 y（相对窗口顶）
PUB_DX = 182           # 「Publish」x（相对窗口左，最大化 1920 宽时）
ITEM_DX = 60           # 下拉项点击时的 x 偏移
ITEM_DY = 22# 菜单项行高
# RP5 文件必弹的Alert，其「确定」按钮在弹窗内的相对位置
ALERT_BTN_DX = -0.36   # 相对弹窗宽度（负值=从右往回）
ALERT_BTN_DY = 0.73    # 相对弹窗高度


def close_alert(pid, main_hwnd):
    """点掉 RP5 兼容性提示 / 载入完成之类的模态弹窗。

    策略（用户确认）：这类弹窗是「兼容性提示」，**点确定或按回车都行**。
    优先用回车——先点一下弹窗让窗口拿到焦点（鼠标点击是本会话唯一可靠的
    激活通道，前台锁拿不到），再发 Enter；回车关不掉时回退到坐标点击确定按钮。

    为什么不只用回车：前台焦点在当前会话拿不到，Enter 可能落到别的窗口。
    为什么不只用坐标：弹窗尺寸随文案变化，比例会漂。
    两者结合最稳。
    """
    for _ in range(8):
        hit = None
        for hwnd, wpid, title, rect in enum_windows(pid):
            if hwnd == main_hwnd:
                continue
            w, h = rect[2] - rect[0], rect[3] - rect[1]
            # Alert / 提示类弹窗：独立顶层、面积合理、标题为空或 Alert
            if 20000 < w * h < 600000 and (title.strip() in ('', 'Alert', 'Warning')):
                hit = (hwnd, title, rect, w, h)
                break
        if not hit:
            return True
        hwnd, title, (l, t, r, b), w, h = hit
        log('关弹窗 title=[%s] rect=%s' % (title, (l, t, r, b)))

        # ① 先点击弹窗中部让它拿到焦点，再按回车（用户确认：回车可确认）
        click((l + r) // 2, (t + b) // 2)
        time.sleep(0.4)
        force_foreground_pid(pid)
        time.sleep(0.3)
        tap_vk(vk_of('enter'))
        time.sleep(1.2)
        if not any(h == hwnd for h, _, _, _ in enum_windows(pid)):
            log('  回车已确认')
            return True

        # ② 回车没关掉 → 按比例点「确定」按钮
        log('  回车无效，改点确定按钮')
        click(int(r - w * 0.36), int(t + h * 0.73))
        time.sleep(1.2)
        if not any(h == hwnd for h, _, _, _ in enum_windows(pid)):
            log('  点击已确认')
            return True
    return False


def main():
    rp = sys.argv[1]
    want_shot = '--shot' in sys.argv
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== MENU8(click) %s ===' % name)

    kill_axure()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    main_hwnd, mrect = mw[0], mw[2]
    log('main rect=%s size=%dx%d' % (mrect, mrect[2] - mrect[0], mrect[3] - mrect[1]))

    dt = wait_title(pid, name, 300)
    log('title ok=%s (%.0fs)' % (dt >= 0, max(dt, 0)))

    # 关掉 RP5 升级提示（可能弹得晚，多等几轮）
    for wait in (5, 10, 20):
        time.sleep(wait)
        if close_alert(pid, main_hwnd):
            break
    log('弹窗处理完毕')

    if want_shot:
        log('shot: %s' % shot('m8_01_ready'))

    # ── 最大化窗口，让菜单栏坐标稳定 ──
    # 不做最大化也能点，但窗口位置会变；这里保持现状，按当前 rect 算
    ml, mt = mrect[0], mrect[1]
    px, py = ml + PUB_DX, mt + MENU_DY
    log('click Publish at (%d,%d)  [窗口左上=(%d,%d)]' % (px, py, ml, mt))
    click(px, py)
    time.sleep(1.5)
    if want_shot:
        log('shot: %s' % shot('m8_02_publish_menu'))

    # 逐行试点击（Publish 下拉里「Generate HTML Files...」通常不在第 1 行）
    for row in range(1, 6):
        gx, gy = px + ITEM_DX, py + ITEM_DY * row
        log('尝试菜单项 row%d at (%d,%d)' % (row, gx, gy))
        click(gx, gy)
        time.sleep(2.2)
        dlg = find_pub_dialog(pid)
        if dlg:
            log('SUCCESS row%d rect=%s' % (row, dlg[2]))
            if want_shot:
                log('shot: %s' % shot('m8_03_dialog'))
            kill_axure()
            return 0
        if want_shot:
            log('shot: %s' % shot('m8_03_try%d' % row))
        # 菜单可能已收起（点空了会收起），重开再试下一行
        click(px, py)
        time.sleep(1.2)

    log('5 行都没命中。请看截图 m8_02 确认下拉菜单的实际行数与位置')
    for hwnd, wpid, title, rect in enum_windows(pid):
        log('  title=[%s] rect=%s' % (title, rect))
    kill_axure()
    return 2


if __name__ == '__main__':
    sys.exit(main())
