# Server TTS 音频缓存

Chainflow Server 对 Kokoro、火山免鉴权及已支持的 OpenAI 兼容 TTS API 共用文件缓存。后续接入新提供商时，应使用同一合成入口和缓存适配器，并将新增的所有合成参数纳入 `SpeechIdentity`。

Web / GitHub Pages 保持浏览器直连或系统原生朗读，不连接 Server 缓存。旧 Local 开发预览和 Mac 包默认没有注入持久缓存。浏览器仅在内存中保留最近一次音频供重复播放，不写入 IndexedDB/localStorage；页面关闭后释放。

## 位置与匹配

- 容器目录：`/data/chainflow/tts-cache`，属于现有 `chainflow_app-data` Volume；没有新数据库表、Compose 服务或额外挂载。
- 目录按 SHA-256 前两位分片：`<前两位>/<完整哈希>.audio` 和同名 `.json`。`.audio` 是实际 WAV/MP3；元数据只保存格式、长度和内容校验值，不保存句子、API Key、表格/单元格 ID。
- 缓存键包含实际提交的文本、提供商、实际合成端点、模型、音色、语言、语速、请求输出格式及流式参数，另有缓存协议版本。保持现有首尾 trim；不合并内部空格、标点、大小写、假名或 Unicode 字符。
- 不同行、表格和设备的相同请求共用缓存。修改文字、模型、音色或语速自动匹配其他键。缓存目录中音频与元数据总量上限固定为 1 GiB；超出后按音频创建时间从早到晚删除完整缓存条目，直到回到上限以内。容器重启后首次 TTS 缓存请求会先清理已有超额缓存；每次新音频写入后也会检查上限。被淘汰的内容下次播放时重新合成；其他文本和参数不受影响。
- `restart`、`up --force-recreate`、镜像更新会保留缓存。删除 `app-data` Volume 会同时丢失工作簿、账户等重要数据，不能用删卷来清缓存。

## 安全与异常

缓存查询位于原有账号认证、CSRF、请求参数和上游配置校验之后。未登录不能读取缓存；付费服务仍要求服务器已有有效密钥配置。供应商密钥不进入缓存键、元数据或日志。音频本身含个人朗读内容，目录权限为 700、文件为 600，应与工作簿同样保护。

同一 Server 进程内相同键的并发请求只合成一次，其他请求等待结果。一个设备取消时，不影响其余等待者；全部取消后终止尚未完成的合成。不同键继续沿用现有单次合成繁忙保护。此实现适用于当前单实例 Docker 部署，多副本共享目录需另行增加跨进程协调。

只有成功响应、非空且结构完整的 WAV/MP3 才会缓存。先写独立临时文件并同步，再原子重命名音频，最后提交元数据；临时文件或缺少元数据的音频不命中。每次读取会检查长度、结构与 SHA-256，损坏文件重新生成。磁盘满/写入失败会返回本次有效音频并记录 BYPASS，保持正常朗读，但之后可能需要再次合成。

声音/模型连接检测（`/voices`）仍检查上游实时状态，不缓存它的测试音频；实际 `/speech` 朗读使用缓存。

## 查看与验证

在项目目录使用 PowerShell 7：

```powershell
docker compose exec -T app du -sh /data/chainflow/tts-cache
docker compose logs --since 10m app | Select-String '\[TTS cache\]'
```

日志仅显示 `miss`、`stored`、`hit`、`shared`、`evicted`、`invalid`、`read-error`、`write-error` 和哈希前缀。响应头 `X-Chainflow-TTS-Cache` 为 `MISS`（首次写入）、`HIT`（磁盘复用）、`SHARED`（等待同次合成）或 `BYPASS`（写入失败）。`Cache-Control: no-store` 保留，避免浏览器/远程代理持久保存个人音频。同一页面重复播放最近一次音频可能完全没有新的网络请求。

## 手动清理

先停止 app，避免清理时有合成写入。下面只删除固定缓存目录，不操作数据库、主密钥或 Codex 登录卷：

```powershell
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint node app --input-type=module -e 'import {rm} from "node:fs/promises"; await rm("/data/chainflow/tts-cache",{recursive:true,force:true});'
docker compose up -d --no-deps app
```

清理后首次朗读会重新合成，付费 API 会重新计费。后端模型升级但模型 ID 未变时，如希望重新合成，也可执行同样清理。正常更新无需清理。

缓存可重建，不包含在现有数据库/账户/加密主密钥备份中；需要保留时，可额外归档 `/data/chainflow/tts-cache` 整个目录（音频和元数据须一起保留）。不要将音频目录、归档或私人配置提交 Git。
