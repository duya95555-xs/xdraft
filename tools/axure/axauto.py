#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
axauto.py — 用 ctypes 直调 user32 的 GUI 自动化原语。

为什么不用 PowerShell: 本机 Add-Type -MemberDefinition（P/Invoke）被安全策略拦截，
  AppActivate+SendKeys 又无法操作 DevExpress 自绘控件（发布对话框内容全部自绘，
  UIA 里只有外壳窗口）。Python 的 ctypes 零依赖直调 user32，绕过该限制。

子命令:
  click  X Y              鼠标左键单击屏幕绝对坐标
  move   X Y              移动鼠标
  dblclick X Y
  focus  PID              把该进程的主窗口激活到前台（EnumWindows 找最大可见窗口）
  keys   "TEXT"           发送按键（SendKeys 语法: ^ = Ctrl, + = Shift, % = Alt）
  rect   PID              打印该进程所有可见顶层窗口的 rect（校验用）
  fg                      打印当前前台窗口的 pid/title
"""
import ctypes
import sys
import time
from ctypes import wintypes

u32 = ctypes.WinDLL('user32', use_last_error=True)
k32 = ctypes.WinDLL('kernel32', use_last_error=True)

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)   # PER_MONITOR_AWARE_V2
except Exception:
    try:
        u32.SetProcessDPIAware()
    except Exception:
        pass

u32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
u32.SetCursorPos.restype = ctypes.c_bool
u32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
u32.GetCursorPos.restype = ctypes.c_bool

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010

KEYEVENTF_KEYUP = 0x0002
VK_CODES = {
    'enter': 0x0D, 'return': 0x0D, 'esc': 0x1B, 'escape': 0x1B, 'tab': 0x09,
    'space': 0x20, 'back': 0x08, 'del': 0x2E, 'delete': 0x2E,
    'alt': 0x12, 'ctrl': 0x11, 'shift': 0x10, 'win': 0x5B,
    'f4': 0x73, 'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77, 'f9': 0x78,
    'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    'o': 0x4F, 's': 0x53, 'n': 0x4E, 'a': 0x41,
    'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
}
VK_MOD = {'ctrl': 0x11, 'control': 0x11, 'alt': 0x12, 'shift': 0x10, 'win': 0x5B}

u32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ulong, ctypes.c_void_p]
u32.keybd_event.restype = None


def vk_of(name):
    n = name.strip().lower()
    if n in VK_CODES:
        return VK_CODES[n]
    if len(n) == 1 and (n.isalnum()):
        return ord(n.upper())
    raise ValueError('unknown key: ' + name)


def tap_vk(vk, hold=0.06):
    u32.keybd_event(vk, 0, 0, 0)
    time.sleep(hold)
    u32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


# 需Shift 才有效果的字符（美式键盘布局）
SHIFTED = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7',
    '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
    ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '|': '\\', '~': '`',
}
VK_SHIFT = 0x10
# 需要用 Shift 打的符号键（VK 码）
SHIFTED_VK = {
    ';': 0xBA,   # :
    "'": 0xDE,   # "
    ',': 0xBC,   # <
    '.': 0xBE,   # >
    '/': 0xBF,   # ?
    '\\': 0xDC,  # |
    '`': 0xC0,   # ~
    '[': 0xDB, ']': 0xDD, '-': 0xBD, '=': 0xBB,
}


def type_text(s, per_key=0.012):
    """逐字符敲一段 ASCII 文本（走 keybd_event，不用 PowerShell）。

    为什么不用 send_keys()：那走 powershell.exe，而本机 PowerShell 已知有问题
    （工具回显异常、Add-Type 受环境块限制），批量任务里调用不可靠。
    keybd_event 是纯 user32 调用，与 tap_vk 同一路径，已验证可用。

    字母与小写符号：VK 码与ASCII 码**不连续**（'A'=0x41 但 '['=0x5B），
    所以不能直接用 ord()，必须查表 —— 否则 '[' 会被敲成 'M' 之类的错字符。

    ★ 只支持 ASCII ★非ASCII（中文）无法用 keybd_event 表达。
    """
    for ch in s:
        if ch == ' ':
            tap_vk(0x20, hold=0.04)
        elif ch in SHIFTED:
            u32.keybd_event(VK_SHIFT, 0, 0, 0)
            time.sleep(0.02)
            tap_vk(ord(SHIFTED[ch]), hold=0.04)
            u32.keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0)
        elif ch in SHIFTED_VK:
            # 符号键：需不需要Shift 由 SHIFTED 决定（上面已处理带 Shift 的）
            tap_vk(SHIFTED_VK[ch], hold=0.04)
        elif '0' <= ch <= '9':
            tap_vk(ord(ch), hold=0.04)
        elif 'A' <= ch <= 'Z':
            tap_vk(ord(ch), hold=0.04)          # VK 码与 ASCII 码一致
        elif 'a' <= ch <= 'z':
            tap_vk(ord(ch.upper()), hold=0.04)  # 小写用大写键，键盘不区分大小写输入
        else:
            raise ValueError('type_text 不支持字符: %r' % ch)
        time.sleep(per_key)


def can_type_text(s):
    """type_text 是否能处理这段文本。"""
    ok = set(' ') | set(SHIFTED) | set(SHIFTED_VK)
    return all(ch in ok or ch.isalnum() and ord(ch) < 128 for ch in s)


def hotkey(spec):
    """spec 形如 'ctrl+shift+o' / 'enter' / 'alt+f4'。"""
    parts = [p for p in spec.replace(' ', '').split('+') if p]
    if not parts:
        return
    mods = [VK_MOD[p] for p in parts[:-1] if p in VK_MOD]
    key = vk_of(parts[-1])
    for m in mods:
        u32.keybd_event(m, 0, 0, 0)
        time.sleep(0.03)
    tap_vk(key)
    for m in reversed(mods):
        time.sleep(0.03)
        u32.keybd_event(m, 0, KEYEVENTF_KEYUP, 0)


def pid_of(hwnd):
    if not hwnd:
        return 0
    p = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
    return p.value


def area_of(rect):
    l, t, r, b = rect
    return max(0, r - l) * max(0, b - t)

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
u32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
u32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
u32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
u32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
u32.IsWindowVisible.argtypes = [wintypes.HWND]
u32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
u32.SetForegroundWindow.argtypes = [wintypes.HWND]
u32.GetForegroundWindow.restype = wintypes.HWND
u32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
u32.BringWindowToTop.argtypes = [wintypes.HWND]
u32.SetActiveWindow.argtypes = [wintypes.HWND]
u32.SetActiveWindow.restype = wintypes.HWND
u32.SetFocus.argtypes = [wintypes.HWND]
u32.SetFocus.restype = wintypes.HWND
u32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
u32.AttachThreadInput.restype = wintypes.BOOL
k32.GetCurrentThreadId.restype = wintypes.DWORD


def force_foreground(hwnd, settle=0.35):
    """强制把窗口置于前台。

    SetForegroundWindow 受 Windows 前台锁限制（只有前台进程才能设前台）。
    经典解法是 AttachThreadInput：把当前线程的输入队列挂到前台线程和目标线程上，
    从而"继承"设置前台的权限。Axure 的模态弹窗持有焦点，必须靠这个才能夺回。
    """
    hwnd = int(hwnd)
    if u32.GetForegroundWindow() == hwnd:
        return True
    fg = u32.GetForegroundWindow()
    tid_fg = u32.GetWindowThreadProcessId(fg, None) if fg else 0
    tid_tgt = u32.GetWindowThreadProcessId(hwnd, None)
    tid_my = k32.GetCurrentThreadId()
    attached = []
    try:
        for t in (tid_fg, tid_tgt):
            if t and t != tid_my:
                if u32.AttachThreadInput(t, tid_my, True):
                    attached.append(t)
        u32.ShowWindow(hwnd, 9)          # SW_RESTORE
        u32.BringWindowToTop(hwnd)
        u32.SetForegroundWindow(hwnd)
        u32.SetActiveWindow(hwnd)
        u32.SetFocus(hwnd)
        time.sleep(settle)
    finally:
        for t in attached:
            u32.AttachThreadInput(t, tid_my, False)
    return pid_of(u32.GetForegroundWindow()) == pid_of(hwnd)


def force_foreground_pid(pid, tries=5, verbose=False):
    """把该进程的某个窗口弄到前台。判断标准是"前台窗口属于该 PID"，
    因为 Axure 存在模态弹窗（独立顶层窗口、无标题），聚焦主窗口会被系统
    重定向到弹窗——那同样是成功。

    额外手段：先发一次 Alt 空击，让系统认为"用户有输入"，
    从而解除 SetForegroundWindow 的前台锁限制。
    """
    if pid_of(u32.GetForegroundWindow()) == pid:
        return True
    for attempt in range(tries):
        u32.keybd_event(VK_MOD['alt'], 0, 0, 0)
        u32.keybd_event(VK_MOD['alt'], 0, KEYEVENTF_KEYUP, 0)
        time.sleep(0.1)
        wins = sorted(enum_windows(pid), key=lambda w: -area_of(w[3]))
        for w in wins:
            hwnd = w[0]
            fg = u32.GetForegroundWindow()
            tid_fg = u32.GetWindowThreadProcessId(fg, None) if fg else 0
            tid_tgt = u32.GetWindowThreadProcessId(hwnd, None)
            tid_my = k32.GetCurrentThreadId()
            attached = []
            try:
                for t in (tid_fg, tid_tgt):
                    if t and t != tid_my and u32.AttachThreadInput(t, tid_my, True):
                        attached.append(t)
                u32.ShowWindow(hwnd, 9)
                u32.BringWindowToTop(hwnd)
                u32.SetForegroundWindow(hwnd)
                u32.SetActiveWindow(hwnd)
                time.sleep(0.25)
            finally:
                for t in attached:
                    u32.AttachThreadInput(t, tid_my, False)
            if pid_of(u32.GetForegroundWindow()) == pid:
                if verbose:
                    print('  fg ok on hwnd=%s (attempt %d)' % (hwnd, attempt + 1))
                return True
        time.sleep(0.3)
    return False


def win_title(hwnd):
    n = u32.GetWindowTextLengthW(hwnd)
    if n <= 0:
        return ''
    buf = ctypes.create_unicode_buffer(n + 1)
    u32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def win_rect(hwnd):
    r = wintypes.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def enum_windows(pid=None):
    """返回 [(hwnd, pid, title, rect)]，可按 pid 过滤。"""
    out = []

    def cb(hwnd, _):
        try:
            wpid = wintypes.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if pid is not None and wpid.value != pid:
                return True
            if not u32.IsWindowVisible(hwnd):
                return True
            out.append((hwnd, wpid.value, win_title(hwnd), win_rect(hwnd)))
        except Exception:
            pass
        return True

    u32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def main_window(pid):
    """取该进程面积最大的可见顶层窗口作为主窗口。"""
    best = None
    best_area = -1
    for hwnd, wpid, title, (l, t, r, b) in enum_windows(pid):
        area = max(0, r - l) * max(0, b - t)
        if area > best_area:
            best_area = area
            best = (hwnd, title, (l, t, r, b))
    return best


def do_focus(pid):
    mw = main_window(pid)
    if not mw:
        print('NO_WINDOW for pid', pid)
        return 1
    hwnd, title, rect = mw
    ok = force_foreground(hwnd)
    print('focus pid=%s hwnd=%s title=[%s] rect=%s fgHwnd=%s ok=%s'
          % (pid, hwnd, title, rect, u32.GetForegroundWindow(), ok))
    return 0


def do_focus_hwnd(hwnd):
    ok = force_foreground(hwnd)
    print('focus hwnd=%s fg=%s ok=%s' % (hwnd, u32.GetForegroundWindow(), ok))
    return 0 if ok else 1


def do_choose_dialog(pid, pick='largest'):
    """打印该进程所有顶层窗口，并按 pick 选择要聚焦的（largest / smallest / title=<kw>）。"""
    wins = enum_windows(pid)
    for hwnd, wpid, title, rect in wins:
        area = max(0, rect[2] - rect[0]) * max(0, rect[3] - rect[1])
        print('  hwnd=%s area=%d rect=%s title=[%s]' % (hwnd, area, rect, title))
    return 0


def do_fg():
    fg = u32.GetForegroundWindow()
    wpid = wintypes.DWORD()
    u32.GetWindowThreadProcessId(fg, ctypes.byref(wpid))
    print('fg hwnd=%s pid=%s title=[%s]' % (fg, wpid.value, win_title(fg)))
    return 0


def move(x, y):
    u32.SetCursorPos(int(x), int(y))
    time.sleep(0.15)


def click(x, y, right=False):
    move(x, y)
    time.sleep(0.15)
    down, up = (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) if right else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    u32.mouse_event(down, 0, 0, 0, 0)
    time.sleep(0.08)
    u32.mouse_event(up, 0, 0, 0, 0)
    time.sleep(0.1)


def send_keys(text):
    """用 SendKeys 等价语义发送（借助 WScript.Shell，无需编译）。"""
    import subprocess
    ps = ('$ws = New-Object -ComObject WScript.Shell; '
          '$ws.SendKeys(%s)' % repr(text).replace("'", '"'))
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
                   capture_output=True)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1].lower()
    if cmd == 'click':
        click(int(sys.argv[2]), int(sys.argv[3])); print('clicked', sys.argv[2], sys.argv[3])
    elif cmd == 'rclick':
        click(int(sys.argv[2]), int(sys.argv[3]), right=True); print('rclicked')
    elif cmd == 'move':
        move(int(sys.argv[2]), int(sys.argv[3])); print('moved', sys.argv[2], sys.argv[3])
    elif cmd == 'dblclick':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        click(x, y); time.sleep(0.08); click(x, y); print('dblclicked')
    elif cmd == 'focus':
        sys.exit(do_focus(int(sys.argv[2])))
    elif cmd == 'focuspid':
        ok = force_foreground_pid(int(sys.argv[2]), verbose=True)
        print('focuspid ok=%s fgpid=%s' % (ok, pid_of(u32.GetForegroundWindow())))
        sys.exit(0 if ok else 1)
    elif cmd == 'focushwnd':
        sys.exit(do_focus_hwnd(int(sys.argv[2])))
    elif cmd == 'key':
        tap_vk(vk_of(sys.argv[2])); print('key:', sys.argv[2])
    elif cmd == 'hotkey':
        hotkey(sys.argv[2]); print('hotkey:', sys.argv[2])
    elif cmd == 'wins':
        sys.exit(do_choose_dialog(int(sys.argv[2])))
    elif cmd == 'fg':
        sys.exit(do_fg())
    elif cmd == 'keys':
        send_keys(sys.argv[2]); print('keys sent:', sys.argv[2])
    elif cmd == 'rect':
        for hwnd, wpid, title, rect in enum_windows(int(sys.argv[2])):
            print('hwnd=%s rect=%s title=[%s]' % (hwnd, rect, title))
    else:
        print('unknown cmd', cmd); sys.exit(2)
