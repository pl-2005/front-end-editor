# 步骤 05 实施记录

## 已完成的代码

- 新增 V10：验证每个项目的所有权及当前 revision 指针，再创建 `collab_document` 并为所有项目（包含软删除项目）回填 `epoch=1/generation=0`、禁用协作模式和当前 revision 基线。
- 新增协作对象写入租约及孤儿观察表；协作清理器只扫描 `collab/projects/`，检查描述行和可扩展引用 Provider，要求对象超过保护期且连续两轮无引用，并在删除时锁住对象租约行。版本快照清理器仍只处理 `projects/`。
- 扩展 MinIO 存储以写入对象 Content-Type，并为协作读取提供有界读取。
- 新增 `CollabStateService`：describe/load/bootstrapSnapshot/persist；检查 epoch/generation、对象键格式、大小及 SHA-256。持久化顺序为租约、对象上传、条件更新描述；CAS 冲突返回稳定 409，存储完整性错误返回 `COLLAB_STORAGE_CORRUPT`。
- 新项目在创建 revision 1 的同一数据库事务插入 generation 0 描述。
- generation 0 时，旧快照保存/恢复在项目行和描述行锁保护下同步推进 bootstrap 与 checkpoint 版本；generation 大于 0 时旧快照/恢复/删除入口返回 `COLLABORATIVE_PROJECT_REQUIRES_CHECKPOINT`。
- H2 测试 schema 已增加 V10 表结构，供后续自动化测试使用。
- 邀请注册成功页在清除 token 后曾被“邀请已失效”分支遮挡；调整判断顺序并增加 StrictMode 回归测试。
- E2E 临时后端迁移目标更新为 V10；所有权/成员权限变更会递增授权版本，双浏览器测试在变更后重新登录，并通过项目成员表单验证 VIEWER 到 EDITOR 的权限提升。

## 发布门禁与未执行项

- `pwsh -NoProfile -File ./scripts/verify-integration.ps1`：通过。脚本读取根 `.env`，确认 IT schema 和 MinIO Bucket 独立于开发环境后，将仅当前进程的 `FLYWAY_TARGET` 设为 10。
- Maven 快速测试：171 项通过；Failsafe 本机 MySQL/MinIO 集成：24 项通过。没有使用 Docker。
- `npm run test:e2e`：通过（1 个双浏览器场景），使用 `.env` 创建并清理独立 E2E schema/Bucket，验证匿名拒绝、注册邀请、所有权转移、revision 1、VIEWER/EDITOR 和已有账号邀请。
- `npm run lint`：0 错误，`authProvider.tsx` 有 1 条 Fast Refresh warning；`npm run test`：11 个文件、45 项通过；`npm run build`：通过，Vite 提示主 bundle 超过 500 kB。
- 集成验收覆盖 V10 回填（含软删除项目）、新项目 revision 1 与描述创建、generation 0 基线更新、MinIO 二进制读写与 SHA/size 校验、同 generation 并发 CAS 仅一方提交、旧快照写入拒绝，以及清理器两轮观察/活动租约/引用保护。
- 验收只在脚本创建的独占 IT/E2E schema 和随机 Bucket 内运行并清理；没有对当前开发库执行 V10。开发配置 `spring.flyway.target` 仍默认为 8。步骤 04 本机 UI/API/E2E 门禁已通过；目标环境 V9/UI 联合发布仍未执行。
- 真实环境发布仍须维护窗口停止 V9 旧写流量、执行正式迁移并对账，不能与 V9 实例并行运行。步骤 06 只能在步骤 04 联合发布门禁完成后开始。
