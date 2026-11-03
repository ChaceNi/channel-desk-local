# Channel Desk 本地双店看板

本地网页 + 本地 Node.js 服务。Lakeside、LTD 分别授权、读取 `FROM sales` 等单店报表后在本机合并。不需要 `FROM ORGANIZATION`，不使用 ChatGPT/Sites 连接，也不需要数据库。原线上 Sites 保持原状。

## 启动

需要 Node.js 22.13 或更新版本。

- 双击 `启动看板.command`，服务在后台运行；关闭启动窗口不会停止服务。
- 已增加公司内网共享密码：同事使用启动时显示的内网地址登录。只有通过 `127.0.0.1` / `localhost` 访问的本机登录者可以管理 Shopify 凭据。
- 双击 `设置访问密码.command` 更换共享密码；改密后所有已有会话失效。双击 `重启看板.command` 重启；双击 `停止看板.command` 停止服务。
- 或在此目录执行 `npm start`，打开 http://127.0.0.1:5188/ 。终端保持运行，Ctrl+C 停止。
- 首次请到 http://127.0.0.1:5188/setup 配置两家店铺并分别验证。
- 如依赖缺失：`npm install`，`npm run build`，`npm start`。
- 修改源码后 `npm run build` 再重启服务。

## 应用授权

1. 使用目标店铺所属 Shopify 组织的应用。现有 Channel Desk Read Only 可以从 https://dev.shopify.com/dashboard/156420807/apps/442680803329/versions 查看。
2. 在每家店铺分别安装、批准权限。同一 Plus 组织可使用同一自定义应用；不属于同一组织的店铺不能假定可共用该应用，请分别使用其组织内的应用。
3. 设置页为每家店单独填写永久 myshopify.com 域名、Client ID 和 Client Secret。实际身份必须分别匹配 65380483281 和 66814050502。
4. 应用需要 read_reports；订单平台识别还需要 read_orders。ShopifyQL 要求 Level 2 受保护客户数据访问资格，不能仅凭应用成功安装认定报表可读。后台不查询客户姓名/地址/邮箱/电话，仅查汇总指标、订单 ID、渠道标签及属性。
5. 「验证店铺与报表权限」会真实请求店铺身份和昨日报表。两店均验证通过后才使用「两店合并」。
6. client_credentials 获取的短期 token 在内存中缓存并于到期前重新获取；修改凭据后自动失效。手动导入的 Admin API Access Token 不会自动续期，失效后请重新授权更新。

## 数据口径

- 任一家店查询失败、数据超过上限，整次合并查询失败，不把缺失店铺按 0 处理。
- 跨店币种、报表时区必须相同，否则拒绝相加。CR / AOV 按汇总分子、分母计算，非简单平均。
- 仅覆盖已进入 Shopify 的渠道数据。Amazon/Walmart/Target 是否完整取决于订单同步。
- 商品列表跨店同名商品按标题汇总；单品查询按标题或 SKU，订单仍带店铺 ID，避免同号混淆。
- 同一日期按各店报表时区统计。今天可能尚未完成，环比请优先用完整日期。

## 本地安全边界

- 设置共享密码后，同时监听 `127.0.0.1` 和本机当前的私有 IPv4 地址；只接受本机或当前接口同网段的来源，并校验 Host / Origin。没有公网隧道、云同步、遥测或后台上传。
- 每位同事首次输入同一个共享密码。服务端只保存加盐 scrypt 哈希，登录会话最长 8 小时；退出或改密后相应会话失效。错误尝试按实际来源 IP 限流，不信任转发头。
- 所有报表接口在服务端验证登录。内网读者即使知道设置网址，也不能读取或修改 Shopify 凭据。密码配置在 `.private/access.json`，同样为 600 权限并排除 Git。
- 当前为公司内网 HTTP，密码与报表传输不加密，只适用于你已选择的可信公司网络。未启用公网访问。后续有需要可部署 HTTPS。
- 凭据在 `.private/stores.json`，目录 700、文件 600，并被 `.gitignore` 排除。它是**本地明文配置，不是加密保险库**；有本机账号权限或管理员权限的程序仍可能读取。不要提交/分享此文件，也注意系统备份。
- Secret / Access Token 不通过设置查询接口回传，不写进前端构建文件，不写日志。浏览器保存设置时将其传给本机服务，由服务发给对应 Shopify HTTPS 域名。
- 不保存报表到磁盘；查看期间数据仍存在本地浏览器及服务内存。主动导出 CSV 是本地文件。
- 本机其他有权限的进程属于信任边界。不要通过路由器端口映射对公网开放。内网 IP 可能随 DHCP 变化，换网络后需重启并把新地址告诉同事；建议请公司 IT 固定 DHCP 租约。

参考：
- https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
- https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- https://shopify.dev/docs/api/admin-graphql/2026-10/queries/shopifyqlQuery

## 公司同事访问

目前检测到的内网地址为 http://192.168.50.23:5188/ ，以启动窗口实际显示为准。

1. 服务电脑保持开机、联网且不休眠。
2. 同事连接同一公司网络，打开内网地址，输入共享密码。不要向同事发送 `.private` 文件。
3. 同事可以筛选店铺、平台和日期，以及导出报表；当前只有共享密码，暂不区分个人账号或导出权限。
4. 如果同事无法连接，先确认 IP 是否变化、是否处于同一子网、Wi-Fi 是否开启访客隔离，再检查系统防火墙是否允许此 Node 服务入站。不要关闭整个防火墙；跨 VLAN 的访问需公司 IT 调整网络策略。
5. Shopify 应用授权设置请在服务电脑打开 http://127.0.0.1:5188/setup ，仍需输入共享密码。同事通过内网地址不能访问此设置页。
