# Server / Web 双版本架构

正式发行收敛为 Chainflow Server 与 Chainflow Web。共享编辑器与工作流继续作为唯一业务实现；取消 Local Docker 的 Compose、独立入口、镜像及发布任务。历史 0.4.0 产物不重写或删除。

## 分层与长期维护

| 层 | Server | Web |
|---|---|---|
| UI、表格、工作流、历史、移动适配 | 共用 app/、components/、core/、modes/ | 同一实现 |
| 数据 | 原认证 + SQLite + 加密配置 | model/browser-workspace.ts + browser-settings.ts，IndexedDB |
| 网络 | 已认证的受限代理、TTS 和 Codex | model/static-api.ts，浏览器直连允许的 HTTPS 提供商 |
| 构建 | 原 Dockerfile / compose.yaml | static/ 入口，GitHub Pages 子路径 |

新增通用功能默认在共享层实现，同时测试两个正式版本。数据库、服务端代理、Codex 等特殊能力通过部署标志和能力检测区分；Web 明确禁用不可用入口，不调用自建后端或公共匿名代理。

## Server

继续使用原有 Docker 部署、账号、SQLite、环境配置、主密钥及数据卷。按 docker/README.md 和 docs/server-storage.md 备份后更新，禁止删除用户数据卷。本轮架构调整不需要重建已运行的 Server，也不迁移数据库。

Server 镜像继续发布到 ghcr.io/zvision755/chainflow-ai-sheets-server，支持版本号、latest 与 sha-<Git SHA>；原 Compose 仍使用本地构建。

## Web

网址：https://zvision755.github.io/Chainflow-AI-Sheets/

仅静态 HTML、CSS、JavaScript，不需要账号或 Node 运行时。工作簿、模型参数、TTS 配置及记忆密钥保存于 IndexedDB。为保留已发布 Web 的工作簿，沿用已有数据库名 chainflow-local-v1，此名称不代表第三种发行模式。

原 localStorage 中的连接配置、TTS 配置及记忆密钥会先写入 IndexedDB，事务成功后清除旧副本。失败时保留旧副本，明确提示；不读取 Server 数据。少量界面偏好可继续使用 localStorage，不存放模型/TTS 密钥。取消记忆时，密钥仅在页面内存中。

工作簿按修订版本串行保存，不允许旧标签页静默覆盖。配置按字段事务合并，修改模型配置不会覆盖另一标签页的 TTS 配置。不同设备独立，不提供账号同步。

导出 JSON 兼容原工作簿格式，保留不含密钥的模型与 TTS 配置；旧 localSettings 字段仍可导入。导入清除旧密钥，需重新填写。清理站点数据会丢失工作簿，定期手动导出备份；浏览器密钥并非加密保管，设备用户和扩展可读取。

## 能力与验证边界

| 能力 | Web 行为 |
|---|---|
| 表格、拆句、移动端、历史、导入导出 | 共享核心，可直接使用 |
| AI / API Agent 工作流与流式 | 浏览器直连审阅过的提供商，需 CORS |
| 原生朗读 | 系统 speechSynthesis；音色、后台播放和离线能力需真机确认 |
| 第三方 TTS | 审阅过的 HTTPS 域名直连，需 CORS |
| Codex 订阅、本机模型、火山免配置 TTS、Kokoro | 禁用，不连接 Windows 服务 |

2026-10-10 的真实 OPTIONS 预检：OpenAI Responses、DeepSeek、aihubmix Chat 和 OpenAI TTS 允许来源 https://zvision755.github.io、POST 和所需请求头。OpenRouter 未完成验证，SiliconFlow 未确认 Authorization 跨域可用。预检不能替代有效密钥的付费生成、真实音频播放或 iPhone 验收。协议和流式逻辑共用 core/provider-transport.ts；Server 的来源校验仍在 server/proxy.ts。错误信息不回显密钥，不使用通用公共代理。

## 开发验证与发布

```sh
npm run typecheck
npm test
npm run build:modes
npm run test:ui:modes
node scripts/check-static-artifact.mjs
```

build:modes 仅生成 Server 与 Web。测试使用隔离的临时账号/数据库、共享编辑器预览与静态服务器，不操作用户容器。Windows 可设置 $env:PLAYWRIGHT_CHROMIUM_CHANNEL='chrome' 使用已安装 Chrome。

Web 预览：npm run build:static，然后 npm run preview:static；访问 http://127.0.0.1:3005/Chainflow-AI-Sheets/。其他静态主机可设置 CHAINFLOW_PAGES_BASE=/。

GitHub Actions 在 main、v* 标签、PR 和手动触发时构建测试 Server / Web；只有通过后才部署 main 的 Pages 和发布 Server 镜像。失败不替换已有 Pages。正式版本统一使用 package.json 版本和 v<版本> 标签。Actions 中可手动运行 Test Server and Web and publish。Local Docker 不再构建或发布。
