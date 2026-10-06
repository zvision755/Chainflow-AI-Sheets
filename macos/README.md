# Mac 桌面版

两个 DMG 使用 AppKit + WKWebView 原生窗口，启动自己携带的 Node 正式服务器。Full 可按需启动自己的冻结 Python + Kokoro MLX/Metal 服务；默认不加载模型，不占用模型内存。在「配置 TTS」确认约 900 MB 内存提示后加载，仅明确勾选「不再提示，下次启动自动加载」才记住许可，未勾选不会改变下次启动行为。卸载按钮释放内存并取消自动加载。关闭窗口或 Cmd-Q 后停止子进程，异常退出由父进程监视器清理。没有 Docker、LaunchManager、浏览器自动化或开发目录依赖。

| 版本 | 架构 | 朗读 | 常规页面端口 |
|---|---|---|---|
| Full MLX | Apple Silicon arm64 | 内置权重、41 音色、日/英/中文词典，GPU Metal | 3005 |
| Lite | Universal arm64 + x86_64 | 可配置第三方 TTS，不含 Python 或权重 | 3004 |

最低 macOS 14。MLX 无法在 Intel 上运行；Lite 含 Intel 运行程序，但当前测试机器没有 Rosetta，Intel 实机兼容性尚未验证。未签名测试版只有运行所需的 ad-hoc 签名，没有 Developer ID 签名或 Apple 公证，不会绕过 Gatekeeper。[用户安装说明](INSTALL.md)。

## 数据与登录

两版各有独立 bundle ID、端口和 WebKit 数据。已有网页表格用 JSON 导出、导入迁移。导出不含 API key。API 费用由使用者自己的提供商账户承担；勾选记住后密钥保存在此应用的 WebKit 本地存储，取消则只保留当前内存。第三方 TTS 密钥仅保存在当前窗口内存。请求不写持久日志，音频仅在服务与播放器内存中处理。

Agent 使用随包分发的官方 Codex App Server，不要求另外安装 Codex。点击「登录 ChatGPT」后由使用者在系统浏览器登录官方账户；OAuth 回调由该进程接收，回到应用点「重新连接」。凭证单独存于 `~/Library/Application Support/ChainFlow AI Sheets Full/Codex` 或 Lite 的对应目录（仅用户访问权限）。强制使用此目录的 file 凭证存储，不读取开发者登录、系统 Codex keychain 或环境 API key；没有登录则明确报错，不回退到 API key。使用者退出登录会调用官方 account/logout。登录、联网生成需要能访问 OpenAI；内置朗读可离线。

只监听 127.0.0.1。MLX 端口由操作系统分配，默认模型地址由启动器传给服务端，不由页面自由指定。第三方 TTS、模型 API 继续使用现有同源接口校验、限制、结构化错误和 no-store。PAC、需要认证的代理暂不支持；支持系统已有的本机 HTTP(S) 代理。不要将桌面服务暴露给公网。

## 从源码构建（开发者）

需要 Apple Silicon Mac、macOS 14+、Xcode Command Line Tools、Node 22.13+ 和 uv。下载后的用户不需要这些工具。依赖只安装在项目内，源码构建从仓库根目录执行：

```sh
npm ci
npm run typecheck
npm test
npm run build:mac
```

只构建精简版：`npm run build:mac -- --lite-only`，不创建 Python 环境或下载权重。完整构建用 `MACOSX_DEPLOYMENT_TARGET=14.0 uv sync --project macos/tts --python 3.12 --locked --python-platform aarch64-apple-darwin` 建立 `macos/tts/.venv`，选择官方 macOS 14 兼容 wheel，再用其中的 PyInstaller 冻结运行环境。

脚本核验 `runtime-manifest.json` 中官方 Node 24.21.0、Codex 0.160.0 和许可证/源码附件的校验值；arm64 Codex 由 npm lock 管理。Full 使用 `tts/model-manifest.json` 固定 Hugging Face 模型 revision，核验全部 43 个资产的大小及 SHA256/Git blob SHA1。安装后不下载模型。冻结包携带 Python、MLX Metal 库、词典和依赖许可证，原版权重未修改。源代码附件、依赖许可见 [THIRD-PARTY.md](THIRD-PARTY.md)。

构建输出：`macos/release/*.dmg`，临时目录：`.cache/macos`、`macos/staging`；它们和 `.venv`、模型不提交 Git。

## 验证

`应用.app/Contents/MacOS/ChainFlow --smoke-test` 是开发者验收入口，用临时端口、临时账号目录和非持久 WebKit 数据，不改动用户表格。验证页面表格渲染、桌面能力、独立 Codex 未登录错误；Full 额外验证默认未加载模型，显式加载后实际生成日语 WAV。正常用户通过双击使用。

正式发布需执行类型检查、核心测试、Sites 与独立 Node 构建、DMG 验证和签名结构检查，再从 DMG 复制到另一目录运行上述测试。没有 Developer ID 证书时 Release 标为 prerelease。Agent 完整生成需安装后使用者自行登录；构建验证不携带或使用开发者账户、API key，也不产生付费模型请求。
