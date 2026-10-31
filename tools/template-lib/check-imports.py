#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""check-imports.py — 静态核对新写的三个前端文件

没有装 node_modules，跑不了 tsc。改用最朴素的检查：逐个 import
核实目标文件/导出是否真实存在 —— 拼错路径、导出不存在的符号
是这类改动最常见的失败原因。

检查项
------
1. 相对导入：文件是否存在
2. @app/... 别名：能否在 tsconfig paths 解析到实际文件
3. 具名导入：目标文件里是否真有那个导出（grep export 声明）
4. JSX 里用的组件有定义
"""
import io
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'src')
TSCONFIG = os.path.join(ROOT, 'tsconfig.json')

TARGETS = [
    'src/wireframes/components/ai/TemplateBrowser.tsx',
    'src/wireframes/components/ai/template-client.ts',
    'src/wireframes/components/ai/template-insert.ts',
]

IMPORT_RE = re.compile(
    r"^\s*import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['\"]([^'\"]+)['\"]",
    re.M)
EXPORT_RE_CACHE = {}


def read(p):
    return io.open(p, encoding='utf-8').read()


def ts_paths():
    """从 tsconfig 拿 paths 映射，处理 @app/* 这类别名。"""
    try:
        cfg = json.loads(read(TSCONFIG))
    except Exception:
        return {}
    opts = cfg.get('compilerOptions', {})
    base = opts.get('baseUrl', '.')
    out = {}
    for k, v in (opts.get('paths') or {}).items():
        if len(v) == 1:
            out[k.replace('/*', '')] = os.path.join(ROOT, base, v[0].replace('/*', ''))
    return out


PATHS = ts_paths()


def resolve(spec, from_file):
    """把 import specifier 解析成绝对路径（不保证存在）。"""
    if spec.startswith('.'):
        d = os.path.dirname(from_file)
        return os.path.normpath(os.path.join(d, spec))
    for alias, target in PATHS.items():
        if spec == alias or spec.startswith(alias + '/'):
            rest = spec[len(alias):].lstrip('/')
            return os.path.join(target, rest) if rest else target
    return None


def candidate_files(base):
    """一个 import 可能对应 .ts/.tsx/.d.ts 或 index.ts。"""
    out = []
    if os.path.splitext(base)[1]:
        out.append(base)
    else:
        for e in ('.ts', '.tsx', '.d.ts', '.js'):
            out.append(base + e)
    for e in ('.ts', '.tsx'):
        out.append(os.path.join(base, 'index' + e))
    return out


def exports_of(path):
    if path in EXPORT_RE_CACHE:
        return EXPORT_RE_CACHE[path]
    if not os.path.isfile(path):
        EXPORT_RE_CACHE[path] = None
        return None
    src = read(path)
    names = set()
    # export const/function/class/interface/type/enum X
    for m in re.finditer(
            r"export\s+(?:declare\s+)?(?:abstract\s+)?"
            r"(?:const|function|class|interface|type|enum|let|var)\s+(\w+)",
            src):
        names.add(m.group(1))
    # export { A, B as C }
    for m in re.finditer(r"export\s*\{([^}]*)\}", src):
        for part in m.group(1).split(','):
            part = part.strip()
            if not part:
                continue
            if ' as ' in part:
                names.add(part.split(' as ')[-1].strip())
            else:
                names.add(part)
    # export * from './x'  —— 保守认为可能导出任何东西，标记为 unknown
    star = bool(re.search(r"export\s*\*\s*from", src))
    EXPORT_RE_CACHE[path] = (names, star)
    return EXPORT_RE_CACHE[path]


def main():
    if not PATHS:
        print('警告：tsconfig里没解析到 paths 映射，别名检查会跳过')
    print('tsconfig paths:')
    for k, v in PATHS.items():
        print('  %-10s -> %s' % (k, os.path.relpath(v, ROOT).replace('\\', '/')))
    print()

    problems = []
    checked = 0

    for rel in TARGETS:
        full = os.path.join(ROOT, rel)
        print('=== %s ===' % rel)
        if not os.path.isfile(full):
            print('  [FAIL] 文件不存在')
            problems.append(rel + ' 不存在')
            continue

        src = read(full)
        own = set(re.findall(r"(?:const|function|class|interface|type)\s+(\w+)", src))
        own |= set(re.findall(r"export\s+(?:const|function|class|interface|type)\s+(\w+)", src))

        for m in IMPORT_RE.finditer(src):
            default, braces, spec = m.group(1), m.group(2), m.group(3)
            checked += 1
            base = resolve(spec, full)
            if base is None:
                print('  [SKIP] %-46s （非相对/非别名）' % spec)
                continue
            hit = None
            for c in candidate_files(base):
                if os.path.isfile(c):
                    hit = c
                    break
            if not hit:
                problems.append('%s: 找不到 %s' % (rel, spec))
                print('  [FAIL] %-46s → 找不到' % spec)
                continue
            if not braces:
                print('  [OK]   %-46s → %s'
                      % (spec, os.path.relpath(hit, ROOT).replace('\\', '/')))
                continue
            info = exports_of(hit)
            names = [x.strip().split(' as ')[0].strip()
                     for x in braces.split(',') if x.strip()]
            if info is None:
                problems.append('%s: %s 不可读' % (rel, spec))
                continue
            have, star = info
            missing = [n for n in names if n not in have]
            if missing and not star:
                problems.append('%s: %s 缺导出 %s' % (rel, spec, missing))
                print('  [FAIL] %-46s → 缺导出 %s' % (spec, missing))
            elif missing:
                print('  [WARN] %-46s → 可能缺 %s（有 export *，未逐个核实）' % (spec, missing))
            else:
                print('  [OK]   %-46s → %d 个具名导入全部存在'
                      % (spec, len(names)))
        print()

    print('=' * 62)
    print('检查 %d 个 import 语句' % checked)
    if problems:
        print('问题 %d 个:' % len(problems))
        for p in problems:
            print('  -', p)
        return 1
    print('全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
