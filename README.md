# tidc VPS 客户自助服务中心

这是一个 Node.js + Proxmox VE 的 VPS 客户服务系统。管理员创建客户账户、配置套餐并绑定 PVE 虚拟机；客户登录后可以查看名下多台实例、剩余天数和账单，并使用余额自助续费。

## 启动

双击 `start.bat`，或执行：

```bash
npm start
```

默认访问地址：`http://localhost:3000`

初始账户：

- 管理端：`admin` / `admin123`
- 客户演示：`demo` / `123456`

首次部署后请立即登录管理端修改初始密码。

## 客户端能力

- 查看账户余额、实例数量、到期时间和剩余天数
- 一个客户绑定一台或多台 PVE KVM/LXC 实例
- 使用余额按 1、3、6 或 12 个月自助续费
- 使用余额提交购买订单，等待管理员审核并分配 PVE 实例
- 开机、正常关机、重启和强制停止
- 从管理员白名单选择 ISO，挂载镜像并启动重装流程
- 通过 PVE 临时 VNC 票据打开 noVNC 控制台
- 查看续费账单和支付记录
- 使用邮箱验证码自行注册客户账户
- 管理员和客户验证当前密码后自行修改登录密码
- 忘记密码时通过已验证邮箱接收验证码并重置密码

## 管理端能力

- 创建客户登录账户和充值余额
- 客户管理：余额、实例数、最近登录 IP/时间、登录历史、强制改密和删除
- 配置 VPS 套餐、售价和成本
- 审核客户购买订单，手动选择 PVE 节点和 VMID 后开通，拒绝时自动退款
- 将客户服务绑定到 PVE 节点、类型和 VMID
- 查看客户余额、服务到期情况和财务流水
- 配置 PVE API Token、测试连接和读取虚拟机列表
- 配置 SMTP、绑定管理员通知邮箱、发送测试邮件并启用邮箱验证注册
- 配置实例开通、续费、解绑以及到期前 5 天、3 天和到期删除风险提醒

## 邮箱注册配置

在管理端的“邮件设置”填写 SMTP 主机、端口、登录凭据、发件邮箱和发件名称，然后先发送一封测试邮件。常见配置为：

- SSL/TLS：端口 `465`，勾选“使用 SSL/TLS”
- STARTTLS：端口 `587`，取消勾选“使用 SSL/TLS”
- 部分邮箱需要使用单独生成的 SMTP 授权码，而不是网页登录密码

验证码 10 分钟内有效，同一邮箱 60 秒内不能重复发送，同一网络在 10 分钟内最多申请 5 次。待验证记录只保存密码哈希和验证码哈希，验证成功后立即删除。

业务邮件默认关闭。确认 SMTP 测试成功后，填写管理员通知邮箱，勾选“启用业务邮件通知”并保存；可以分别控制客户通知、管理员新订单通知和管理员实例到期通知。系统每小时扫描一次到期提醒，同一实例和到期日期只发送一次，也可以在邮件设置中手动执行扫描。

## PVE 配置

在管理端的“PVE 设置”填写：

- 主机地址，例如 `pve.example.com`
- 端口，默认 `8006`
- API Token ID，例如 `root@pam!portal`
- API Token Secret

Token 至少需要目标虚拟机的审计、电源管理、控制台和配置权限。重装功能当前针对 KVM/QEMU：系统会停止实例，将白名单 ISO 挂载到 `ide2`，调整启动顺序后开机。生产环境建议进一步改成基于 Cloud-Init 模板克隆或备份恢复的自动装机任务。

VNC 使用项目内置的官方 noVNC 1.5 客户端和服务器端 WebSocket 转发，不依赖 PVE 主机的 `/usr/share/novnc-pve` 静态文件。客户只能为自己绑定的实例申请 45 秒临时票据，PVE API Token 不会发送到客户浏览器。

### Windows 密码重置

Windows KVM/QEMU 虚拟机需要在 PVE 的 VM 选项中启用 QEMU Guest Agent，并在 Windows 内安装、启动 `qemu-ga-x86_64.msi` 和对应的 VirtIO Serial 驱动。客户可在“我的实例”生成随机强密码并自助重置；PVE 返回成功后，系统才会保存新的当前密码、写入不含密码的审计记录，并向客户邮箱发送新密码和后台地址。管理员可在“全部虚拟机”重置密码，管理员操作不会发送客户邮件。

客户付款订单经管理员审核并分配 KVM/QEMU VM 时，系统会先通过 Guest Agent 设置随机安全密码，成功后才完成开通。若 Guest Agent 不在线，订单保持待审核状态。管理员从“实例绑定”直接添加的虚拟机不会自动重置密码，仍使用管理员填写的登录凭据。已明确标记为 Linux 或 LXC 的实例不会显示 Windows 密码重置入口。

### VNC 只能在代理网络下连接

客户浏览器不应直接访问 PVE 8006 端口。浏览器只连接 tidc 网站的同源 WebSocket，由 Node.js 服务端转发到 PVE。生产环境应让网站统一使用 HTTPS 443：

- Caddy：将 `deploy/Caddyfile.example` 中的域名替换为真实域名，Caddy 会自动处理 HTTPS 和 WebSocket。
- Nginx：参考 `deploy/nginx-tidc.conf.example`，必须转发 `Upgrade` 和 `Connection` 请求头，并延长 WebSocket 超时。
- 不建议让客户使用公网 IP 的 `3000` 或 PVE 的 `8006` 端口连接控制台。

控制台连接失败时会显示分段诊断。提示“WebSocket 没有到达服务端”表示客户到网站的 443/反向代理有问题；提示“服务器连接 PVE 失败”表示运行 tidc 的服务器到 PVE 8006 的路由或防火墙有问题。后一种情况应把 tidc 部署到与 PVE 可直连的网络，或只在服务器与 PVE 之间建立 WireGuard 等私网，不需要客户挂代理。

## 数据文件

- 业务数据：`data/db.json`
- PVE 凭据：`data/pve-config.json`
- SMTP 凭据：`data/mail-config.json`
- 临时邮箱验证记录：`data/email-verifications.json`
- 临时密码重置记录：`data/password-resets.json`
- 邮件提醒发送记录：`data/mail-notifications.json`

密码使用 Node.js `scrypt` 不可逆哈希保存，因此管理员不能读取客户原密码，只能强制设置新密码；新密码仅在操作时显示，改密后客户现有会话会立即失效。PVE Token Secret 和 SMTP 密码只保存在服务器端，不会返回给浏览器。服务器已经禁止通过静态网址读取 `data` 目录。当前会话保存在内存中，服务器重启后需要重新登录。

生产环境必须使用 Nginx、Caddy 或其他反向代理为站点启用 HTTPS，避免登录密码和注册信息通过明文 HTTP 传输。

登录 IP 支持 `X-Forwarded-For`、`X-Real-IP` 和 `CF-Connecting-IP`。默认 `TRUST_PROXY=auto`，会信任来自 Docker 私网、回环和链路本地地址的反向代理，并从代理链右侧验证后提取客户公网 IP。可按部署结构设置：`TRUST_PROXY=0` 完全关闭；`TRUST_PROXY=1` 表示网站前只有一层代理；`TRUST_PROXY=2` 表示 Cloudflare + Nginx 等两层代理；也可填写逗号分隔的可信代理 CIDR，例如 `TRUST_PROXY=172.18.0.0/16,10.0.0.0/8`。生产环境必须让最后一层代理覆盖或正确追加 `X-Forwarded-For`，不要使用 `TRUST_PROXY=all`，除非应用端口完全无法被公网直接访问。
