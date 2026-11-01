# xdraft 项目协作规范

基于 mydraft.cc 二次开发的 Electron 线框图工具。代码托管于 https://github.com/duya95555-xs/xdraft-test ，CI 按 tag 自动构建三端安装包。

## 代码管理（必须遵守）

- 所有代码改动**必须 git 提交并推送到 `origin`（xdraft-test 仓库）**，不允许只在本地改完就结束
- 日常：改完 → `git add -A`（或按文件）→ 有意义的提交信息（单行说清做了什么）→ `git push origin main`
- 推送前如远端可能有他人/网页改动，先 `git pull` 合并
- 大改动或试验性功能：开分支（`feat/xxx` 等），完成后再合回 main
- 提交粒度：一次提交只做一件事，不混入无关改动
- 禁止绕过规范用 tar 包传递代码更新；源码包仅在发版时按需生成（见《部署说明.md》）

## 发版流程（release）

发新版时严格按以下步骤，缺一不可：

1. `package.json` 的 `version`  bump（修 bug +0.0.1，新功能 +0.1），tag 名与版本一致（如 `v1.0.5`）
2. 同步更新文档：
   - 根目录《部署说明.md》顶部的新功能行 + 验证清单
   - `README.md` / `README.zh-CN.md` 的功能特性列表、版本/下载信息
   - 若改了打包配置，`README.electron.md` 一并更新
3. 按《部署说明.md:56-66》的验证清单逐项验证（tsc 零错误、功能实测）
4. `git add -A && git commit -m "release: vX.Y.Z"` → `git tag vX.Y.Z` → `git push origin main vX.Y.Z`
5. 确认 CI（.github/workflows/build.yml）构建成功、安装包挂到 Release

版本号规则：tag = package.json version = 文档中的版本，三者必须一致。

## 环境注意事项

- `node_modules` 在本机是指向 1.0.2 的 junction 链接（`.gitignore` 已排除，勿入库、勿删除）
- `templates/` 为模板库数据目录（体积大，已 gitignore）；放到 `xdraft-1.0.4/templates/` 后 `tools/local-server.mjs` 自动识别，没有不影响其他功能
- 全局 `gh-proxy.com` 的 git 代理规则已删除（会剥掉认证头导致推送失败）；github.com 直连正常，凭据在 `~/.git-credentials`
- 本仓库的写权限 token 是 fine-grained PAT，仅授权 `xdraft-test`；对 `duya95555-xs/xdraft`（旧仓库）只读
- 打包命令：`npm run electron:build:linux-arm64`（UOS 推荐 `bash slim-build.sh`，产物在 `release-slim/`）；发版勿动 workflow 的 `--publish never`
