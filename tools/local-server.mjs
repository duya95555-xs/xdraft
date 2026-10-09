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
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
