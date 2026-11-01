#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""gen-toc.py — 生成项目目录索引

扫描 1.0.1/ 的关键目录，产出一份带说明的 Markdown 目录，
让人不翻代码也能知道「东西在哪、能干什么、当前什么状态」。

刻意只收关键目录，不做全量文件列举 —— 全量 3000+ 文件没人会读。
"""
import json
import os
import re
import subprocess
import sys
import time

# 本文件在 1.0.1/tools/ 下，上溯一级即 1.0.1/
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'docs', '项目目录.md')

# 目录说明：(相对路径, 一句话作用, 关键文件或备注)
DIRS = [
    ('src', '前端源码（React + PixiJS + SVG.js + antd）',
     ['wireframes/model/serializer.ts     模型序列化（插件查不到 renderer 时计 skippedItems）',
      'wireframes/shapes/index.ts          38 个内置图形的注册处（RENDERER_NAMES 权威名单来源）',
      'wireframes/components/ai/            AI 上下文集成（会读取 skippedItems 并提示用户）',
      'utils/loading.ts                 加载流程，同样读取 skippedItems']),
    ('tools/axure', 'Axure 批量发布链路（F8 入口 → Use Default → 回车）',
     ['axrun.py           批量主体。--from-list 走清单；--ax 8 选版本；--skip-existing',
      'axauto.py          GUI 原语：窗口枚举/点击/hotkey/type_text/vk_of（含 f8）',
      'axshot.py          纯 ctypes 写 PNG，无 PIL 依赖',
      'axpath.py          读 settings.8.0.bin 里的发布路径',
      'axsetpub.py        ★ 不要用 —— 改配置会让 Axure 启动异常']),
    ('tools/axure-html', 'Axure HTML → mydraft 转换链路（M1p + M2）',
     ['parse-datajs.js      求值 data.js',
      'extract-project.js   M1p 控件树（几何 + 类型 + 递归 + 坐标累加）',
      'extract-text.js      文本提取（uXXX_text + data-label，按 objectPaths join）',
      'expand-repeater.js   repeater 展开（读 Axure 渲染结果，见上下文压缩 §5.3）',
      'convert-mydraft.js   M2 → mydraft JSON，含映射表自检 assertRendererNames()',
      'batch-convert.py     全量驱动（失败隔离 + 断点续跑 + 每 10 个落索引）',
      'page-stats.py        页面级可用性统计 + 生成 page-index.json']),
    ('tools/axure-import', 'M1 二进制解析路线（已被 M1p HTML 路线取代，保留作参考）', []),
    ('tools', '其他工具',
     ['local-server.mjs     本地图形存储 API（8901 端口，提供 /api/config 与 /api/diagrams）']),
    ('docs', '项目文档',
     ['README.md            索引 + 推翻链图 + 工程实际进度 + 素材口径',
      '会话上下文压缩-2026-10-03.md   ★ 换会话时先读这份',
      '文档评审-2026-10-02.md         文档治理评审（含已修与待修项）',
      '方案-Axure原型转RAG模板库.md   总体方案（§5/§6.1/§7.1/§9/§12 需重写）',
      'Axure文件格式实测报告.md       实测报告 v2',
      'Axure格式升级实测报告.md       🔴 §5/§6 已废弃',
      'Axure可编程入口分析.md         PE 头 + 字符串表扫描']),
    ('tests', '测试',
     ['editor-serialization.spec.ts   覆盖 skippedItems 机制']),
    ('cook', 'Axure 素材（1.7 GB，已 gitignore）',
     ['_pilot/    8 个按版本抽出的样本',
      '_html/     早期发布产物（已迁至 Documents\\Axure\\HTML）',
      '_logs/     批量报告与清单']),
    ('axure-src', 'Axure 素材副本（已 gitignore，仅保留两份 README）', []),
    ('templates', '★ M3 模板库产物（data/ 已 gitignore）',
     ['index.json       项目级汇总',
      'page-index.json  页面级索引 —— M3 检索的直接输入',
      'data/<工程名>/   tree.json + texts.json + diagram.json']),
    ('out', '中间产物与统计报表', []),
    ('src/wireframes/components/templates', '模板组件（目录尚未创建，M3 时需新建）', []),
]

KEY_FILES = [
    ('package.json', '依赖与脚本（homepage=mydraft.cc 说明是上游 fork）'),
    ('vite.config.ts', '构建配置。已补/api/config 代理（local-server.mjs:97 有这条路由）'),
    ('README.electron.md', 'Electron 部署手册，质量很高（file:// 白屏、字体阻塞、arm64 依赖）'),
    ('一键启动.bat', 'Windows 启动脚本'),
    ('tsconfig.json / vitest.config.ts', 'TS 与测试配置'),
]


def dir_size(p):
    """目录体积（字节）。跳junction 以免死循环。"""
    total = 0
    for root, dirs, files in os.walk(p, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def count_files(p):
    n = 0
    for _, _, files in os.walk(p, followlinks=False):
        n += len(files)
    return n


def main():
    lines = []
    W = lines.append

    W('# 项目目录')
    W('')
    W('> 生成时间：%s' % time.strftime('%Y-%m-%d %H:%M'))
    W('> 根目录：`1.0.1/`')
    W('> 用途：快速定位「东西在哪、能干什么」。不替代读代码。')
    W('')

    # ── 现状速览 ──
    W('## 现状速览')
    W('')
    W('| 环节 | 状态 | 数字 |')
    W('|---|---|---|')
    W('| Axure 发布 | ✅ 完成 | 163/163 项目，2235 页，3.2 小时 |')
    W('| M1p 控件树 | ✅ 完成 | 167 项目，93,171 控件 |')
    W('| M2 mydraft 转换 | ✅ 完成 | 145,202 图元（三轮全量，零失败） |')
    W('| repeater 展开 | ✅ 完成 | 952 个 / 7,260 行，展开成功率 100% |')
    W('| 页面可用性 | ✅ 完成 | 可用 1511 页(68.3%) / 77,021 条中文 |')
    W('| M3 模板库 | ⬜ 未开始 | 索引已有：`templates/page-index.json` |')
    W('| M4 检索 | ⬜ 未开始 | 评测集未建 |')
    W('')

    # ── 数据流 ──
    W('## 数据流')
    W('')
    W('```')
    W('cook/**/*.rp')
    W('   │  tools/axure/axrun.py                F8 → Use Default → 回车')
    W('   ▼')
    W(r'C:\Users\xiaos\Documents\Axure\HTML\<工程名>\      ← 不搬运，产物留原地')
    W('   │  tools/axure-html/batch-convert.py')
    W('   ├── extract-project.js                → tree.json    几何 + 类型')
    W('   ├── extract-text.js                   → texts.json   中文文本')
    W('   └── convert-mydraft.js（内含 expand-repeater.js）')
    W('                                          → diagram.json mydraft JSON')
    W('   │  page-stats.py')
    W('   ▼')
    W('templates/  index.json + page-index.json + data/<工程名>/*.json')
    W('   │')
    W('   ▼')
    W('M3 模板库 → M4 检索')
    W('```')
    W('')

    # ── 目录结构 ──
    W('## 目录结构')
    W('')
    for rel, desc, files in DIRS:
        full = os.path.join(ROOT, rel)
        exists = os.path.isdir(full)
        mark = '' if exists else '  ⚠️ **目录不存在**'
        W('### `%s/`%s' % (rel, mark))
        W('')
        W(desc)
        W('')
        if exists:
            n = count_files(full)
            sz = dir_size(full)
            W('*%d 个文件，%.1f MB*' % (n, sz / 1048576.0))
            W('')
        if files:
            W('| 文件 | 说明 |')
            W('|---|---|')
            for item in files:
                # 兼容两种写法：['file  说明'] 或 [('file', '说明')]
                if isinstance(item, (list, tuple)) and len(item) == 2:
                    f, d = item
                else:
                    # 单个字符串：用 2 个以上空格 split（对齐用）
                    parts = re.split(r'\s{2,}', str(item), maxsplit=1)
                    f = parts[0].strip()
                    d = parts[1].strip() if len(parts) > 1 else ''
                W('| `%s` | %s |' % (f, d))
            W('')

    # ── 关键根文件 ──
    W('### 根目录文件')
    W('')
    W('| 文件 | 说明 |')
    W('|---|---|')
    for f, d in KEY_FILES:
        mark = '' if os.path.isfile(os.path.join(ROOT, f)) else ' ⚠️'
        W('| `%s`%s | %s |' % (f, mark, d))
    W('')

    # ── 外部依赖 ──
    W('## 外部依赖（不在本仓库）')
    W('')
    W('| 位置 | 内容 |')
    W('|---|---|')
    W('| `C:\\Users\\xiaos\\Documents\\Axure\\HTML\\` | 发布产物，转换链路的输入 |')
    W('| `D:\\Program Files (x86)\\Axure\\Axure RP 8\\` | Axure RP 8（第三方授权 www.jb51.net） |')
    W('| `%LOCALAPPDATA%\\Axure\\settings.8.0.bin` | Axure 配置（改它会让 Axure 启动异常） |')
    W('| `cook/` 下三个压缩包 | 素材原件，共 830 MB（已 gitignore） |')
    W('')

    # ── git 状态 ──
    try:
        r = subprocess.run(['git', 'log', '--oneline', '-1'], cwd=ROOT,
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=20)
        if r.returncode == 0:
            W('## git')
            W('')
            W('最新提交：`%s`' % r.stdout.strip())
            W('')
    except Exception:
        pass

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('已生成: %s (%d 行)' % (OUT, len(lines)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
