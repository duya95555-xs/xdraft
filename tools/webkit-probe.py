#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mydraft WebKitGTK 兼容性探针
============================================================================
目的：回答「把 Electron 换成 Tauri / Wails（用系统 WebKit 内核）到底行不行」。

做法：用系统自带的 WebKitGTK 打开 mydraft 的前端构建产物（dist-electron），
      然后自动探测 4 件事，并截图留证：

  1) 画布渲染链   —— WebGL2 / WebGL1 是否可用、真实 GPU 渲染器是谁
                     （出现 llvmpipe / SwiftShader / softpipe 就是软件渲染 ⇒ 画布必卡）
  2) 文字渲染链   —— SVG <foreignObject> 里塞 HTML 能不能正常布局
                     （mydraft 的文字全走这条路，WebKit 上失败就是灾难）
  3) 剪贴板链路   —— navigator.clipboard.read 是否可用（粘贴图片进画布依赖它）
  4) 应用是否活着 —— React 是否挂载成功、页面报了什么错

用法（**必须用系统 python3**，PyGObject / WebKitGTK 装在系统 python 里，
      不在托管 python 里）：

    /usr/bin/python3 ~/mydraft/tools/webkit-probe.py                 # 默认测 dist-electron
    /usr/bin/python3 ~/mydraft/tools/webkit-probe.py --wait 10       # 多等一会再探测
    /usr/bin/python3 ~/mydraft/tools/webkit-probe.py --url http://localhost:5173

缺依赖时（先确认仓库里到底有哪个版本，别闷头装）：

    apt-cache policy gir1.2-webkit2-4.0 gir1.2-webkit2-4.1 gir1.2-webkit-6.0

    sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1   # 新系统
    sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.0   # UOS 20 等老系统

注意：apt 一次给了多个包名时，只要有**一个**定位不到就会整笔中止、什么都不装。
所以那个 4.1 报 "无法定位软件包" 时，要拆成单独一条来装能装的那部分。

退出码：0 = 跑完（结论看输出）；2 = 环境不满足；3 = 页面加载失败
============================================================================
"""
from __future__ import print_function

import argparse
import json
import os
import sys
import threading
import time

VERSION = '1.0'


def log(msg=''):
    print(msg)
    sys.stdout.flush()


def die(msg, code=2):
    log('[探针] ' + msg)
    sys.exit(code)


# ---------------------------------------------------------------- 依赖检查

try:
    import gi
except ImportError:
    die('缺少 PyGObject。请执行：\n'
        '    sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1')

WK_NS = None
for _ver in ('4.1', '4.0'):
    try:
        gi.require_version('WebKit2', _ver)
        WK_NS = _ver
        break
    except ValueError:
        continue

if WK_NS is None:
    die('系统没有 WebKitGTK（4.1 / 4.0 都找不到）。请执行：\n'
        '    sudo apt install -y gir1.2-webkit2-4.1\n'
        '老系统（UOS 20 / Debian 10）只有 4.0，装 gir1.2-webkit2-4.0')

gi.require_version('Gtk', '3.0')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402


# ---------------------------------------------------------------- 注入 / 探测脚本

# 在文档开始前注入：收集所有 JS 错误，供稍后读取
ERROR_HOOK_JS = """
window.__probeErrors = [];
window.addEventListener('error', function (e) {
    window.__probeErrors.push('error: ' + (e && (e.message || e.type) || 'unknown'));
});
window.addEventListener('unhandledrejection', function (e) {
    window.__probeErrors.push('unhandledrejection: ' + String(e && e.reason));
});
(function () {
    var orig = console.error;
    console.error = function () {
        try {
            window.__probeErrors.push('console.error: ' +
                Array.prototype.slice.call(arguments).join(' ').slice(0, 300));
        } catch (_) {}
        return orig.apply(console, arguments);
    };
})();
"""

# 等待页面稳定后执行：返回 JSON 字符串（避免依赖 JSC.Value.to_json）
PROBE_JS = r"""
(function () {
    var out = {};
    var NS = 'http://www.w3.org/2000/svg';

    // ---- 1) 画布渲染链 ----
    try {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var gl2 = c.getContext('webgl2');
        var gl = gl2 || c.getContext('webgl') || c.getContext('experimental-webgl');
        out.webgl2 = !!gl2;
        out.webgl1 = !!gl;
        if (gl) {
            out.glVersion = String(gl.getParameter(gl.VERSION));
            var dbg = gl.getExtension('WEBGL_debug_renderer_info');
            out.glRenderer = String(dbg
                ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER));
            out.glVendor = String(dbg
                ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
                : gl.getParameter(gl.VENDOR));
            out.glMaxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        }
        out.webgpu = !!navigator.gpu;
    } catch (e) {
        out.webglError = String(e);
    }

    // ---- 2) foreignObject + HTML 布局 ----
    try {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', '240');
        svg.setAttribute('height', '80');
        svg.style.cssText = 'position:absolute;left:-9999px;top:0;width:240px;height:80px';
        var fo = document.createElementNS(NS, 'foreignObject');
        fo.setAttribute('x', '0'); fo.setAttribute('y', '0');
        fo.setAttribute('width', '240'); fo.setAttribute('height', '80');
        var div = document.createElement('div');
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        div.style.cssText = 'font:16px/20px sans-serif;color:#000;padding:4px;margin:0';
        div.textContent = 'probe text';
        fo.appendChild(div);
        svg.appendChild(fo);
        document.body.appendChild(svg);
        var rr = div.getBoundingClientRect();
        out.foreignObject = {
            ok: rr.width > 0 && rr.height > 0,
            w: Math.round(rr.width),
            h: Math.round(rr.height)
        };
        svg.parentNode.removeChild(svg);
    } catch (e) {
        out.foreignObject = { ok: false, err: String(e) };
    }

    // ---- 3) 剪贴板 / 文件能力 ----
    out.clipboardRead = !!(navigator.clipboard && navigator.clipboard.read);
    out.clipboardWrite = !!(navigator.clipboard && navigator.clipboard.write);
    out.clipboardPasteEvent = typeof ClipboardEvent !== 'undefined';
    out.downloadAttr = 'download' in document.createElement('a');
    out.saveFilePicker = (typeof window.showSaveFilePicker === 'function');
    out.printApi = (typeof window.print === 'function');
    out.localStorage = (function () {
        try { window.localStorage.setItem('__probe', '1');
              window.localStorage.removeItem('__probe'); return true; }
        catch (e) { return false; }
    })();

    // ---- 4) 应用是否活着 ----
    out.title = document.title;
    out.root = document.querySelector('#root');
    out.rootChildren = out.root ? out.root.childElementCount : -1;
    out.svgCount = document.querySelectorAll('svg').length;
    out.canvasCount = document.querySelectorAll('canvas').length;
    out.buttonCount = document.querySelectorAll('button').length;
    out.devicePixelRatio = window.devicePixelRatio;
    out.userAgent = navigator.userAgent;
    out.innerText = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200);
    out.errors = (window.__probeErrors || []).slice(0, 25);

    return JSON.stringify(out);
})()
"""


# ---------------------------------------------------------------- 本地静态服务


def start_static_server(root, port):
    """在后台线程起一个静态服务，避免 file:// 的各种限制（CORS / module 脚本）。"""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class QuietHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super(QuietHandler, self).__init__(*args, directory=root, **kwargs)

        def log_message(self, *args):  # 静音请求日志
            pass

    QuietHandler.extensions_map.update({
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
    })

    httpd = ThreadingHTTPServer(('127.0.0.1', port), QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever)
    thread.daemon = True
    thread.start()
    return httpd


# ---------------------------------------------------------------- 探针主体


class Probe(object):

    def __init__(self, args, url):
        self.args = args
        self.url = url
        self.result = None
        self.load_error = None
        self.t_load_start = time.time()
        self.t_loaded = None
        self.quit_done = False

        manager = WebKit2.UserContentManager()
        try:
            script = WebKit2.UserScript.new(
                ERROR_HOOK_JS,
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START,
                None, None)
        except TypeError:
            script = WebKit2.UserScript.new(
                ERROR_HOOK_JS,
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START)
        manager.add_script(script)

        self.webview = WebKit2.WebView.new_with_user_content_manager(manager)

        settings = self.webview.get_settings()
        self._try_set(settings, 'set_enable_write_console_messages_to_stdout', True)
        self._try_set(settings, 'set_enable_developer_extras', True)
        self._try_set(settings, 'set_allow_file_access_from_file_urls', True)
        self._try_set(settings, 'set_enable_webgl', True)
        self._try_set(settings, 'set_javascript_can_access_clipboard', True)
        self._try_set(settings, 'set_enable_javascript', True)

        self.webview.connect('load-changed', self.on_load_changed)
        self.webview.connect('load-failed', self.on_load_failed)

        self.window = Gtk.Window()
        self.window.set_title('mydraft WebKitGTK probe')
        self.window.set_default_size(int(args.size[0]), int(args.size[1]))
        self.window.add(self.webview)
        self.window.connect('destroy', lambda *a: self.finish())

    @staticmethod
    def _try_set(obj, method, *value):
        try:
            getattr(obj, method)(*value)
        except Exception as exc:  # API 在不同版本间有增删，缺一个不影响主流程
            log('  [warn] %s 设置失败：%s' % (method, exc))

    # ---- 生命周期 ----

    def start(self):
        self.window.show_all()
        self.webview.load_uri(self.url)
        # 看门狗：无论如何别挂死
        GLib.timeout_add_seconds(int(self.args.wait) + 60, self.watchdog)

    def watchdog(self):
        if not self.quit_done:
            log('[探针] [!!] 看门狗触发，强制结束（页面可能卡住了）')
            self.finish()
        return False

    def on_load_failed(self, _view, _event, failing_uri, error, _data=None):
        self.load_error = '%s  (uri=%s)' % (error.message, failing_uri)
        log('[探针] [!!] 页面加载失败：%s' % self.load_error)
        GLib.timeout_add(100, self.finish)
        return True

    def on_load_changed(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.t_loaded = time.time()
            log('[探针] 页面已加载（%.2fs），等待 %ss 让 React / Pixi 完成初始化…'
                % (self.t_loaded - self.t_load_start, self.args.wait))
            GLib.timeout_add_seconds(int(self.args.wait), self.run_probe)

    # ---- 探测 ----

    def run_probe(self):
        log('[探针] 执行探测脚本…')
        self.webview.run_javascript(PROBE_JS, None, self.on_probe_done)
        return False

    def on_probe_done(self, view, result, _data=None):
        raw = ''
        try:
            js_result = view.run_javascript_finish(result)
            raw = js_result.get_js_value().to_string()
            self.result = json.loads(raw)
        except Exception as exc:
            log('[探针] [!!] 探测脚本执行失败：%s' % exc)
            if raw:
                log('        原始返回：%s' % raw[:300])
            self.result = {}

        self.report()
        GLib.timeout_add(800, self.do_snapshot)
        return False

    def do_snapshot(self):
        try:
            self.webview.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,
                                      WebKit2.SnapshotOptions.NONE,
                                      None, self.on_snapshot)
        except Exception as exc:
            log('[探针] 截图不可用：%s' % exc)
            self.finish()
        return False

    def on_snapshot(self, view, result, _data=None):
        try:
            surface = view.get_snapshot_finish(result)
            surface.write_to_png(self.args.shot)
            log('[探针] 截图已保存：%s' % self.args.shot)
        except Exception as exc:
            log('[探针] 截图失败：%s' % exc)
        self.finish()
        return False

    def finish(self):
        if self.quit_done:
            return
        self.quit_done = True
        if self.result is not None:
            try:
                with open(self.args.shot + '.json', 'w') as handle:
                    json.dump(self.result, handle, ensure_ascii=False, indent=2)
                log('[探针] 原始数据已保存：%s.json' % self.args.shot)
            except Exception as exc:
                log('[探针] 写 JSON 失败：%s' % exc)
        log('[探针] 结束。')
        Gtk.main_quit()

    # ---- 结果解读 ----

    def report(self):
        r = self.result or {}
        log('')
        log('=' * 74)
        log('探测结果')
        log('=' * 74)
        log('  WebKitGTK 版本   : %s'
            % '.'.join(str(x) for x in (WebKit2.get_major_version(),
                                       WebKit2.get_minor_version(),
                                       WebKit2.get_micro_version())))
        log('  GTK 版本         : %s.%s.%s'
            % (Gtk.get_major_version(), Gtk.get_minor_version(), Gtk.get_micro_version()))
        log('  User-Agent       : %s' % r.get('userAgent', '-'))
        log('  软件渲染环境变量 : WEBKIT_DISABLE_COMPOSITING_MODE=%r'
            % os.environ.get('WEBKIT_DISABLE_COMPOSITING_MODE'))
        log('')

        gl_renderer = (r.get('glRenderer') or '')
        soft = any(k in gl_renderer.lower() for k in ('llvmpipe', 'swiftshader', 'softpipe'))

        def line(ok, label, detail):
            log('  %s %-16s %s' % ('[OK]' if ok else '[!!]', label, detail))

        line(bool(r.get('webgl2')), 'WebGL2',
             '可用' if r.get('webgl2') else '不可用 —— Pixi v8 需退回 WebGL1 或直接失败')
        line(bool(r.get('webgl1')), 'WebGL1',
             '可用' if r.get('webgl1') else '不可用 —— 画布基本无解')
        line(not soft, 'GPU 渲染器',
             '%s%s' % (gl_renderer or '(未知)',
                       '  ← 软件渲染，画布会明显卡顿' if soft else ''))
        line(bool(r.get('webgpu')), 'WebGPU', '可用' if r.get('webgpu') else '不可用（Pixi 会自动退回 WebGL，正常）')

        fo = r.get('foreignObject') or {}
        line(bool(fo.get('ok')), 'foreignObject',
             'HTML-in-SVG 布局正常 (%sx%s)' % (fo.get('w'), fo.get('h'))
             if fo.get('ok') else '布局失败/尺寸为 0 —— 文字会消失（%s）' % fo.get('err', 'w/h=0'))

        line(bool(r.get('clipboardRead')), '剪贴板读取',
             'navigator.clipboard.read 可用' if r.get('clipboardRead')
             else '不可用 —— 粘贴图片进画布需另想办法')
        line(bool(r.get('saveFilePicker')), '保存文件',
             '可用' if r.get('saveFilePicker') else '不可用（Tauri 下改用后端保存，属预期）')
        line(bool(r.get('localStorage')), 'localStorage',
             '可用' if r.get('localStorage') else '不可用')

        log('')
        mounted = (r.get('rootChildren') or 0) > 0
        line(mounted, 'React 挂载',
             '#root 子节点 %s / svg %s / canvas %s / button %s'
             % (r.get('rootChildren'), r.get('svgCount'),
                r.get('canvasCount'), r.get('buttonCount')))
        if r.get('innerText'):
            log('      页面文字 : %s' % r['innerText'][:150])

        errors = r.get('errors') or []
        if errors:
            log('')
            log('  页面报错（前 %d 条）：' % len(errors))
            for item in errors:
                log('    - %s' % item)
        else:
            log('      页面报错 : 无')

        log('')
        log('-' * 74)
        log('结论')
        log('-' * 74)
        if not mounted:
            log('  [!!] React 没挂载起来，先看上面的报错 —— 若报的是 electronAPI/IPC')
            log('       之类的错，那是预期的（这本来就是 Electron 产物）。')
        elif (r.get('webgl2') or r.get('webgl1')) and fo.get('ok') and not soft:
            log('  [OK] 画布渲染链 + 文字渲染链都能跑，且不是软件渲染。')
            log('       ⇒ 值得继续评估换 WebKit 内核（下一步才是改 IPC / 剪贴板）。')
        elif soft:
            log('  [!!] 用的是软件渲染（llvmpipe 一类）。在国产 arm64 机器上这通常')
            log('       代表 GPU 合成被禁用，画布会卡。换内核前必须先解决这条。')
        else:
            log('  [!!] 关键链路有缺失（看上面 [!!] 的行）。建议保留 Electron。')
        log('')
        log('提示：截图 %s（若已有画面，说明 HTML/CSS 渲染 OK，仅能力有缺）' % self.args.shot)


# ---------------------------------------------------------------- main


def main():
    parser = argparse.ArgumentParser(
        description='用系统 WebKitGTK 打开 mydraft 构建产物，验证换内核是否可行')
    parser.add_argument('--url', default=None,
                        help='要探测的地址。默认自动起本地静态服务加载 dist-electron')
    parser.add_argument('--root', default=None,
                        help='静态资源目录，默认 <项目>/dist-electron')
    parser.add_argument('--port', type=int, default=8099, help='本地静态服务端口（默认 8099）')
    parser.add_argument('--no-serve', action='store_true',
                        help='不起静态服务，仅用 --url 指定的地址')
    parser.add_argument('--wait', type=int, default=6,
                        help='页面加载完成后等待多少秒再探测（默认 6，Pixi 初始化慢就调大）')
    parser.add_argument('--size', nargs=2, default=['1280', '820'], help='窗口尺寸，默认 1280 820')
    parser.add_argument('--shot', default='/tmp/mydraft-webkit-probe.png', help='截图输出路径')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root = args.root or os.path.join(project_root, 'dist-electron')

    if os.environ.get('DISPLAY') is None and os.environ.get('WAYLAND_DISPLAY') is None:
        die('没有图形环境（DISPLAY / WAYLAND_DISPLAY 都为空）。\n'
            '    WebKitGTK 需要真实桌面会话，请在 UOS 桌面终端里跑，而不是 SSH。')

    if args.no_serve:
        if not args.url:
            die('--no-serve 时必须给 --url')
        url = args.url
    elif args.url:
        url = args.url
    else:
        index = os.path.join(root, 'index.html')
        if not os.path.isfile(index):
            die('找不到 %s\n'
                '    先构建：cd ~/mydraft && unset LD_PRELOAD && ELECTRON=true npm run build' % index)
        start_static_server(root, args.port)
        url = 'http://127.0.0.1:%d/' % args.port
        log('[探针] 已启动本地静态服务：%s -> %s' % (url, root))

    log('[探针] v%s  WebKit2 命名空间 %s' % (VERSION, WK_NS))
    log('[探针] 目标：%s' % url)
    log('[探针] 窗口：%s x %s，等待 %ss' % (args.size[0], args.size[1], args.wait))
    log('')

    try:
        Gtk.init(None)
    except Exception as exc:
        log('[探针] [warn] Gtk.init 报错（多数情况无害）：%s' % exc)

    probe = Probe(args, url)
    probe.start()
    Gtk.main()

    if probe.load_error:
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
