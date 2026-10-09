# 长期开发规范

一个仓库、main 分支、两个正式版本：Chainflow Server 和 Chainflow Web。Local Docker 不作为独立发行版维护。

- Server 是主要开发和自托管版本。通用 UI、表格、工作流、移动端、历史、拆句及导入导出在 app/、components/、core/、modes/ 共用，默认同时适用于 Server 与 Web，不复制编辑器，不建立长期产品分支。
- 部署差异通过 core/deployment.ts、存储和网络适配器表达。Web 使用 model/browser-workspace.ts、model/browser-settings.ts 和 model/static-api.ts；工作簿、模型/TTS 配置和记忆密钥均持久化于 IndexedDB。
- 认证、SQLite 和加密主密钥只属于 Server。未经明确要求，不改 server/admin-auth.ts、server/personal-store.ts、数据库结构或 compose.yaml，不操作用户数据卷。
- Web 不依赖运行时后端，不连接开发者电脑或 Server 数据库。禁止匿名公共代理、私人密钥入包及远程暴露 Codex。本机模型、Codex 和火山免配置 TTS 应禁用并说明限制，外部 API 必须说明 CORS 要求。
- IndexedDB 事务完成后才确认保存；工作簿使用修订冲突保护。迁移旧配置须先确认写入 IndexedDB，再清除旧 localStorage 密钥。保存失败保留数据并提示，导出不含密钥。
- 每次通用功能发布须执行类型检查、单元测试、npm run build:modes、npm run test:ui:modes 和静态产物检查。Server 与 Web 均通过才能发布；模拟测试或 CORS 预检不能冒充真实提供商调用成功。
- GitHub Actions 自动部署通过测试的 Web 到 Pages，只发布 Server 镜像。统一更新 package.json/锁文件版本，正式标签 v<版本>，镜像带版本和 SHA，不重新发布 Local Docker。
- 每次创建或重写提交前检查 Git Author/Committer 和配置来源，只使用已确认的 zvision755 <199458887+zvision755@users.noreply.github.com>，禁止 david@Mac.lan，不得强推或覆盖已有改动。
- 自动更新容器已有用户授权；Git 提交推送须确认。操作现有 Server 前保留完整备份，不影响其他 Windows 服务。
