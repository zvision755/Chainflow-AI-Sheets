# Docker 管理员登录

Docker 版采用一个管理员账户。第一次打开任何入口时设置密码（至少 1 个字符），此后所有入口使用同一个密码。用户名不预填，首次设置时必须手动输入；登录时填写你设置的用户名。没有默认密码。请部署后立即完成首次设置；设置完成前模型、TTS、Agent 和其他业务 API 均不能调用。

本机 localhost、Windows 局域网 IP、蒲公英虚拟 IP、fnOS 反向代理和 Cloudflare Tunnel 都使用相同的后端认证。已登录的管理员 可使用现有 TTS、Codex Agent 和模型功能，不再要求请求来自 localhost 或 Origin 匹配 Docker 上游 Host；仍保留模型/地址白名单、参数、大小、超时和现有工具权限限制。API 模式的提供方密钥和容器 Codex 自身登录仍按原方式管理。

每个浏览器在每个访问地址首次登录一次。登录会话保留 30 天；关闭网页、刷新、重启容器或重建 app 都不会主动退出。不同域名/IP 的 Cookie 独立，但账户和密码相同。点击页面顶部「退出登录」立即撤销当前会话；退出后的旧 Cookie 无法再次使用。HTTP 本机/LAN 入口也可登录；公网入口应使用 HTTPS，HTTP 本身不加密密码和会话。

## 后端权限边界

- 除 `/healthz`、首次设置、登录和登录状态检查外，所有 `/api/` 路径统一要求有效登录 Cookie，包括 capabilities、模型 API、TTS、Agent、模型控制及未来工作簿 API。
- POST 等操作还必须携带与会话绑定的 CSRF 令牌。令牌由登录状态接口返回，前端 API 客户端自动携带。不接受转发头、localhost Host、来源 IP、API 提供方密钥或 Cloudflare Access 登录代替应用登录。
- 会话 Cookie 为 HttpOnly、SameSite=Lax，HTTPS 登录添加 Secure。密码用随机盐和 scrypt 保存，不存明文；会话凭据仅保存摘要。错误密码尝试受到限速。
- Docker 工作簿和模型/TTS 配置已改为服务器 SQLite 持久化，密钥由独立 Docker Secret 加密保存；数据库读写使用受统一认证保护的 `/api/` 路由。详见[迁移与备份恢复](server-storage.md)。

## 部署与持久化

```sh
docker compose up -d --no-deps --build app
docker compose ps
```

只更新 app，保持原 `.env` 和 `chainflow_codex-login`。新的 `chainflow_app-data` 卷挂载 `/data/chainflow`，其中 `auth.json` 保存密码哈希和会话状态。不要删除该卷、提交其内容或使用 `docker compose down -v`。读取失败或文件损坏时服务器拒绝启动，不会自动清空密码重新开放注册。

fnOS 现有 Gateway Test 应用可以继续使用：它保留请求 Cookie/自定义请求头、移除路径前缀，并把响应 Cookie 的 `Path=/` 改为应用路径。新的 Cookie 没有 `__Host-` 前缀，因此允许该路径改写；不需要重装或修改 NAS 软件。Cloudflare Tunnel 只需正常转发 Cookie、JSON POST 和 SSE/音频响应，不需要 localhost Host 伪装或应用 Origin 白名单。

## 手机验证

1. 在 Windows 的原地址打开，首次手动设置用户名和密码；已设置的账户直接登录。然后实际运行一个 Agent 单元格、播放一次日语 TTS。
2. 使用手机 5G 从飞牛 App 打开原来的 Chainflow 入口，首次用同一用户名和密码登录；运行单元格并确认最终结果完整，播放 TTS。现有飞牛入口尚不能逐块显示生成文本，不应把最终结果返回误记为流式显示通过。
3. 关闭页面重新打开、切换 App 后返回并刷新，确认无需立即重复登录。
4. 手机使用蒲公英入口或局域网地址时首次登录一次，验证同样的 Agent/TTS 操作。
5. 用无痕浏览器访问应显示登录页；未带登录 Cookie 直接 POST TTS/Agent/模型接口应得到 401。登录后缺少 CSRF 令牌应得到 403。

修改仅针对 Docker 运行入口；公开 Sites 和仅回环监听的开发预览/原生 Mac App 保持其各自原有访问策略。
