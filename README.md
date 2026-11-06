# Channel Desk 1.2.2

React + Node.js 多店销售看板，支持 Lakeside、LTD 单店和合并报表，以及 Shopify、Amazon、Walmart、Target 渠道筛选。渠道范围取决于已同步至 Shopify 的订单，无需数据库。

## 普通服务器部署

Linux 服务器准备 Docker Engine、Compose 和 Python 3，进入仓库执行：

```sh
python3 deploy/server/setup.py
```

向导配置正式域名、HTTPS 和 Shopify 凭据；真实 Secret 隐藏输入并存于仓库外，不进入镜像或 Git。域名解析及 Shopify 正式回调需先配置。

- [部署与更新、回滚](deploy/DEPLOY-SERVER.md)
- [Git 发布流程](deploy/GIT-RELEASE.md)
- [配置示例](deploy/server/runtime.config.example.json)
- [上线验收清单](deploy/ACCEPTANCE.md)

生产模式使用 Shopify 员工登录。任一家指定店铺的有效报表员工登录后，均可查看和导出两店数据；不再维护额外员工名单。后台用应用统一只读凭据查询两店，此访问范围由负责人确认。

## 本机运行

使用 Node.js 24。首次运行 `npm ci`、`npm run build`，再双击 `启动看板.command`；也可 `npm start` 打开 http://127.0.0.1:5188/ 。

本机设置页为 http://127.0.0.1:5188/setup 。本地凭据保存于 `.private/stores.json`，共享密码哈希保存于 `.private/access.json`，均排除 Git。内网共享仍使用密码；通过本机地址登录后才能管理凭据。可用 `设置访问密码.command`、`重启看板.command`、`停止看板.command` 管理服务。

本机 HTTP 仅适用于可信公司网络。服务器共享使用 HTTPS 和 Shopify 登录。5190 隔离测试服务及启动入口已移除。

## 数据与授权

应用在两店分别安装，读取需要 `read_reports`、`read_orders` 和适用的 Shopify 报表访问资格。后台核验固定店铺 ID、币种及报表时区，不依赖组织级报表权限。报表仅查询汇总指标和订单渠道属性，不查询客户姓名、联系方式或地址。

任一家店查询失败，合并请求明确失败，不将缺失店铺按零统计。AOV/CR 按合并后的分子分母计算。报表不保存到服务器磁盘，主动导出的 CSV 由访问者保存。

Secret 不进入前端、不通过查询接口返回；服务器管理员和可修改后端代码的人仍属于信任范围。不得提交 `.private`、真实配置、证书、日志或导出报表。

## 开发与打包

```sh
npm ci
npm run check
npm run release
```

发布构建需要 Node.js 24 和 Python 3，输出 `release/channel-desk-source.zip`、`release/channel-desk-server.zip`、版本清单与 SHA-256 校验文件。GitHub 自动检查代码，版本标签生成 Release；服务器发布手动触发，不随普通推送自动上线。当前运行的 5188 实例不会因源码清理自动重启。
