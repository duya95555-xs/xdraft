# -*- coding: utf-8 -*-
"""xdraft 更名批处理：用户可见品牌 mydraft → xdraft。

原则:
- 改: 产品名/打包配置/UI 文案/IPC 通道/日志前缀/localStorage 键/logo
- 不改: 上游版权头(*/mydraft.cc)、LICENSE、致谢、指向上游云服务的文案(saveTargetCloud)
- userData 显式固定在历史目录(main.js), 已保存文档不受更名影响
"""
import io, os, re, sys

ROOT = r"D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.2"

# (相对路径, [(old, new), ...], 全文正则兜底)
EDITS = {
    "package.json": [
        ('"name": "mydraft"', '"name": "xdraft"'),
        ('"name": "mydraft UOS packaging"', '"name": "xdraft UOS packaging"'),
        ('"desktopName": "mydraft.desktop"', '"desktopName": "xdraft.desktop"'),
        ('"appId": "cc.mydraft.app"', '"appId": "cc.xdraft.app"'),
        ('"productName": "mydraft"', '"productName": "xdraft"'),
        ('"Name": "mydraft"', '"Name": "xdraft"'),
        ('"shortcutName": "mydraft"', '"shortcutName": "xdraft"'),
    ],
    "electron-builder-optimized.yml": [
        ("appId: cc.mydraft.app", "appId: cc.xdraft.app"),
        ("productName: mydraft", "productName: xdraft"),
        ("Name: mydraft", "Name: xdraft"),
        ("shortcutName: mydraft", "shortcutName: xdraft"),
        ("# mydraft Electron 精简打包配置", "# xdraft Electron 精简打包配置"),
    ],
    "index.html": [
        ("<title>mydraft.cc [BUILD:__BUILD_STAMP__]</title>", "<title>xdraft [BUILD:__BUILD_STAMP__]</title>"),
        ("'mydraft 启动失败: 页面已加载, 但应用没有渲染出来。'", "'xdraft 启动失败: 页面已加载, 但应用没有渲染出来。'"),
    ],
    "src/App.tsx": [
        ("alt='mydraft.cc'", "alt='xdraft'"),
    ],
    "src/core/utils/desktop.ts": [
        ("window.mydraftApp", "window.xdraftApp"),
    ],
    "electron/preload.js": [
        ("mydraftApp", "xdraftApp"),
        ("--mydraft-is-packaged", "--xdraft-is-packaged"),
        ("'mydraft:", "'xdraft:"),
        ('"mydraft:', '"xdraft:'),
    ],
    "electron/main.js": [
        ("'mydraft:", "'xdraft:"),
        ("[mydraft]", "[xdraft]"),
        ("--mydraft-is-packaged", "--xdraft-is-packaged"),
        ("MYDRAFT_DEBUG", "XDRAFT_DEBUG"),
        ("mydraft 文档", "xdraft 文档"),
        ("// mydraft.cc Electron 主进程", "// xdraft Electron 主进程 (based on mydraft.cc)"),
    ],
    "src/core/utils/logger.ts": [
        ("'mydraft.logs'", "'xdraft.logs'"),
        ("'mydraft-logs.txt'", "'xdraft-logs.txt'"),
    ],
    "src/wireframes/components/actions/save-target.ts": [
        ("'mydraft.saveTarget'", "'xdraft.saveTarget'"),
    ],
    "src/wireframes/components/assets/Shapes.tsx": [
        ("'mydraft.assetGroups.collapsed'", "'xdraft.assetGroups.collapsed'"),
    ],
    "src/fonts/icon-fonts.ts": [
        ("[mydraft]", "[xdraft]"),
    ],
    "tools/icon-fonts.template.ts": [
        ("[mydraft]", "[xdraft]"),
    ],
    "vite.config.ts": [
        ("mydraft-build-stamp", "xdraft-build-stamp"),
        ("appName: 'mydraft'", "appName: 'xdraft'"),
    ],
    "一键启动.bat": [
        ("mydraft 原型工具", "xdraft 原型工具"),
    ],
    "tools/save-snapshot.sh": [
        ("mydraft 源码快照", "xdraft 源码快照"),
        ("~/mydraft/tools/", "~/xdraft/tools/"),
        ("mydraft-src-backup-", "xdraft-src-backup-"),
    ],
}

# README.electron.md: 部署文档, 全局替换本产品名, 但保留上游指涉 mydraft.cc
README_E = "README.electron.md"

def apply(path, pairs):
    p = os.path.join(ROOT, path)
    with io.open(p, "r", encoding="utf-8") as f:
        s = f.read()
    miss = []
    for old, new in pairs:
        if old in s:
            s = s.replace(old, new)
        else:
            miss.append(old)
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    return miss

def main():
    total_miss = 0
    for path, pairs in EDITS.items():
        miss = apply(path, pairs)
        if miss:
            total_miss += len(miss)
            print("MISS %-46s -> %s" % (path, miss))
        else:
            print("OK   %s" % path)

    # README.electron.md: 全局替换, 保护 mydraft.cc
    p = os.path.join(ROOT, README_E)
    with io.open(p, "r", encoding="utf-8") as f:
        s = f.read()
    s = s.replace("mydraft.cc", "\x00UPSTREAM\x00")
    s = s.replace("MYDRAFT_DEBUG", "\x00DBG\x00").replace("\x00DBG\x00", "XDRAFT_DEBUG")
    n = s.count("mydraft")
    s = s.replace("mydraft", "xdraft").replace("\x00UPSTREAM\x00", "mydraft.cc")
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print("OK   %s (全局替换 %d 处, mydraft.cc 已保留)" % (README_E, n))

    # README.md: 标题与自指
    p = os.path.join(ROOT, "README.md")
    with io.open(p, "r", encoding="utf-8") as f:
        s = f.read()
    s = s.replace("# mydraft — UOS Desktop Edition", "# xdraft — UOS Desktop Edition")
    s = s.replace("A desktop (Electron) port of [mydraft.cc]",
                  "xdraft is a desktop (Electron) port of [mydraft.cc]")
    s = s.replace("mydraft 是一款优秀的开源线框图工具",
                  "xdraft 基于优秀的开源线框图工具")
    s = s.replace("本仓库是个人维护的**桌面增强版**", "xdraft 是个人维护的**桌面增强版**")
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print("OK   README.md")

    if total_miss:
        print("\n警告: %d 处替换未命中, 请人工检查" % total_miss)
        sys.exit(1)

if __name__ == "__main__":
    main()
