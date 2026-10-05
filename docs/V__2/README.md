# V__2 多人在线编辑器与身份系统开发文档

本目录定义轻量身份系统、团队成员授权、Yjs 多人协作与当前项目文件的自动持久化。团队项目由所有有效成员同权操作，OWNER 仅管理团队成员。V2 不提供版本列表、检查点、历史恢复或版本比较；现有 V1 版本数据保留但不进入 V2 业务流程。

## 阅读顺序

1. [整体开发总方案](./00-overall-plan.md)
2. [步骤 01：现状与并发、存储护栏](./steps/01-baseline-guardrails.md)
3. [步骤 02：身份、JWT 与刷新凭据](./steps/02-identity-jwt.md)
4. [步骤 03：团队成员授权、加入流程与旧项目隔离](./steps/03-team-invite-project-acl.md)
5. [步骤 04：前端身份与团队界面](./steps/04-frontend-auth-team-permission-shell.md)
6. [步骤 05：Y.Doc 初始文件与当前状态持久化](./steps/05-collaboration-state-storage-foundation.md)
7. [步骤 06：协作网关、票据与自动持久化](./steps/06-collaboration-gateway-and-ticket.md)
8. [步骤 07：Yjs、Monaco 语言服务与 Sandpack 派生桥](./steps/07-yjs-monaco-sandpack-bridge.md)
9. [步骤 08：离线编辑、Presence 与结构操作](./steps/08-offline-presence-and-structure-ops.md)
10. [步骤 09：持久化协调、软删除关房与成员撤权](./steps/09-persistence-delete-revocation.md)
11. [步骤 10：安全、可观测性与当前文件恢复](./steps/10-security-observability-performance-recovery.md)
12. [步骤 11：发布、回滚与功能验收](./steps/11-release-deploy-and-functional-acceptance.md)

## 项目进度

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 01 | 已完成（2026-09-28） | [现状与并发、存储护栏](./steps/01-baseline-guardrails.md) |
| 02 | 已实现 | [身份、JWT 与刷新凭据](./steps/02-identity-jwt.md) |
| 03 | 团队后端已实现（2026-09-29） | [团队成员授权、加入流程与旧项目隔离](./steps/03-team-invite-project-acl.md)；项目创建由 05 接入 |
| 04 | 已实现并完成自动检查及本机流程验收 | [前端身份与团队界面](./steps/04-frontend-auth-team-permission-shell.md) |
| 05 | 已实现并完成自动检查及本机功能验收（2026-10-04） | [Y.Doc 初始文件与当前状态持久化](./steps/05-collaboration-state-storage-foundation.md) |
| 06 | 已实现并完成自动检查及本机功能验收（2026-10-04） | [协作网关、票据与自动持久化](./steps/06-collaboration-gateway-and-ticket.md) |
| 07–11 | 未开始 | — |

首期部署与验收采用单网关实例；步骤 09 完成前生产协作开关保持关闭。

当前下一步为 Step07：将现有项目工作区接入票据、Hocuspocus Provider、Monaco/Yjs 与 Sandpack 单向派生桥。Step06 已提供初始持久化状态及后续状态消息，前端须分别展示 WebSocket 同步与 durableSequence 确认的持久化状态。Step08 再接入离线更新重发和完整 Presence 界面，Step09 完成删除 fence 与 Outbox 主动撤权。

## 门禁规则

- 每一步完成实现及对应功能检查后，才能开始依赖它的下一步；步骤 01–10 仅建立可发布的完整 V2，不逐步公开。
- 步骤 03 的团队与项目归属设计及授权后端通过后，才能开始步骤 04；认证切换由步骤 11 执行。
- 步骤 05 完成初始 Y.Doc 原子创建后才允许受控创建新项目；完整 V2 的公开入口在步骤 11 开放。步骤 05–08 通过后，步骤 09 才能完成软删除关房和成员撤权协调。
- 最终认证切换后任何回滚制品都必须强制认证并 fail closed，不能恢复匿名项目、旧快照写入或历史版本接口。
- 不以本机 MySQL/MinIO/Redis 专用集成验证或双浏览器端到端测试作为门禁；功能验收运行应用时使用根 `.env` 连接本机服务，禁止 Docker，不打印凭据。

## 版本主线

`V3` 项目锁版本 → `V4/V5` 身份与 JWT 撤销水位（刷新凭据存 Redis）→ `V6/V7` 团队成员关系与旧匿名项目隔离 → `V8/V9` 站内邀请与注册账号约束 → `V10` 协作文档、幂等回执与对象保护 → `V11` 协作票据与内部 HMAC nonce。Step09 后续追加 operation/outbox 迁移。V2 制品始终强制认证；步骤 11 通过切换外部入口发布，不创建数据库认证切换状态，也不再添加 revision 迁移。
