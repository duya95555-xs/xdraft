# axinv.py — 盘点 cook/ 下所有 .rp：版本、页面数、字节数，并按版本分组输出
import zipfile, os, json, collections, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else r'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, '_logs', 'inventory.json')

rows = []
for dp, dn, fn in os.walk(ROOT):
    rel = os.path.relpath(dp, ROOT)
    if rel != '.' and rel.split(os.sep)[0].startswith('_'):
        continue
    for f in fn:
        if not f.lower().endswith('.rp'):
            continue
        p = os.path.join(dp, f)
        ver, pages, pbytes = '?', 0, 0
        try:
            z = zipfile.ZipFile(p)
            for n in z.namelist():
                if n.endswith('.version'):
                    ver = n[:-len('.version')]
                elif n.startswith('Page/') and n.endswith('.rppkg'):
                    pages += 1
                    pbytes += z.getinfo(n).file_size
        except Exception as e:
            ver = 'ERR:' + str(e)[:30]
        rows.append({'p': p, 'v': ver, 'pages': pages, 'pbytes': pbytes})

rows.sort(key=lambda r: (r['v'], r['p']))
maj = collections.Counter(r['v'].split('.')[0] for r in rows)
print('总 .rp 数:', len(rows))
for k, v in sorted(maj.items()):
    print('  RP%-4s %d 个' % (k, v))

old = [r for r in rows if r['v'].split('.')[0] not in ('7', '8')]
print('\n非 RP7/8（转换风险）: %d' % len(old))
for r in old:
    print('  %-10s pages=%-3d bytes=%-9d %s' % (r['v'], r['pages'], r['pbytes'], r['p']))

c = collections.Counter(os.path.relpath(r['p'], ROOT).split(os.sep)[0] for r in rows)
print('\n按目录:')
for k, v in sorted(c.items()):
    print('  %s: %d' % (k, v))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(rows, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('\n→', OUT)
