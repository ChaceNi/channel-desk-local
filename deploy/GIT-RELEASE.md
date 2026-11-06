# Git 发布流程

仓库：https://github.com/ChaceNi/channel-desk-local 。首次服务器准备见 [DEPLOY-SERVER.md](DEPLOY-SERVER.md)。不需要 Azure、OIDC 或 Key Vault。

## 提交与版本

审阅工作区及暂存区后自行提交推送，本次清理没有自动提交或推送：

```sh
git status
git diff
git diff --cached
git add -A
git commit -m "Prepare Channel Desk 1.2.2 release"
git push origin main
```

`git add -A` 同时记录已删除的旧文件。提交前确认不含 `.private`、真实运行配置、证书、日志或报表。

main 提交与 PR 执行 **Check and package**：锁定依赖安装、构建、类型检查、测试、打包及容器检查。无须 Shopify 密钥。产物可从 Actions 下载。

版本号同时更新 package.json、package-lock.json 和 CHANGELOG.md。确认 main 检查通过后：

```sh
git tag -a v1.2.2 -m "Channel Desk 1.2.2"
git push origin v1.2.2
```

标签须匹配 package.json 且属于 main 历史，自动生成 GitHub Release 与源码包、服务器包和校验文件；标签不自动部署。发布后不要移动同名标签。

## 服务器发布

首次在服务器配置仓库外的运行密钥与 HTTPS，运行 `python3 deploy/server/setup.py`。后续可进入版本目录执行 `python3 deploy/server/manage.py deploy --proxy caddy`；已有 HTTPS 代理则使用 `--proxy external`。

可选 GitHub 网页发布：按部署说明配置专用 SSH 凭据和已核实的主机公钥，Actions → **Deploy server**，工作流选 main，release_ref 填 main、标签或 main 历史中的提交，勾选发布确认后运行。Shopify Secret 仅保存在服务器，不填入 GitHub。

## 回滚与核验

服务器执行 `python3 deploy/server/manage.py rollback` 回到上一镜像，或发布已验证的历史标签。保留旧镜像、发布目录和管理状态；回滚不回退运行密钥，重启后用户需重新登录。

检查 `/api/health` 的 release.version 与 release.commit，并实际完成 Shopify 登录、双店报表与导出验收。无 Git 历史的源码包 commit 为 null，使用产物校验值识别版本。自动检查不代替目标服务器实际验收。
