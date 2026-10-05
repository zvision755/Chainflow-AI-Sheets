# ChainFlow AI Sheets

中文表格式 AI 工作流：每行是一组数据，生成列按依赖顺序处理前面列的结果。新版从零实现，已替换 Google AI Studio 旧版。支持访客自带密钥的 API 模式，以及 Mac 本地使用 Codex ChatGPT 订阅的 Agent 模式；公开 Sites 的 Agent 模式仍使用访客自己的 API key。

## 启动

需要 Node.js 22.13 或更高版本。本次使用 Node 26.10.0。所有项目依赖都在项目内 `node_modules`，版本由 `package-lock.json` 锁定，不依赖全局项目包。项目没有使用 Python；如果以后添加 Python，请建立并使用本项目 `.venv`。

```sh
git clone https://github.com/zvision755/Chainflow-AI-Sheets.git
cd Chainflow-AI-Sheets
npm ci
npm run dev -- --host 127.0.0.1 --port 3002
```

访问 http://127.0.0.1:3002 。开发服务器保持运行时才能访问。终端 Ctrl+C 停止。本地默认端口为 3002，为 Docker Homepage 留出 3000；端口被占用时会报错，不会自动跳到别的端口。

换 Wi-Fi 不影响 `127.0.0.1` 或 `localhost`，两者都指向本机。不过浏览器将它们视为不同站点，各自保存表格、凭证和 TTS 配置；日常保持使用 `http://127.0.0.1:3002`，避免切换地址后看到另一份浏览器数据。

需要在退出 Codex 后继续预览时，在项目目录执行 `npm run preview:background`，它启动独立后台进程，日志在忽略的 `outputs/preview.log`；已有本应用预览时不会重复启动。后台进程仅本地开发使用，Mac 重启后需重新启动。

### 用 LaunchManager 管理 Mac 服务

在已安装依赖的项目目录运行 `npm run service:configure`，生成用户启动项 `ai.chainflow.sheets`。先停止已有开发服务器，再打开 LaunchManager → Launch Agents → User，搜索 `ai.chainflow.sheets`，点击 **Load** 加载。此后点击 **Stop** 停止、**Start** 启动。登录 Mac 后自动启动，访问地址仍为 http://127.0.0.1:3002；退出 LaunchManager 或 Codex 不会停止已托管的服务。KeepAlive 关闭，手动停止后不会立即重新启动；下次登录仍自动启动。如不希望登录时自动运行，在 Edit 中关闭 RunAtLoad 并保存。

启动项位于 `~/Library/LaunchAgents/ai.chainflow.sheets.plist`。它直接运行前台 Node 进程和本项目 `scripts/run-framework.mjs`，使用项目内依赖，仅监听 `127.0.0.1:3002`。不要在 LaunchManager 中填写 `npm run preview:background`，该命令会脱离托管进程；完成托管后日常使用 LaunchManager 的按钮，无需再运行后台预览命令。项目移动后，在新目录运行 `npm run service:configure` 重新生成配置，然后在 LaunchManager 重新加载。

日志在忽略的 `outputs/launchd.stdout.log`、`outputs/launchd.stderr.log`，可展开启动项查看。配置只设置 PATH，没有密钥或 Codex 登录数据。Agent 模式继续通过本机 Codex 自己管理的登录运行。此启动项只用于 Mac 本地，不属于 Sites 部署。

Mac 开发环境自动读取系统 HTTPS 代理，只支持回环地址代理。可显式覆盖：

```sh
CHAINFLOW_DEV_PROXY=http://127.0.0.1:7897 npm run dev -- --host 127.0.0.1 --port 3002
```

不用本地代理时设置 `CHAINFLOW_DEV_PROXY=off`。该配置没有密钥，且只在开发工具中生效。部署 Worker 不包含本地代理逻辑。

## 马上测试

1. 点击「载入示例」会加载当前批准的日语学习示例：两行输入「フレーム」「水差し」、日语例句提示词、日语老师完整系统提示词和四个已完成结果。载入本身不会发送请求。
2. 「连接 API key」提供 OpenAI 官方、DeepSeek 官方、自定义 API 三项。自定义支持基础 URL 或完整 Chat Completions / Responses 接口，例如 `https://aihubmix.com/v1/chat/completions`。切换提供商清除当前密钥，保留表格；现有列模型不会自动改动。
3. 输入对应提供商的密钥，按需勾选「记住此浏览器的密钥」。勾选后同一浏览器/站点再次打开自动恢复；取消勾选移除本地保存的密钥，当前会话仍可用；「清除密钥」同时清除内存及本地凭证。
4. 已完成示例跳过重复调用。可点击单元格「运行」重新生成该结果，或者修改输入后运行整行/全部。运行全部先确认预计请求数量与并发。下游等待本次运行中的来源列全部完成，再等待设置的时间。
5. 完成后生成计数和排队数回到 0。修改输入只标记下游需要更新，不自动发送请求。停止、超时与失败都有明确状态和重试入口。
6. 刷新保留表格与连接设置；未选择记住时不恢复密钥，中断中的任务恢复为已取消。当前页面更新前已备份原有提示词/结果，没有手动刷新用户页面。

不要把密钥粘贴进聊天、终端命令、仓库文件或环境变量。应用不从本地文件自动读取 API key。

## 功能

- 第一列编辑输入；生成列新增、删除、重命名、排序、多个来源、提示词、模型、推理强度与输出上限。
- 无环依赖图，阻止循环引用与删除仍被依赖的列；视觉列顺序可以独立于依赖顺序。
- 行新增、删除、复制；输出可以手动编辑。
- 单元格重跑，单行、整列、全表运行；停止与失败重试。
- 生成状态：待运行、排队、生成中、完成、失败、已取消、需要更新。
- 默认开启流式输出，API 和本地 Codex Agent 均可逐步显示正文；开关保存在浏览器运行设置中。
- 本地浏览器保存、JSON 导入导出、CSV 导出（防止常见表格公式注入）。
- 中文桌面宽表格及窄屏横向表格滚动；执行记录含每次实际调用的耗时和 tokens。
- 拖动列标题右边界独立调整列宽（180–1200 像素）；双击恢复默认，聚焦边界后方向键微调。列宽随浏览器表格和 JSON 保存，排序后跟随对应列，调整宽度不重新生成结果。默认 A/B 更窄，C 更宽，适合词汇、例句和长篇解释。
- 本地 Kokoro TTS：独立配置 API、音色与语速；每列选择朗读语言，单元格一键朗读、停止或切换，无音频文件缓存。

上限：500 行、30 列；输入/输出单元格 32000 字符；单列提示词 12000 字符；输出 64–4096 tokens；并发 1–3。

## API 与 Agent 模式

API 模式按依赖图调度，一个单元格默认一次模型请求（OpenAI 官方使用 Responses，DeepSeek 官方使用 Chat Completions，自定义按 URL 后缀选择）。同一次运行中，依赖列等待来源列的全部计划单元格完成，然后等待用户设置的时间再开始（0–60 秒，默认 0.5 秒）。等待只占排队数，不占生成数；可以停止等待中的任务。默认开启失败自动重试，仅对网络、限流、暂时性服务端错误和超时生效；默认最多额外重试 2 次，首轮间隔 2 秒，后续间隔加倍（上限 60 秒），可手动调整次数/间隔或关闭。等待时进入排队，不占生成计数，可以停止或修改输入取消；没有无限循环。无效密钥、余额不足、无模型权限、截断或参数错误不会自动重试。运行全部确认显示包含潜在重试的请求上限，重复付费风险仍由用户控制。设置单独保存在浏览器。

Agent 模式先按依赖规划；生成后进行配置的本地检查（最少字符数、包含来源原文），不增加模型调用。只有开启列的「额外语义检查」才调用模型判断是否符合提示词。未通过时，在修正次数、最大实际调用步数与整次时限内修正；暂时性网络/限流错误由共用调度器进行排队重试，受自动重试次数、最大调用步数及总时限限制。无效密钥、无权限或余额不足不自动重试。默认最多 50 次调用、1 次修正、10 分钟；单元格也有超时。公开 API/Agent 共用访客凭证转发层；本地 Codex Agent 使用独立订阅适配器。

本地规则无法全面判断任意自然语言要求。需要语义判断时明确启用检查，会额外收费。最大步数包含生成、修正和语义检查。执行记录仅在内存保留最近 300 步，刷新清空。

### 流式输出

首页「流式输出」默认勾选，旧设置自动迁移为开启；取消勾选后等待完整结果再显示。开关同时适用于 API、公开 Agent 和本地 Codex Agent，保存在浏览器独立运行设置中。API 使用 `stream:true`：Responses 读取正文 delta 和完成事件，Chat Completions 读取正文 delta、完成标记及用量；本地 Codex 读取最终回答的增量通知，不显示分析/旁白或语义检查 JSON。本地 HTTP 入口直接转发流，避免先缓冲整段响应。

生成中的文字是临时预览；正式结果、JSON/CSV 导出和浏览器表格保存只使用最后一次成功接受的结果。只有收到完整结束标记且通过该模式检查后才更新结果、触发下游依赖等待。停止、编辑上游、超时或流中断会丢弃临时预览，保留原正式结果；连接中断按现有设置有限重试，迟到的增量和旧请求不能覆盖新结果。每次模型请求只有一次网络调用，开启流式不额外调用模型，也不增加任何系统/用户提示词。

提供商响应头缺少 SSE 标记时，服务端只检查有限前缀并继续转发原始流，不收集完整响应。如果提供商忽略流式参数并返回完整 JSON，同一次请求直接使用完整结果；若明确拒绝流式参数，会提示关闭开关，不自动追加一笔非流式请求。字符、响应大小、并发和 110 秒服务端时限同样约束整个流，直到完成或取消才释放并发名额；响应禁止缓存。流式不能缩短模型首字输出前的排队/思考时间，也不能让仅返回完整结果的提供商提前出字。

### Codex 本地订阅适配器

Mac 本地开发时，Agent 模式使用官方 Codex App Server 与本机 ChatGPT 订阅登录，无需 API key。已在本机桌面应用自带的 `codex-cli 0.160.0` 验证 ChatGPT Plus 登录、模型列表和 `gpt-6-luna` 完成推理。本机 Homebrew CLI `0.46.0` 太旧，适配器优先选择桌面应用里的新版可执行文件；可用 `CHAINFLOW_CODEX_BIN` 指定其他安装，不修改全局 CLI。

使用步骤：通过 `npm run preview:background` 或 `npm run dev` 启动，打开 http://127.0.0.1:3002，切换 Agent 模式。页面自动检测登录，显示“Codex 订阅已连接”；在“Agent 模型”选择模型，默认为 `gpt-6-luna`。模型目录不等于权限保证，真实调用仍会检查访问权限。Agent 模型独立于列中保存的 API 模型。切换 Agent 模型会保留原结果并标记生成列“需要更新”，不会自动发起调用。列推理设置“无”在 Codex 中映射为“低”；不支持的强度会明确报错。

桌面聊天当前没有暴露可附着的控制 socket，因此适配器用同一新版 Codex 二进制启动专用 stdio App Server，复用 Codex 自己管理的登录，不向已有聊天发消息、不操作已有任务。它不会读取、复制或向浏览器发送 `auth.json`。每次推理前验证账户类型为 ChatGPT；API key 登录会被拒绝，子进程移除 API key 环境变量，绝不自动回退到 API 模式。

本地入口仅在 Vite 开发插件中注册：`POST /api/local-agent/status`、`POST /api/local-agent/generate`。只允许回环来源、正确 Host 和同源 Origin，严格验证 JSON、70 KB 请求上限，拒绝 Authorization 和额外参数，不记录 Codex 原始诊断。最多 3 个并发，连接阶段有独立时限，推理最多 110 秒；停止调用官方 `turn/interrupt`，只中断对应任务。临时连接/限流错误按页面设置重试；订阅额度耗尽、登录失效与模型不可用不会循环重试。

使用 ephemeral 文本任务与只读沙箱，在子进程配置里关闭命令、MCP、插件、Apps、Hooks、子 Agent、自动目标续跑和联网搜索；不修改用户全局配置。表格仍按依赖规划、检查和有限修正，显示每次任务的模型、耗时、错误和实际 token 用量。检查默认在本地完成，开启语义检查才新增模型调用。Codex turn 接口没有与 API 模式相同的硬 `max_output_tokens` 参数：列 tokens 在本地模式是提示预算，另限制返回字符数（最多 32,000、随预算缩小）和时限；最大调用步数统计表格发起的 turn，不保证限制 Codex 内部网络重试次数。内部重试仍受单次/整次时限约束。

公开 Sites 构建的 capabilities 始终为 `codex:false`，不注册上述入口；公开 Agent 仍需访客自己的 API key。Node 进程调用代码只存在于 `build/codex-*.ts` 等开发工具，不进入部署 Worker。

## 本地 Kokoro TTS

先在 LaunchManager 启动已有的 Kokoro 服务，再点击首页「配置 TTS」。本机默认地址为 `http://127.0.0.1:8880/v1`，模型为 `kokoro`，语速为 1；也可填写完整 `/v1/audio/speech` 地址。这里只接受本机回环地址，不需要或传递 API key。点击「测试连接」读取服务提供的音色列表，不生成音频。本机已验证返回 41 个可用音色。

每个列标题下方和列设置中都有朗读语言选择，包括输入列。支持不朗读、日语、美式英语、英式英语和中文；默认音色分别为 `jf_alpha`、`af_heart`、`bf_emma`、`zf_xiaobei`，可在 TTS 配置中调整。当前四列表格为 A/B 日语、C 不朗读、D 美式英语。旧表格首次迁移采用这个列位置规则；明确选择过的语言始终保留，新建列默认不朗读。改语言不会让已有 AI 结果需要更新，也不会调用模型。

点击单元格「朗读」后，文字通过本地同源接口送到 Kokoro，短暂合成后自动播放；该 Kokoro 接口返回完整 WAV，目前不支持边生成边播放。每次点击重新合成，音频只放在服务端及浏览器内存中，不写文件、localStorage 或导出内容；播放结束、停止、切换单元格或修改被朗读文字后释放当前 Blob URL。同一时间只播放一段音频，取消后迟到的响应不会播放。浏览器若限制自动播放，会显示「点击播放」，该操作直接播放已就绪的当前音频，不重复合成。

单次最多 4096 个字符，服务端最多一个合成请求、90 秒超时，并限制返回音频大小；失败有明确提示，可以再次点击。停止会取消网络等待和播放，但已经进入 Kokoro 的模型推理仍可能在服务里完成。朗读与 AI 调度独立，不改变生成计数，不消费 OpenAI API 或 Codex 额度。TTS 地址、音色、语速保存在浏览器独立设置项；列语言随表格 JSON 保存和导出。

本地入口是 `POST /api/local-tts/voices`、`POST /api/local-tts/speech`，校验回环来源、Host、同源 Origin、JSON 参数、大小和目标地址，拒绝凭证、远程目标、额外参数和重定向；响应禁止缓存。公开 Sites 构建固定为 `tts:false`，不注册这些入口，因为部署服务器不能访问访客 Mac 上的 Kokoro。公开版保留列语言和配置界面说明，但本机朗读按钮不可用；本功能面向 Mac 本地运行。

## 列提示词与动态模板

生成列配置分别提供系统提示词（角色、规则、输出格式）和用户提示词（本次任务与数据）。两者均支持模板，点击模板按钮在光标位置插入；可指定插入位置、查看说明并选择某一行预览实际系统/用户消息。预览不调用模型；时间和请求 ID 在正式请求前重新计算。旧表格的用户提示词默认是 `{{text}}`，保持原来的来源输入方式。修改任一种提示词会保留结果文字，并将该列及其下游标记为需要更新。

| 模板 | 运行时内容 |
| --- | --- |
| `{{text}}` | 所选来源内容；多来源按列名拼接 |
| `{{existing_result}}` | 本次请求前当前格子的已有结果；首次为空 |
| `{{recent_results}}` | 最多 5 条结果的 JSON 数组，总长不超过 10000 字符；仅插入此模板时发送 |
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

模板只做一次字面替换，不执行来源内容里的模板或代码。未知模板、空用户消息或展开后超出系统 12000 / 用户 32000 字符的请求会给出错误，不调用模型。表格 JSON 保存模板原文，不保存展开后的时间、请求 ID 或历史记录；当前结果依旧按普通单元格保存。会话历史仅在内存保留最近 100 个格子，每格最多 5 条；刷新后过去历史清空，但当前格子的已有结果仍可用于排除。修改上游、列生成配置或直接编辑格子时清除受影响格子的历史。

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
- `components/tts-settings.tsx`：TTS 连接测试、音色与语速配置。
- `build/local-tts-http.ts`：仅本地的 Kokoro 请求转发、并发、超时和二进制音频响应。
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

请求限定 70 KB，响应读取最多 1.5 MB，提供商超时 110 秒，所有响应 `no-store`。验证同源 Origin、JSON 类型、模型 ID 和参数；按密钥 SHA-256 摘要维护短时并发/频率计数，不保存原始密钥。每个 Worker isolate 内最多 12 个并发，每个密钥最多 3 个并发/分钟 60 次。计数仅是 isolate 级保护，不能跨 Cloudflare 全部 isolate 提供全局统一配额；生产如需更严格全局限制，可另加 Durable Objects。

取消会停止队列、终止客户端/服务端请求并隔离旧结果。已到达提供商的请求仍可能收费，浏览器断开后 Worker 获取不到取消通知时也受 110 秒超时限制。

## 检查

```sh
npm run typecheck
npm test
npm run build
```

96 项核心/服务端/凭证/示例/本地 Agent/TTS/提示词模板/重复结果/流式测试通过。TTS 测试覆盖目标限制、同源与参数验证、二进制音频、并发与超时、取消和旧响应隔离、播放失败、Blob URL 释放，以及公开版关闭本地入口。当前本机页面验收使用 Codex 自带浏览器，已验证真实 Kokoro 日语/英语播放、停止、失败提示和桌面/手机布局，原表格提示词与结果保留。此前的 4 项 Playwright 自动化界面测试已通过；保留 `npm run test:ui` 仅作为未来 CI 的可选入口，本机不自动运行。CI 如需运行，可修改配置并使用项目内浏览器：

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
