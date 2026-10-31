/*
 * mydraft.cc 本地文档存储服务器(零依赖,Node 内置模块)。
 *
 * 为什么需要它:
 *   浏览器模式下"保存到本机"走 fetch('/api/diagrams/<name>'),由 vite dev proxy
 *   转发到 127.0.0.1:8901(api.ts 注释里的 server.py)。zip 包里没有 server.py,
 *   所以浏览器里保存必然 500。本文件是它的 Node 替代品。
 *
 * 用法:
 *   node tools/local-server.mjs          # 监听 127.0.0.1:8901
 *   默认存储位置: <项目根>/diagrams/<name>.json
 *   可配置:     应用内"保存"对话框里改保存目录(写入 local-server.config.json),
 *               或直接编辑该配置文件里的 saveDir 字段后重启本服务器。
 *
 * 与 vite proxy 的对应关系(vite.config.ts):
 *   PUT    /api/diagrams/:name   → 保存,响应 { file, bytes }
 *   GET    /api/diagrams/:name   → 读取(浏览器模式当前未用,备后续)
 *   GET    /api/diagrams         → 列表(同上)
 *   GET    /api/config           → 当前保存目录 { saveDir }
 *   POST   /api/config           → 修改保存目录 { saveDir },立即生效并持久化
 *
 * 模板库(Axure RAG,2026-10-03 新增,方案 §9):
 *   GET    /api/templates?domain=&tag=&q=&limit=
 *                               → 列表(q 非空时走检索,否则按图元数倒序)
 *   POST   /api/templates/search → 检索 body {query,limit} → top-N 卡片
 *   GET    /api/templates/:id          → 单模板 meta
 *   GET    /api/templates/:id/diagram  → 单页 mydraft JSON(插入画布用)
 *   GET    /api/templates/:id/thumb     → 缩略图 PNG
 *
 *   方案 §9 原本要另起 5301 端口的 template-server;这里挂在 8901 上,
 *   复用现成的 vite proxy —— 少一个进程、少一层跨域。
 *   索引懒加载 + 按 catalog.json 的 mtime 失效,转换产物重跑后无需重启。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplateIndex, toCard } from './template-lib/template-search.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(PROJECT_ROOT, 'diagrams');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'local-server.config.json');
const PORT = 8901;
const HOST = '127.0.0.1';

// 当前生效的保存目录:配置文件里的 saveDir 优先,否则用默认 diagrams/。
// 每次请求现读配置 —— 应用内改路径后立即生效,无需重启服务器。
function getSaveDir() {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

        if (typeof config.saveDir === 'string' && config.saveDir.trim()) {
            return path.resolve(config.saveDir.trim());
        }
    } catch {
        // 配置文件不存在或损坏:退回默认目录。
    }

    return DEFAULT_DIR;
}

function setSaveDir(dir) {
    const resolved = path.resolve(dir);

    // 目录不存在就创建;创建失败(盘符不存在/无权限)直接抛给调用方。
    fs.mkdirSync(resolved, { recursive: true });

    let config = {};

    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
        // 忽略旧配置损坏,直接覆盖。
    }

    config.saveDir = resolved;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    return resolved;
}

// 文件名只允许字母数字、中文、-_.,其余一律替换,拒绝路径穿越。
function sanitize(name) {
    return decodeURIComponent(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\.\.+/g, '_')
        .slice(0, 120) || 'untitled';
}

function send(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// ── 模板库（Axure RAG）────────────────────────────────────────────────────
// 索引构建较慢（1511 模板 × 6 字段），所以懒加载 + 缓存：
// 首次请求几百毫秒，之后直接命中。目录 mtime 变化时自动重建
// （转换产物重跑后不用手动重启服务）。
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
let tplIndex = null;
let tplIndexMtime = 0;

function getTemplateIndex() {
    const catPath = path.join(TEMPLATES_DIR, 'catalog.json');

    if (!fs.existsSync(catPath)) return null;

    const mtime = fs.statSync(catPath).mtimeMs;

    if (tplIndex && tplIndexMtime === mtime) return tplIndex;

    tplIndex = loadTemplateIndex(TEMPLATES_DIR);
    tplIndexMtime = mtime;
    console.log(`[templates] 索引已构建: ${tplIndex.size} 个模板`);
    return tplIndex;
}

function sendFile(res, file, contentType) {
    if (!fs.existsSync(file)) {
        return send(res, 404, { error: 'not found' });
    }
    const buf = fs.readFileSync(file);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buf.length,
        // 开发期不缓存，改完模板刷新即可见
        'Cache-Control': 'no-cache',
    });
    res.end(buf);
}

async function handleTemplates(req, res, url) {
    const idx = getTemplateIndex();

    if (!idx) {
        return send(res, 503, {
            error: '模板库未初始化',
            hint: '先跑 tools/axure-html/batch-convert.py 与 tools/template-lib/build-library.py',
        });
    }

    // GET /api/templates?domain=&tag=&q=&limit=
    if (url.pathname === '/api/templates') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

        const domain = url.searchParams.get('domain') || '';
        const tag = url.searchParams.get('tag') || '';
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '60', 10) || 60, 500);

        let rows;

        if (q) {
            rows = idx.search(q, limit).map(r => toCard(r.tpl, r.score, TEMPLATES_DIR));
        } else {
            // 无查询词时按图元数倒序 —— 复杂页面更有参考价值
            const all = idx.tpls
                .filter(t => (!domain || t.domain === domain)
                    && (!tag || t.tags.split(' ').includes(tag)))
                .sort((a, b) => b.itemCount - a.itemCount)
                .slice(0, limit);
            rows = all.map(t => toCard(t, 0, TEMPLATES_DIR));
        }

        return send(res, 200, {
            total: rows.length,
            indexed: idx.size,
            domains: [...new Set(idx.tpls.map(t => t.domain))].filter(Boolean).sort(),
            tags: [...new Set(idx.tpls.flatMap(t => t.tags.split(' ')).filter(Boolean))].sort(),
            templates: rows,
        });
    }

    // POST /api/templates/search   body: {query, limit}
    if (url.pathname === '/api/templates/search') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
        try {
            const body = JSON.parse((await readBody(req)).toString('utf-8') || '{}');
            const query = String(body.query || '').trim();
            const limit = Math.min(parseInt(body.limit || '8', 10) || 8, 50);
            if (!query) return send(res, 400, { error: 'query required' });
            const rows = idx.search(query, limit).map(r => toCard(r.tpl, r.score, TEMPLATES_DIR));
            return send(res, 200, { query, total: rows.length, templates: rows });
        } catch (e) {
            return send(res, 400, { error: String(e.message || e) });
        }
    }

    // GET /api/templates/:id          单模板元数据
    // GET /api/templates/:id/diagram  单页 mydraft JSON
    // GET /api/templates/:id/thumb     缩略图 PNG
    const m = /^\/api\/templates\/([\w-]+)(?:\/(diagram|thumb|meta))?$/.exec(url.pathname);
    if (m) {
        const [, id, kind] = m;
        if (!/^tpl_[0-9a-f]+$/.test(id)) return send(res, 400, { error: 'bad id' });

        if (!kind || kind === 'meta') {
            const f = path.join(TEMPLATES_DIR, 'meta', `${id}.json`);
            if (!fs.existsSync(f)) return send(res, 404, { error: 'no such template' });
            return sendFile(res, f, 'application/json; charset=utf-8');
        }
        if (kind === 'diagram') {
            const f = path.join(TEMPLATES_DIR, 'diagram', `${id}.json`);
            if (!fs.existsSync(f)) return send(res, 404, { error: 'no diagram' });
            return sendFile(res, f, 'application/json; charset=utf-8');
        }
        if (kind === 'thumb') {
            const f = path.join(TEMPLATES_DIR, 'thumbs', `${id}.png`);
            return sendFile(res, f, 'image/png');
        }
    }

    return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);

    // ── 保存目录配置 ────────────────────────────────────────────────────────
    if (url.pathname === '/api/config') {
        if (req.method === 'GET') {
            return send(res, 200, { saveDir: getSaveDir() });
        }

        if (req.method === 'POST') {
            try {
                const body = JSON.parse((await readBody(req)).toString('utf-8') || '{}');

                if (typeof body.saveDir !== 'string' || !body.saveDir.trim()) {
                    return send(res, 400, { error: 'saveDir required' });
                }

                const resolved = setSaveDir(body.saveDir.trim());
                console.log(`[config] saveDir -> ${resolved}`);
                return send(res, 200, { saveDir: resolved });
            } catch (e) {
                console.error(`[config:error] ${e.message}`);
                return send(res, 400, { error: String(e.message || e) });
            }
        }

        return send(res, 405, { error: 'method not allowed' });
    }

    // ── 模板库（Axure RAG）──────────────────────────────────────────────────
    // 方案 §9 原本要另起一个 5301 端口的 template-server；这里挂到 8901，
    // 复用现成的 vite proxy，少一个进程少一层跨域。
    if (url.pathname.startsWith('/api/templates')) {
        return handleTemplates(req, res, url);
    }

    // ── 文档读写 ────────────────────────────────────────────────────────────
    const match = /^\/api\/diagrams\/?([^/]*)$/.exec(url.pathname);

    if (!match) {
        return send(res, 404, { error: 'not found' });
    }

    const name = sanitize(match[1]);
    const rootDir = getSaveDir();
    const file = path.join(rootDir, `${name}.json`);

    if (req.method === 'PUT') {
        try {
            const body = await readBody(req);

            // 校验是合法 JSON 再落盘,避免存进坏文件。
            JSON.parse(body.toString('utf-8'));

            fs.mkdirSync(rootDir, { recursive: true });
            // 原子写:先写临时文件再改名,防止写到一半进程被杀留下半截文件。
            const tmp = `${file}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, body);
            fs.renameSync(tmp, file);

            console.log(`[save] ${name}.json (${body.length} bytes) -> ${rootDir}`);
            send(res, 200, { file, bytes: body.length });
        } catch (e) {
            console.error(`[save:error] ${name}: ${e.message}`);
            send(res, 400, { error: String(e.message || e) });
        }
        return;
    }

    if (req.method === 'GET' && name && name !== 'untitled') {
        if (!fs.existsSync(file)) {
            return send(res, 404, { error: 'not found' });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return fs.createReadStream(file).pipe(res);
    }

    if (req.method === 'GET') {
        // 列表
        try {
            fs.mkdirSync(rootDir, { recursive: true });
            const items = fs.readdirSync(rootDir)
                .filter(f => f.endsWith('.json'))
                .map(f => ({ name: f.slice(0, -5), updatedAt: fs.statSync(path.join(rootDir, f)).mtimeMs }));
            return send(res, 200, items);
        } catch (e) {
            return send(res, 500, { error: String(e.message || e) });
        }
    }

    send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, HOST, () => {
    console.log(`local diagram server: http://${HOST}:${PORT}`);
    console.log(`storage: ${getSaveDir()}`);
});
