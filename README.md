# ChainFlow AI Sheets

中文表格式 AI 工作流：每行是一组数据，生成列按依赖顺序处理前面列的结果。新版从零实现，已替换 Google AI Studio 旧版。支持自带密钥的 API 模式、Codex 订阅 Agent、流式输出、多工作表管理、历史结果和内置 Kokoro 朗读。

**Docker 是当前主要维护版本**，同一项目可部署在 Mac OrbStack 或 Windows Docker Desktop，也可供可信局域网中的 iPad 等设备通过浏览器使用。Kokoro 在容器内使用 ONNX CPU，第三方 TTS API 仍可选。macOS DMG 测试版作为可选方案；其 Full 版使用 MLX。v0.3.1 桌面安装包单独发布为未签名测试版。

当前源码版本：**v0.4.0**。完整功能变更、验证范围和更新步骤见 [更新记录](CHANGELOG.md)。

正在开发的 **Mobile View** 与电脑版共享工作簿和运行引擎：宽度小于 768px 自动使用手机表格，菜单可选择「自动适配／手机版／电脑版」，偏好保存在当前浏览器。手机表格以紧凑行预览最多两行文字；点击任意格子可查看、编辑整行，复制全文、切换历史、朗读及运行节点。右下角 + 支持从任意列录入；行详情底部只保留「运行」，顶部「下一行」和「+」可保存当前草稿并继续录入，不触发 AI。关闭有内容的新草稿会自动保存，空草稿直接关闭。完整行为、架构、验证和限制见 [移动端说明](docs/mobile-view.md)。这些源码更改尚未包含在已发布的 v0.3.1 DMG 中。

**Docker 跨设备共享**：同一管理员登录后自动加载服务器 SQLite 中的工作簿、模型和 TTS 配置；密钥加密保存。旧浏览器有需要保留的数据时可迁移，迁移前自动下载工作簿备份；无需旧数据时可创建全新空白工作簿。原 Mac 开发版及公开 Sites 保持各自原有存储方式。详见[服务端存储、迁移与备份恢复](docs/server-storage.md)。

## 启动

推荐 Docker 部署，在项目根目录执行：

```sh
node scripts/init-master-key.mjs
docker compose up -d --build
```

访问 **http://127.0.0.1:3003**。首次构建会下载 Kokoro 模型与运行依赖。详见 [Docker 启动、登录、TTS、局域网与迁移说明](docker/README.md)。Docker 使用独立 Node 正式构建，原有 Mac 3002 开发服务和 Sites 构建继续保留。

Docker 首次打开时手动设置管理员用户名和密码；本机、局域网、蒲公英、fnOS 和 Tunnel 使用同一账户。所有业务 API 必须登录，浏览器登录保留 30 天。密码哈希、会话和工作簿位于持久化数据卷，原 Codex 登录保留。详见[管理员登录与手机验证](docs/admin-login.md)。

更新已部署的源码：先按服务端存储说明备份数据库、账户及加密主密钥，再执行 `git pull --ff-only origin main` 和 `docker compose up -d --no-deps --build app`，最后刷新页面。首次升级先运行主密钥初始化脚本，不要删除数据卷。

**可选 Mac 桌面测试版**：到 [GitHub Releases](https://github.com/zvision755/Chainflow-AI-Sheets/releases/tag/v0.3.1-macos-beta.1) 下载 v0.3.1-macos-beta.1 的 DMG，拖入应用程序后打开，无需终端、Docker 或 LaunchManager。Full MLX 版包含 Kokoro 模型，仅适用 M 系列 Mac；Lite Universal 版不含模型，提供第三方 TTS 接口。均要求 macOS 14+，未使用 Developer ID 签名或 Apple 公证，首次打开可能需在系统设置中选择「仍要打开」。新版安装包包含 v0.3.1 的本地模型、长文导入与拆句等更新。详见 [安装说明](macos/INSTALL.md) 和 [桌面版架构与构建](macos/README.md)。

从源码运行前端需要 Node.js 22.13 或更高版本。所有项目依赖都在项目内 `node_modules`，版本由 `package-lock.json` 锁定，不依赖全局项目包。TTS 开发分别使用项目内 `tts/.venv`（Docker CPU）和 `macos/tts/.venv`（Mac MLX）；Python 版本及依赖由各目录的 `pyproject.toml`、`uv.lock` 管理。

```sh
git clone https://github.com/zvision755/Chainflow-AI-Sheets.git
cd Chainflow-AI-Sheets
npm ci
npm run dev -- --host 127.0.0.1 --port 3002
```

访问 http://127.0.0.1:3002 。开发服务器保持运行时才能访问。终端 Ctrl+C 停止。本地默认端口为 3002，为 Docker Homepage 留出 3000；端口被占用时会报错，不会自动跳到别的端口。

换 Wi-Fi 不影响 `127.0.0.1` 或 `localhost`，两者都指向本机。不过浏览器将它们视为不同站点，各自保存表格、凭证和 TTS 配置；日常保持使用 `http://127.0.0.1:3002`，避免切换地址后看到另一份浏览器数据。

退出 Codex 后若仍需运行 **本机开发预览**，可在项目目录执行 `npm run preview:background`。该命令只适用于 Node 开发服务器（3002），Mac 重启后需重新启动；LaunchManager 启动项也是可选的本机开发方式。Docker 部署请直接用 OrbStack 或 Docker Desktop 管理 `chainflow` 项目，无需 LaunchManager。

Mac 开发环境自动读取系统 HTTPS 代理，只支持回环地址代理。可显式覆盖：

```sh
CHAINFLOW_DEV_PROXY=http://127.0.0.1:7897 npm run dev -- --host 127.0.0.1 --port 3002
```

不用本地代理时设置 `CHAINFLOW_DEV_PROXY=off`。该配置没有密钥，且只在开发工具中生效。部署 Worker 不包含本地代理逻辑。

## Windows / Mac Docker Agent 模式

Agent 模式通过容器中的 Codex 使用你自己的 ChatGPT 订阅额度，不需要在页面填写 API key。Windows Docker Desktop 和 Mac OrbStack 都需先启动本项目，再为该容器完成一次 Codex 登录。登录保存在项目专用 Docker 数据卷中，重启或重新构建会保留。页面显示「ChatGPT 订阅」并列出模型后即可使用；选择模型（默认 `gpt-6-luna`），填写单元格并运行。

**模式选择建议：日常使用或重视响应速度时，优先选 API 模式**，请求通过你选定的 API 提供商和模型执行。Agent 模式适合希望直接使用 Codex ChatGPT 订阅、不想填写 API key 的场景，但响应会慢不少：本机 OrbStack 实测两步依赖生成分别耗时约 13.4 秒和 16.0 秒，实际速度会随任务、网络和账户状态变化。

**Windows（Docker Desktop）**：在 PowerShell 进入项目目录，例如 `F:\Projects\Chainflow-AI-Sheets`，然后更新并启动：

```powershell
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
```

首次登录，在 PowerShell 执行：

```powershell
docker compose exec app /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --device-auth
```

若 Windows Docker Desktop 需要使用主机代理，在 Compose 项目的 `.env` 配置（端口按实际情况调整），再重建容器：

```dotenv
CHAINFLOW_HTTP_PROXY=http://host.docker.internal:7897
```

Codex 登录命令也要显式设置代理：

```powershell
docker compose exec -e HTTPS_PROXY=http://host.docker.internal:7897 -e HTTP_PROXY=http://host.docker.internal:7897 app /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --device-auth
```

**Mac（OrbStack）**：在「终端」进入项目目录，然后更新并启动：

```sh
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
```

首次登录：

```sh
docker compose exec app /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --device-auth
```

OrbStack 通常会沿用 Mac 系统代理。如需指定代理，在项目 `.env` 设置 `CHAINFLOW_HTTP_PROXY=http://host.docker.internal:7897` 并重建；登录命令加上 `-e HTTPS_PROXY=http://host.docker.internal:7897 -e HTTP_PROXY=http://host.docker.internal:7897`。

登录命令会显示 OpenAI 官方设备授权网址和一次性代码。只在官方页面输入终端显示的代码，并在自己的 ChatGPT 账户完成授权。**不要把一次性代码、登录凭证或 API key 粘贴到聊天、发给协助你的 Agent 或写入项目文件。**授权后在终端运行 `docker compose exec app /app/node_modules/.bin/codex login status`，确认显示 `Logged in using ChatGPT`，再回到网页「Agent 模式」点击「重新连接 / 更新模型」。如果页面仍未连接，先检查容器健康状态、代理和登录状态。

不熟悉终端或 Docker 时，可以让 Codex 等编程 Agent 协助检查项目目录、执行更新和登录命令、解释错误；设备码输入和 ChatGPT 授权仍由你在官方页面亲自完成。详细代理与故障处理见 [Docker 说明](docker/README.md#codex-登录连接问题)。Agent 只处理单元格文本；生成和修正会消耗你的订阅额度。

## 马上测试

首次打开显示空白的「未命名表格」。顶部可直接编辑表格名称，使用「新建表格」和「切换表格」管理多张表格；「删除表格」需确认，本次页面内可撤销最近一次删除。删除最后一张表会自动创建空白表格。各表格独立保存输入、提示词、结果历史、布局与执行设置；切换前自动保留当前修改。生成期间需先停止才能切换。旧版单张表格会自动迁移，原存储保留。JSON 导出整个工作簿（全部工作表、提示词、配置、历史结果及布局）；Excel（.xlsx）导出全部工作表的当前单元格内容，每张表格对应一个底部可切换的 Excel 标签；重复名称和 Excel 不支持的名称会自动调整。Excel 不保存提示词、历史记录或执行配置，完整备份请用 JSON。工作簿导入及导出按钮位于页面顶部「载入示例」左边。JSON 导入兼容新版工作簿和旧版单工作表，并新增导入的工作表，不覆盖现有数据。表格列表只保存在当前浏览器，跨设备需要分别导出备份。

1. 点击「载入示例」会新增独立的「日语词汇学习」表格，不覆盖当前表格，并加载当前批准的日语学习示例：三行输入「フレーム」「壊れる」「直す」、各列系统及用户提示词、六个已完成结果与已有历史记录；保留列宽、朗读语言、历史保留数量，并恢复示例执行设置（并发 1、依赖等待 1 秒、流式输出与自动重试开启）。载入本身不会发送请求。
2. 「连接 API key」提供 OpenAI 官方、DeepSeek 官方、自定义 API 和本地大语言模型。自定义支持基础 URL 或完整 Chat Completions / Responses 接口，例如 `https://aihubmix.com/v1/chat/completions`。本地入口可选 LM Studio 或 Ollama，支持选填鉴权 token 和读取模型列表；切换提供商不会改动表格，现有列模型需在列配置中改为本地模型 ID。
3. 输入对应提供商的密钥，按需勾选「记住此浏览器的密钥」。勾选后同一浏览器/站点再次打开自动恢复；取消勾选移除本地保存的密钥，当前会话仍可用；「清除密钥」同时清除内存及本地凭证。
4. 已完成示例跳过重复调用。可点击单元格「运行」重新生成该结果，或者修改输入后运行整行/全部。运行全部先确认预计请求数量与并发。下游等待本次运行中的来源列全部完成，再等待设置的时间。
5. 完成后生成计数和排队数回到 0。修改输入只标记下游需要更新，不自动发送请求。停止、超时与失败都有明确状态和重试入口。
6. 刷新保留表格与连接设置；未选择记住时不恢复密钥，中断中的任务恢复为已取消。当前页面更新前已备份原有提示词/结果，没有手动刷新用户页面。

不要把密钥粘贴进聊天、终端命令、仓库文件或环境变量。应用不从本地文件自动读取 API key。

## 三种部署模式（0.4.0）

Server Docker 保留现有账号、SQLite 和跨设备共享。新增 Local Docker（无需登录、浏览器数据、无状态代理）及 Local Pages（无需 Docker/服务器、浏览器数据、API 直连需 CORS）。三个版本使用同一个表格 UI、工作流和移动端组件；main 发布由 Actions 构建与回归三个模式，再部署 Pages 和发行 Docker 镜像。

Local Docker：`docker compose -f compose.local.yaml up -d --build`，打开 `http://127.0.0.1:3004/`。Local Pages：[打开静态版](https://zvision755.github.io/Chainflow-AI-Sheets/)。Local 默认禁用本地 Codex 订阅，API Agent 工作流保留；Pages 默认使用浏览器 TTS。Local 密钥存于浏览器，定期导出 JSON 备份；不会连接已有 Server 数据库。

三版本差异、CORS 实测边界、备份、镜像版本与后续开发规则见 [部署文档](docs/deployment-modes.md)。

## 功能

表格工具栏提供两种长文处理方式：「长文拆句」可直接粘贴文章，按中日文、英文或自定义标点及换行规则切分，预览后填入当前工作表 A 列；「导入句子文件」可读取 Excel（可选工作表）、CSV、TSV 或 TXT，将第一列或文本条目导入 A 列。两种方式都只整理/导入数据，不自动调用模型，之后可逐条运行或点击「运行全部」。TXT 默认使用与粘贴相同的中日英混合拆句选项，换行切分及保留标点默认开启；导入优先复用完全空白且无历史的行。当前单表上限 2500 行，超过时不会写入部分数据。

本机 Docker 版的「本地大语言模型」支持 LM Studio（默认 `http://127.0.0.1:1234/v1`）和 Ollama（默认 `http://127.0.0.1:11434/v1`）的 OpenAI 兼容接口。Docker 会将这两个回环地址转到宿主机；服务端仅允许这两个端口和标准 `/v1` 推理/模型路径，公开 Sites 不开放本机目标。模型服务如启用了认证可填 token；token 只在当前页面内存使用，不记忆或导出。Ollama 须已在主机安装并运行，Docker 不会替用户下载或启动 Ollama。

本地模型是可选项，速度和质量由本机加载的模型决定。当前 Qwen 实测明显快于 Agent，但在长句语义、日语读音/罗马音和教学解释上可能出现错误或重复；用于学习时应核对结果。模型列表会过滤 embedding/rerank 等非文本生成模型，并在检测到不匹配的旧模型 ID 时提示并切换到可用的文本模型。API 模式仍更适合追求稳定质量与速度的日常使用；Agent 模式可使用 Codex 订阅，但响应通常较慢。

- 第一列编辑输入；生成列新增、删除、重命名、排序、多个来源、提示词、模型、推理强度与输出上限。
- 无环依赖图，阻止循环引用与删除仍被依赖的列；视觉列顺序可以独立于依赖顺序。
- 行新增、删除及上移/下移；每个单元格底部都可一键复制内容，输出也可以手动编辑。
- 单元格重跑，单行、整列、全表运行；停止与失败重试。
- 生成状态：待运行、排队、生成中、完成、失败、已取消、需要更新。
- 默认开启流式输出，API 和本地 Codex Agent 均可逐步显示正文；开关保存在浏览器运行设置中。
- 本地浏览器保存、JSON 导入导出、CSV 导出（防止常见表格公式注入）。
- 中文桌面宽表格及窄屏横向表格滚动；执行记录含每次实际调用的耗时和 tokens。
- 拖动列标题右边界独立调整列宽（180–1200 像素）；双击恢复默认，聚焦边界后方向键微调。列宽随浏览器表格和 JSON 保存，排序后跟随对应列，调整宽度不重新生成结果。默认 A/B 更窄，C 更宽，适合词汇、例句和长篇解释。
- 内置 Kokoro TTS：Docker 自动启动 CPU 模型；可切换第三方 API，设置音色与语速。每列选择朗读语言，单元格一键朗读、停止或切换，无音频文件缓存。

上限：2500 行、30 列；输入/输出单元格 32000 字符；单列提示词 12000 字符；输出 64–4096 tokens；并发 1–10。

导入成功提示可撤销本次最近一批导入；刷新或切换表格后撤销入口失效，导入行有后续编辑或生成时拒绝撤销以保护数据。列设置可确认清空此列，也可将有内容的格子标记为完成（包括已停止、失败、待更新），后者保留文本及历史，不调用模型。

“运行全部”先选择范围：默认只生成缺失格子，也可同时生成需要更新的格子，数量按所选范围计算。API 与 Agent 的并发可手动输入 1–10，默认 3；失败自动重试最多 5 次，默认 3。Agent 整次运行时限可手动输入 1–60 分钟，默认 10 分钟；单次超时及最大调用步数仍独立生效。已保存工作簿的个人设置保留。

## API 与 Agent 模式

API 模式按依赖图调度，一个单元格默认一次模型请求（OpenAI 官方使用 Responses，DeepSeek 官方使用 Chat Completions，自定义按 URL 后缀选择）。同一次运行中，依赖列等待来源列的全部计划单元格完成，然后等待用户设置的时间再开始（0–60 秒，默认 0.5 秒）。等待只占排队数，不占生成数；可以停止等待中的任务。默认开启失败自动重试，仅对网络、限流、暂时性服务端错误和超时生效；默认最多额外重试 2 次，首轮间隔 2 秒，后续间隔加倍（上限 60 秒），可手动调整次数/间隔或关闭。等待时进入排队，不占生成计数，可以停止或修改输入取消；没有无限循环。无效密钥、余额不足、无模型权限、截断或参数错误不会自动重试。运行全部确认显示包含潜在重试的请求上限，重复付费风险仍由用户控制。设置单独保存在浏览器。

Agent 模式先按依赖规划，再将模型输出直接保存为结果；不强制逐字包含来源，也不额外调用模型检查或修正内容。暂时性网络/限流错误由共用调度器进行排队重试，受自动重试次数、最大调用步数及总时限限制。无效密钥、无权限或余额不足不自动重试。默认最多 50 次调用、10 分钟；单元格也有超时。公开 API/Agent 共用访客凭证转发层；本地 Codex Agent 使用独立订阅适配器。

执行记录仅在内存保留最近 300 步，刷新清空。旧工作簿中的 Agent 检查配置仅为兼容历史数据保留，不再执行。

### 流式输出

首页「流式输出」默认勾选，旧设置自动迁移为开启；取消勾选后等待完整结果再显示。开关同时适用于 API、公开 Agent 和本地 Codex Agent，保存在浏览器独立运行设置中。API 使用 `stream:true`：Responses 读取正文 delta 和完成事件，Chat Completions 读取正文 delta、完成标记及用量；本地 Codex 读取最终回答的增量通知，不显示分析/旁白或语义检查 JSON。本地 HTTP 入口直接转发流，避免先缓冲整段响应。

生成中的文字是临时预览；正式结果、JSON/CSV 导出和浏览器表格保存只使用最后一次成功接受的结果。只有收到完整结束标记且通过该模式检查后才更新结果、触发下游依赖等待。停止、编辑上游、超时或流中断会丢弃临时预览，保留原正式结果；连接中断按现有设置有限重试，迟到的增量和旧请求不能覆盖新结果。每次模型请求只有一次网络调用，开启流式不额外调用模型，也不增加任何系统/用户提示词。

提供商响应头缺少 SSE 标记时，服务端只检查有限前缀并继续转发原始流，不收集完整响应。如果提供商忽略流式参数并返回完整 JSON，同一次请求直接使用完整结果；若明确拒绝流式参数，会提示关闭开关，不自动追加一笔非流式请求。字符、响应大小、并发和 110 秒服务端时限同样约束整个流，直到完成或取消才释放并发名额；响应禁止缓存。流式不能缩短模型首字输出前的排队/思考时间，也不能让仅返回完整结果的提供商提前出字。

### Codex 本地订阅适配器

Mac 本地开发时，Agent 模式使用官方 Codex App Server 与本机 ChatGPT 订阅登录，无需 API key。已在本机桌面应用自带的 `codex-cli 0.160.0` 验证 ChatGPT Plus 登录、模型列表和 `gpt-6-luna` 完成推理。本机 Homebrew CLI `0.46.0` 太旧，适配器优先选择桌面应用里的新版可执行文件；可用 `CHAINFLOW_CODEX_BIN` 指定其他安装，不修改全局 CLI。

使用步骤：通过 `npm run preview:background` 或 `npm run dev` 启动，打开 http://127.0.0.1:3002，切换 Agent 模式。页面自动检测登录，显示“Codex 订阅已连接”；在“Agent 模型”选择模型，默认为 `gpt-6-luna`。模型目录不等于权限保证，真实调用仍会检查访问权限。Agent 模型独立于列中保存的 API 模型。切换 Agent 模型会保留原结果并标记生成列“需要更新”，不会自动发起调用。列推理设置“无”在 Codex 中映射为“低”；不支持的强度会明确报错。

桌面聊天当前没有暴露可附着的控制 socket，因此适配器用同一新版 Codex 二进制启动专用 stdio App Server，复用 Codex 自己管理的登录，不向已有聊天发消息、不操作已有任务。它不会读取、复制或向浏览器发送 `auth.json`。每次推理前验证账户类型为 ChatGPT；API key 登录会被拒绝，子进程移除 API key 环境变量，绝不自动回退到 API 模式。

本地入口仅在 Vite 开发插件中注册：`POST /api/local-agent/status`、`POST /api/local-agent/generate`。只允许回环来源、正确 Host 和同源 Origin，严格验证 JSON、70 KB 请求上限，拒绝 Authorization 和额外参数，不记录 Codex 原始诊断。最多 10 个并发，连接阶段有独立时限，推理最多 110 秒；停止调用官方 `turn/interrupt`，只中断对应任务。临时连接/限流错误按页面设置重试；订阅额度耗尽、登录失效与模型不可用不会循环重试。

使用 ephemeral 文本任务与只读沙箱，在子进程配置里关闭命令、MCP、插件、Apps、Hooks、子 Agent、自动目标续跑和联网搜索；不修改用户全局配置。表格仍按依赖规划、检查和有限修正，显示每次任务的模型、耗时、错误和实际 token 用量。检查默认在本地完成，开启语义检查才新增模型调用。Codex turn 接口没有与 API 模式相同的硬 `max_output_tokens` 参数：列 tokens 在本地模式是提示预算，另限制返回字符数（最多 32,000、随预算缩小）和时限；最大调用步数统计表格发起的 turn，不保证限制 Codex 内部网络重试次数。内部重试仍受单次/整次时限约束。

公开 Sites 构建的 capabilities 始终为 `codex:false`，不注册上述入口；公开 Agent 仍需访客自己的 API key。Node 进程调用代码只存在于 `build/codex-*.ts` 等开发工具，不进入部署 Worker。

## 内置 Kokoro 朗读

Docker 版默认包含 Kokoro ONNX CPU 模型，随项目启动，支持日语、英语（美式/英式）和中文。无需单独运行主机 Kokoro 或 LaunchManager 服务；点击单元格朗读即可即时合成，音频只在内存播放，不写音频文件。每列可选择语言或关闭，语速 0.5–2，一次最多 4096 字符、90 秒超时。

首页「配置 TTS」可选第三方 OpenAI 兼容 TTS API，或免配置使用 Pot 社区插件所用的火山翻译端点。用户此前有约两年的正常使用经历，但最近重测 Pot 插件时似乎无法使用；2026-10-08 ChainFlow 自身的本机适配链路曾成功合成 MP3，不能据此保证 Pot 插件或其他网络环境可用。该接口不是火山官方承诺的第三方 API，仍可能调整或暂时不可用。Kokoro 是离线选项；第三方 TTS 密钥只在当前页面内存保存，不写入工作簿或导出。公开 Sites 不包含本地 Kokoro 服务。详见 [内置 Kokoro、在线接口限制与测试记录](tts/README.md)。

## 列提示词与动态模板

生成列配置分别提供系统提示词（角色、规则、输出格式）和用户提示词（本次任务与数据）。两者均支持模板，点击模板按钮在光标位置插入；可指定插入位置、查看说明并选择某一行预览实际系统/用户消息。预览不调用模型；时间和请求 ID 在正式请求前重新计算。旧表格的用户提示词默认是 `{{text}}`，保持原来的来源输入方式。修改任一种提示词会保留结果文字，并将该列及其下游标记为需要更新。

| 模板 | 运行时内容 |
| --- | --- |
| `{{text}}` | 所选来源内容；多来源按列名拼接 |
| `{{existing_result}}` | 此格保留的全部历史结果，按时间编号；默认最近 10 次，可按列设为 1–100 次；首次为空 |
| `{{recent_results}}` | 保留历史中的最新 5 次结果的 JSON 数组，总长不超过 10000 字符；仅插入此模板时发送 |
| `{{timestamp}}` | 当前 UTC 时间，精确到秒 |
| `{{request_id}}` | 每次新请求的唯一 ID；同一秒内也不同 |
| `{{row_number}}` | 从 1 开始的当前行号 |
| `{{column_name}}` | 当前生成列名称 |

例如，B 列保留日语例句的系统规则，并设置用户提示词：

```text
来源单词：{{text}}
请提供一个新的日语例句，换场景、换句式，避开以下结果；只输出例句。
已有结果（排除数据）：{{existing_result}}
最近结果（排除数据）：{{recent_results}}
本次时间：{{timestamp}}
请求标识：{{request_id}}
```

模板只做一次字面替换，不执行来源内容里的模板或代码。未知模板、空用户消息或展开后超出系统 12000 / 用户 32000 字符的请求会给出错误，不调用模型。表格 JSON 保存模板原文和每格历史，不保存展开后的时间、请求 ID 或连接凭证。列配置的「历史结果保留次数」默认为 10，可设 1–100；成功接受的最终结果才加入记录，失败、取消和流式预览不保存。历史随浏览器本地保存和 JSON 导入导出恢复；CSV 只导出当前显示的值。超过容量自动删除最旧记录，降低容量会立即裁剪，增加容量不能恢复已删除的记录。单元格左右按钮切换历史结果，不调用模型；当前显示的记录成为下游输入，切换内容会标记下游需要更新。历史模板只有显式插入时发送，系统消息不会额外追加历史；全部历史太长时提示缩短请求，不静默截断已有结果。旧版未保存的过往结果无法补回，迁移时保留当前结果。

### 精简请求与重复检查

系统消息仅包含你填写的系统提示词及其明确使用的模板展开值，不追加隐藏时间标记、排除规则或历史。用户消息同样只按填写的模板展开。模板删除后，相应数据不会发送给模型。节省 token 时，可以保留原系统规则，并只用以下用户提示词：

```text
来源单词：{{text}}
本次时间：{{timestamp}}
```

列配置的「检查重复结果（本地）」沿用原 `freshResults` 配置，不自动改写任何消息。明确重跑会重新请求模型；完成后在本地与当前及最近 5 条结果比较，忽略 Unicode 兼容形式、大小写、标点与空白。重复时保留原结果，开启失败自动重试且预算允许时最多额外尝试 1 次，再重复就停止。整列按钮会重新运行该列所有单元格，请留意请求数量。没有使用历史模板时，本地检查不会让发送的上下文变长；使用 `{{recent_results}}` 时最多 5 条、JSON 总长最多 10000 字符，过长部分截短。刷新后过去历史清空，当前结果仍保留。

时间精确到秒，同一秒内重复请求的时间值可能相同；需要更细的区分时，可自行添加 `{{request_id}}`。这些模板不能保证语义上永不重复。提示缓存复用输入计算，不代表复用旧答案，相关说明见 [AIhubmix 官方文档](https://docs.aihubmix.com/en/api/GPT-Cache)。本站不宣称上游缓存命中为零。

API 与 Agent 首次生成共用同一组展开消息。Agent 只有在已启用的结果检查失败、需要修正时，才将简短修正反馈放入用户消息；不会修改列的系统消息。单独启用语义检查仍会按界面说明另发检查请求。

## 架构

- `core/types.ts`：表格、列、单元格、运行与用量数据。
- `core/graph.ts`：无环检查、后代集合和依赖计划。
- `core/run-settings.ts`：运行预算、可调依赖等待、自动重试与浏览器设置校验。
- `core/scheduler.ts`：队列、并发、批次预算、超时、取消、revision 防止旧结果覆盖。
- `core/prompt-templates.ts` / `components/prompt-editor.tsx`：系统与用户提示词、模板展开与预览。
- `core/fresh-results.ts`：仅本地的重复结果比较，不装饰请求提示词。
- `core/storage.ts`：显式保存白名单、导入校验、状态恢复、CSV。
- `model/client.ts`：浏览器同源请求与结构化错误。
- `model/credentials.ts`：提供商、连接设置及可选浏览器凭证记忆，与表格保存隔离。
- `core/tts.ts` / `model/tts.ts`：列语言、TTS 配置校验及可取消的内存音频播放。
- `components/tts-settings.tsx`：内置 Kokoro、可选免鉴权火山适配器、第三方 TTS 的连接测试、音色、语速及凭证设置。
- `build/local-tts-http.ts`：本地网站的 TTS 请求转发、固定目标限制、凭证、并发、超时和 WAV/MP3 音频响应。
- `tts/`：锁定依赖的 Python 虚拟环境、Kokoro 模型下载校验、离线 CPU 服务及 Docker 镜像。
- `core/example-workflow.ts`：用户批准的两行提示词与已完成结果，无密钥。
- `server/targets.ts`：受审阅的域名、HTTPS/路径验证与协议选择。
- `modes/api.ts` / `modes/agent.ts`：两种清楚分离的执行策略。
- `server/proxy.ts`：请求/凭证验证、安全官方请求、并发、超时和错误映射。
- `core/stream-protocol.ts`、`server/provider-stream.ts`、`server/provider-response.ts`、`server/generation-stream.ts`、`model/stream.ts`：有大小限制的 SSE 解析、提供商事件适配、流转发及客户端读取。
- `app/api/*/route.ts`：Sites 服务端入口。
- `build/local-api-plugin.ts`：仅开发用的 Mac 系统代理适配，不进入生产 Worker。
- `build/sites-worker.ts` 与 `sites()` 插件：官方 Sites starter 的 Worker 构建入口。

框架为 Sites 官方 Vinext / React starter，正式输出为 Cloudflare Worker ESM 和浏览器静态资源。部署不依赖 Mac 路径、localhost、长期运行本地进程、Codex CLI 或运行时 child_process。安装/构建脚本可在开发时使用 Node 进程工具，未被部署入口引用。

## 数据与密钥

默认密钥仅保留于页面 React ref 内存。按用户后续要求提供可选「记住此浏览器的密钥」：勾选后以明文保存在该站点 localStorage 的独立 `chainflow-connection-v1` 项中，下次打开恢复；浏览器同源脚本及有权访问此浏览器的人可以读取它，请不要在共享电脑启用。取消勾选立即移除已存密钥，清除密钥按钮同时清空内存和本地凭证。本站服务端不持久存储密钥，不写入 cookie、数据库、URL、分析或表格导出。没有 owner API key 或密钥环境变量。公开模式缺少访客凭证会拒绝生成；本地 Agent 必须显式切换模式并通过 Codex ChatGPT 登录检测，与 API 模式隔离。

生成费用由访客 API 账户承担。请求期间密钥会经过本站服务端发送给用户选定的提供商；本站代码不持久保存它。运营方技术上可以接触转发中的密钥，因此不承诺运营方无法接触。生产应保持平台请求日志不记录 Authorization 与请求正文；本站没有密钥日志代码或分析 SDK。

表格输入、生成结果和配置保存在 `localStorage`，仅限当前浏览器，且会发给模型提供商处理。JSON 显式导出字段不含密钥或执行日志。用户自己把秘密写进表格内容时，它会作为普通表格数据保存/导出；不要把密钥写进表格。

提供商预设仅为 OpenAI 官方与 DeepSeek 官方，另外提供自定义 API。服务端只允许 HTTPS 和已审阅域名 `api.openai.com`、`api.deepseek.com`、`aihubmix.com`、`api.aihubmix.com`、`openrouter.ai`；拒绝 IP/内网地址、非标准端口、URL 凭证、查询参数、片段、非标准路径及重定向。当前自定义不接受上述列表外的新域名；新增供应商须在 `server/targets.ts` 审阅后加入。完整 `/responses` 地址使用 Responses 协议，完整 `/chat/completions` 或基础地址使用 Chat Completions 协议，模型列表同源于该 API 基础路径。公开版本同样允许访客使用自己的第三方密钥；个人测试文件始终只用于本地，不包含在站点或构建里。OpenAI Responses 发送 `store:false`，这不替代提供商自身数据政策。

请求限定 70 KB，响应读取最多 1.5 MB，提供商超时 110 秒，所有响应 `no-store`。验证同源 Origin、JSON 类型、模型 ID 和参数；按密钥 SHA-256 摘要维护短时并发/频率计数，不保存原始密钥。每个 Worker isolate 内最多 12 个并发，每个密钥最多 10 个并发/分钟 60 次。计数仅是 isolate 级保护，不能跨 Cloudflare 全部 isolate 提供全局统一配额；生产如需更严格全局限制，可另加 Durable Objects。

取消会停止队列、终止客户端/服务端请求并隔离旧结果。已到达提供商的请求仍可能收费，浏览器断开后 Worker 获取不到取消通知时也受 110 秒超时限制。

## 检查

```sh
npm run typecheck
npm test
npm run build
# Python TTS 服务测试（先 uv sync --project tts --locked）
cd tts
.venv/bin/python -m unittest -v test_service
```

144 项核心/服务端/凭证/示例/本地 Agent/本地模型/拆句导入/TTS/提示词模板/历史结果/行高/工作簿/Excel/流式/Docker HTTP 测试通过，类型检查通过。TTS 测试覆盖目标限制、同源与参数验证、二进制 WAV/MP3、免鉴权火山适配器的固定目标与无密钥、并发与超时、取消和旧响应隔离、播放失败、Blob URL 释放，以及公开版关闭本地入口。2026-10-08 本机通过 ChainFlow 接口实际合成火山 TTS MP3；上游可用性与限制见 TTS 说明。此前的 4 项 Playwright 自动化界面测试已通过；保留 `npm run test:ui` 仅作为未来 CI 的可选入口，本机不自动运行。CI 如需运行，可修改配置并使用项目内浏览器：

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright ./node_modules/.bin/playwright install chromium
```

不要在测试里写真实密钥。核心自动化使用模拟模型，浏览器测试使用假的会话凭证和请求拦截。本次真实 aihubmix 测试只在本地读取父目录的授权测试文件并通过同源接口请求；测试工具不保存凭证。页面记忆凭证由用户的勾选选项决定。

2026-10-06 的提示词模板验收使用 Codex 自带浏览器，验证模板按钮插入、展开预览、未知模板错误、保存配置与 390px 窄屏无横向溢出。B 列通过页面现有凭证实际收到 5 条不同例句，该轮测试使用显式模板并曾启用自动追加规则（之后已移除）；后段提供商连接中断时，自动重试在上限内停止，旧结果保留，最终运行和排队计数归零。提示缓存用量未由本站接口转发，不能据此宣称上游缓存命中为零。

2026-10-06 后续精简修复移除了全部系统消息自动追加规则，验证当前 B 列系统预览与输入严格一致、用户消息只有用户保留的来源/时间模板，保存的提示词和表格结果未改动。自动测试覆盖重复检查开关不改变消息、重试不增加隐藏内容、最近历史条数/字符上限，以及 Agent 修正保持系统消息一致。

2026-10-06 流式验收使用 Codex 自带浏览器：通过页面已有凭证重跑第 1 行 B 列，API 收到多段 SSE 正文并完成；本地 ChatGPT 订阅 Agent 同样收到多段正文并完成。两次成功运行均计数归零，未触发 C 列，原有列提示词和其他单元格结果保留。开关关闭/打开均实际写入运行设置，最终保持开启；390px 窄屏没有页面横向溢出。自动测试另覆盖跨块 Unicode、完整结束标记、连接中断、有限重试、取消及迟到回调、临时结果不保存/导出、上游完整接受后才运行下游、流中跨块密钥脱敏、流结束/取消才释放并发，以及 Codex 旁白过滤。OpenAI/DeepSeek 官方调用路径通过模拟 SSE 验证，未使用个人 OpenAI key。

## 当前官方文档

2026-10-04 核实：

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [文本生成与 Responses API](https://developers.openai.com/api/docs/guides/text)
- [OpenAI 流式输出](https://developers.openai.com/api/docs/guides/streaming-responses)（2026-10-06 核实）
- [DeepSeek Chat Completions、参数与当前模型](https://api-docs.deepseek.com/api/create-chat-completion/)
- [账户模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [ChatGPT 计划与 app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

初始示例列模型保持 `gpt-6-luna`，DeepSeek 官方建议列表为当前文档中的 `deepseek-flash`、`deepseek-v4-pro`。切换提供商后请自行调整现有列的模型。账户模型列表只能辅助选择，实际一次生成成功才证明模型权限和参数支持。部分语音/图像模型会出现在列表中但不支持本应用的文本生成。

Sites 构建/发布能力依据已安装的官方 Sites 技能与 starter 核实：Cloudflare Workers ESM，默认 Worker 入口 `dist/server/index.js`，128 MB/isolate；通过原生 Sites 工具注册、推送源码、保存构建版本、部署、检查状态。没有假设 Codex CLI 自带 Sites 发布命令。

## Sites 保存与发布

原作者的站点已经注册，身份在 `.openai/hosting.json`。原作者更新时保持原项目 ID；其他使用者若要发布自己的 Sites 网站，须注册自己的项目并替换该 ID。项目 ID 不是发布凭证，GitHub 上传源码也不会自动部署网站。

1. 在 ChatGPT / Codex 桌面或网页中打开 Sites 工具对应的项目；如从另一个聊天继续，将本源码目录或无秘密源码包提供给 Sites 工作流。
2. 使用 Sites 的短期源码仓库凭证，仅通过 stdin 交给官方 `site-workflow.mjs`；不要把该凭证写进 shell 参数、文件或仓库。
3. 官方工作流检查、构建、推送精确 Git commit，并打包 Worker 输出；原生 `save_site_version` 保存对应 commit 和构建包。
4. 在用户确认 OpenAI API 模式验收通过前，只保存，不公开部署/分享。
5. 公开发布前确认访问策略为用户选定的公开访问，核实实际域名、同源 API、没有密钥环境变量、源码/构建包没有密钥、自定义 URL 校验、访客自带凭证与无所有者密钥回退。随后通过 Sites 原生部署工具部署已保存版本，并检查最终成功状态。

`.env.example` 不含秘密，公开版无须配置任何 API key 环境变量。源码不依赖父目录测试文件。

## 已知限制

- OpenAI 官方真实调用仍须用户在页面输入自己的 OpenAI key 验收；aihubmix 成功不代表 OpenAI 账户权限已验收。
- 本地浏览器持久化没有云同步，多标签页间没有协同编辑；同时修改同一工作流时以最近保存为准。
- 列的语义检查是模型判断，不保证所有答案正确；输入可影响检查结果，不能用于高风险自动裁决。
- 本地订阅适配器已用桌面应用新版 Codex 验证；旧版 CLI 不支持该协议。公开版始终不使用本机登录。
- 未经用户验收与最终发布决定，站点不会公开分享。
