# Chainflow AI Sheets

表格式 AI 工作流：编辑工作簿、配置列依赖与提示词、批量生成、流式输出、历史、拆句导入和朗读。桌面与手机共用同一套界面。

项目只维护 **Chainflow Server** 和 **Chainflow Web** 两个正式版本，使用一个仓库和 main 分支。

| | Chainflow Server | Chainflow Web |
|---|---|---|
| 使用方式 | Docker 自托管 | [直接在线使用](https://zvision755.github.io/Chainflow-AI-Sheets/) |
| 登录 | 单用户账号密码 | 无 |
| 工作簿 | 服务端 SQLite，跨设备共享 | 当前浏览器 IndexedDB，不同步设备 |
| 模型/TTS 配置和 API Key | 服务端保存、密钥加密 | 浏览器 IndexedDB，可取消记忆密钥 |
| AI / API Agent 工作流 | 受保护的受限代理 | 浏览器直连，需要提供商支持 CORS |
| Codex 订阅 Agent | 登录后可用 | 禁用 |
| TTS | 火山、Kokoro、第三方 API | 原生朗读；支持 CORS 的第三方 API |
| 本机模型 | LM Studio / Ollama | 禁用 |
| 编辑、移动 UI、JSON 导入导出 | 共享核心 | 共享核心 |

## Server：Docker 自托管

首次部署，在项目目录执行：

```sh
node scripts/init-master-key.mjs
docker compose up -d --build
```

打开 `http://127.0.0.1:3003/`，设置用户名和密码。更新前备份数据库、账户及加密主密钥，不能只备份数据库，也不要删除数据卷。

详见 [Docker 部署](docker/README.md)、[账户认证](docs/admin-login.md)及[服务端存储与备份恢复](docs/server-storage.md)。现有 Server 的认证、数据库结构及 Compose 保留。

## Web：打开网址直接使用

[https://zvision755.github.io/Chainflow-AI-Sheets/](https://zvision755.github.io/Chainflow-AI-Sheets/)

无需登录、Docker、数据库或自建后端。工作簿、模型配置、TTS 配置和记忆密钥保存在访问者自己的 IndexedDB，不连接开发者 Windows 或 Server 数据库。

请定期导出工作簿 JSON；导出不含 API Key，导入时需重新填写密钥。清理站点数据、存储回收或退出无痕窗口可能丢失数据，不同设备及浏览器相互独立。浏览器存储不是加密保管，设备用户、扩展或 XSS 可读取密钥，不宜在共享电脑记忆。

AI 需要提供商允许跨域调用。Web 不使用匿名公共代理；本地 Codex、本机模型和火山免配置 TTS 入口禁用。原生朗读不需要 API Key，系统音色和后台播放须在实际设备上确认。提供商兼容性及验证边界见[双版本架构与部署说明](docs/deployment-modes.md)。

## 开发与同步发布

通用功能默认在 `app/`、`components/`、`core/`、`modes/` 开发；部署差异通过能力检测、存储和网络适配器处理，不复制编辑器，也不维护长期产品分支。

```sh
npm ci
npm run typecheck
npm test
npm run build:modes
npm run test:ui:modes
node scripts/check-static-artifact.mjs
```

静态开发预览：`npm run build:static` 后执行 `npm run preview:static`，访问 `http://127.0.0.1:3005/Chainflow-AI-Sheets/`。静态服务器只是开发工具。

GitHub Actions 在 main、版本标签、PR 和手动触发时构建测试 Server 与 Web。通过后部署 main 的 Web 到 Pages，发布 Server Docker 镜像；失败不覆盖现有 Pages。正式版本统一使用 package.json 版本及 `v<版本>` 标签，Server 镜像保留版本和 SHA 标签。

长期规范见 [AGENTS.md](AGENTS.md)，变更见[更新记录](CHANGELOG.md)。
