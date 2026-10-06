# Docker 本机运行

适用于 Mac OrbStack 和 Windows Docker Desktop（Linux containers）。同一份 Dockerfile 按主机架构安装 Linux 原生依赖，支持 ARM64 和 AMD64。Docker 使用 Node 正式构建，不运行 Vite 开发服务、不挂载 Mac 路径，也不依赖 LaunchManager。默认访问地址为 **http://127.0.0.1:3003**，原 Mac 开发版仍在 3002。

## 启动与管理

在项目根目录运行（PowerShell/终端均可）：

```sh
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

`down` 删除容器和网络，保留登录数据卷；不要使用 `down -v`，除非确实要删除容器 Codex 登录。更新源码后重新执行 `docker compose up -d --build`。重新构建镜像不删除浏览器表格或登录卷。

如需换端口，在根目录 `.env` 写入 `CHAINFLOW_PORT=3005`，然后执行 `docker compose up -d`。端口仅发布到主机 `127.0.0.1`；HTTP 同时校验 loopback Host 和同源 Origin。此版本面向本机个人使用，不提供账号、多用户隔离或公网发布。不要仅把端口改成 `0.0.0.0` 来公开本机订阅。

## API 模式与表格迁移

API 模式仍使用页面填写的访客密钥、受控官方/自定义地址转发，以及原有调度、流式、有限重试和导入导出。容器没有站点所有者 API key、密钥环境变量或后备凭证。请求失败不会自动切换 Codex。API 与公开 Sites 模式保持独立。

浏览器把不同端口看作不同站点。3002 的表格、TTS 配置和可选记忆密钥不会自动出现在 3003。在原页面「导出 JSON」，再到 Docker 页面「导入 JSON」迁移表格；输入、结果、列提示词、模板、宽度和语言都会保留，JSON 不含 API key。密钥须在新页面自行填写。访问时始终保持同一个地址（127.0.0.1 与 localhost 也属于不同站点）。表格没有存入容器文件系统或数据卷，浏览器备份仍需自己导出。

## Codex 订阅 Agent

镜像包含项目内、锁定版本的官方 `@openai/codex` CLI；不使用 Windows/Mac 的可执行文件。容器启动独立 stdio App Server，沿用已有的规划、检查、有限修正和流式桥接；默认模型 `gpt-6-luna`，从容器账户加载可选模型。镜像没有登录凭证，不读取或挂载主机 `.codex`。

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

「TTS 提供方 → 第三方 TTS API」保留 OpenAI 兼容 WAV 接口配置，地址、模型和每种语言的音色可自定义；第三方 TTS 密钥单独输入，仅在当前页面内存保存。详情见 [内置模型、协议、锁文件和校验说明](../tts/README.md)。

## 网络代理

OrbStack 默认跟随 Mac 系统代理。Windows 可在 Docker Desktop 配置代理；如 Node/Codex 推理还需显式代理，在 `.env` 设置（仅示例，无凭证）：

```dotenv
CHAINFLOW_HTTP_PROXY=http://host.docker.internal:7897
```

Compose 将该设置用于构建阶段的 npm、Python 和模型下载，以及运行阶段的 API/Codex 外部请求；内置 TTS 请求仅走容器内部网络，第三方远程 TTS 使用运行时代理；代理设置不放入浏览器。只接受主机/回环 HTTP(S) 代理，不接受含账号密码、查询参数或任意远程地址的代理。代理地址里的 127.0.0.1 指容器本身，主机代理要使用 host.docker.internal。未设置时正常直连。构建使用下载缓存和有限重试，网络中断后可再次执行构建，模型必须完整通过哈希校验才会使用。

## 安全与健康检查

多阶段镜像仅包含正式前端/服务端、运行依赖和 Codex；构建上下文采用目录白名单，忽略 `.env`、auth.json、txt 密钥文件、node_modules、输出/浏览器备份和 Git/tool state。运行用户为 `node`，根文件系统只读，临时工作区在 `/tmp`，仅 Codex 专用卷可持久写入（TTS 模型只读）；不挂载 Docker socket 或主机目录。进程退出有停止时限，容器日志滚动限制为 3×10 MB，应用不记录请求正文、Authorization、密钥或 Codex 原始诊断。

健康检查访问 `/healthz`，只检查服务响应，不请求模型或消耗额度。`healthy` 不代表已登录 Codex、模型有权限或 API key 正确。原有服务端限制继续生效：70 KB 请求、1.5 MB 模型响应、32,000 输出字符、每个凭证最多 3 并发和有限重试，流式直到结束/取消才释放并发。

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

此前的网站/Codex Linux AMD64 镜像已在 OrbStack x86 仿真下完整构建并启动，首页、健康检查、API-only 配置和 AMD64 Codex CLI 0.160.0 均通过。本次新增 Kokoro 镜像实测为 ARM64；依赖与基础镜像支持 AMD64，但尚未验证 AMD64 合成或 Windows 实机。日常保留 ARM64 服务。Windows Docker Desktop 使用 Linux containers，并需在 Windows 自行完成容器登录、API key 输入及内置 Kokoro 朗读测试。

参考：[OrbStack 容器访问 Mac](https://docs.orbstack.dev/docker/network#connecting-to-servers-on-mac)、[Docker Desktop 主机网络](https://docs.docker.com/desktop/features/networking/networking-how-tos/)、[官方 Codex 认证](https://learn.chatgpt.com/docs/auth)、[Vinext 官方 Node 部署](https://github.com/cloudflare/vinext)。
