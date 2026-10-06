# 内置 Kokoro

Docker 启动 ChainFlow 时自动启动本项目的 Kokoro CPU 服务。首页「配置 TTS」默认选择内置模型，无须填 API 地址或密钥。每列继续单独选择语言；关闭语言的列不会朗读。

采用 Kokoro v1.0 82M 的全精度 ONNX 模型，ONNX Runtime CPU 执行，默认 2 个计算线程。Mac Docker 不使用 MLX/Metal，Windows Docker Desktop 使用同一 Linux CPU 实现。日语、英语（美式/英式）、中文共 41 个音色，默认 jf_alpha、af_heart、bf_emma、zf_xiaobei。语速 0.5–2。

模型、音色、英语 spaCy 小词典、日语 UniDic Lite 和中文字典均在构建阶段安装。运行时不下载模型、不调用云端、不依赖主机 Kokoro 或 LaunchManager。首次构建需要联网；之后镜像可断网启动与合成。模型容器加入项目网络，另仅为 Mac 3002 开发预览提供主机回环 8881 端口。网站通过固定 `http://kokoro:8880/v1` 调用，浏览器不能指定此内部地址。模型容器同时连接默认网络以支持主机回环桥；不把这一配置描述为强制禁止出网。

一个模型常驻、一个合成线程，一次只接受一个请求；忙时返回 429。输入上限 4096 字符，请求上限 30 KB，合成超时 90 秒。取消网络等待或超时不会中断已进入 ONNX 的 CPU 调用，CPU 工作完成前保留并发槽。音频为 24 kHz WAV，仅在模型内存、HTTP 响应和浏览器 Blob 中短暂存在；不写磁盘、不记忆、不导出。

## 第三方接口

「TTS 提供方 → 第三方 TTS API」可设置独立地址、模型、音色、语速和 API key。兼容 OpenAI `/v1/audio/speech` WAV 协议；远程请求不附加本地 Kokoro 的 `language` 字段。远程接口限已审阅域名 api.openai.com、aihubmix.com、api.aihubmix.com、openrouter.ai、api.siliconflow.cn 的 HTTPS，也可调用本机回环服务。非标准路径、内网地址、URL 密钥和重定向拒绝；供应商的非 OpenAI 音频协议暂不支持。

远程「测试连接」读取账户模型列表，不执行付费合成。语音模型权限需实际朗读验证。第三方密钥独立于生成 API key，只保存在当前页面内存；不会写 localStorage、配置 JSON、环境变量或日志。刷新后需重新输入。保存的配置使用字段白名单剔除密钥；更改供应商地址会清空输入中的密钥。密钥经本站转发给指定供应商；费用由填写者承担。

## Python 开发与测试

所有 Python 依赖在项目内虚拟环境，禁止全局 pip 安装：

```sh
uv sync --project tts --locked
uv export --project tts --locked --no-dev --no-emit-project --format requirements-txt --output-file tts/requirements.lock
# 在 tts 目录运行测试
cd tts
.venv/bin/python -m unittest -v test_service
```

Docker 构建同样先创建 `/app/.venv`，使用带哈希的 requirements.lock。构建工具只在构建层；运行层非 root、只读，临时缓存位于 `/tmp`。Kokoro 的 `/tmp` 必须允许 `exec`，因为英语发音依赖会将随包安装的 eSpeak 共享库放到临时目录后加载；网站容器的 `/tmp` 仍保持默认 `noexec`。不安装 PyTorch、CUDA 或其他推理模型。

原生 CPU 调试可先在项目目录运行 `.venv` 的 `download_models.py` 下载校验资产，再运行 `service.py`；调试默认监听 127.0.0.1:8881，与 Docker 的开发桥端口互斥。正式使用只需根目录 `docker compose up -d --build`。

2026-10-06 在 Mac OrbStack ARM64 实测：日语短句 0.78 秒、美式英语 0.58 秒、英式英语 0.62 秒、中文 1.00 秒，均返回有效 WAV 和 `no-store`。另以 `--network none` 启动同一镜像，无端口、主机目录或模型挂载，日语/英语/中文仍成功合成。停止原主机 8880 服务后，Docker 3003 与 Mac 3002 页面都可使用内置模型；Codex 内置浏览器验证了播放、停止、41 个音色、第三方缺少密钥提示及桌面/390px 窄屏。长文本与不同 CPU 的耗时可能更长。3 项 Python 服务测试及 105 项应用测试通过；尚未在 Windows 实机测试此模型。

## 模型来源与校验

资产来自 [kokoro-onnx 的固定 model-files-v1.1 发布](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1)，不使用浮动 latest：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| kokoro-v1.0.onnx | 325505369 bytes | beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a |
| voices-v1.0.bin | 28214398 bytes | bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d |

模型来自 [hexgrad/Kokoro-82M（Apache-2.0）](https://huggingface.co/hexgrad/Kokoro-82M)，ONNX 转换/封装来自 [thewh1teagle/kokoro-onnx（MIT）](https://github.com/thewh1teagle/kokoro-onnx)，发音前端来自 [hexgrad/misaki（Apache-2.0）](https://github.com/hexgrad/misaki)。模型下载校验 SHA-256，不接受不完整或被修改的文件。权重、开发 .venv、缓存和生成音频均不提交 Git。
