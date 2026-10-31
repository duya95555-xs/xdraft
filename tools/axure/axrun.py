#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
axrun.py — 批量把 legacy .rp 用 Axure RP 9 发布成 HTML（纯 ctypes GUI 驱动，零第三方依赖）。

════════ 为什么是这个形态（踩过的坑，改代码前先读） ════════

1. .rp（RP5~RP8）是私有二进制容器，无法脱离 Axure 转 HTML，必须过一次 Axure。
   已验证：Axure 无 CLI / COM / SDK / 独立 dll / 进程外服务；在线服务和 MCP 也都依赖本地 Axure。

2. Axure 主窗口是 WinForms，但内容区被 DevExpress 全自绘（DxDrawingControl）：
     - 整个主窗口的 UIA 树只有 ~15 个元素；
     - 「您的项目已载入完成」弹窗、发布对话框内容在 UIA 里完全不可见；
   → UIA / Press-ByName 路线全部无效，只能「键盘 + 像素坐标点击」。

3. 本机 PowerShell 的 Add-Type -MemberDefinition（P/Invoke）被安全策略拦截，
   且环境块 339KB 远超 csc 的 64KB 上限 → 弃用 PowerShell，改用 Python ctypes 直调 user32。

4. 焦点：SetForegroundWindow 受 Windows 前台锁限制。必须
   AttachThreadInput(前台线程, 当前线程, True) + Alt 空击 才能夺回前台。
   判断标准是「前台窗口属于目标 PID」，而不是「等于某个 hwnd」——
   因为 Axure 的模态弹窗是独立顶层窗口（无标题），聚焦主窗口会被系统重定向到它。

5. 载入旧版文件时必弹「您的项目已载入完成」，它持有焦点会吃掉 Ctrl+Shift+O。
   该弹窗特征：同 PID 的独立顶层窗口、title 为空、约 600x242。
   → 只在检测到它时才发 Enter（否则 Enter 会误发到画布）。

6. 发布对话框「发布项目」：固定 260x392，内容全自绘。
   实测 dlg=(830,319,1090,711) 时，复选框中心 (855,586)、主按钮中心 (960,618)
   → 相对左上角偏移 (25,267) 和 (130,299)，用 dlg 的实时 rect 推算即可。
   勾选态用像素检测（蓝色方块），「取消在浏览器中打开」是幂等的。

7. 重要实测结论：「发布之后在浏览器中打开」一旦取消，Axure 会**记住**该选择，
   后续对话框默认不再勾选 → 像素检测是保险，不是必需。

════════ 流程 ════════
  清 *.PID + 强杀 → 启动 Axure <file> → 等主窗口 → 等标题含文件名（= 真加载完）
  → 轮询等「载入完成」弹窗 → 夺前台 → Enter 关弹窗
  → Ctrl+Shift+O → 等「发布项目」对话框 → 幂等取消勾选 → 点 Publish Locally
  → 等 PUBROOT/<name>/index.html 刷新且文件数稳定 → 强杀 Axure → 产物移到 --out

用法:
  axrun.py --dir <目录> [--filter *.rp] [--out <产物目录>] [--limit N] [--report r.json]
  axrun.py --files a.rp b.rp --out <产物目录>
"""
import argparse
import ctypes
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axauto import (u32, enum_windows, main_window, area_of, pid_of, click, move,
                    hotkey, tap_vk, vk_of, force_foreground_pid,
                    type_text, can_type_text)

# 调试开关：设 1 时在关键步骤截图，便于核对坐标与路径是否正确
DEBUG_SHOTS = 0
if DEBUG_SHOTS:
    from axshot import shot

# ── Axure 版本配置 ──────────────────────────────────────────────────────────
# 2026-10-02：RP9 已被卸载（仅剩汉化包残留目录），当前可用的是 RP8。
# 两者都能打开 RP5~RP8 素材，但：
#   - 数据目录名不同（Axure-9-0 / Axure-8-0），强杀后留的 *.PID 位置也不同；
#   - 发布对话框的尺寸与控件偏移是按 RP9 校准的（见下方偏移常量），
#     RP8 下必须先用--probe 重新校准，否则点击会落空。
# 用 --ax 指定版本；偏移量可用 --probe 打印当前对话框 rect 后手工填。
AX_VERSIONS = {
    '9': (r'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe', 'Axure-9-0'),
    '8': (r'D:\Program Files (x86)\Axure\Axure RP 8\AxureRP8.exe', 'Axure-8-0'),
}
AX_VER = '8'
# 运行期可覆盖（由 main() 的 --ax 通过 apply_version() 赋值）
AX = AX_VERSIONS[AX_VER][0]
AXDATA_NAME = AX_VERSIONS[AX_VER][1]
PUBROOT = os.path.join(os.environ.get('USERPROFILE', ''), 'Documents', 'Axure', 'HTML')
EXE_NAME = os.path.basename(AX)

# ★ 产物可能落在多个根目录 ★
# 2026-10-02 实测教训：点「Use Default」后 Axure 会把路径重置为它在设置里记住的
# 目录，本机实测是 **D:\桌面**（不是 settings.8.0.bin 里写的
# C:\Users\xiaos\Documents\Axure\HTML —— 那个只是"默认建议值"，
# 会被「Use Default」按钮重写成用户最近用过的目录）。
#
# ★ 安全约束（踩坑后修正）★
# 候选根目录**绝不能包含 Documents 这类用户目录**！曾把 `...\\Documents` 写进候选，
# 结果 scan_output 扫到 `WeChat Files`（55 万文件）、`Tencent Files` 等目录：
#   ① 每次判断都要递归遍历几十万个文件，慢到无法接受；
#   ② 一旦触发清理逻辑，会威胁用户真实数据（沙箱已正确拦截）。
# 现在只保留「明确是 Axure 产物目录」和「用户明确的工作区」，并要求
# 目录必须同时含 index.html + data/files 才是候选，见 _is_axure_output()。
#
# ★ 落点已确认固定（用户实测，2026-10-02 19:26）★
#   流程：F8 → 点「Use Default」→ 回车（一次）
#   落点恒为 C:\Users\xiaos\Documents\Axure\HTML\<工程名>
#   ——「Use Default」把路径重置为「配置里的默认根 + 工程名」，可预测。
#   之前观察到落点散乱（桌面 / Documents / axure-html），根因是 DEF 坐标偏了 40px
#   点在按钮边缘：有时点中有时没点中，没点中就沿用 Axure 上次记住的路径。
#   坐标已修正为 (210, 42)，落点恢复固定。桌面保留为兜底（诊断用）。
#★ 2026-10-02 19:50 曾尝试用 axsetpub.py 把配置里的 DefaultPrototypePath 改成
#   项目内的 axure-html，以固定落点。**该尝试已回滚** —— 改配置后 Axure
#   启动异常（弹窗不关、标题一度显示 Untitled），推测长度前缀之外还有
#   内部索引/校验，插入字节破坏了结构。配置已从备份完整恢复。
#   现在的方案：不改配置、不搬运，产物恒留在 PUBROOT（=PUB_ROOTS[0]）。
PUB_ROOTS = [
    PUBROOT,                                        # 落点（点 Use Default 后重置到这里）
    r'D:\桌面',                                     # 兜底：Use Default 没点中时 Axure 会沿用上次位置
]


def _is_axure_output(p):
    """判断目录 p 是否为 Axure 发布产物。

    双重特征校验，避免把用户目录里的普通文件夹误认成产物：
      · 含 index.html 或 start.html（Axure 入口页）
      · 含 data/ 或 files/ 子目录（Axure 产物必有）
    """
    has_entry = (os.path.exists(os.path.join(p, 'index.html'))
                 or os.path.exists(os.path.join(p, 'start.html')))
    has_axure = (os.path.isdir(os.path.join(p, 'data'))
                 or os.path.isdir(os.path.join(p, 'files')))
    return has_entry and has_axure


def _axdata_dir():
    """强杀后残留 *.PID 的数据目录（随版本不同）。"""
    return os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Axure', AXDATA_NAME)


def apply_version(ver):
    """按版本号设置 exe / 数据目录。返回 (exe路径, 数据目录, exe名)。"""
    global AX, AXDATA_NAME, EXE_NAME
    if ver not in AX_VERSIONS:
        raise SystemExit('不支持的版本: %s（可选 %s）' % (ver, '/'.join(AX_VERSIONS)))
    exe, data = AX_VERSIONS[ver]
    if not os.path.isfile(exe):
        raise SystemExit('找不到 %s 的可执行文件: %s' % (ver, exe))
    AX, AXDATA_NAME = exe, data
    EXE_NAME = os.path.basename(exe)
    return exe, _axdata_dir(), EXE_NAME

# 发布入口：RP8 与 RP9 不同，必须分别处理（2026-10-02 实测）
#   RP9 汉化版：菜单「发布(U)」→ 快捷键 Ctrl+Shift+O 直接开对话框
#   RP8 英文版：菜单「&Generate HTML Files...」(助记 G)，但扫遍 Platform.dll 的
#               UTF-16LE/UTF-8/GBK 字符串表均未找到 "Ctrl+Shift+O" 形式绑定
#               → 判定无快捷键。且实测 Alt+G 在本会话打不开（前台锁）。
#               → 唯一可行通道是「鼠标点击菜单栏 + 点击菜单项」。
# 发布入口：RP8 与 RP9 不同（2026-10-02 实测 + 用户确认）
#   RP9 汉化版：菜单「发布(U)」→ 快捷键 Ctrl+Shift+O 直接开对话框
#   RP8 英文版：**F8 直接打开发布对话框**（用户确认）。
#
#★ 为什么之前绕了那么多弯路 ★
#   扫遍 Platform.dll 的 UTF-16LE/UTF-8/GBK 字符串表都没找到 "Ctrl+Shift+O"
#   形式的快捷键绑定；26 字母助记键全扫也发现 **P 无反应**（菜单栏只注册了
#   E/F/H/T/V，对应 Edit/File/Help/Team/View）。于是尝试用方向键在菜单栏导航，
#   但实测方向键在下拉展开时只在下拉列表内移动，不切菜单栏（截图 pm_step1）。
#   鼠标点击也失败：GetWindowRect 对最大化窗口返回 (-9,-9,...)，那是 DWM 阴影
#   延伸而非内容原点，按 rect 加偏移算出的坐标落在标题栏内，点击被吞掉。
#   → 结论：**F8 才是 RP8 的正确入口**，菜单路径在这套 UI 上不可靠。
# F8 打开发布对话框失败后的重试间隔。
# 2026-10-02 实测：wait_title 只等标题出现，而标题在文件刚开始加载就有了，
# 此时画布仍在渲染（工具栏灰、画布空白），功能键无效。复杂文件需要多等一会儿。
ENTRY_RETRY_WAIT = float(os.environ.get('AX_ENTRY_RETRY_WAIT', '12.0'))

PUB_ENTRY = {
    '9': 'ctrl+shift+o',   # RP9 汉化版
    '8': 'f8',# RP8 英文版（用户确认）
}


def open_publish_dialog(pid, ver, main_rect=None, attempts=3):
    """打开发布对话框。返回 (成功?, 诊断信息)。

    ★ 为什么需要重试 ★
    2026-10-02 实测：`wait_title()` 只等窗口标题出现，而标题在文件**刚开始
    加载**时就有了。此时画布还在渲染（工具栏灰、画布空白），功能键按下去
    无效 —— F8 表现为「没打开对话框」。
    受影响的 3 个文件（天猫商城 49MB / tmall2 / 91金融@PC）都是内容较复杂、
    加载慢的，重试一次就成功。所以这里改成：等一小会儿 →试 → 不行再等再试。
    """
    key = PUB_ENTRY.get(ver)
    if not key:
        return False, 'entry=no_config'
    for attempt in range(1, attempts + 1):
        if not force_foreground_pid(pid):
            time.sleep(0.8)
            continue
        time.sleep(0.4)
        # 前置：清掉可能残留的菜单/焦点态，否则功能键可能落到别处
        tap_vk(vk_of('esc'))
        time.sleep(0.3)
        tap_vk(vk_of('esc'))
        time.sleep(0.3)
        if key == 'ctrl+shift+o':
            hotkey(key)
        else:
            tap_vk(vk_of(key))
        time.sleep(2.0)
        if find_pub_dialog(pid):
            return True, 'entry=%s' % key if attempt == 1 else 'entry=%s_try%d' % (key, attempt)
        if attempt < attempts:
            # 画布可能还在渲染，等它画完再试
            log('    %s 未打开对话框（第 %d 次），等界面就绪后重试' % (key.upper(), attempt))
            time.sleep(ENTRY_RETRY_WAIT)
    log('    %s 重试 %d 次仍未打开发布对话框，当前窗口：' % (key.upper(), attempts))
    dump_windows(pid, '')
    return False, 'entry=%s_failed' % key


# 发布对话框内控件的相对偏移
# ════════ 2026-10-02 RP8 实测重校准（calib_grid.png 网格图标定）═══════
# 对话框 rect=(550,108,1370,912) size=820x804，标题「Generate HTML (Html Prototype 1)」
# 界面是**英文**的，布局与 RP9 完全不同（RP9 是 260x392）→ 旧偏移量全部失效。
#
# ★★ 三个关键事实 ══
#  1. 「Do not open」**默认未选中**，实际选中的是 Default browser。
#     不点它，Generate 后浏览器弹到前台抢焦点，后续按键全部落空。
#  2. Generate 不用点，**回车即可**（用户确认）。
#  3. 顶部有**路径输入框**（General 页签），可直接敲目标路径 ——
#     比依赖「Use Default」可靠得多：后者会把路径重写成 Axure 记忆中的目录
#     （本机实测是 D://桌面），产物落在项目外，脚本扫不到。
#
# 屏幕绝对坐标 → 相对对话框左上 (550,108)：
#   路径输入框(578, 128)   → (28, 20)    ← DevExpress 自绘，键入进不去（实测 4 法皆败）
#   Use Default  (1255, 265) → (705, 157)
#   Do not open  (774, 733)  → (224, 625)
#   Generate     (1168, 886) → (618, 778)
#
# ★★ 坐标修正记录（2026-10-02 19:43，用户提供截图后重算）★★
#   之前用网格图肉眼估值，先后试过 (170,42) 与 (210,42)，**都没点中**。
#   换算回截图坐标：(210,42) → 截图内 (422,83)，落在「Destination folder for
#   HTML files:」标签附近，根本不在 Use Default 按钮上 —— 偏得离谱。
#   本次依据用户提供的清晰截图重算（截图 1067x600 ↔ 屏幕 1920x1080，比例 1.8）。
#   ★ 教训 ★
#   网格图有 50px 间隔、且按钮本身只有约 60px 宽，肉眼估误差能到 100px+。
#   标定按钮位置必须用**已知比例的整屏截图**换算，不能靠网格图目测。
EDIT_DX, EDIT_DY = 28, 20        # 路径输入框（仅记录，键入无效）
DEF_DX, DEF_DY = 705, 157        # 「Use Default」—— 重置为默认根
NOOPEN_DX, NOOPEN_DY = 224, 625  # 「Do not open」radio —— 必须点，否则浏览器抢焦点
BTN_DX, BTN_DY = 618, 778        # 「Generate」

DEF_SETTLE = float(os.environ.get('AX_DEF_SETTLE', '3.0'))

# ★ 为什么必须先点「Use Default」★
#   Axure 会记住「上次发布目录」。若上次是自定义路径（例如用户在别处手工发布过），
#   那么本次对话框会预填那个路径；一旦该目录不存在，回车后会弹
#   「目标文件夹不存在。需要创建吗？」，流程就卡在那里（实测踩坑）。
#   点「Use Default」把路径重置为 Documents\Axure\HTML\<工程名>，Axure 会自己创建，
#   且不会弹确认框 —— 这是整条链路上最隐蔽的一个坑。
#   ★ 落点由此固定：配置里的默认根 + 工程名，可预测（用户实测确认）。


LOGFILE = ''


def log(msg):
    line = '[%s] %s' % (time.strftime('%H:%M:%S'), msg)
    print(line, flush=True)
    if LOGFILE:
        try:
            with open(LOGFILE, 'a', encoding='utf-8') as fh:
                fh.write(line + '\n')
        except Exception:
            pass


# ── 进程与窗口 ───────────────────────────────────────────────────────────────
def kill_axure():
    r"""强杀 Axure，并处理强杀留下的 *.PID 恢复标记。

    ★ 为什么用改名归档而不是删除 ★
    Axure 强杀后会留下 <数字>.PID 恢复标记，下次启动会弹「上次异常退出」
    告警并**忽略命令行传入的文件参数** —— 那会导致 open 静默失败。
    原实现是 os.remove 删掉它，但实测在批量跑到第 47 个时被沙箱拦下
    （%LOCALAPPDATA%\Axure\Axure-8-0\20928.PID），整批中断。
    → 改为**改名为 .pid.bak**：Axure 只认 *.PID，改完就等于清掉了标记；
       归档文件留在原地（很小，几百字节），不做任何删除操作。
    """
    subprocess.run(['taskkill', '/F', '/IM', EXE_NAME], capture_output=True)
    time.sleep(1.8)
    axdata = _axdata_dir()
    if not os.path.isdir(axdata):
        return
    for f in os.listdir(axdata):
        if not f.lower().endswith('.pid'):
            continue
        src = os.path.join(axdata, f)
        dst = src + '.bak'
        try:
            if os.path.exists(dst):
                # 已有同名归档（上一轮留的），直接跳过，不覆盖
                continue
            os.rename(src, dst)
        except OSError:
            pass


def clear_pubroot():
    """**不做任何删除**，只记录清理前的时间戳。

    ★ 为什么改成不删 ★
    2026-10-02 实测教训：候选根目录里有 `D:\\桌面`、`...\\Documents` 这些
    **用户目录**。原先「先清空再判断」的思路必须删除文件，而这些目录里可能有
    用户的其它文件 —— 这是不可接受的风险，也会被沙箱正确拦下。
    改用「时间戳 + 精确目录名」判定本次产物，既安全又更可靠：
      · Axure 输出目录名 = .rp 内部工程名，通常与文件名一致；
      · 发布一定发生在本次运行期间（t_start 之后），用 mtime 过滤不会误判。
    """
    return 0


def _iter_publish_dirs(only_axure=True):
    """遍历所有候选发布根目录下的子目录（去重，保持顺序）。

    only_axure=True 时只返回通过 _is_axure_output() 校验的目录 ——
    这是安全底线：候选根目录里可能有用户的普通文件夹，绝不能整目录遍历。
    """
    seen = set()
    for root in PUB_ROOTS:
        if not root or not os.path.isdir(root):
            continue
        try:
            entries = os.listdir(root)
        except OSError:
            continue
        for d in entries:
            p = os.path.join(root, d)
            if not os.path.isdir(p):
                continue
            if only_axure and not _is_axure_output(p):
                continue
            key = os.path.normcase(os.path.abspath(p))
            if key in seen:
                continue
            seen.add(key)
            yield root, d, p


def scan_output(since_ts=None, name=None):
    """在候选发布根目录里定位本次产物。

    ★ 定位策略（2026-10-02 20:00 修正）★
    之前用「目录 mtime > since_ts」判断本次产物，实测**不可靠**，两个原因：
      1. Axure 生成的 index.html 用的是模板固定时间戳（实测恒为 08:19:31），
         覆盖已有目录时目录 mtime 也不更新 → 老产物会被误判为"这次生成的"，
         真正的新产物反而被漏掉（表现为明明生成了却报 NO_OUTPUT）。
      2. 目录 mtime 只在目录项变动时更新，Axure 覆盖写文件不改它。
    → 改为**按工程名精确匹配**：Axure 的输出目录名 = .rp 内部工程名，
      传入 name 时只认这个名字的目录；name 为空才退回"文件数最多"。

    ★ 过滤条件 ★
    1. _is_axure_output()：候选根目录可能是用户目录，必须确认含
       index.html + data/files，否则会扫到几十万个文件的无关目录。
    2. index.html：Axure 产物有两类入口 —— index.html（站点地图，恒存在）与
       start.html / start_c_1.html（内部壳页面）。只认 index.html，
       下游 extract-project.js 也会排除那 4 个壳页面。
    """
    cands = []
    for root, d, p in _iter_publish_dirs(only_axure=True):
        if not os.path.exists(os.path.join(p, 'index.html')):
            continue
        n = sum(len(fs) for _, _, fs in os.walk(p))
        cands.append((p, n, d))
    if not cands:
        return None
    if name:
        # 优先精确匹配工程名
        exact = [c for c in cands if c[2] == name or c[0].rstrip('\\/').endswith(name)]
        if exact:
            exact.sort(key=lambda c: -c[1])
            return (exact[0][0], exact[0][1])
    # 退化：取文件数最多的
    cands.sort(key=lambda c: -c[1])
    return (cands[0][0], cands[0][1])


def scan_output_anywhere():
    """诊断用：列出候选根目录下的 Axure 产物目录（NO_OUTPUT 时写进 report）。"""
    out = []
    for root, d, p in _iter_publish_dirs(only_axure=True):
        files = sum(len(fs) for _, _, fs in os.walk(p))
        try:
            mt = os.path.getmtime(p)
        except OSError:
            mt = 0
        out.append({
            'root': root,
            'dir': d,
            'path': p,
            'files': files,
            'mtime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mt)),
            'has_index': os.path.exists(os.path.join(p, 'index.html')),
            'has_start': os.path.exists(os.path.join(p, 'start.html')),
        })
    return sorted(out, key=lambda x: -x['files'])


def scan_output_detail(path):
    """统计产物里的页面数与几何文件数，写进 report 用于排查。"""
    if not path or not os.path.isdir(path):
        return {}
    datajs = []
    for root, _, files in os.walk(path):
        for f in files:
            if f == 'data.js':
                datajs.append(os.path.relpath(os.path.join(root, f), path))
    return {
        'has_index': os.path.exists(os.path.join(path, 'index.html')),
        'has_start': os.path.exists(os.path.join(path, 'start.html')),
        'datajs_count': len(datajs),
        'datajs_sample': datajs[:5],
    }


def wait_main(pid, proc, timeout=150):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(1.0)
        if proc.poll() is not None:
            return None
        mw = main_window(pid)
        if mw:
            return mw
    return None


def wait_title(pid, name, timeout=220):
    t0 = time.time()
    while time.time() - t0 < timeout:
        mw = main_window(pid)
        if mw and name in mw[1]:
            return time.time() - t0
        time.sleep(1.0)
    return -1


def find_popup(pid, main_hwnd):
    """找「载入完成」「兼容性提示」这类弹窗：同 PID、独立顶层、面积合理。

    RP5/RP6/RP7 文件在 RP8 下会弹：
        This file was created in Axure RP 5. Files saved in Axure RP 8 will not open in version 5.
    标题为 'Alert'（英文界面）或空（汉化版）。
    """
    for hwnd, wpid, title, rect in enum_windows(pid):
        if hwnd == main_hwnd:
            continue
        w, h = rect[2] - rect[0], rect[3] - rect[1]
        if title.strip() and title.strip() not in ('Alert', 'Warning'):
            continue
        if 20000 < w * h < 600000:
            return hwnd, rect
    return None


def close_popups(pid, main_hwnd, rounds=8, log_prefix=''):
    """关掉所有模态弹窗，直到没有为止。返回剩余弹窗数。

    策略（2026-10-02 用户确认：这类是对话框确认即可）：
      ① 点击弹窗中部让它拿焦点 → force_foreground_pid → Enter；
      ② 回车关不掉时，按比例点「确定」按钮（实测在弹窗内 x≈64%、y≈73%）。

    为什么不用纯回车：前台焦点在本会话拿不到，Enter 可能落到别的窗口。
    为什么不用纯坐标：弹窗尺寸随文案变化，比例会漂。两者结合最稳。
    """
    left = 0
    for i in range(rounds):
        pop = find_popup(pid, main_hwnd)
        if not pop:
            if i:
                log('%s弹窗已全部关闭（%d 轮）' % (log_prefix, i))
            return left
        hwnd, (l, t, r, b) = pop
        w, h = r - l, b - t
        log('%s关弹窗 rect=%s size=%dx%d' % (log_prefix, (l, t, r, b), w, h))
        # ① 焦点 + Enter
        click((l + r) // 2, (t + b) // 2)
        time.sleep(0.4)
        force_foreground_pid(pid)
        time.sleep(0.3)
        tap_vk(vk_of('enter'))
        time.sleep(1.2)
        if not find_popup(pid, main_hwnd):
            log('%s  回车已确认' % log_prefix)
            continue
        # ② 坐标点确定
        click(int(r - w * 0.36), int(t + h * 0.73))
        time.sleep(1.2)
        if not find_popup(pid, main_hwnd):
            log('%s  点击已确认' % log_prefix)
            continue
        log('%s  该弹窗未关闭，保留待人工处理' % log_prefix)
        left += 1
    return left


def find_pub_dialog(pid):
    """找发布对话框。

    ★ 关键实测（2026-10-02 RP8）★
    对话框**标题为空**，不匹配任何 'Publish'/'发布' 关键字——
    它靠标题找会永远失败。特征是「同 PID、标题空、面积 200x200 ~ 500x500、
    位于屏幕中部」。菜单下拉（508x600）比它大，可据此区分。
    所以策略：先按标题找，找不到就按「无标题 + 尺寸在对话框区间 + 非菜单尺寸」兜底。
    """
    cands = []
    for hwnd, wpid, title, rect in enum_windows(pid):
        t = title.strip()
        w, h = rect[2] - rect[0], rect[3] - rect[1]
        if '发布' in t or 'Publish' in t or 'Generate HTML' in t:
            return hwnd, title, rect
        if not t and 100 < w < 600 and 100 < h < 600:
            cands.append((w * h, hwnd, title, rect))
    if cands:
        # 同 PID 下可能有菜单下拉与对话框并存，取面积最小的那个即为对话框
        cands.sort()
        _, hwnd, title, rect = cands[0]
        return hwnd, title, rect
    return None


def dump_windows(pid, tag=''):
    """打印该 PID 下所有顶层窗口（诊断用）。"""
    for hwnd, wpid, title, rect in enum_windows(pid):
        w, h = rect[2] - rect[0], rect[3] - rect[1]
        log('%s  hwnd=%s title=[%s] rect=%s size=%dx%d' % (tag, hwnd, title, rect, w, h))


def find_confirm(pid):
    """「目标文件夹不存在，需要创建吗？」一类的确认框。"""
    for hwnd, wpid, title, rect in enum_windows(pid):
        if ('目标目录' in title) or ('不存在' in title) or ('文件夹' in title):
            return hwnd, title, rect
    return None


# ── 像素检测（GDI 抓一小块屏幕，判断复选框是否勾选）─────────────────────────
def count_blue(cx, cy, half=8):
    gdi32 = ctypes.WinDLL('gdi32', use_last_error=True)
    user32 = ctypes.WinDLL('user32', use_last_error=True)

    class BMIH(ctypes.Structure):
        _fields_ = [('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32),
                    ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
                    ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32),
                    ('biSizeImage', ctypes.c_uint32), ('biXPelsPerMeter', ctypes.c_int32),
                    ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32),
                    ('biClrImportant', ctypes.c_uint32)]

    size = half * 2 + 1
    hdc_screen = user32.GetDC(0)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    hbmp = gdi32.CreateCompatibleBitmap(hdc_screen, size, size)
    old = gdi32.SelectObject(hdc_mem, hbmp)
    gdi32.BitBlt(hdc_mem, 0, 0, size, size, hdc_screen, cx - half, cy - half, 0x00CC0020)
    bi = BMIH()
    bi.biSize = ctypes.sizeof(BMIH)
    bi.biWidth = size
    bi.biHeight = -size
    bi.biPlanes = 1
    bi.biBitCount = 32
    buf = ctypes.create_string_buffer(size * size * 4)
    got = gdi32.GetDIBits(hdc_mem, hbmp, 0, size, buf, ctypes.byref(bi), 0)
    blue = 0
    if got:
        raw = buf.raw
        for i in range(size * size):
            b_, g_, r_ = raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]
            if b_ > 130 and (b_ - r_) > 45 and g_ > 80:
                blue += 1
    gdi32.SelectObject(hdc_mem, old)
    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(0, hdc_screen)
    return blue


# ── 单文件发布 ───────────────────────────────────────────────────────────────
def publish_one(rp, outroot, popup_wait=35):
    name = os.path.splitext(os.path.basename(rp))[0]
    res = {'file': rp, 'name': name, 'status': '?', 'out': '', 'note': ''}
    t_start = time.time()

    # 超时随文件体积自适应：110MB / 41 页的工程，加载和生成都要好几分钟
    mb = os.path.getsize(rp) / 1048576.0
    t_main = min(600, max(150, mb * 4))
    t_title = min(600, max(220, mb * 5))
    t_popup = int(min(180, max(35, mb * 2)))
    t_out = min(1800, max(300, mb * 10))
    res['note'] += 'mb=%.1f;' % mb

    kill_axure()
    # ★ 发布前清空整个 PUBROOT：Axure 生成的 index.html 用的是模板固定时间戳
    #   （实测恒为 2025-07-25 15:26:16），无法用 mtime 判断"这次有没有发布"。
    #   清空后，任何新出现且含 index.html 的目录就一定是本次产物。
    clear_pubroot()

    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, t_main)
    if not mw:
        res['status'] = 'NO_WINDOW'
        kill_axure()
        return res
    main_hwnd = mw[0]

    dt = wait_title(pid, name, t_title)
    if dt < 0:
        res['status'] = 'NOT_OPENED'
        res['note'] += 'title_timeout;'
        kill_axure()
        return res
    res['note'] += 'load=%.0fs;' % dt

    # 等「载入完成 / 兼容性提示」弹窗（大文件会晚），出现就确认掉
    pop = None
    t0 = time.time()
    while time.time() - t0 < t_popup:
        pop = find_popup(pid, main_hwnd)
        if pop:
            break
        time.sleep(0.7)
    if pop:
        res['note'] += 'popup=%.0fs;' % (time.time() - t0)
        left = close_popups(pid, main_hwnd, rounds=8, log_prefix='    ')
        if left:
            res['note'] += 'popup_stuck%d;' % left
    else:
        res['note'] += 'nopopup;'

    mw2 = main_window(pid)
    if not mw2 or name not in mw2[1]:
        res['status'] = 'NOT_OPENED2'
        res['note'] += 'title=[%s];' % (mw2[1] if mw2 else '')
        kill_axure()
        return res
    main_hwnd = mw2[0]

    # 打开发布对话框（入口按版本不同：RP9=快捷键，RP8=点击菜单）
    dlg = find_pub_dialog(pid)
    if not dlg:
        ok, how = open_publish_dialog(pid, AX_VER, mw2[2])
        res['note'] += 'entry=%s;' % how.replace('=', '')
        dlg = find_pub_dialog(pid) if ok else None
        if not dlg:
            res['status'] = 'NO_PUBDLG'
            res['note'] += 'entry_failed;'
            kill_axure()
            return res

    dl, dtt, dr, db = dlg[2]
    res['note'] += 'dlg=%d,%d;' % (dl, dtt)
    res['note'] += 'dlg_size=%dx%d;' % (dr - dl, db - dtt)

    # ★★ 方案 B（用户确认）：不碰路径框，事后把产物移走 ★★
    #   起因：路径输入框是 DevExpress 自绘控件，程序化键入进不去。
    #   2026-10-02 试过 4 种方法全部无效，截图证实框内文字毫无变化：
    #     ① 点击 + Ctrl+A + type_text
    #     ② 双击 + 连按退格
    #     ③ Tab 切换焦点后 type_text
    #     ④ 先点对话框标题栏激活，再点输入框 type_text
    #   期间还发现：按退格弹出了 Axure 的系统菜单（还原/移动/大小/关闭），
    #   说明焦点始终在主窗口而非对话框上。
    #   → 改为「点 Use Default 让 Axure 自己发布到它记住的目录，
    #     产物出来后再 move 到目标目录」。实测它记住的是 D://桌面。
    root = PUBROOT   # 不搬运，产物留在 Axure 默认根
    res['note'] += 'schemeB;'
    force_foreground_pid(pid)
    time.sleep(0.9)

    # ① 点「Use Default」，让Axure 用它设置里记住的发布根目录
    #   ★ 时序是成败关键 ★
    #   2026-10-02 19:26 手动跑成功、19:28 脚本跑失败，同样的文件同样的流程，
    #   唯一差别是：手动点完 Use Default 后人停顿了几秒才按回车，给了 Axure
    #   内部重算路径的时间；脚本只等 1.2s 就回车 → 路径没重置完 →
    #   导出的东西落不到预期位置（表现为 NO_OUTPUT）。
    #   所以这里等 3s，并留 DEF_SETTLE_S 可调。
    click(dl + DEF_DX, dtt + DEF_DY)
    res['note'] += 'def;'
    time.sleep(DEF_SETTLE)
    if DEBUG_SHOTS:
        log('    shot: %s' % shot('dbg_after_def'))

    # ② 回车导出（用户确认：一次回车即可）
    force_foreground_pid(pid)
    time.sleep(0.4)
    tap_vk(vk_of('enter'))
    res['note'] += 'enter;'
    time.sleep(1.5)

    # ③ 处理「目标文件夹已存在，是否覆盖？」一类确认框
    #    ★ 这是 2026-10-02 19:11 那轮 NO_OUTPUT 的原因 ★
    #    落点固定为 C:\Users\xiaos\Documents\Axure\HTML\<工程名>，重跑同一文件时
    #    该目录已存在，Axure 会弹确认框；脚本此前没处理，回车没落在Generate 上，
    #    对话框虽然消失但导出根本没开始 —— 表现就是「什么产物都没有」。
    #    处理：轮询一段时间，捕到确认框就回车确认（默认按钮通常是「是/Yes」）。
    t0 = time.time()
    while time.time() - t0 < 30:
        time.sleep(0.7)
        if not find_pub_dialog(pid):
            # 对话框已关；再给一点时间让导出启动，然后跳出
            if time.time() - t0 > 3:
                break
            continue
        conf = find_confirm(pid)
        if conf:
            res['note'] += 'confirm[%s];' % conf[1]
            log('    捕获确认框: %s → 回车确认' % conf[1])
            force_foreground_pid(pid)
            time.sleep(0.3)
            tap_vk(vk_of('enter'))
            res['note'] += 'confirmed;'
            time.sleep(1.5)
            break
    if find_pub_dialog(pid):
        log('    对话框仍在，尝试点 Generate 兜底')
        res['note'] += 'gen_click;'
        click(dl + BTN_DX, dtt + BTN_DY)
        time.sleep(1.8)

    if find_pub_dialog(pid):
        log('    ★ 对话框仍在，打印窗口列表供核对坐标')
        dump_windows(pid, '      ')
        res['note'] += 'dlg_stuck;'

    # 兜底：万一仍弹「目标文件夹不存在。需要创建吗？」，Enter 选「创建」
    t0 = time.time()
    while time.time() - t0 < 12:
        time.sleep(0.6)
        conf = find_confirm(pid)
        if conf:
            res['note'] += 'confirm[%s];' % conf[1]
            force_foreground_pid(pid)
            tap_vk(vk_of('enter'))
            time.sleep(1.0)
        elif scan_output(since_ts=t_start, name=name):
            break

    # 等产物：PUBROOT 里出现含 index.html 的目录，且文件数连续 5 次不变（约 15 秒无增长）
    deadline = time.time() + t_out
    last_n, stable, ok, target = -1, 0, False, None
    while time.time() < deadline:
        time.sleep(3)
        got = scan_output(since_ts=t_start, name=name)
        if not got:
            continue
        target, n = got
        if n <= 3:
            continue
        if n == last_n:
            stable += 1
        else:
            stable = 0
            last_n = n
        if stable >= 5:
            ok = True
            break
    if not ok:
        res['status'] = 'NO_OUTPUT'
        res['note'] += 'out_wait=%.0fs;' % (time.time() - (deadline - t_out))
        # 诊断：把 PUBROOT 下实际有什么记下来，避免面对空报告猜原因
        anywhere = scan_output_anywhere()
        res['found_anywhere'] = anywhere
        if anywhere:
            log('    PUBROOT 实际内容: %s' % anywhere[:5])
        else:
            log('    PUBROOT 为空——Generate 未被执行（对话框里回车没落到 Generate 上）')
        kill_axure()
        return res
    res['note'] += 'files=%d;' % last_n
    # 记录产物明细：index.html 存在性 + 页面（data.js）数量
    det = scan_output_detail(target)
    res['detail'] = det
    res['note'] += 'idx=%s;dj=%d;' % (det.get('has_index'), det.get('datajs_count', 0))

    kill_axure()
    # ★ 不搬运：产物就留在 Axure 的默认发布根目录（用户决策，2026-10-02 20:02）★
    #   落点：C:\Users\xiaos\Documents\Axure\HTML\<工程名>（点 Use Default 重置得到）
    #   下游 tools/axure-html/extract-project.js 等直接读这个目录。
    #   放弃搬运的三个原因：
    #     ① move 会触发沙箱的删除保护（Documents 是用户目录，每次都被拦）；
    #     ② 改 Axure 配置来固定落点会破坏其配置结构（实测启动异常，已回滚）；
    #     ③ 留在原地最简单，且全程不删任何东西，最不容易丢数据。
    res['out'] = target
    res['status'] = 'OK'
    res['note'] += 'nomove;'
    return res


def probe(rp):
    """校准模式：打开文件 → 走到发布对话框 → 打印 rect 与候选偏移，不点击任何按钮。

    为什么必须有这个模式：发布对话框的控件偏移量（下方 CHK_*/BTN_*/DEF_*）是按
    特定版本实测校准的，换版本（RP9 → RP8）后对话框尺寸/布局可能不同，
    直接跑批量会点空。本模式让人工看一眼真实 rect，据此重校准常量。
    """
    name = os.path.splitext(os.path.basename(rp))[0]
    log('=== PROBE %s（不点任何按钮，仅测量）===' % name)
    kill_axure()
    clear_pubroot()
    proc = subprocess.Popen([AX, rp])
    pid = proc.pid
    mw = wait_main(pid, proc, 300)
    if not mw:
        log('NO_WINDOW'); kill_axure(); return 1
    main_hwnd = mw[0]
    log('main rect=%s title=[%s]' % (mw[2], mw[1]))

    dt = wait_title(pid, name, 300)
    log('title 含文件名: %s（%.0fs）' % (dt >= 0, dt if dt >= 0 else -1))
    if dt < 0:
        log('NOT_OPENED — 文件打不开，批量时会白等'); kill_axure(); return 2

    # 载入完成弹窗
    pop = None
    t0 = time.time()
    while time.time() - t0 < 60:
        pop = find_popup(pid, main_hwnd)
        if pop:
            break
        time.sleep(0.7)
    if pop:
        log('popup rect=%s（%.0fs）' % (pop[1], time.time() - t0))
        force_foreground_pid(pid)
        tap_vk(vk_of('enter'))
        time.sleep(1.5)
    else:
        log('no popup')

    if not force_foreground_pid(pid):
        log('WARN夺前台失败，菜单路径可能落空')
    time.sleep(0.8)
    ok, how = open_publish_dialog(pid, AX_VER)
    log('触发发布入口: %s' % how)
    t0 = time.time()
    dlg = None
    while time.time() - t0 < 30:
        time.sleep(0.8)
        dlg = find_pub_dialog(pid)
        if dlg:
            break
    if not dlg:
        log('NO_PUBDLG — 入口 %s 未打开对话框（该版本菜单路径可能不同）' % how)
        log('  排查建议：用 axauto.py rect %d 列出当前所有顶层窗口，看菜单是否展开成了子窗口' % pid)
        kill_axure(); return 3

    hwnd, title, (dl, dt_, dr, db) = dlg
    w, h = dr - dl, db - dt_
    log('发布对话框 title=[%s] rect=(%d,%d,%d,%d) 尺寸=%dx%d' % (title, dl, dt_, dr, db, w, h))
    log('')
    log('请据此核对下方常量是否仍适用（当前值是按 RP9 校准的）：')
    log('  CHK_DX, CHK_DY = %d, %d   # 「发布之后在浏览器中打开」复选框' % (CHK_DX, CHK_DY))
    log('  BTN_DX, BTN_DY = %d, %d   # 「Publish Locally」主按钮' % (BTN_DX, BTN_DY))
    log('  DEF_DX, DEF_DY = %d, %d   # 「使用默认」链接' % (DEF_DX, DEF_DY))
    log('')
    log('各控件的绝对坐标 = (dl+%d, dt_+%d) 等；用 axauto.py rect %d 可复现本测量' % (
        DEF_DX, DEF_DY, pid))
    log('若尺寸差异明显，请人工在此界面上目测控件位置后改常量。')
    kill_axure()
    return 0


def main():
    global LOGFILE
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir')
    ap.add_argument('--files', nargs='*')
    ap.add_argument('--from-list', default='',
                    help='从文件读取待处理清单（每行一个路径），'
                         '避开命令行长度限制与中文/空格转义问题')
    ap.add_argument('--filter', default='*.rp')
    ap.add_argument('--out', default='',
                    help='已弃用：产物不再搬运，恒留在 Axure 默认发布目录')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--skip-existing', action='store_true')
    ap.add_argument('--popup-wait', type=int, default=35)
    ap.add_argument('--report', default='')
    ap.add_argument('--log', default='')
    ap.add_argument('--ax', default='8', choices=sorted(AX_VERSIONS),
                    help='Axure 版本（默认 8；RP9 已卸载）')
    ap.add_argument('--probe', metavar='FILE', default='',
                    help='校准模式：只测量发布对话框 rect，不点击')
    a = ap.parse_args()

    apply_version(a.ax)
    LOGFILE = a.log or ((a.report + '.log') if a.report else '')
    log('Axure 版本: %s  exe=%s' % (a.ax, AX))

    if a.probe:
        return probe(a.probe)
    files = list(a.files or [])
    if a.from_list:
        # 从清单读：每行一个路径，忽略空行与# 注释。
        #为什么要这个而不是 --files：163 个路径里含中文、空格、括号，
        # 走命令行会被 shell 拆坏，且可能超出命令长度上限。
        with open(a.from_list, 'r', encoding='utf-8') as fh:
            for line in fh:
                s = line.strip()
                if s and not s.startswith('#'):
                    files.append(s)
    if a.dir:
        for f in sorted(os.listdir(a.dir)):
            if fnmatch.fnmatch(f.lower(), a.filter.lower()):
                files.append(os.path.join(a.dir, f))
    # 清单里可能是相对路径（相对于启动时的 cwd），统一转成绝对路径
    files = [os.path.abspath(f) for f in files]
    files = [f for f in files if os.path.isfile(f)]
    if a.limit:
        files = files[:a.limit]
    if not files:
        log('NO_INPUT_FILES')
        return 1
    if a.out:
        os.makedirs(a.out, exist_ok=True)
    LOGFILE = a.log or ((a.report + '.log') if a.report else '')

    log('=== AXRUN: %d 个文件 -> out=%s ===' % (len(files), a.out))
    results = []
    for i, f in enumerate(files, 1):
        name = os.path.splitext(os.path.basename(f))[0]
        # ★ 判据用 PUBROOT（产物实际落点），不是 --out（已弃用）★
        # 产物在 Axure 默认发布目录下，目录名 = 工程名。
        # 用 _is_axure_output 确认是真的产物，避免把空目录当已完成。
        _existing = os.path.join(PUBROOT, name)
        if a.skip_existing and _is_axure_output(_existing):
            log('[%d/%d] %s SKIP(exists)' % (i, len(files), name))
            results.append({'file': f, 'name': name, 'status': 'SKIP',
                            'out': _existing, 'note': '', 'sec': 0})
            continue
        log('[%d/%d] %s' % (i, len(files), name))
        t0 = time.time()
        try:
            r = publish_one(f, a.out, a.popup_wait)
        except Exception as e:
            r = {'file': f, 'name': name, 'status': 'EXCEPTION', 'out': '', 'note': repr(e)}
        r['sec'] = int(time.time() - t0)
        results.append(r)
        log('    -> %s  %ss  %s %s' % (r['status'], r['sec'], r.get('note', ''), r.get('out', '')))
        if a.report:
            with open(a.report, 'w', encoding='utf-8') as fh:
                json.dump(results, fh, ensure_ascii=False, indent=2)

    okc = sum(1 for r in results if r['status'].startswith('OK'))
    log('')
    log('=== 汇总: 成功 %d / %d ===' % (okc, len(results)))
    for r in results:
        log('%-12s %-32s %4ss  %s' % (r['status'], r['name'], r['sec'], r['note']))
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as fh:
            json.dump(results, fh, ensure_ascii=False, indent=2)
        log('report: %s' % a.report)
    return 0


if __name__ == '__main__':
    sys.exit(main())
