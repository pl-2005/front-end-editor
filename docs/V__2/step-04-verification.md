# 步骤 04 验证记录

## 本次补齐

- 项目工作区原先从项目 capabilities 读取 `PROJECT_CREATE` 来控制“另存副本”。项目能力集只包含项目动作，而创建项目属于团队动作，因此任何角色都会被错误拒绝。工作区现在单独加载当前团队能力，以 `PROJECT_CREATE` 决定是否显示“另存副本”，提交时仍由服务端授权。
- `IdentitySessionIT` 验证 V4–V8 的预切换状态。应用默认 Flyway 会继续执行 V9，因此该用例现显式指定 `spring.flyway.target=8`，保留预切换断言；V9 强制认证由步骤 04 的隔离 E2E 流程验证。

## 门禁结果

- `npm run lint`：通过，现有 `authProvider.tsx` Fast Refresh 提示 1 条 warning。
- `npm run test`：通过，11 个文件、45 项测试。
- `npm run build`：通过。Vite 提示主 bundle 超过 500 kB。
- `pwsh -NoProfile -File ./scripts/verify-integration.ps1`：本机 MySQL + MinIO 通过，快速测试 171 项、集成测试 24 项；IT schema 和独占 Bucket 按脚本清理。
- `npm run test:e2e`：通过。两个 browser context 完成匿名拒绝、新用户邀请注册与登录、所有权转移、revision 1、VIEWER/EDITOR 权限和既有账号接受邀请。E2E 使用 `.env` 中的独立 schema/Bucket，并在结束时清理。

## 发布状态

前端产物与 V9 迁移已准备，本机隔离 E2E 已覆盖 V9 强制认证流程。文档要求的维护窗口、停止旧实例、部署隐藏槽位、应用 V9 并原子切流属于目标环境发布操作；本次没有连接或操作生产入口，因此生产联合发布门禁仍未完成。
