#!/usr/bin/env bash
# =============================================================================
# mydraft 源码快照 —— 把「当前代码与结构」原样打包到 home 目录
#
# 用法：
#     bash ~/mydraft/tools/save-snapshot.sh
#
# 产物：~/mydraft-src-backup-YYYYMMDD-HHMM.tar.gz
#   - 命名与存放位置沿用既有惯例（与 20260918-0024 / 20260918-2312 一致）
#   - 排除 node_modules / release* / dist-electron / dist / coverage / .git
#   - 含 src / electron / tools / tests / public / 各类配置文件
# =============================================================================
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$HOME/mydraft-src-backup-${STAMP}.tar.gz"

cd "$PROJ"

tar -czf "$OUT" \
    --exclude=./node_modules \
    --exclude=./release \
    --exclude='./release-bak-*' \
    --exclude=./dist-electron \
    --exclude=./dist \
    --exclude=./coverage \
    --exclude=./.git \
    .

echo "=============================================="
echo "源码快照：$OUT"
ls -lh "$OUT"
echo "条目数  ：$(tar -tzf "$OUT" | wc -l)"
echo "----------------------------------------------"
echo "确认已包含本轮新文件（M1~M4 新增）："
tar -tzf "$OUT" | grep -E '_shadow\.ts|_text-box\.ts|core/utils/desktop\.ts|CloseGuardDialog\.tsx|color-alpha\.spec\.ts|editor-serialization\.spec\.ts|electron/(main|preload)\.js|tools/' || true
echo "----------------------------------------------"
echo "确认 package.json 已带跨平台/瘦身配置（应能看到三行）："
tar -xzOf "$OUT" ./package.json | grep -E 'electronLanguages|electron:build:win|"nsis"' || true
echo "----------------------------------------------"
echo "确认未误含依赖与产物（应全为 0）："
echo "  node_modules : $(tar -tzf "$OUT" | grep -c 'node_modules' || true)"
echo "  release      : $(tar -tzf "$OUT" | grep -c '/release' || true)"
echo "  dist-electron: $(tar -tzf "$OUT" | grep -c 'dist-electron' || true)"
echo "=============================================="
