# Docker 本机运行

适用于 Mac OrbStack 和 Windows Docker Desktop（Linux containers）。同一份 Dockerfile 按主机架构安装 Linux 原生依赖，支持 ARM64 和 AMD64。Docker 使用 Node 正式构建，不运行 Vite 开发服务、不挂载 Mac 路径，也不依赖 LaunchManager。默认访问地址为 **http://127.0.0.1:3003**，原 Mac 开发版仍在 3002。

## 当前版本更新

Docker 是主要维护版本。工作簿及模型/TTS 配置现在存于服务器 SQLite，同一账户跨设备共享。首次升级先生成独立主密钥；日常更新前做完整备份，再拉取代码并重建 app，保留数据库、主密钥和 Codex 登录卷。完整说明见 [更新记录](../CHANGELOG.md) 和 [备份恢复说明](../docs/server-storage.md)。

## 启动与管理

在项目根目录运行（PowerShell/终端均可）。首次部署先生成主密钥：

```sh
node scripts/init-master-key.mjs
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=50
```

也可用 `npm run docker:up` 启动。日常通过 OrbStack / Docker Desktop 管理 `chainflow` 项目，把 `app` 和 `kokoro` 一起启动、停止或重启；无需再用 LaunchManager 管理 TTS。Docker Engine 启动后，`unless-stopped` 会自动恢复之前运行的服务；手动停止的容器保持停止。Windows 要在 Docker Desktop 设置里启用登录后启动 Docker Desktop。桌面软件退出且 Engine 停止时，网站不能访问。

```sh
docker compose stop
docker compose start
docker compose restart
docker compose down
```

`down` 删除容器和网络，保留登录和数据库卷；不要使用 `down -v`，这会删除账户、工作簿和 Codex 登录。更新源码后重新执行 `docker compose up -d --build`。重新构建镜像不删除数据库或登录卷。

首次部署或升级前运行 `node scripts/init-master-key.mjs` 生成独立加密主密钥，已有密钥不会覆盖。数据库和密钥需要一起备份，详见[服务端存储与恢复](../docs/server-storage.md)。

Docker 现在统一使用可自定义用户名的密码认证，首次打开手动设置用户名和密码。TTS、Agent 和模型 API 都必须登录，不再将 localhost、私网 Host 或代理 Origin 作为权限条件。登录保留 30 天，容器更新保留原 Codex 卷及新增认证卷。需要从 LAN/NAS 访问时，在 `.env` 设置 `CHAINFLOW_BIND_ADDRESS=0.0.0.0`，并允许 Windows 专用网络 TCP 3003；默认端口仍仅绑定本机。详见[管理员登录、fnOS 兼容与手机验证](../docs/admin-login.md)。

### 手机视图测试

源码新增 Mobile View 后，需重新构建 app 镜像，单纯重启旧容器不会更新页面。在 Windows PowerShell 中进入项目目录，先导出工作簿 JSON，再执行：

```powershell
git pull --ff-only origin main
docker compose up -d --build app
docker compose ps
```

保留原 `.env` 和数据卷。只更新 app，不会主动启动已停用的 Kokoro 服务。沿用上述局域网设置，在 Windows 防火墙允许可信专用网络访问 TCP 3003，通过 `ipconfig` 查看当前 Wi-Fi／以太网 IPv4；手机连接同一局域网后访问 `http://该IPv4:3003`。页面按宽度自动选择手机视图，也可在「菜单」中手动切换。

手机右下角 + 支持任意列输入、运行后留在详情、连续新增或提交后关闭；点击已有格子可查看整行。详情关闭不影响后台任务。完整说明见 [Mobile View](../docs/mobile-view.md)。测试范围包括 150 项核心／服务端测试及 26 项浏览器测试；真机触屏、键盘和音频播放仍需实测。

工作簿以服务器数据库为准，手机与电脑登录同一账户后共享。切换设备前等待“已保存到服务器”，另一台已打开的页面需刷新。JSON 仍可用于导入导出，不含模型连接凭证。

## API 模式与表格迁移

API 模式使用管理员保存的加密密钥和受控上游地址，由后端解密并发起请求；保留原有调度、流式、有限重试和导入导出。连接设置另有独立的「本地大语言模型」入口，支持宿主机 LM Studio（1234）和 Ollama（11434）的 OpenAI 兼容接口，可不填 key；Docker 仅把这两个本机端口映射至宿主机，不允许任意内网 URL。本地模型 API 也经过管理员登录和 CSRF 校验；未登录的局域网设备不能调用。镜像和明文环境变量不包含模型密钥；数据库只保存加密密钥，主密钥通过独立 Docker Secret 提供。请求失败不会自动切换 Codex。API 与公开 Sites 模式保持独立。

原 Mac 3002 开发版的浏览器数据不会自动出现在 Docker。可在原页面导出 JSON，再到 Docker 导入；输入、结果、列提示词、模板、宽度和语言保留，JSON 不含 API Key。旧 Docker 浏览器数据可通过迁移入口上传；没有需要迁移的数据时，可创建全新空白工作簿。迁移后不同地址只需分别登录，同享服务器数据。

## Codex 订阅 Agent

镜像包含项目内、锁定版本的官方 `@openai/codex` CLI；不使用 Windows/Mac 的可执行文件。容器启动独立 stdio App Server，沿用已有的受限工具权限和流式桥接，不强制结果包含来源原文；默认模型 `gpt-6-luna`，从容器账户加载可选模型。镜像没有登录凭证，不读取或挂载主机 `.codex`。

首次使用时由你完成容器登录：

```sh
docker compose exec app /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --device-auth
docker compose exec app /app/node_modules/.bin/codex login status
```

或者在安装 Node 的主机运行 `npm run docker:login`。根据终端显示的官方网址在浏览器完成登录，设备码只在自己的终端使用，不粘贴进聊天。设备认证为官方 beta 功能，可能需要先在 ChatGPT 安全设置允许设备码登录。若账户不允许该方式，可由你按[官方无界面登录文档](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)完成其他登录方法；本项目不会自动复制主机凭证或改用 API key。

登录由 Codex 自己写入专用 `chainflow_codex-login` 卷中的 `/data/codex`，由非 root 用户使用。该卷含私密登录令牌，不能上传、共享或提交 Git；与浏览器可选 API key 记忆完全不同。正常重启/重建保留登录，过期/撤销需要重新登录。登录后点击页面 Agent 模式的「重新连接 / 更新模型」。订阅耗尽、无模型权限或 API key 登录明确拒绝，不作为公共访客的凭证后备。

退出登录：

```sh
docker compose exec app /app/node_modules/.bin/codex logout
docker compose restart
```

API-only 使用者可以在 `.env` 设置 `CHAINFLOW_CODEX_ENABLED=false` 并重新启动；此时 Agent 使用页面自带 API key 的执行方式。此操作是明确的运行配置，不是自动回退。

## 内置 Kokoro 与第三方 TTS

Compose 自动构建并启动项目内的 Kokoro ONNX CPU 模型，与网站一起管理，不依赖 Mac/Windows 主机另开的服务或 LaunchManager。模型健康后启动前端；首页配置默认使用内置模型，原默认 8880 地址自动迁移。模型、41 个日语/英语/中文音色和词典都打入镜像，运行时不需要网络。首次构建需下载约 354 MB 模型/音色及 Python 依赖。Docker 不使用 Mac MLX/Metal；CPU 性能以实际合成测量为准。

默认语速 0.5–2，一次最多 4096 字符、90 秒超时，一个合成线程。音频只在内存流转，不产生缓存音频文件。网站访问固定的 Compose 内部服务；Mac 3002 开发版通过仅回环 8881 端口复用同一模型。8881 不是原来的 8880，Wi-Fi 地址变化没有影响。

「TTS 提供方」还可以切换到可选的「火山 TTS（免配置 · 在线实验）」。它参考 Pot App 社区插件使用的免鉴权端点，固定由本站服务端请求，不需要填 key。用户此前有约两年的正常使用经历，但最近重测 Pot 插件时似乎无法使用；2026-10-08 ChainFlow 本机适配链路曾成功合成 MP3，不能据此推断其他网络环境或 Pot 插件当前可用。该端点并非火山官方承诺的第三方 API，可能调整或暂时不可用。每次朗读都会把文字发送给火山服务。偏好离线使用时可继续选择随 Docker 提供的 Kokoro。第三方 OpenAI 兼容 TTS 地址、模型和音色仍可自定义，密钥只在当前页面内存保存。接口限制与处理方式见 [内置模型、协议、锁文件和校验说明](../tts/README.md)。

## 网络代理

OrbStack 默认跟随 Mac 系统代理。Windows 可在 Docker Desktop 配置代理；如 Node/Codex 推理还需显式代理，在 `.env` 设置（仅示例，无凭证）：

```dotenv
CHAINFLOW_HTTP_PROXY=http://host.docker.internal:7897
```

Compose 将该设置用于构建阶段的 npm、Python 和模型下载，以及运行阶段的 API/Codex 外部请求；内置 TTS 请求仅走容器内部网络，第三方远程 TTS 使用运行时代理；代理设置不放入浏览器。只接受主机/回环 HTTP(S) 代理，不接受含账号密码、查询参数或任意远程地址的代理。代理地址里的 127.0.0.1 指容器本身，主机代理要使用 host.docker.internal。未设置时正常直连。构建使用下载缓存和有限重试，网络中断后可再次执行构建，模型必须完整通过哈希校验才会使用。

## Codex 登录连接问题

Docker 运行镜像安装系统 `ca-certificates`，供容器 Codex 校验 OpenAI HTTPS 证书。旧镜像缺少证书包时可能报 `error sending request for url`；拉取本修复后需重新构建并创建主服务，单纯重启旧容器不会更新镜像：

```sh
git pull --ff-only origin main
docker compose up -d --build app
```

若认证仍失败，检查代理连通性。`CHAINFLOW_HTTP_PROXY` 由应用用于推理连接；直接运行容器里的登录 CLI 时，如需代理，请显式传入 `HTTPS_PROXY` / `HTTP_PROXY`（以下为主机代理端口示例）：

```sh
docker compose exec -e HTTPS_PROXY=http://host.docker.internal:7897 -e HTTP_PROXY=http://host.docker.internal:7897 app /app/node_modules/.bin/codex -c 'cli_auth_credentials_store="file"' login --device-auth
```

在 ChatGPT 安全设置启用设备码登录后，重新运行命令获取新的设备码，由自己完成浏览器授权。登录完成后执行 `docker compose exec app /app/node_modules/.bin/codex login status`，再点击页面「重新连接 / 更新模型」。不要关闭 TLS 证书校验，也不要提交 `.env` 或登录卷中的凭证。

## 安全与健康检查

多阶段镜像仅包含正式前端/服务端、运行依赖和 Codex；构建上下文采用目录白名单，忽略 `.env`、auth.json、txt 密钥文件、node_modules、输出/浏览器备份和 Git/tool state。运行用户为 `node`，根文件系统只读，临时工作区在 `/tmp`，Codex 登录卷和 app-data 卷可持久写入（TTS 模型只读），主密钥以只读 Secret 挂载；不挂载 Docker socket 或任意主机目录。进程退出有停止时限，容器日志滚动限制为 3×10 MB，应用不记录请求正文、Authorization、密钥或 Codex 原始诊断。

健康检查访问 `/healthz`，只检查服务响应，不请求模型或消耗额度。`healthy` 不代表已登录 Codex、模型有权限或 API key 正确。原有服务端限制继续生效：工作簿写入最多 20 MB，其他请求 70 KB、1.5 MB 模型响应、32,000 输出字符、每个凭证最多 3 并发和有限重试，流式直到结束/取消才释放并发。

## 验证

```sh
npm run typecheck
npm test
npm run build:docker
docker compose up -d --build
docker compose ps
```

Docker 专项模拟测试覆盖真实 Node HTTP 的增量传输、取消、依赖链结果、计数归零、Host/Origin/大小/密钥检查、未登录不回退、内置 TTS 固定地址及第三方密钥转发。真实 OpenAI 调用仍由你在页面输入自己的 key 完成，容器订阅推理由你首次完成官方登录后验收。

2026-10-06 已在 Mac OrbStack 实测 ARM64 正式镜像：容器健康、页面水合与桌面/390px 窄屏布局、从原 3002 页面导入当前提示词和全部单元格结果、容器重启和专用卷持久化、非 root/只读文件系统、无主机密钥/登录文件、Kokoro 41 个音色及实际日语合成均通过。OpenAI 官方地址通过本机代理可达，测试用无效密钥正确返回 401；未读取个人 API key 或执行真实付费生成。容器 Codex CLI 0.160.0 启动正常，未登录时页面明确要求容器登录；没有复用 Mac 登录态。101 项自动测试、类型检查、Docker 正式构建和原 Sites 构建通过。原 3002 服务继续运行。

后续内置 TTS 更新：105 项应用测试、3 项 Python 服务测试、类型检查、Docker 与 Sites 构建通过。两个正式容器均健康；日语、美式/英式英语、中文短句实际合成约 0.6–1 秒。独立 `--network none` 临时容器验证了离线启动和三种语言合成；停用旧主机 8880 服务后，3003 和 3002 均返回有效 WAV。内置浏览器验证默认模型、41 个音色、播放/停止、第三方缺少密钥提示与桌面/390px 窄屏。没有执行付费 TTS 请求或产生缓存音频文件。原独立 TTS 代码/模型保留作试用回退。

此前的网站/Codex Linux AMD64 镜像已在 OrbStack x86 仿真下完整构建并启动，首页、健康检查、API-only 配置和 AMD64 Codex CLI 0.160.0 均通过。本次新增 Kokoro 镜像实测为 ARM64；依赖与基础镜像支持 AMD64；截至该次验证，尚未验证 AMD64 合成或 Windows 实机。后续 Windows 验证见下文。日常保留 ARM64 服务。Windows Docker Desktop 使用 Linux containers，并需在 Windows 自行完成容器登录、API key 输入及内置 Kokoro 朗读测试。

2026-10-08 Windows Docker Desktop（Linux AMD64）实测：补齐系统 CA 证书后，通过主机代理完成容器 ChatGPT 设备码登录；登录状态为 `Logged in using ChatGPT`，Agent 状态返回 `connected: true`，发现 8 个模型。用户确认 Windows Docker Agent 实际生成成功。登录保存在原专用数据卷中；网页、健康检查及 Kokoro 41 个音色列表通过。

2026-10-08 Mac OrbStack（ARM64）同步上述更新后实测：`ca-certificates` 已安装，app 与 Kokoro 容器均为 healthy，`/healthz` 返回 200；容器 Codex 登录状态为 `Logged in using ChatGPT`。使用页面 Agent 模式和 `gpt-6-luna` 在独立的「Agent 验收 10月8日」工作表运行两列依赖流程：输入「フレーム」，B 列生成日语解释（13.4 秒），C 列自动取得 B 的结果并生成中文解读（16.0 秒）；2/2 结果完成，运行与排队计数均回到 0。日语 Kokoro 实际请求返回有效 WAV。129 项自动化测试、TypeScript 类型检查及更新后的 Docker 镜像构建通过。登录凭证留在 OrbStack 专用 Codex 数据卷；未导出或提交凭证。该 Agent 验收表保留在浏览器，C 列提示词为快速测试设置的两句话，正式「日语词汇学习」工作表和提示词未改动。本次只同步并验证已有代码更新，没有新增应用代码。

参考：[OrbStack 容器访问 Mac](https://docs.orbstack.dev/docker/network#connecting-to-servers-on-mac)、[Docker Desktop 主机网络](https://docs.docker.com/desktop/features/networking/networking-how-tos/)、[官方 Codex 认证](https://learn.chatgpt.com/docs/auth)、[Vinext 官方 Node 部署](https://github.com/cloudflare/vinext)。
