# 三种部署模式（0.4.0）

一个仓库、main 分支、同一个表格页面与工作流。通用功能在 `app/page.tsx`、`components/`、`core/`、`modes/` 开发；部署差异集中在存储与网络入口，不维护三套 UI。

| 能力 | Server Docker | Local Docker | Local Pages |
|---|---|---|---|
| 登录 | 单用户账号密码 | 无 | 无 |
| 工作簿 | SQLite，跨设备共享 | 当前浏览器 IndexedDB | 当前浏览器 IndexedDB |
| 密钥和小配置 | 服务器加密、前端不返回完整密钥 | 浏览器 localStorage，可取消记忆 | 浏览器 localStorage，可取消记忆 |
| 云端 AI / 流式 | 受保护的受限代理 | 无状态受限代理 | 浏览器直连，需提供商 CORS |
| Agent 工作流 | 现有工作流 | 同一工作流，使用 API | 同一工作流，使用 API |
| 本地 Codex 订阅 | 登录后的受保护接口 | 禁用 | 禁用 |
| LM Studio / Ollama | 已审阅本机端口 | 同一端口限制 | 禁用 |
| 火山免配置 TTS | 现有服务端转发 | 无状态转发 | 禁用，不能伪装扩展来源 |
| 内置 Kokoro | 现有部署 | 不自动启动模型，可配置主机兼容服务 | 不提供 |
| 浏览器原生朗读 | 原有 TTS 保持 | 可选 | 默认，音色由系统提供 |
| 第三方 TTS | 服务端代理 | 无状态代理 | 已审阅 HTTPS 直连，需 CORS |
| 表格、移动 UI、导入导出 | 共用 | 共用 | 共用 |

## Server：原部署保留

`compose.yaml`、登录状态、SQLite、主密钥和已有数据卷没有迁移。原部署仍使用 3003。更新仍须遵守现有完整备份流程；不要用 Local 的配置启动已有 Server 容器。

## Local Docker

在项目目录执行：

```sh
docker compose -f compose.local.yaml up -d --build
```

打开 `http://127.0.0.1:3004/`。项目名 `chainflow-local`，镜像 `chainflow-ai-sheets-local:0.4.0`，不挂载任何数据卷、不要求密钥文件、不启动数据库或 Kokoro。后端只在请求期间处理模型/TTS 文本与凭据，不持久化、不记录密钥；仅保留不含凭据的摘要限流计数。默认回环绑定，无法匿名远程调用宿主机 Codex，容器入口也没有启动 Codex 的代码。

如需网络代理，设置 `CHAINFLOW_LOCAL_HTTP_PROXY=http://host.docker.internal:7897`。Local 不读取 Server 专用代理变量。更换端口用 `CHAINFLOW_LOCAL_PORT`。Linux 的 `host.docker.internal` 已通过 `host-gateway` 配置。

可选局域网：同时设置 `CHAINFLOW_LOCAL_BIND_ADDRESS=0.0.0.0`、`CHAINFLOW_LOCAL_LAN_ACCESS=true` 后重建启动。该模式没有账户认证，任何能访问端口的人都能使用代理，并且每台浏览器的数据独立；不要直接把这个端口发布到公网。需要远程账号保护、共享数据或 Codex 订阅时使用 Server。

## Local Pages

网址：<https://zvision755.github.io/Chainflow-AI-Sheets/>。仅 HTML/CSS/JavaScript；不连接开发者 Windows，不请求本站运行时 API，没有 Node/SQLite/账号系统。前端路由只有页面根入口，子路径与资源 base 为 `/Chainflow-AI-Sheets/`；表格切换不改变 URL，刷新仍加载相同入口。

```sh
npm ci
npm run build:static
npm run preview:static
```

预览地址为 `http://127.0.0.1:3005/Chainflow-AI-Sheets/`。其他静态主机可在构建时设置 `CHAINFLOW_PAGES_BASE=/`。`static/vite.config.ts` 不加载 `.env`，不使用 Server Routes、Server Actions 或 RSC。`static/main.tsx` 直接挂载现有 `app/page.tsx`，不会复制编辑器。

GitHub Settings → Pages 的 Source 为 GitHub Actions。`.github/workflows/release.yml` 在 main 推送、`v*` 标签、PR 和手动触发时检查三个模式；只有全部构建和关键回归通过后才部署 main 的静态产物。失败的检查不会替换现有 Pages。手动部署：Actions → Test all modes and publish → Run workflow → main。[GitHub 自定义 Pages 工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## API/TTS 兼容性及验证边界

2026-10-10，从本机经网络代理对公开端点执行真实 OPTIONS，Origin 为 `https://zvision755.github.io`，请求 POST 与 `authorization,content-type`。没有使用私人 API Key，也没有发起付费生成：

| 提供商 / 端点 | 实际预检结果 | 静态版结论 |
|---|---|---|
| OpenAI Responses `/v1/responses` | 200，允许来源、POST、所需请求头 | 可尝试直连；有效密钥/模型调用待用户验证 |
| DeepSeek `/chat/completions` | 200，允许来源、POST、所需请求头 | 可尝试直连；模型与计费权限待用户验证 |
| aihubmix、api.aihubmix Chat Completions | 204，允许来源、POST、所需请求头 | 可尝试直连；实际模型调用待用户验证 |
| OpenRouter | 本次网络/预检未完成 | 未确认，不能报告可用 |
| OpenAI TTS `/v1/audio/speech` | 200，允许来源、POST、所需请求头 | 可尝试 MP3 直连；密钥、音色和播放待用户验证 |
| SiliconFlow TTS | 204，返回允许头 `*` | 不确认可用：Authorization 通常需显式允许；实际浏览器/音色调用未通过验收 |
| 火山免配置 TTS | 依赖后端特定请求头 | 静态禁用；Docker 保留原适配 |
| 浏览器 TTS | 原生接口适配已实现 | 音色、离线能力及后台恢复取决于系统；需真机验证 |

预检成功不代表生成、模型权限、音色或计费成功。原始 CORS 配置由提供商决定，可能变化。AI 的 Responses/Chat、流式完整结束、错误与密钥脱敏通过模拟响应测试；界面测试验证最终结果落入 IndexedDB。网络或 CORS 失败有明确提示，不使用公共匿名代理，静态版不提供自建通用代理配置。受限目标与协议检查复用原代理代码，该代码在静态版浏览器内部处理协议，实际网络仅发送到审阅过的提供商。

## 数据安全与备份

- Local 数据按浏览器 origin 隔离。localhost、127.0.0.1、局域网 IP、不同端口、Pages 域名属于不同站点，不会自动共享；无账号同步。
- 工作簿用 IndexedDB 事务保存；只有事务完成显示已保存。不同标签页通过修订号拒绝旧版本覆盖，冲突后先导出当前副本再刷新。不要在尚未保存时关闭页面。
- 默认记忆 AI Key，可取消勾选；TTS Key 与设置保存在浏览器。用户、扩展或 XSS 能读取浏览器密钥，禁止在共享设备保存。浏览器存储并不等同于 Server 的加密保管。
- 定期使用“导出 JSON”。Local JSON 额外带不含密钥的模型连接与 TTS 设置；三个模式都读取共用工作簿格式，Server 导入只读取工作簿。Local 恢复不会恢复密钥，需重新填写；导入设置会清除旧密钥，避免发往不同服务。
- 清理站点数据、无痕窗口退出或系统存储回收可能丢失 Local 数据。Docker 重启不会删除浏览器数据，但也不构成备份。切换设备请自行导出/导入。
- 未迁移或读取现有 Server 用户数据库。所有 CI 账号、主密钥、模拟 API Key 在临时测试环境生成/使用，不含开发者私有凭据。

## 更新与版本管理

package.json 与锁文件统一版本。正式发布使用 `v0.4.0` 形式标签；Server 与 Local Docker 由同一 Dockerfile、不同构建参数产生，同一版本发布到：

```text
ghcr.io/zvision755/chainflow-ai-sheets-server:0.4.0
ghcr.io/zvision755/chainflow-ai-sheets-local-docker:0.4.0
```

main 还生成 `latest` 和完整 `sha-<Git SHA>` 标签，可按 SHA 精确回溯。正式标签须与 package.json 版本一致，不能强推或重复使用已有版本标签。Server 现有 Compose 继续使用本机构建镜像；拉取发行镜像时通过单独的 Compose override 指定上述 image，沿用原环境与数据卷。Local 可设置 `CHAINFLOW_LOCAL_IMAGE` 使用已发布镜像后 `docker compose -f compose.local.yaml up -d`（不加 `--build`）。

开发检查：

```sh
npm run typecheck
npm test
npm run build:modes
npm run test:ui:modes
node scripts/check-static-artifact.mjs
```

跨模式浏览器测试使用隔离临时 Server、Local 无状态入口、Pages 预览和共用 UI 回归；不操作用户服务。`AGENTS.md` 要求未来开发默认考虑三个模式，CI 不允许仅验证 Server 后就将 Local 标记成功。

Windows 若没有 Playwright 自带 Chromium，可先设置 `$env:PLAYWRIGHT_CHROMIUM_CHANNEL='chrome'` 使用已安装的 Chrome；CI 安装独立 Chromium。提供商参数、受限目标和流式协议集中在 `core/provider-transport.ts`，服务端的来源校验保留在 `server/proxy.ts`，静态版不会借用或伪造服务器 Origin。

本机验收：类型检查、190 项单元测试、34 项跨模式浏览器回归、三个生产构建及静态产物检查通过；真实 Local Docker 另有 4 项桌面/手机视口测试通过。独立容器重启后工作簿和浏览器密钥恢复；火山日语 TTS 实际响应 200、`audio/mpeg`（6765 字节）。既有 Server 容器未重启，数据库只读 `integrity_check` 为 `ok`。真实 iPhone 的原生朗读音色/后台恢复，以及有效付费 AI/TTS 密钥的直连调用尚未验收，不能用模拟测试代替。
