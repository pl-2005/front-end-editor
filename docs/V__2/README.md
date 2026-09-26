# V__2 多人在线编辑器与身份系统开发文档

本目录基于 `docs/V__1` 与当前项目代码，定义身份系统、团队/项目 ACL、Yjs 多人编辑器和上线运维方案。

## 阅读顺序

1. [整体开发总方案](./00-overall-plan.md)
2. [步骤 01：基线与安全护栏](./steps/01-baseline-guardrails.md)
3. [步骤 02：身份、JWT 与刷新凭据](./steps/02-identity-jwt.md)
4. [步骤 03：团队、邀请、项目 ACL 与旧项目隔离](./steps/03-team-invite-project-acl.md)
5. [步骤 04：前端身份、团队与权限壳](./steps/04-frontend-auth-team-permission-shell.md)
6. [步骤 05：协作状态与对象存储地基](./steps/05-collaboration-state-storage-foundation.md)
7. [步骤 06：协作网关、Opaque 票据与内部协议](./steps/06-collaboration-gateway-and-ticket.md)
8. [步骤 07：Yjs、Monaco 与 Sandpack 派生桥](./steps/07-yjs-monaco-sandpack-bridge.md)
9. [步骤 08：离线更新、Presence 与结构操作](./steps/08-offline-presence-and-structure-ops.md)
10. [步骤 09：检查点、恢复、删除与 Fence](./steps/09-checkpoint-restore-delete-fence.md)
11. [步骤 10：安全、可观测性、性能与恢复](./steps/10-security-observability-performance-recovery.md)
12. [步骤 11：发布、回滚与功能验收](./steps/11-release-deploy-and-functional-acceptance.md)

## 项目进度

进度记录已重置。步骤 01–11 当前均标记为未开始；完成实现和验收后，再在本节更新状态并链接对应记录。

首期部署与验收采用单网关实例；步骤 09 完成前生产协作开关保持关闭。

## 门禁规则

- 每一步完成实现及对应功能验收后，才能开始依赖它的下一步；步骤 03 的生产 V9 验收与步骤 04 UI 联合完成。
- 步骤 03 的 V6–V8 迁移和授权后端通过后，才能开始步骤 04；V9 仅与步骤 04 登录 UI 原子发布。
- 步骤 05–08 通过后，步骤 09 才能开启协作项目的检查点、恢复、删除和撤权协调。
- V9 后任何回滚制品都必须强制认证并 fail closed，不能恢复匿名项目接口。
- 不以本机 MySQL/MinIO/Redis 专用集成验证或双浏览器端到端测试作为门禁；功能验收运行应用时使用根 `.env` 连接本机服务，禁止 Docker，不打印凭据。

## 版本主线

`V3` 基线并发控制 → `V4/V5` 身份表与 JWT 撤销水位（刷新凭据存 Redis）→ `V6` 团队/ACL 与旧匿名项目标记 → `V7/V8` 条件约束 → `V9` 不可逆认证 cutover → `V10` collab_document → `V11` opaque ticket/nonce → `V12` operation/outbox。
