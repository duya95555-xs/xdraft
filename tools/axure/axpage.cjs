// axpage.cjs — 解析 Axure 发布产物（页面 HTML + CSS）→ 带绝对坐标与文本的结构化 JSON
//
// 为什么不用 data.js：data.js 里没有控件文本（textBox 只有 placeholderText），
// 而 HTML 里 uN 与 uN_text 是父子关系，几何与文本天然对齐。
// 几何来源：styles.css 的 #uN { left/top/width/height }，按 DOM 层级累加 absolute 祖先偏移。
//
// 用法:
//   node axpage.cjs <页面.html>                 打印控件摘要
//   node axpage.cjs <页面.html> --json out.json 输出 JSON
//   node axpage.cjs <项目目录> --all --out <dir> 解析整个项目（自动跳过壳页面）
const fs = require('fs');
const path = require('path');

const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'area', 'base', 'col', 'source']);
const SKIP_FILES = new Set(['index.html', 'start.html', 'start_c_1.html', 'start_with_pages.html']);

// ── 极简 HTML 解析（Axure 产物是规整 XHTML，无需完整 DOM）────────────────────
function parseHtml(html) {
  // 去掉 head 与 script，避免 script 里的 '<' 干扰标签扫描
  let body = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;

  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const t = body.slice(i, lt);
      if (t.trim()) stack[stack.length - 1].text += t;
    }

    if (body.startsWith('<!--', lt)) {
      const end = body.indexOf('-->', lt);
      if (end < 0) break;
      stack[stack.length - 1].children.push({
        tag: '#comment', attrs: {}, children: [], text: body.slice(lt + 4, end).trim(),
      });
      i = end + 3;
      continue;
    }

    const gt = body.indexOf('>', lt);
    if (gt < 0) break;
    let raw = body.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('/')) { if (stack.length > 1) stack.pop(); continue; }

    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1);

    const sp = raw.search(/\s/);
    const tag = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase();
    const attrs = {};
    if (sp >= 0) {
      raw.slice(sp).replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (_m, k, v) => { attrs[k] = v; return _m; });
    }

    const node = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID.has(tag)) stack.push(node);
  }
  return root;
}

// ── CSS：只提取 #id { left/top/width/height/display/visibility/position } ────
function parseCss(css) {
  const rules = {};
  const pat = /#([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g;
  let m;
  while ((m = pat.exec(css)) !== null) {
    const id = m[1];
    const g = rules[id] || (rules[id] = {});
    for (const p of ['left', 'top', 'width', 'height', 'display', 'visibility', 'position']) {
      const mm = new RegExp('(?:^|[;\\s])' + p + '\\s*:\\s*([^;]+)').exec(m[2]);
      if (mm) g[p] = mm[1].trim();
    }
  }
  return rules;
}
const px = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function collectText(node) {
  let s = node.text || '';
  for (const c of node.children) s += collectText(c);
  return s.replace(/\s+/g, ' ').trim();
}

function findById(node, id) {
  if (node.attrs && node.attrs.id === id) return node;
  for (const c of node.children) { const r = findById(c, id); if (r) return r; }
  return null;
}

// ── 主解析：页面 HTML + CSS → widgets ────────────────────────────────────────
function parsePage(htmlPath) {
  const dir = path.dirname(htmlPath);
  const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
  const pageName = path.basename(htmlPath, '.html');
  const doc = parseHtml(html);

  // 收集本地 CSS（页面级 + 全局），后面的覆盖前面的
  let css = '';
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
    const p = path.join(dir, decodeURIComponent(m[1]));
    if (fs.existsSync(p)) css += fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') + '\n';
  }
  const rules = parseCss(css);

  // 页面尺寸
  const bodyRule = rules.__none__;
  let pageW = null, pageH = null;
  const bodyM = /body\s*\{([^}]*)\}/.exec(css);
  if (bodyM) {
    const w = px((/width\s*:\s*([^;]+)/.exec(bodyM[1]) || [])[1]);
    if (w) pageW = w;
  }

  const widgets = [];
  const stats = { total: 0, hidden: 0, noGeom: 0 };

  // 遍历 DOM，维护绝对定位帧
  const walk = (node, frameX, frameY, depth, hiddenChain, pendingComment) => {
    for (const child of node.children) {
      if (child.tag === '#comment') { pendingComment = child.text; continue; }

      const id = child.attrs.id || '';
      const isWidget = /^u\d+$/.test(id);
      const r = rules[id] || {};
      const inlineStyle = child.attrs.style || '';

      const cssHidden = r.display === 'none' || r.visibility === 'hidden';
      const inlineHidden = /display\s*:\s*none/.test(inlineStyle) || /visibility\s*:\s*hidden/.test(inlineStyle);
      const selfHidden = cssHidden || inlineHidden;
      const hidden = hiddenChain || selfHidden;

      // 绝对定位帧：position:absolute 的元素成为新的坐标系原点
      let nx = frameX, ny = frameY;
      const abs = r.position === 'absolute' || /position\s*:\s*absolute/.test(inlineStyle);
      if (abs) {
        nx = frameX + (px(r.left) ?? 0);
        ny = frameY + (px(r.top) ?? 0);
      }

      if (isWidget) {
        stats.total++;
        const w = px(r.width), h = px(r.height);
        if (w == null || h == null) stats.noGeom++;
        if (hidden) stats.hidden++;

        // 类型：注释 <!-- 名称 (类型) --> 给控件类型；class 的 _xxx 给样式名
        // 例：一个矩形套了标题样式 → type=矩形, styleName=一级标题
        let type = '';
        if (pendingComment) {
          const cm = /\(([^)]+)\)\s*$/.exec(pendingComment);
          if (cm) type = cm[1];
        }
        // 注意 _ 前须为空格或串首，否则会误命中 class="ax_default" 里的 default
        const cls = child.attrs.class || '';
        const styleNames = [...cls.matchAll(/(?:^|\s)_([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)/g)]
          .map((m) => m[1]).filter((s) => s !== 'default');
        const styleName = styleNames[0] || '';
        if (!type) type = styleName;

        // 文本：uN_text 后代 / uN_input 的 value 或 placeholder
        let text = '';
        const tNode = findById(child, id + '_text');
        if (tNode) text = collectText(tNode);
        const iNode = findById(child, id + '_input');
        if (!text && iNode) text = (iNode.attrs.value || iNode.attrs.placeholder || '').trim();

        widgets.push({
          id, type, styleName,
          label: child.attrs['data-label'] || '',
          x: nx, y: ny, w, h,
          text,
          visible: !hidden,
          depth,
        });
      }

      walk(child, nx, ny, depth + 1, hidden, null);
      pendingComment = null;
    }
  };

  const base = findById(doc, 'base') || doc;
  walk(base, 0, 0, 0, false, null);

  // 页面尺寸兜底：取所有控件的包围盒
  const vis = widgets.filter((w) => w.visible && w.w != null && w.h != null);
  const maxX = Math.max(0, ...vis.map((w) => w.x + w.w));
  const maxY = Math.max(0, ...vis.map((w) => w.y + w.h));

  return {
    page: pageName,
    source: htmlPath,
    size: { w: pageW || maxX, h: pageH || maxY },
    bounds: { x: 0, y: 0, w: maxX, h: maxY },
    widgets,
    stats,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const target = process.argv[2];
const args = process.argv.slice(3);
const jsonIdx = args.indexOf('--json');
const outDirIdx = args.indexOf('--out');

if (!target) {
  console.log('用法: node axpage.cjs <页面.html|项目目录> [--json out.json] [--out dir] [--quiet]');
  process.exit(1);
}

// 容错：传入目录时自动按整项目解析（无需显式 --all）
let isDir = false;
try { isDir = fs.statSync(target).isDirectory(); } catch { /* 不存在则按文件处理，后面自然报错 */ }
const allMode = isDir || args.includes('--all');
const quiet = args.includes('--quiet');

function show(res) {
  console.log(`\n═══ ${res.page} ═══  控件 ${res.widgets.length}（隐藏 ${res.stats.hidden}，无尺寸 ${res.stats.noGeom}）`);
  for (const w of res.widgets) {
    const flag = w.visible ? ' ' : '✗';
    console.log(
      `${flag} ${w.id.padEnd(5)} [${(w.type || '?').padEnd(6)}${w.styleName && w.styleName !== w.type ? '/' + w.styleName : ''}] `.padEnd(28) +
      `x=${String(w.x).padStart(4)} y=${String(w.y).padStart(4)} ` +
      `w=${String(w.w).padStart(4)} h=${String(w.h).padStart(4)} ` +
      `${w.label ? '#' + w.label + ' ' : ''}${w.text ? '"' + w.text.slice(0, 24) + '"' : ''}`
    );
  }
}

if (allMode) {
  const files = fs.readdirSync(target)
    .filter((f) => f.endsWith('.html') && !SKIP_FILES.has(f))
    .sort();
  const results = [];
  for (const f of files) {
    try {
      const r = parsePage(path.join(target, f));
      results.push(r);
      if (!quiet) show(r);
    } catch (e) {
      console.log(`\n[跳过] ${f}: ${e.message}`);
    }
  }
  const project = path.basename(target);
  const summary = {
    project,
    source: target,
    pages: results.length,
    widgetCount: results.reduce((a, r) => a + r.widgets.length, 0),
    pageList: results.map((r) => ({
      page: r.page,
      size: r.size,
      widgets: r.widgets.length,
      hidden: r.stats.hidden,
      noGeom: r.stats.noGeom,
    })),
    data: results,
  };
  const out = outDirIdx >= 0 ? args[outDirIdx + 1] : null;
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const r of results) {
      fs.writeFileSync(path.join(out, r.page + '.json'), JSON.stringify(r, null, 1), 'utf8');
    }
    console.log(`\n已输出 ${results.length} 个页面 JSON → ${out}`);
  }
  if (jsonIdx >= 0) {
    const p = args[jsonIdx + 1];
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(summary), 'utf8');
    console.log(`\n→ ${p}`);
  }
  console.log(`\n合计: ${results.length} 页, ${summary.widgetCount} 个控件`);
} else {
  const res = parsePage(target);
  show(res);
  if (jsonIdx >= 0) {
    fs.writeFileSync(args[jsonIdx + 1], JSON.stringify(res, null, 1), 'utf8');
    console.log(`\n→ ${args[jsonIdx + 1]}`);
  }
}
