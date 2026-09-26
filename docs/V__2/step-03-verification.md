# 步骤 03 实施与验收记录

基线：步骤 02 通过验收后的工作区。开始时工作区已存在前一轮的 `V6__add_team_acl_audit_and_legacy_claim.sql`、`schema-h2.sql` 的 V6 部分，以及一套**没有任何消费者**的 `authorization/` 骨架（`AccessAction`、`AccessRepository`、`TeamAccessService`、`ProjectAccessService`、`PlatformAccessService`、`TeamRole`、`ProjectRole`、`ProjectVisibility`）。本步骤在其上补齐团队域、邀请、项目 ACL 接入、审计、平台管理、存量归属迁移与 V7/V8 收紧。用户既有的 `README.md`、V1 文档目录迁移和 V2 方案文档改动保留，未重置或提交。

## 已实现

### 团队域与仓储（`team/`）

- `team/domain`：`Team`、`TeamMember`、`TeamInvitation`、`ProjectMember` 记录与 `TeamMemberStatus`/`InvitationStatus`/`ProjectMemberStatus`。
- `team/repository`：全部走 `JdbcTemplate`（与 `identity`、`authorization` 一致），因为需要显式的 `SELECT ... FOR UPDATE`、条件更新与固定顺序的多行加锁，JPA 不适合。
  - `TeamRepository.lockMembers(teamId)` 按 `user_id` 升序锁整个团队的成员行；`listActiveOwnerTeamIds` 按 `team_id` 升序返回用户担任 OWNER 的团队。
  - `TeamInvitationRepository.markAccepted/markRevoked` 使用 `WHERE status='PENDING'` 的条件更新，撤销与接受竞争时恰好一个成功。
  - `ProjectMemberRepository.removeAllForTeamMember` 用子查询形式（`ON DUPLICATE KEY UPDATE` 与多表 `UPDATE ... JOIN` 在 H2/MySQL 间不可移植，已改为两边都支持的写法）。

### 授权水位与审计

- `authorization/AuthzVersionService`：一个批次内每个用户只递增一次、按 `user_id` 升序更新以固定加锁顺序；若当前操作者也在批次内，提交后（`TransactionSynchronization.afterCommit`）刷新其 Session 中的 `Authentication`，否则操作者会被自己的授权变更判为过期会话。另有 `refreshCurrentSession` 用于「版本已在别处递增」的路径，避免重复递增。
- `authorization/SessionPrincipalRefresher`：只在用户仍为 `ACTIVE` 时替换会话快照；被降级或禁用的会话保持旧版本，交由 `ActiveAccountFilter` 判定失效。
- `authorization/CurrentActor`：所有业务控制器的身份入口，匿名在应用层统一得到 401；`requirePlatformAdmin` 在已认证但非平台管理员时 403。
- `audit/AuditService`：成功路径与业务变更**同事务**（写失败即回滚）；失败路径用 `REQUIRES_NEW` 独立小事务且任何异常都不向调用方传播。`AuditMetadata` 是**白名单**写入（只有固定键可落库，超长截断），`AuditRepository` 只有 INSERT/SELECT，没有 UPDATE/DELETE。
- `authorization/{Team,Project,Platform}AccessService` 在被拒绝时记录 FAILURE 审计（`REQUIRES_NEW`），因此外层业务回滚后仍然留痕。
- `common/web/RequestIdFilter`：每请求一个关联 ID（可用 `X-Request-Id` 提供，需匹配 `[A-Za-z0-9._-]{1,64}`），写入审计的 `request_id`。

### 团队、成员、邀请服务

- `TeamService`：创建（建团 + OWNER membership + 审计 + 递增创建者水位）、SQL 范围列表、改名、归档（归档会递增**全部有效成员**的水位）。
- `TeamMemberService`：改名/移除/所有权转移。所有可能改变 OWNER 数量的操作**先锁 team 行、再按 user_id 顺序锁全部成员行**；校验顺序为「授予上限 → ADMIN 不碰 OWNER → 最后一名 OWNER 保护 → 禁止自我提权」。移除成员时同事务把其全部 `project_member` 置 `REMOVED`。所有权转移先提升接收者再降级原 OWNER，事务内不会出现零 OWNER。
- `TeamInvitationService`：token 用 CSPRNG 生成 32 字节（≥256-bit）、`Base64Url` 编码，库中只存 SHA-256 摘要；`create/accept/registerWithInvitation` 三条路径都校验「PENDING 且未过期」，无效/过期/已用/撤销/邮箱不匹配统一 410。已有成员接受邀请时**仍原子消费令牌**并幂等返回 `alreadyMember=true`。
- `TeamProperties`（`editor.team.*`）：邀请有效期（默认 7d）与迁移团队名。

### 项目 ACL、模板与项目 API

- `ProjectTemplateService`：服务端生成规范默认文件（内容与前端 `DEFAULT_FILES` 一致），写入 `projects/{id}/revisions/1-{hash}.json.gz` 并创建 revision 1；数据库失败时补偿删除刚上传的对象。前端 `DEFAULT_FILES` 自此只是展示 fallback。
- `ProjectService`：创建唯一入口是 `POST /api/teams/{teamId}/projects`（校验 `PROJECT_CREATE`）；列表用 `ProjectRepository.findVisibleForUser[InTeam]` 在 **SQL 层**过滤并由 `ProjectAccessService.resolveMany` 批量解析角色（无 N+1）；元数据更新仍走乐观锁 `@Version` + `If-Match`；软删除先取项目行悲观锁。
- `ProjectMemberService`：目标必须是该团队的 ACTIVE 成员；团队 OWNER/ADMIN 可授予 MANAGER，仅凭 `project_member` 升为 MANAGER 的用户最多授予 EDITOR/VIEWER 且不能触碰另一位 MANAGER。
- `ProjectAccessService`：有效角色 = 团队 OWNER/ADMIN → MANAGER；否则 ACTIVE `project_member` 的角色；否则 TEAM 可见性项目至少 VIEWER；`team_member` 是硬前提；`team_id`/`visibility` 为空一律视为不可见（迁移完成前的安全默认）。

### 平台管理

- `PlatformAdminService`/`AdminController`：`PATCH /api/admin/users/{id}/status`、`/platform-role`、`POST /api/admin/platform-access`、`GET /api/admin/audit-logs`。状态/角色迁移必须给出 10–500 字原因并写审计；禁用用户前按 `team_id` 升序锁定其所有 OWNER 团队并验证每队仍有另一名 ACTIVE OWNER；平台介入只执行「目标项目 + 单次动作 + 原因」，不读写任何 membership。平台审计视图只暴露平台管理与维护动作。

### 存量归属迁移与 V7/V8

- `migration/LegacyProjectMigrationService` + `LegacyProjectClaimer`：固定顺序「建立/复用唯一迁移团队并写 OWNER membership → 逐项目：校验既有对象 → 回填归属 → 回填 revision 元数据 → version 0 → revision 1（CAS 推进指针）→ 标记 CLAIMED」。**校验先于回填**，因此失败项目保持未归属，即便绕过报告，V7 的 NOT NULL 也会真正失败。每个项目独立事务，失败只影响该项目且可修复后重跑。
- `migration/LegacyProjectMigrationRunner`：拒绝 web 上下文、拒绝 `spring.flyway.enabled=true`（否则 Spring 会在 Runner 之前抢先执行 V7/V8）、要求显式 `LEGACY_OWNER_USER_ID`，执行期间用独立连接持有 `system_bootstrap_lock`（`MaintenanceLock`）。报告 JSON 输出到 stdout，可用 `app.maintenance.migrate-legacy-report` 落盘；报告非全绿即抛错阻止下一阶段。
- `migration/FlywayReconciliationService` + `Runner` + `SchemaSignature`：确认 `project.team_id/created_by/visibility` 与 `project_revision.created_by/source` 都已存在、已收紧且无 NULL 之后，才补写 `flyway_schema_history` 的 V7/V8 行（checksum 取自制品解析结果）；任何不匹配都返回「停止人工修复」，不重复 ALTER、不做盲目 `flyway repair`。表结构签名是受影响表列定义（名称/类型/可空性/顺序）的 SHA-256。
- `V7__contract_project_ownership.sql`、`V8__contract_revision_metadata.sql`：各一个原子 ALTER。V6 未修改，V1/V2 未修改。
- `MaintenanceExitConfig`：维护命令跑完（或启动失败）后关闭上下文，否则 `@EnableScheduling` 的非守护调度线程会让离线进程挂住，发布脚本也无法按退出码判断结果。

### 契约与安全链调整

- `SecurityConfig`：删除暗置期的 `isLegacyAnonymousPath` CSRF 例外和 `/api/projects/**` 的 `hasRole("PLATFORM_ADMIN")` 临时映射；强制态下 `/api/**` 一律 `authenticated()`。暗置期过滤器不提前拦截，但业务控制器经 `CurrentActor` 在应用层要求身份，因此**匿名不再存在任何项目通道**。
- `POST /api/projects` 已删除（自然返回 405）；`PUT /api/projects/{id}` 仍不接受 `entry`。
- 项目响应新增 `teamId/visibility/effectiveRole/capabilities`；revision 响应新增 `source/createdBy`。

## 验证命令与结果

后端快速测试：`mvn test` **165 项通过**（步骤 01/02 的 125 项全部保留并通过）。

前端：`npm run lint` 通过；`npm run test` 45 项通过；`npm run build` 通过。

真实集成：仓库根执行 `pwsh ./scripts/verify-integration.ps1`（加载根 `.env`，本机 MySQL 8.0.46 + 本机 MinIO）：
`BaselineIT` 5 项 + `IdentitySessionIT` 8 项 + `OwnershipMigrationIT` 5 项 + `TeamOwnershipIT` 2 项 = **20 项通过，BUILD SUCCESS**；运行后 `web_editor_it` 表数为 0、独占随机 Bucket 已删除；未使用 Docker，未打印 `.env` 凭据。

本机开发库迁移（`web_editor`）：
1. `--spring.flyway.target=6` 离线启动 → 应用 V6 并按 `BOOTSTRAP_ADMIN_*` 创建**首个平台管理员**（随后把 `BOOTSTRAP_ADMIN_ENABLED` 改回 `false`，凭据留在 `.env` 且未回显）。
2. 离线执行存量归属命令（`--spring.flyway.enabled=false --spring.main.web-application-type=none --app.maintenance.migrate-legacy=true`）→ 报告 `clean=true total=6 claimed=6 failed=0 pending=0 invalidRevisions=0 unclaimedOwnership=0 versionZero=0 pointerMismatches=0 teamsWithoutOwner=0`；命令自行退出（BUILD SUCCESS）。
3. 正常启动应用 → Flyway 应用 V7/V8，`ddl-auto: validate` 通过。
4. 冒烟（端口 8080）：`/api/health` 200；`/api/health/readiness` 200 `READY`；匿名 `GET /api/projects` 401 `AUTHENTICATION_REQUIRED`；`/api/auth/csrf` 200；用一次性管理员登录 200 且 `globalCapabilities` 只有 `USER_MANAGE/PLATFORM_ACCESS`（平台角色不授予业务权限）；`GET /api/teams` 返回迁移团队且角色 OWNER；`GET /api/projects` 只返回唯一活动项目并给出 `effectiveRole=MANAGER`；软删除项目返回 404 `PROJECT_NOT_FOUND`；`POST /api/projects` 405；`GET /api/admin/audit-logs` 可见 `LEGACY_MIGRATION_RUN`（actorType `MAINTENANCE`）。
5. 离线执行 reconciliation → `clean=true signature=81bed5f8… registered=[7, 8]`。
6. 迁移后数据核对：6 个项目全部有 team/creator/visibility；全部 revision 都有 `created_by` 与 `source`（`rev_meta_missing=0`）；原本 `current_version=0` 的**软删除**项目已被初始化为 revision 1 且仍保持软删除；无 NULL 归属；无缺少 ACTIVE OWNER 的团队。

## 覆盖要点

- 角色/可见性：团队 OWNER/ADMIN 对全部项目 MANAGER；TEAM 可见性项目对有效成员至少 VIEWER；RESTRICTED 只有 OWNER/ADMIN 或显式项目成员可见；非成员与非成员团队一律 404；匿名 401。
- 授予上限：ADMIN 不能提升/降级/移除 OWNER、不能邀请 OWNER；MANAGER 只能授 EDITOR/VIEWER 且不能触碰另一位 MANAGER；团队 OWNER/ADMIN 可以授 MANAGER；自我提权被拒。
- OWNER 保护：最后一名 ACTIVE OWNER 不能被降级、移除或禁用（409 `LAST_TEAM_OWNER`）；出现第二名 OWNER 后即可禁用。
- 授权水位：角色变更对目标与操作者各递增一次；操作者会话被刷新（无需重新登录），目标会话失效（401，需重新登录，符合步骤 02 的既定契约）。
- 团队硬前提：移除团队成员后其 `project_member` 同事务置 `REMOVED`，且不再能访问项目；已消费的邀请令牌不会因成员被移除而复活。
- 邀请：库中只有摘要、签发后为 PENDING、消费后为 ACCEPTED 且不可回退；未知/过期/已用/撤销/邮箱不匹配统一 410；已是成员时第二个令牌同样被消费且幂等；创建与接受响应 `Cache-Control: no-store`。
- 审计：成功变更恰好一条 SUCCESS；越权拒绝留下 FAILURE 且业务数据未变；`metadata_json` 不含完整邮箱与令牌，白名单之外的键被丢弃；团队日志只有 OWNER/ADMIN 可读且限本团队；平台视图不含团队内部日志；`(occurred_at,id)` 游标分页不重不漏，非法游标 400。
- 项目契约：`If-Match`/强 ETag、`PROJECT_STATE_CONFLICT`、`VERSION_CONFLICT`、`REVISION_NOT_FOUND`、`STORAGE_CORRUPT`、幂等去重、入口字段与未知字段 400 均保留并通过回归。
- 迁移：`target=6` → 禁用 Flyway 的命令（含哈希损坏的故障注入）→ 报告非全绿阻止下一阶段 → 修复后重跑全绿且幂等 → `target=8` 收紧 → `flyway_schema_history` 恰好连续 V1…V8；`audit_log` 的只追加在真实 MySQL 由触发器强制（UPDATE/DELETE 报 `append-only`）。
- **OWNER 并发**（`TeamOwnershipIT`，真实 MySQL + barrier/latch）：两个 OWNER 同时被禁用时**恰好一个成功**、另一个得到 `LAST_TEAM_OWNER`，团队始终保留一名「有效 OWNER」（成员关系 ACTIVE/OWNER 且账号仍为 ACTIVE）；禁用与降级并发时不会出现死锁/500，也不会出现零有效 OWNER。

## 刻意的取舍（供复审与后续步骤判断）

1. **快速测试库与迁移命令用两套 H2 schema**：`schema-h2.sql` 表示迁移链的**最终形态**（V8 后的 NOT NULL），使快速测试能立刻发现"忘记写归属"的回归；`schema-h2-legacy.sql` 表示 V6 形态，只供离线命令的测试使用。V7/V8 的真实收紧由 `OwnershipMigrationIT` 在 MySQL 上验证。
2. **新项目的可见性默认 `TEAM`，存量项目迁移为 `RESTRICTED`**：前者符合"MEMBER 可访问团队可见项目"，后者符合总方案 §6.4「存量项目先收紧、由所有者显式放权」。步骤 03 没有可见性修改接口（§5 表格只允许改名/描述/模板）。
3. **授权水位变更会让目标用户的既有会话失效**：这是步骤 02 已定的契约（版本不符 → 401 强制重新登录），本步骤只是按规格在成员/角色/可见性/团队状态变化时递增水位，并额外保证**当前操作者**在提交后被刷新、不会自我登出。
4. **软删除且 `current_version=0` 的项目同样初始化 revision 1**：总方案与步骤 05 都要求「全部项目（含可恢复软删项目）」数据完整，因此 CAS 推进指针时不按 `status` 过滤；软删除状态本身不变。
5. **维护命令跑完自动退出**：新增 `MaintenanceExitConfig` 监听 `ApplicationReadyEvent`/`ApplicationFailedEvent` 关闭上下文（步骤 02 的 `AdminRecoveryRunner` 未改动）。
6. **平台介入动作集合故意最小**（当前只有 `PROJECT_DELETE`），后续步骤按需要扩展；规格要求的原因长度、目标与"不创建 membership"都已实现并测试。
7. **前端尚未适配新的项目接口**：`POST /api/projects` 已删除、项目列表按团队范围返回，而团队 UI 属于步骤 04。规格把步骤 03–04 之间定位为「不面向用户发布」的窗口（`AUTH_ENFORCEMENT_ENABLED` 仍为 false、`cutover` 仍为 false），前端门禁（lint/test/build）仍全部通过。
8. **`docs/V__1/api.md` 未改动**：它是 V1 的历史文档，V2 的接口契约以 `docs/V__2/steps/*.md` 为准，API/部署文档的合并更新在步骤 11。

## 独立复审与处理

复审由独立子 agent 完成：它自己读规格与代码，实跑后端快速测试、前端 lint/test/build、真实集成脚本，并只读查询本机开发库。结论是 **「步骤 03 可判定为已完成且符合总方案（后端门禁范围），无阻塞问题」**，同时给出 8 项非阻塞项。据此修正了 1 项真实并发缺陷、1 项锁顺序问题、2 处规格缺口，并补上并发测试。

### 修正内容

1. **两个 OWNER 并发禁用可以互相绕过（真实缺陷）**：原 `guardLastOwner` 只统计「成员关系仍是 ACTIVE/OWNER」，而账号被禁用后其 `team_member` 行仍是 ACTIVE/OWNER，因此两个 OWNER 同时被禁用时都会通过检查。第一次修正把它改成 `JOIN app_user` 计数，但新写的 MySQL 并发用例立刻证明**仍然失败**：MySQL 默认 REPEATABLE READ 下，事务内的普通读读的是事务开始时的快照，看不到并发事务刚刚提交的 `DISABLED`。最终改为新增 `team/application/OwnerGuard`：由**已加锁**的成员行得到候选 OWNER，再按 `user_id` 升序对其账号行做**锁读**（锁读才会看到最新已提交值），并且不短路以保证锁集合确定。`TeamMemberService` 与 `PlatformAdminService` 共用它。
2. **锁顺序反转（ABBA 窗口）**：`PlatformAdminService.changeStatus` 原来先 `users.lock(target)` 再锁 `team/team_member`，与 `TeamMemberService` 的 `team → team_member → app_user` 相反。已改为先 `guardLastOwner`（team → team_member → 账号锁读）再锁目标账号行。
3. **补齐规格 §5 接口表格中的 `GET /api/teams/{id}/projects`**：非团队成员返回 404（与不可见资源规则一致），团队内返回同一套 SQL 范围过滤结果；`GET /api/projects?teamId=` 行为与之统一。
4. **reconciliation 增加 FK/CHECK 校验**：规格 §2.3 要求「列/FK/CHECK/checksum 完全匹配」，此前只校验列可空性与 checksum。现在同时确认 `fk_project_team`、`fk_project_created_by`、`chk_project_visibility`、`fk_project_revision_created_by`、`chk_project_revision_source`、`chk_project_revision_collab_pair` 均存在。
5. **补并发测试**：H2 侧重用确定性用例「已 DISABLED 的 OWNER 不构成有效 OWNER」（后提交方看到的状态）；真实 MySQL 用 `TeamOwnershipIT` + barrier/latch 覆盖并发禁用与并发降级，不使用 `sleep` 猜测顺序。

第二轮定向复核（针对上述修正）确认第 1、3、4 项与测试有效性成立——它做了对照实验：把 `OwnerGuard` 换回「只数成员关系」会让 H2 用例与 `TeamOwnershipIT` 分别以「期望 409 实得 200」和 `["OK","OK"]` 失败；把锁读换回普通读同样失败，证明「REPEATABLE READ 快照读不到并发刚提交的 `DISABLED`、必须锁读」的解释与实现都正确。但它**推翻了我的锁顺序结论**，并探测出两个新的真实死结，均已修正：

6. **app_user 加锁仍非单调（ABBA）**：`changeStatus` 先按 `user_id` 升序锁候选 OWNER，**再**锁目标账号——目标未参与排序，若其 id 小于某候选，本事务的加锁顺序就不是递增的，与 `AuthzVersionService.bump` 的升序更新构成 ABBA。已改为：先按 `team_id` 升序锁完全部相关团队与成员行，再把**全部**涉及的账号（各团队的有效 OWNER ∪ 本次目标账号）**一次性**按 `user_id` 升序锁读，使每个事务内对 `app_user` 的加锁单调递增。`OwnerGuard.lockAccounts` 现在是唯一的账号锁读入口，且不短路。
7. **归档团队会永久卡住其唯一 OWNER 的账号**：归档不可逆、也无法再添加成员，而守卫仍要求它保留有效 OWNER，导致该账号永远无法被禁用（复核用探针实测 409）。已改为只对**仍为 ACTIVE 的团队**执行守卫（`TeamRepository.listOwnedActiveTeamIds`）。
8. **可以把所有权/OWNER 角色交给已禁用的账号**：`transferOwnership` 与「提升为 OWNER」都不校验目标账号状态，复核探针实测可以把唯一 OWNER 转给已 DISABLED 的成员并得到 200，团队有效 OWNER 归零。现在两条路径都要求目标账号为 ACTIVE 才允许。

### 第三轮复核（针对上述修正）与处理

第三轮确认第 1、3、4 项与对照实验结论成立，并**复现了一个新的真实死锁**（用真实 MySQL 探针得到 `CannotAcquireLockException: Deadlock found`），已修正：

9. **`app_user` 加锁仍可能被「追加一个更小的 id」破坏单调性**：`changeRole` 先按 `user_id` 升序锁读「有效 OWNER 成员 ∪ 目标账号」，之后 `AuthzVersionService.bump({target, actor})` 会**追加操作者账号**——操作者若是 ADMIN 就不在第一批里，其 id 更小时本事务的加锁顺序不再是递增的，另一支并发事务即可构成 ABBA。已统一为：`OwnerGuard.accountsToLock(members, actor.id(), targetUserId)` 计算本事务会碰到的**全部**账号，交给 `OwnerGuard.lockAccounts` 一次性按 `user_id` 升序锁读；`PlatformAdminService` 的守卫同样把目标账号并入同一批次，并删除对 `UserRepository.lock` 的直接调用。现在「一个事务内对 `app_user` 的加锁只来自一次升序批次」是可检查的不变量。
10. **补确定性回归测试**：新增 `OwnerGuardTests`（机制测试）断言账号集合必须包含操作者与目标、加锁按 `user_id` 升序、每个账号恰好一次、**不短路**，以及 `hasValidOwner` 正确忽略已禁用账号与已移除的成员关系；`TeamOwnershipIT` 增加跨团队、actor 为 ADMIN（id 小于 OWNER）的并发改角色用例，正是复核复现死锁的形态。

修正后重新执行全部门禁并通过：后端快速测试 171 项、前端 lint/test/build、真实集成 21 项（`TeamOwnershipIT` 3/3）全部 `BUILD SUCCESS`。

### 第四轮复核（针对上述修正）与处理

第四轮确认 `app_user` 的加锁单调性成立，并用对照实验证明新用例确有区分力：把 `TeamMemberService` 传给 `accountsToLock` 的 `actor.id()` 去掉后，`concurrentRoleChangesAcrossTeamsCompleteWithoutLockErrors` 立刻以 `CannotAcquireLockException` 失败，且 **0.089 秒**返回（`innodb_lock_wait_timeout=50s`，说明是 InnoDB 死锁检测而非锁等待超时）；还原后 3/3 通过。它同时发现另一条残留互锁边，已修正：

11. **`app_user` ↔ `project_member` 反序**：`TeamMemberService.remove`（目标为 OWNER 时）先锁 `app_user` 再写 `project_member`，而 `ProjectMemberService.grant/revoke` 先写 `project_member` 再更新 `app_user`；两条路径都不持 team 行锁，因此同一用户「被移出团队」与「被授/撤项目角色」并发时可构成 ABBA。已把 `remove` 里的项目授予失效移到账号锁读之前，使全局加锁顺序固定为 `team → team_member（按 user_id 升序）→ project_member → app_user（按 user_id 升序）`；守卫失败会回滚整个事务，提前写入不会留下半完成状态。
12. 该顺序与「一个事务内 `app_user` 加锁只来自一次升序批次」一并写进 `CLAUDE.md`，作为后续步骤的硬约束。

### 已记录、未修改的项

- `audit_log` 的 MySQL 触发器不拦 `TRUNCATE`（触发器只对 DML 生效）。规格 §2.1 要求的是「应用账号对 audit_log 仅 INSERT/SELECT，禁止 UPDATE/DELETE」，该要求已满足；更强的账号权限收紧属于纵深防御，留待步骤 10 的安全加固。
- 授权水位递增会让**被授予**权限的用户既有会话变 401。这是步骤 02 已验收的契约（版本不符即强制重新登录），步骤 03 只保证**操作者自身**会话被刷新，未改动该契约。
- 仍未被并发用例覆盖的极端窗口：用户被禁用的同一瞬间因**并发的所有权转移**成为另一个团队的 OWNER（该团队不在禁用前枚举到的结果里）。团队行锁能串行化同一团队的 OWNER 变更，但跨团队新增 OWNER 关系不在禁用方的枚举范围内。`TeamOwnershipIT` 覆盖的是规格 §3 明确要求的「两个 OWNER 并发禁用」；跨团队窗口留待步骤 09 的撤权/Outbox 链路统一处理。
- `application.yml` 未固定 `spring.flyway.target`（V9 尚不存在；规格要求由发布制品显式以 `target=8`/`target=9` 执行）。
- `TeamInvitationService.registerWithInvitation` 的写入顺序是「插入 `app_user`（全新行）→ `team_member` → 更新 `app_user`」，与别处的 `team_member → app_user` 相反；它涉及的是全新行，其他事务无法预先持有该行的锁，因此不构成环（第四轮复核同意此判断，仅标注未做并发探针）。
- `TeamInvitationService.accept` 写 `team_member` 时不持 team 行锁。它只能授予 ADMIN/MEMBER（`RoleInput.invitableTeamRole` 拒绝 OWNER），且对已是有效成员的账号会提前返回而不改写角色，因此不会改变 OWNER 数量，也就不参与 §3 的 OWNER 保护协议。

### 当前门禁

四轮独立复审（后三轮为针对修正的定向复审）均给出「无阻塞问题」；其提出的全部实用缺陷已逐项修正并留有回归测试：两个 OWNER 并发禁用互相绕过（REPEATABLE READ 快照读）、两处 `app_user` 加锁非单调（含被真实探针复现的死锁）、`app_user ↔ project_member` 反序、归档团队卡住唯一 OWNER、可把所有权交给已禁用账号。回归覆盖 = `OwnerGuardTests`（机制测试，确定性）+ `TeamOwnershipIT`（真实 MySQL + barrier/latch）。后端快速测试 171 项、前端 lint/test/build、真实集成 21 项全部通过。

三轮独立复审（第三轮为针对修正的定向复审）均已给出「无阻塞问题」，其提出的全部阻塞级/实用缺陷已逐项修正并留有回归测试。后端快速测试 171 项、前端 lint/test/build、真实集成 21 项全部通过。

## 保留约束与后续工作

- 本步骤**不**面向用户发布：`AUTH_ENFORCEMENT_ENABLED` 默认 false，唯一的原子启用窗口是步骤 04 的登录 UI 就绪后与 `V9` 一起切换。
- 步骤 03 不创建 `collab_document`，不写 `collab/` 前缀对象，不实现票据、Yjs、检查点或 Outbox；`USER_DISABLED / TEAM_MEMBER_REMOVED / PROJECT_MEMBER_REMOVED / ROLE_DOWNGRADED` 只作为稳定领域事件类型与聚合序号契约预留，步骤 09 才写 `collab_control_event`。
- 本地开发库已到 V8，全部存量项目归入「存量项目迁移团队」并标记 `RESTRICTED`；唯一活动项目对管理员可见。后续如需让这些项目对更多用户可见，走项目成员授予（`PUT /api/projects/{id}/members/{userId}`）。
- `BOOTSTRAP_ADMIN_PASSWORD` 仍留在根 `.env`（仅本机、已被 git 忽略）；如不再需要创建管理员，可从 `.env` 移除该行。
- 全部运行使用本机 MySQL/MinIO，无 Docker；未打印或提交根 `.env` 凭据。本文件不宣称 V2 协作系统已完成。
