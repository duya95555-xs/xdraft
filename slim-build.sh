#!/usr/bin/env bash
# =============================================================================
# mydraft Electron 精简打包脚本（1.0.1+）
#
# 核心策略：
#   · 不打包 node_modules（Vite 已经把所有 JS 依赖打包进 dist-electron/）
#   · 打包完用 xz -9 重压 deb
#   · 构建前先生成内联的图标字体数据（离线可用 + 导出不丢图标）
#
# 用法（在本目录下）：
#     bash slim-build.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "================================="
echo " mydraft 精简打包"
echo "================================="
echo "工作目录: $ROOT_DIR"
echo ""

# ── Step 0: 图标字体内联数据 ──
echo "[0/4] 图标字体内联数据..."
if [ -f "$ROOT_DIR/tools/fetch-icon-fonts.sh" ]; then
    bash "$ROOT_DIR/tools/fetch-icon-fonts.sh" || echo "      (字体准备失败，继续构建；图标将沿用旧表现)"
else
    echo "      (未找到 tools/fetch-icon-fonts.sh，跳过)"
fi
echo ""

# ── Step 1: 清理 ──
echo "[1/4] 清理..."
rm -rf "$ROOT_DIR/release-slim" "$ROOT_DIR/dist" "$ROOT_DIR/dist-electron"
echo "      完成。"
echo ""

# ── Step 2: 前端构建 ──
echo "[2/4] 前端构建..."
cd "$ROOT_DIR"
ELECTRON=true npm run build
echo "      完成。"
echo ""

# ── Step 3: 打包 deb ──
echo "[3/4] 打包 deb..."
npx electron-builder build --linux --arm64 \
    --config "$ROOT_DIR/electron-builder-optimized.yml" \
    2>&1
echo "      完成。"
echo ""

# ── Step 4: xz -9 重压 ──
echo "[4/4] xz -9 重压 deb..."
DEB="$(find "$ROOT_DIR/release-slim" -maxdepth 1 -name '*.deb' | head -1 || true)"

if [ -n "$DEB" ]; then
    BEFORE="$(du -h "$DEB" | cut -f1)"
    TMPD="$(mktemp -d)"
    dpkg-deb -R "$DEB" "$TMPD"
    dpkg-deb -Zxz -z9 --build "$TMPD" "$DEB"
    rm -rf "$TMPD"
    echo "      $BEFORE → $(du -h "$DEB" | cut -f1)"
else
    echo "      (未找到 deb，跳过)"
fi

echo ""
echo "================================="
echo " 打包完成"
echo " 产物目录: $ROOT_DIR/release-slim/"
echo "================================="

if [ -d "$ROOT_DIR/release-slim" ]; then
    echo ""
    ls -lh "$ROOT_DIR/release-slim"/*.deb 2>/dev/null || echo "(deb 未找到)"
fi
