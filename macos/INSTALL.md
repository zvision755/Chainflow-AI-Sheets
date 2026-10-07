# ChainFlow AI Sheets 0.3.0 · 未签名测试版

1. 打开 DMG，将应用拖到 Applications（应用程序）。
2. 双击应用。如果 macOS 阻止首次打开，请按 Apple 官方说明，在系统设置 → 隐私与安全中由你选择「仍要打开」。本版本没有 Developer ID 签名或 Apple 公证，不要关闭整个系统的安全保护。
3. App 自带独立前端窗口，不需要用浏览器显示。不需要终端、Node、Python、Docker 或 LaunchManager。关闭窗口或 Cmd-Q 会停止本应用的服务。

两个版本均要求 macOS 14 或更高：

- Full MLX：仅支持 Apple Silicon（M 系列）。已包含 Kokoro 模型、41 个音色、词典及 MLX/Metal 运行环境，无须下载模型。默认不加载模型；在首页「配置 TTS」手动启用，确认约 900 MB 内存占用提示后才能朗读。仅明确勾选「不再提示，下次启动自动加载模型」并成功加载后，才记住自动加载许可。未勾选则下次启动仍不加载。可随时卸载模型释放内存，同时关闭自动加载；加载后可离线朗读。
- Lite：Universal，支持 Apple Silicon 与 Intel，不含 Python、MLX 或 TTS 权重。可配置 OpenAI 兼容第三方 TTS 服务；没有内置朗读，不能把 Docker 上的模型当作后备。

API 模式需在页面填写自己的提供商密钥。Agent 模式已包含 Codex 文本运行程序，首次使用点击「登录 ChatGPT」，在系统浏览器完成官方登录后回到应用点击「重新连接」。不会携带开发者的密钥、登录态或订阅。每个使用者消耗自己的账户额度。

表格、结果和配置保存在此应用的 WebKit 存储中；第三方 TTS 密钥只在当前窗口内存中。API key 的「记住」选项与网页版本一样，由使用者自己选择。完整版、精简版和网页/Docker 各有独立存储，迁移请使用 JSON 导出/导入，文件不含 API key。

普通启动只监听本机回环：Lite 3004、Full 3005。若端口被占用，应用显示启动失败；关闭占用端口的程序后再打开。MLX 服务使用系统分配的临时回环端口。Wi-Fi 更换不影响运行。

本版会使用系统设置中已有的本机 HTTP(S) 代理；暂不支持 PAC、带用户名密码或远程代理。不要将应用的本地服务暴露到公网。

Apple 首次打开说明：https://support.apple.com/en-us/102445
源码与 Release：https://github.com/zvision755/Chainflow-AI-Sheets
