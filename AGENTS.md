# xdraft 项目协作规范

基于 mydraft.cc 二次开发的 Electron 线框图工具。代码托管于 https://github.com/duya95555-xs/xdraft-test ，CI 按 tag 自动构建三端安装包。

## 代码管理（必须遵守）

每次开工按固定顺序执行，缺一不可：

1. **先拉远端**：`git pull` 把远端最新代码合并到本地，不允许在过时的代码上改
2. **看更新过什么**：对比本地与远端（`git status` / `git log origin/main` / `git diff`），远端有新提交时先了解更新内容，确认与本次要改的东西没有冲突再动手
3. **本地修改与自验**：改完 `git add -A`（或按文件）→ 提交信息写清做了什么 → 本地跑 `npx tsc --noEmit` 和相关测试，全绿才算完 → **只提交到本地，不推送**
4. **交用户完整验证**：功能实测由用户进行（必要时出测试包/deb）
5. **验证通过后推送**：用户明确说"推送"才执行 `git push`；推送前再拉一次确认远端无新改动，有则先合并再推

其他约定：

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
4. `git add -A && git commit -m "release: vX.Y.Z"` → `git tag vX.Y.Z` → **暂停，交用户完整验证**
5. 用户验证通过后：`git push origin main vX.Y.Z`
6. 确认 CI（.github/workflows/build.yml）构建成功、安装包挂到 Release

版本号规则：tag = package.json version = 文档中的版本，三者必须一致。

## 环境注意事项

- `node_modules` 在本机是指向 1.0.2 的 junction 链接（`.gitignore` 已排除，勿入库、勿删除）
- `templates/` 为模板库数据目录（体积大，已 gitignore）；放到 `xdraft-1.0.4/templates/` 后 `tools/local-server.mjs` 自动识别，没有不影响其他功能
- 全局 `gh-proxy.com` 的 git 代理规则已删除（会剥掉认证头导致推送失败）；github.com 直连正常，凭据在 `~/.git-credentials`
- 本仓库的写权限 token 是 fine-grained PAT，仅授权 `xdraft-test`；对 `duya95555-xs/xdraft`（旧仓库）只读
- **token 有效期 60 天**（约 2026-12-31 到期）：到期后推送会报 401/403 认证失败，需到 https://github.com/settings/personal-access-tokens 续期或换新 token，并同步更新本机 `~/.git-credentials` 里的密码字段
- 打包命令：`npm run electron:build:linux-arm64`（UOS 推荐 `bash slim-build.sh`，产物在 `release-slim/`）；发版勿动 workflow 的 `--publish never`
