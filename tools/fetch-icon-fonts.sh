#!/usr/bin/env bash
# =============================================================================
# 把图标字体下载下来 / 从本地读取，生成 src/fonts/icon-fonts.ts
#
# 用法（在 slim-build-1.0.1 目录下）：
#     bash tools/fetch-icon-fonts.sh
#
# 取字体的优先级：
#   1. src/fonts/ 下已有的 woff2  —— 优先用本地，方便从别的机器拷过来
#   2. 联网下载（多个源依次尝试）
#   3. 都拿不到 —— 生成空常量版本，编译照样通过，
#      图标表现回退到旧版本（画布依赖 CDN、导出会丢），但不会引入新的报错
#
# 注意：生成交给 python3 完成。早期版本用 sed 替换占位符, 而字体转成 base64 后
# 有 200KB 往上 —— 超过 execve 的参数长度上限会直接报 "参数列表过长"，
# 而且重定向已经先把目标文件截成了空文件, 于是 TS 报 "File ... is not a module"。
# python 直接从字体文件读取并编码, 不经过 shell 变量, 没有这个限制。
# =============================================================================
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="$DIR/src/fonts"
TPL="$DIR/tools/icon-fonts.template.ts"
OUT="$FONT_DIR/icon-fonts.ts"

FA_FILE="$FONT_DIR/fontawesome-webfont.woff2"
MI_FILE="$FONT_DIR/material-icons.woff2"

UA='Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

mkdir -p "$FONT_DIR"

if [ ! -f "$TPL" ]; then
    echo "错误：找不到模板 $TPL"
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "错误：找不到 python3"
    exit 1
fi

echo "================================="
echo " 准备图标字体"
echo "================================="

# 依次尝试多个 URL，下载到 $1
fetch_font() {
    local dest="$1"; shift

    if [ -s "$dest" ]; then
        echo "      [本地] $(basename "$dest") （已有，跳过下载）"
        return 0
    fi

    local url
    for url in "$@"; do
        if curl -fsSL --max-time 25 --retry 1 -A "$UA" "$url" -o "$dest" 2>/dev/null && [ -s "$dest" ]; then
            echo "      [下载] $(basename "$dest") ← $url"
            return 0
        fi
    done

    rm -f "$dest"
    return 1
}

# Material Icons 的字体地址写在 googleapis 返回的 CSS 里，需要先取 CSS 再抽 URL
fetch_material() {
    local dest="$1"

    if [ -s "$dest" ]; then
        echo "      [本地] $(basename "$dest") （已有，跳过下载）"
        return 0
    fi

    if command -v curl >/dev/null 2>&1; then
        local css_url css real_url

        for css_url in \
            'https://fonts.googleapis.com/icon?family=Material+Icons' \
            'https://fonts.googleapis.com/css?family=Material+Icons' \
            'https://fonts.googleapis.com/css2?family=Material+Icons'
        do
            css="$(curl -fsSL --max-time 20 -A "$UA" "$css_url" 2>/dev/null || true)"
            real_url="$(printf '%s' "$css" | grep -oE 'https://fonts\.gstatic\.com[^")]+\.woff2' | head -1 || true)"

            if [ -n "$real_url" ]; then
                if curl -fsSL --max-time 25 -A "$UA" "$real_url" -o "$dest" 2>/dev/null && [ -s "$dest" ]; then
                    echo "      [下载] $(basename "$dest") ← $real_url"
                    return 0
                fi
            fi
        done
    fi

    # 退路：npm 镜像里的同名字体（URL 会随版本号变化，尽量宽泛地试几个）
    fetch_font "$dest" \
        'https://cdn.jsdelivr.net/npm/material-icons@1.13.14/iconfont/material-icons.woff2' \
        'https://cdn.jsdelivr.net/npm/material-icons/iconfont/material-icons.woff2' \
        'https://unpkg.com/material-icons@1.13.14/iconfont/material-icons.woff2' \
        'https://unpkg.com/material-icons/iconfont/material-icons.woff2'
}

echo "[1/3] Font Awesome ..."
fetch_font "$FA_FILE" \
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/fonts/fontawesome-webfont.woff2' \
    'https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/fonts/fontawesome-webfont.woff2' \
    'https://unpkg.com/font-awesome@4.7.0/fonts/fontawesome-webfont.woff2'

echo "[2/3] Material Icons ..."
fetch_material "$MI_FILE"

echo "[3/3] 生成 src/fonts/icon-fonts.ts ..."

rm -f "$OUT"

python3 - "$TPL" "$OUT" "$FA_FILE" "$MI_FILE" <<'PY'
import base64
import sys

tpl_path, out_path, fa_path, mi_path = sys.argv[1:5]


def encode(path):
    # 字体缺失时返回空串：生成的 TS 依然合法，编译照过，
    # 运行与导出表现回退到旧版本，不会引入新的报错。
    try:
        with open(path, 'rb') as handle:
            data = handle.read()
    except OSError:
        return ''

    if not data:
        return ''

    return 'data:font/woff2;base64,' + base64.b64encode(data).decode('ascii')


with open(tpl_path, encoding='utf-8') as handle:
    text = handle.read()

text = text.replace('__FONT_AWESOME_WOFF2__', encode(fa_path))
text = text.replace('__MATERIAL_ICONS_WOFF2__', encode(mi_path))

with open(out_path, 'w', encoding='utf-8') as handle:
    handle.write(text)
PY

if [ -s "$OUT" ]; then
    SIZE="$(du -h "$OUT" | cut -f1)"
    echo "      $OUT ($SIZE)"
else
    echo "      生成失败"
    exit 1
fi

HAS_FA=0
HAS_MI=0
[ -s "$FA_FILE" ] && HAS_FA=1
[ -s "$MI_FILE" ] && HAS_MI=1

echo ""
if [ "$HAS_FA" = "1" ] && [ "$HAS_MI" = "1" ]; then
    echo "两套字体就绪：画布离线可用，导出图片不再丢图标。"
else
    echo "警告：字体不完整，相关图标在画布和导出里仍会缺失："
    [ "$HAS_FA" = "0" ] && echo "  - Font Awesome 缺失"
    [ "$HAS_MI" = "0" ] && echo "  - Material Icons 缺失"
    echo ""
    echo "离线环境下可以手动补齐：把对应的 .woff2 放到"
    echo "  $FONT_DIR/"
    echo "文件名保持 fontawesome-webfont.woff2 与 material-icons.woff2，重跑本脚本即可"
    echo "（本地文件会被优先使用，不再联网）。"
fi
echo ""
