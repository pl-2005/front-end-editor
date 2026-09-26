# V__2 多人在线编辑器与身份系统开发文档

本目录基于 `docs/V__1` 与当前项目代码，定义身份系统、团队/项目 ACL、Yjs 多人编辑器和上线运维方案。

## 阅读顺序

1. [整体开发总方案](./00-overall-plan.md)
2. [步骤 01：基线与安全护栏](./steps/01-baseline-guardrails.md)
3. [步骤 02：身份、Session 与 CSRF](./steps/02-identity-session-csrf.md)
4. [步骤 03：团队、邀请、项目 ACL、审计与存量迁移](./steps/03-team-invite-project-acl-audit.md)
5. [步骤 04：前端身份、团队与权限壳](./steps/04-frontend-auth-team-permission-shell.md)
6. [步骤 05：协作状态与对象存储地基](./steps/05-collaboration-state-storage-foundation.md)
7. [步骤 06：协作网关、Opaque 票据与内部协议](./steps/06-collaboration-gateway-and-ticket.md)
8. [步骤 07：Yjs、Monaco 与 Sandpack 派生桥](./steps/07-yjs-monaco-sandpack-bridge.md)
9. [步骤 08：离线更新、Presence 与结构操作](./steps/08-offline-presence-and-structure-ops.md)
10. [步骤 09：检查点、恢复、删除与 Fence](./steps/09-checkpoint-restore-delete-fence.md)
11. [步骤 10：安全、可观测性、性能与恢复](./steps/10-security-observability-performance-recovery.md)
12. [步骤 11：发布、回滚与最终 E2E](./steps/11-release-deploy-and-final-e2e.md)

## 当前进度（2026-09-26）

| 步骤 | 状态 | 实时记录 |
| --- | --- | --- |
| 06：协作网关、短期票据与内部协议 | 单实例验收通过 | [实施与验收记录](./step-06-implementation.md) |
| 07：Yjs 文件模型、Monaco 与 Sandpack 派生桥 | 验收通过 | [实施记录](./step-07-implementation.md) |
| 08：离线更新、Presence 与结构操作 | 验收通过 | [实施记录](./step-08-implementation.md) |
| 09：检查点、恢复、删除与 Fence | 单网关本地完整验收通过 | [实施记录](./step-09-implementation.md) |
| 10：安全、可观测性、性能与恢复 | 本机代码与隔离资源验收通过；待 staging 运维演练 | [实施记录](./step-10-implementation.md) |

步骤 10 最新本机验收结果与尚待 staging 的门禁详见[步骤 10 实施记录](./step-10-implementation.md)。此前步骤 06 的联合验收证据仍见其[实施记录](./step-06-implementation.md)。

验收范围为单网关实例。步骤 09 控制路由仍保持 fail closed，生产协作开关保持关闭。

## 门禁规则

- 每一步完成实现、测试和验收后，才能开始依赖它的下一步。
- 步骤 03 的 V6–V8 迁移和授权后端通过后，才能开始步骤 04；V9 仅与步骤 04 登录 UI 原子发布。
- 步骤 05–08 通过后，步骤 09 才能开启协作项目的检查点、恢复、删除和撤权协调。
- V9 后任何回滚制品都必须强制认证并 fail closed，不能恢复匿名项目接口。
- 所有真实集成/E2E 使用根 `.env` 注入本机 MySQL/MinIO，独占 IT/E2E schema 与 Bucket；禁止 Docker，不打印凭据。

## 版本主线

`V3` 基线并发控制 → `V4/V5` 身份与 JDBC Session → `V6` 团队/ACL additive → `V7/V8` contract → `V9` 不可逆认证 cutover → `V10` collab_document → `V11` opaque ticket/nonce → `V12` operation/outbox。
