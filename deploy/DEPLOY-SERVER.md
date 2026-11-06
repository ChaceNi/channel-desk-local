# 普通 Linux 服务器部署（1.2.2）

## 最短部署方式

对方需要仓库读取权限，以及已安装 Docker Engine、Compose 和 Python 3 的 Linux 服务器。你推送本次改动后，对方执行：

```sh
git clone https://github.com/ChaceNi/channel-desk-local.git
cd channel-desk-local
python3 deploy/server/setup.py
```

仓库已在服务器上时，只需进入目录执行最后一条命令。向导会检查环境、询问域名和 HTTPS 方式、隐藏输入 Shopify Secret，并写入仓库外的私有配置后启动。已有配置原样复用。服务器 ZIP 解压后也可执行相同命令。

这是一条命令引导部署，不是零配置：域名解析、首次 Docker 安装、Shopify 允许回调仍需有权限的人准备；向导不会擅自更改 DNS、Shopify 应用或安装系统软件。密钥必须由你在服务器直接填写或通过受控方式交给可信部署者，不能放入 Git 供所有仓库读者获取。

仓库已关联：https://github.com/ChaceNi/channel-desk-local 。新增文件仍需由你审阅、提交并推送，关联仓库本身不会上传本地改动。本说明不依赖 Azure、OIDC、Key Vault 或数据库。

## 交付给部署人员

- 提供私有仓库读取权限及明确版本（本版计划标签 v1.2.2）；或者提供 channel-desk-server.zip。
- 普通服务器使用 channel-desk-server.zip。服务器包包含预构建网页、Node 后端、Dockerfile、Compose、HTTPS 配置和管理脚本；不含真实密钥。
- Git clone 方式在 Docker 中构建，不需要服务器安装 Node；预构建包部署同样不需要 Node 或前端开发依赖。
- 部署人员需要服务器操作权限、Docker 操作权限、域名/DNS 权限。真实 Client Secret 由负责人直接在服务器填入，勿通过仓库或聊天传递。
- 服务器管理员、Docker 操作者及有权修改部署代码的人仍处于信任范围内，可能使用运行时密钥。

## 一次性准备

服务器按 Linux + Docker Engine + Docker Compose 插件 + Python 3 + unzip 准备。Docker 账号权限等同于很高的主机权限，请只给必要人员。安装按 [Docker 官方说明](https://docs.docker.com/engine/install/) 操作；无需额外云平台 CLI。

正式域名例如 sales.example.com，A/AAAA 记录指向服务器。

- 新站点：使用 Caddy，80/443 必须空闲且能从公网到达，以便自动申请/续期证书。只开放必要的 SSH 及网站端口，应用端口不对外开放。
- 已有 Nginx/HTTPS：使用 external 模式，不启动 Caddy，不争用原有 80/443。参考 deploy/server/nginx.conf.example 配置对应域名和证书。
- 当前默认应用宿主端口为 5188，但只绑定 127.0.0.1。若服务器已占用此端口，用管理脚本的 --port 指定空闲端口，并同步已有 Nginx 的 upstream。

从仓库获取源码后进入目录，或解压服务器 ZIP 后进入包含 compose.yaml 的目录。私有仓库需要你自己的 GitHub 读取凭据；自动发布方式会传输版本包，服务器无需保存 GitHub 仓库 Token。

## 单独填写服务器密钥

以下命令以固定的部署账号执行；后续手动发布与 GitHub SSH 发布应使用同一账号，以保持发布/回滚记录一致。

```sh
install -d -m 700 "$HOME/.config/channel-desk"
if [ ! -e "$HOME/.config/channel-desk/runtime.config.json" ]; then
  install -m 600 deploy/server/runtime.config.example.json "$HOME/.config/channel-desk/runtime.config.json"
fi
nano "$HOME/.config/channel-desk/runtime.config.json"
```

填入：

- CHANNEL_DESK_PUBLIC_ORIGIN：正式 HTTPS 根地址，例如 https://sales.example.com。
- SHOPIFY_CLIENT_ID：现有应用的 Client ID。
- SHOPIFY_CLIENT_SECRET：现有应用的真实 Secret。

文件必须在代码目录之外，权限为 600 或 400，由非 root 的运行 UID 持有。一般使用普通部署账号创建就符合要求。若使用 root 部署账号，编辑完成后执行 `chown 1000:1000 "$HOME/.config/channel-desk/runtime.config.json"`，应用将在容器中以 UID 1000 读取挂载文件；不要把容器改为 root 来绕过权限检查。

文件仅在运行时只读挂载，不会进入镜像、构建参数、GitHub Secret 或容器环境变量。它仍是服务器上的明文文件；服务器管理员可以读取。不要打印它，不要运行会将全部配置上传到日志的调试命令。旧员工访问名单不再使用。

## 配置 Shopify 正式地址

在现有 Channel Desk Read Only 应用中发布正式域名配置：

- App URL：https://sales.example.com/
- 允许回调 URL：新增 https://sales.example.com/auth/shopify/callback；已移除 localhost:5190 测试回调。
- 保留 read_reports、read_orders；无需新增写权限。

任一家指定店铺的有效报表员工登录后，均可查看/导出两店数据，这是负责人已选择的范围；后台不逐店继承员工的原有权限。

## 首次启动或手动更新

新站点由 Caddy 负责 HTTPS：

```sh
python3 deploy/server/manage.py deploy --proxy caddy
```

已有 HTTPS/Nginx：

```sh
python3 deploy/server/manage.py deploy --proxy external
```

文件不在默认位置时，追加 `--config /绝对路径/runtime.config.json`；更换本地应用端口时追加 `--port 5198`。不要将配置文件拷入源码目录。

脚本会检查文件权限、构建镜像、启动单实例、确认版本和 HTTPS、验证 Shopify 登录方式及匿名报表 401。已有同名但未由脚本管理的容器会拒绝覆盖，需先人工检查。

首次证书申请需要 DNS 和网络就绪。若公开 HTTPS 检查失败，脚本报告失败，但不会删除已有证书或其他站点；排查 DNS、端口占用和代理配置。不要同时启用两套 80/443 服务。外部 Nginx 日志应按示例记录不含查询参数的 URI，监控和错误日志采集也应脱敏，避免保存 OAuth 授权码。

管理命令：

```sh
python3 deploy/server/manage.py status
python3 deploy/server/manage.py rollback
```

回滚复用上一个镜像和代码目录，保留当前密钥文件、域名与代理选择，不回退凭据。首次发布没有前一版本可回滚。保留旧发布目录、镜像和同一部署账号的 ~/.local/state/channel-desk；不要直接清理证书卷、旧镜像或回滚状态。部署/回滚会让现有登录会话失效，需要重新登录。当前仅支持单实例。

源码 Git clone 更新可以 git pull 或切换已验证标签后再次 deploy。服务器包更新则解压到新的版本目录再执行 deploy，勿覆盖密钥配置。

## GitHub 网页自动发布

推送本版后，Actions 中会出现 Deploy server。该流程会在 GitHub 先构建测试，再用 SSH 传输无密钥的服务器包并在服务器执行相同管理脚本，无需 Azure 授权。

仓库 Settings → Secrets and variables → Actions 配置：

Repository Secrets：

- SERVER_HOST：服务器域名或 IPv4。
- SERVER_USER：固定部署账号。
- SERVER_SSH_KEY：专用自动化 SSH 私钥；当前流程要求可非交互使用，不支持密码/硬件确认提示。
- SERVER_KNOWN_HOSTS：经服务器控制台/可信渠道核实的 SSH 主机公钥行。非 22 端口通常为 [host]:port 格式。不要自动信任未经核实的 ssh-keyscan 结果。

Repository Variables：

- SERVER_DEPLOY_ROOT：服务器发布根目录，例如 /home/deploy/channel-desk-deploy，要求账号可写。
- SERVER_CONFIG_FILE：已在服务器填写的密钥文件绝对路径，例如 /home/deploy/.config/channel-desk/runtime.config.json。
- SERVER_PROXY_MODE：caddy 或 external。
- SERVER_SSH_PORT：默认 22。
- SERVER_APP_PORT：默认 5188。

自动发布路径仅支持字母、数字、点、下划线、短横线和斜线，不支持空格或 .. 路径段。

不向 GitHub 填写 Shopify Secret。SSH 部署权限本身属于高信任权限，部署账号需要能运行 Docker；限制仓库写入和发布权限。

Actions → Deploy server → Use workflow from 选 main → release_ref 选 main 或已发布的 v1.2.2/后续标签 → 勾选确认 → Run workflow。工作流仅部署 main 历史中的提交，严格校验 SSH 主机，不会自动跳过主机校验。

服务器如果仅能从公司内网访问，GitHub 托管 Runner 无法直接 SSH；可先手动部署，或由公司配置内网 Runner/安全网络，不要为此关闭 SSH 校验或随意开放管理入口。

## 验收与已知边界

- 实际完成 Shopify 员工登录、两店切换、合并报表和导出验证。
- 未登录 /api/dashboard 为 401，/setup 为 403。
- /api/health 的 release.version 与 release.commit 对应目标版本；无 Git 历史包以校验值识别。
- 检查应用 5188 仅绑定宿主机回环地址，外网只能走 HTTPS 代理。
- 本机已验证 Node 生产模式、配置文件边界、发布包、工作流及配置语法。当前开发电脑没有 Docker 守护进程，镜像构建、容器 smoke 和真实服务器的证书/SSH/回滚需推送后在 CI 与目标服务器实际验收。

官方参考：[Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)、[Docker Compose](https://docs.docker.com/compose/)、[Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)。
