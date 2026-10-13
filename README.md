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

Server 的所有 TTS 朗读共用持久化音频缓存，跨设备、刷新和容器更新复用相同文本及合成参数，避免重复调用。位置、命中日志、空间查看和清理命令见 [TTS 缓存说明](docs/tts-cache.md)。Web 保持浏览器朗读方式。

## Markdown 列（开发中）

在列设置的“内容显示”中选择 Markdown。默认纯文本，已有工作簿无需迁移。

- 手机总览显示两行、电脑总览显示四行去掉 Markdown 标记的普通文本；两端共用行详情，完整渲染标题、列表、粗体、引用、代码及表格。编辑时显示原文。
- 原始 Markdown 及历史仍完整保存；复制、JSON/CSV/Excel 导出保留原文。
- TTS、单/多来源模板和 API/Agent 上游输入使用纯文本，保留正文、代码内容、链接名称和表格行列关系。普通文本列不进行转换。
- 切换显示模式会让依赖此列的生成结果需要更新，不改写原结果或历史，也不自动调用 AI。
- 不执行原始 HTML，不加载 Markdown 图片，危险链接协议被阻止。不包含数学公式或代码语法高亮扩展。
- 实际手机朗读和远程访问体验需在本机测试后确认；此次 Markdown 改动暂不发布 GitHub。

### 桌面表格显示与性能（开发中）

- 桌面总览固定四行文本预览，无单元格内部滚动；点击打开与手机共用的行详情，编辑原文或完整阅读 Markdown。
- 行高固定，电脑版每个数据列统一固定 440px，手机仍采用原有自动宽度规则；不再提供行高/列宽拖动。读取已有表格或导入旧 JSON 时忽略旧行高/列宽，导出也不再包含它们。
- 运行、复制、历史、朗读与行操作仍在桌面总览直接使用。大表格只挂载可见区域附近的行，完整数据与任务仍由稳定 ID 绑定。

桌面总览操作区：状态、运行、复制、朗读和右侧历史共用一行，固定行高 168px；列头模型与来源共用一行。
