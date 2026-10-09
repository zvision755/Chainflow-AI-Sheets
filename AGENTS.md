# 长期开发规范

本仓库在 main 维护 Server Docker、Local Docker、Local Pages 三种部署模式，不建立长期分叉业务代码。

- 通用 UI、表格编辑、工作流、移动适配、导入导出在现有 `app/page.tsx`、`components/`、`core/`、`modes/` 中共用。默认让新功能适用于三个模式；不得复制完整编辑器。
- 认证、SQLite、加密主密钥仅属于 Server。未经任务明确要求，不改 `server/admin-auth.ts`、`server/personal-store.ts`、现有数据库结构或 `compose.yaml`，不操作用户数据卷。
- 运行环境通过 `core/deployment.ts` 和 `/api/capabilities` 检测。Local 工作簿使用 `model/browser-workspace.ts`；静态 API 使用 `model/static-api.ts`；Docker 的两个入口共享受限代理。
- 不兼容能力须禁用入口并解释原因。Local 默认不得开放本地 Codex；静态版不得连接开发者电脑、依赖运行时 API、加入无认证公共代理或内嵌私人密钥。
- 每次通用功能发布必须执行类型检查、单元测试、三个模式构建及 `npm run test:ui:modes`。任何关键回归失败不得标记发布成功。外部 CORS 模拟不等于真实提供商成功调用；记录实测边界。
- 不把未完成的 IndexedDB 事务误报为已保存；保留冲突提示。工作簿导出不包含连接密钥。浏览器密钥仅发送给所选提供商或 Local Docker 的受限代理。
- 发布统一更新 package.json/锁文件版本；正式版本使用 `v<版本>` 标签，两个镜像带同一版本号及 Git SHA。不得强推或覆盖其他设备的提交。检查 Git Author/Committer 及配置来源，仅使用用户确认的 `zvision755 <199458887+zvision755@users.noreply.github.com>`，禁止 `david@Mac.lan`。
- 操作现有 Server 前保留完整备份；自动更新容器已有用户授权，Git 提交推送必须有当前任务授权。其它 Windows 服务不受本项目部署影响。
