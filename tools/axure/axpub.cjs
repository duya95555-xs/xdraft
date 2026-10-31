// axpub.cjs — 解析 Axure 9/10 发布产物 data.js / document.js
// 用法: node axpub.cjs <data.js> [结构|widgets|dump]
const fs = require('fs');

function load(p) {
  const src = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  let captured = null;
  const $axure = {
    loadCurrentPage: (x) => { captured = x; },
    loadDocument: (x) => { captured = x; },
    loadSitemap: (x) => { captured = x; },
  };
  const fn = new Function('$axure', src);
  fn($axure);
  return captured;
}

const file = process.argv[2];
const mode = process.argv[3] || 'structure';
const obj = load(file);
if (!obj) { console.log('NOTHING_CAPTURED'); process.exit(1); }

console.log('顶层键:', Object.keys(obj).join(', '));

function keysOf(o) { return (o && typeof o === 'object') ? Object.keys(o).join(', ') : String(o); }

if (mode === 'structure') {
  const page = obj.page || obj;
  console.log('page 键:', keysOf(page));
  const dg = page.diagram;
  console.log('diagram 类型:', Array.isArray(dg) ? 'array' : typeof dg);
  if (dg && typeof dg === 'object') console.log('diagram 键:', keysOf(dg));
  // 找对象列表
  const list = Array.isArray(dg) ? dg : (dg && (dg.objects || dg.children)) ? (dg.objects || dg.children) : null;
  if (list) {
    console.log('对象数:', list.length);
    const types = {};
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      types[n.type || '?'] = (types[n.type || '?'] || 0) + 1;
      (n.children || []).forEach(walk);
      (n.objects || []).forEach(walk);
      (n.diagram || []).forEach?.(walk);
    };
    list.forEach(walk);
    console.log('类型统计:', JSON.stringify(types, null, 1));
    console.log('\n--- 第 1 个对象完整结构(截断 2000) ---');
    console.log(JSON.stringify(list[0], null, 1).slice(0, 2000));
  }
} else if (mode === 'widgets') {
  const page = obj.page || obj;
  const dg = page.diagram;
  const list = Array.isArray(dg) ? dg : (dg && (dg.objects || dg.children)) || [];
  let n = 0;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || n > 40) return;
    const st = node.style || {};
    const loc = st.location || {};
    const size = st.size || {};
    const label = node.label || node.text || node.name || '';
    console.log(`${'  '.repeat(depth)}[${node.type || '?'}] "${String(label).slice(0,30)}" x=${loc.x} y=${loc.y} w=${size.width} h=${size.height}`);
    n++;
    (node.children || []).forEach(c => walk(c, depth + 1));
    (node.objects || []).forEach(c => walk(c, depth + 1));
  };
  list.forEach(c => walk(c, 0));
}
