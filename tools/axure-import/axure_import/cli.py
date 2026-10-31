"""
CLI: Axure .rp 解析与 import report 生成 (M1)

用法:
  python -m axure_import.cli dump <file.rp> [--page N]   # 导出控件树 JSON
  python -m axure_import.cli report <dir|file.rp ...>    # 批量 import report

输出:
  dump   -> <stdout 或 --out 路径> 每页: 页名/控件类型/文本/几何候选
  report -> JSON: 文件数/页面数/控件类型 TOP/未识别类型统计
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from .extract import summarize_pages
from .rpformat import open_rp

# 已知 Axure 控件类型白名单(用于 report 的"未识别"统计,随逆向迭代补充)
KNOWN_TYPES = {
    'DynamicPanel', 'VectorShape', 'RichTextPanel', 'ImageBox', 'Repeater',
    'ButtonShape', 'TextPanel', 'TextField', 'TextArea', 'Droplist', 'ListBox',
    'Checkbox', 'RadioButton', 'DataTable', 'Tree', 'InlineFrame', 'Snapshot',
    'FlowShape', 'HotSpot', 'Group', 'Connector',
    # M1 批量报告实测补充(37 个真实文件)
    'ReferenceDiagramObject', 'Layer', 'ImageMapRegion', 'TextBox', 'Paragraph',
    'HorizontalLine', 'Table', 'TableCell', 'ComboBox', 'VerticalLine',
    'Hyperlink', 'Button',
}


def cmd_dump(args):
    entries = open_rp(args.rp)
    pages, _ = summarize_pages(entries)
    out = {
        'source': str(Path(args.rp).name),
        'page_count': len(pages),
        'pages': pages,
    }
    text = json.dumps(out, ensure_ascii=False, indent=2, default=list)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
        print(f'written: {args.out} ({len(pages)} pages)', file=sys.stderr)
    else:
        print(text)


def cmd_report(args):
    targets = []
    for a in args.targets:
        p = Path(a)
        if p.is_dir():
            targets.extend(sorted(p.glob('*.rp')))
        else:
            targets.append(p)

    files = []
    grand = Counter()
    for rp in targets:
        try:
            entries = open_rp(str(rp))
            pages, type_counter = summarize_pages(entries)
            grand.update(type_counter)
            files.append({
                'file': rp.name,
                'size_mb': round(rp.stat().st_size / 1e6, 2),
                'pages': len(pages),
                'masters': sum(1 for e in entries if e.kind == 'Master'),
                'widget_types': dict(type_counter),
                'page_names': [p['page_name'] for p in pages if p['page_name']],
            })
        except Exception as e:  # noqa: BLE001 - 批量场景单文件失败不中断
            files.append({'file': rp.name, 'error': str(e)})

    known = {k: v for k, v in grand.items() if k in KNOWN_TYPES}
    unknown = {k: v for k, v in grand.items() if k not in KNOWN_TYPES}
    report = {
        'generated': 'axure-import M1',
        'file_count': len(targets),
        'widget_type_top': grand.most_common(30),
        'known_total': sum(known.values()),
        'unknown_types': dict(sorted(unknown.items(), key=lambda kv: -kv[1])),
        'files': files,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding='utf-8')
        print(f'report written: {args.out}', file=sys.stderr)
    print(text)


def main(argv=None):
    ap = argparse.ArgumentParser(prog='axure-import')
    sub = ap.add_subparsers(dest='cmd', required=True)

    d = sub.add_parser('dump', help='导出单文件控件树 JSON')
    d.add_argument('rp')
    d.add_argument('--out')
    d.set_defaults(fn=cmd_dump)

    r = sub.add_parser('report', help='批量 import report')
    r.add_argument('targets', nargs='+')
    r.add_argument('--out')
    r.set_defaults(fn=cmd_report)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == '__main__':
    main()
