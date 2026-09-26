# 步骤 03：团队、邀请、项目 ACL、审计与存量迁移

> 前置：步骤 01、02 已完成。  
> 文档/开发顺序门禁：步骤 03 后端、V6–V8 和 target=8 验收通过后才开始步骤 04；这就是“步骤 03 完成”的开发含义。生产验收的匿名关闭由步骤 03/04 联合发布完成：UI 就绪后才交付 V9，并以 target=9 与认证开关原子切换。

## 1. 唯一领域模型

团队角色为 `OWNER / ADMIN / MEMBER`；项目角色为 `MANAGER / EDITOR / VIEWER`；项目可见性为 `TEAM / RESTRICTED`。有效项目角色取以下能力最高值：

- 团队 OWNER/ADMIN 对全部项目具有 MANAGER 能力；
- TEAM 项目的有效团队成员至少为 VIEWER；
- RESTRICTED 项目只有 OWNER/ADMIN 或有效 project_member 可见；
- project_member 只在 ACTIVE team_member 之上生效。

授予上限：OWNER 可授予团队全部角色；ADMIN 最多授予 ADMIN/MEMBER，且不能创建、修改、移除或降级任何 OWNER；OWNER/ADMIN 可授予 MANAGER；MANAGER 最多授予 EDITOR/VIEWER，且不能创建、修改、移除或降级另一个 MANAGER。服务端同时比较操作者等级、目标当前等级和目标新等级，禁止利用合法枚举绕过层级；禁止自我提权。最后一个有效 OWNER 不得退出、移除、降级或禁用。

统一 `ProjectAccessService`/`TeamAccessService` 返回 `teamId/effectiveRole/capabilities/authzVersion`。Controller、ProjectService、SnapshotService、revision 读取/恢复、MinIO 读取和未来内部 API 都在服务层调用；列表在 SQL 层按权限过滤，禁止查全量后 Java 过滤。不可见资源为 404，可见但动作不足为 403。只有项目条件写使用步骤 01 的 If-Match。

## 2. 迁移分阶段执行

MySQL DDL 有隐式提交，且 MinIO 写入不能包含在 Flyway 事务中，因此禁止声称全流程原子。

### 2.1 V6 additive migration

`V6__add_team_acl_audit_and_legacy_claim.sql` 创建：

- `team`：id、name、唯一 slug、`status ACTIVE/ARCHIVED`、created_by、时间戳；
- `team_member`：team_id/user_id 联合主键、`role OWNER/ADMIN/MEMBER`、`status ACTIVE/REMOVED`、joined_at、created_by、updated_at；
- `team_invitation`：id、team_id、唯一 token_hash、normalized_email、`role ADMIN/MEMBER`、`status PENDING/ACCEPTED/REVOKED/EXPIRED`、expires/accepted/revoked/created 时间和 actor；
- `project_member`：project_id/user_id 联合主键、`role MANAGER/EDITOR/VIEWER`、`status ACTIVE/REMOVED`、granted_by、时间戳；
- `legacy_project_claim`：project_id 唯一、suggested/claimed team 与 creator、`status PENDING/CLAIMED/FAILED`、error_code、attempt_count、时间戳；
- `audit_log`：id、occurred_at、actor_type `USER/SYSTEM/MAINTENANCE`、actor_user_id nullable、actor_snapshot、action、target_type/id、team_id/project_id、`result SUCCESS/FAILURE`、request_id、受限 metadata_json。

给 `project` additive 增加 nullable team_id、created_by 和 visibility；给 `project_revision` 增加 nullable created_by、source、collab_epoch、collab_generation。source CHECK 固定 `LEGACY/MANUAL/AUTO/LEAVE/RESTORE`。所有 role/status/visibility/source 有 CHECK；FK 默认 RESTRICT，不级联删除审计或目标历史；授权查询建立 team/user/status、project/user/status、project/team/visibility 索引。

V6 同时创建数据库账号权限/触发器或等价约束，使应用账号对 audit_log 仅 INSERT/SELECT，禁止 UPDATE/DELETE；审计保存目标稳定 ID 和快照，目标删除不级联。

### 2.2 可恢复应用迁移命令

交付离线 `LegacyProjectMigrationCommand`，要求 Web 实例停写并持有 `system_bootstrap_lock`。配置 `LEGACY_OWNER_USER_ID`，启动即校验该用户是 ACTIVE PLATFORM_ADMIN；不得猜测多个管理员中的一个。

执行编排固定为：第一阶段制品/命令用 `spring.flyway.target=6` 只迁移到 V6；随后以 `spring.flyway.enabled=false` 运行离线命令，避免 Spring 在 Runner 前抢先执行 contract。报告全绿后才交付/执行 V7/V8；V9 仅在步骤 04 UI 已就绪的生产维护窗口执行。

对每个项目建立 claim 后幂等处理：

1. 创建或复用唯一迁移团队，写 OWNER membership；
2. 回填 team_id、created_by、visibility=RESTRICTED；
3. 既有 revision 回填 source=LEGACY、created_by；校验对象存在、gzip/哈希和引用；
4. current_version=0 时调用服务端 `ProjectTemplateService` 生成规范默认文件，把 gzip JSON 写入 `projects/{projectId}/revisions/1-{hash}.json.gz`，以 projectId+version+hash 为幂等键；对象写成功后，在同一数据库事务插 revision 1，并 CAS 原子设置 `current_version=1`、`current_object_key`、模板 `entry_file` 和递增 `lock_version/stateVersion`；
5. 数据库提交失败遗留的不可达对象由步骤 01 revision 清理器回收；重跑先按哈希查对象和 revision，绝不重复加版本；
6. 标记 CLAIMED，失败保留 FAILED/error/attempt，可修复后重跑单项目。

同一步改造新项目创建：后端 ProjectTemplateService 创建项目与初始 revision 1，前端 DEFAULT_FILES 只可作展示 fallback，不再是权威初始化；数据库失败后的对象按相同补偿清理。

命令生成机器可读报告：项目总数、claim 状态、无效 revision/对象、team/creator 空值、current_version=0、无 OWNER 数量，并验证 `project.current_object_key` 与当前 revision 的 object_key/hash 一致。任何非零异常都阻止下一阶段。

### 2.3 V7/V8 contract 与 V9 cutover

报告全绿后，停止离线命令并恢复 Flyway，由发布制品显式以 `spring.flyway.target=8` 执行 `V7__contract_project_ownership.sql` 和 `V8__contract_revision_metadata.sql`。鉴于 MySQL DDL 隐式提交，发布脚本在每个 DDL 前后生成受审计 schema signature；若 DDL 已成功而 history 未登记，只能由一次性 reconciliation 命令在确认目标列/FK/CHECK/现有 checksum 完全匹配后补写对应 history 行，且命令幂等、锁定发布窗口并记录审计；任何不匹配都停止并人工修复，禁止盲目 flyway repair 或重复 ALTER。最终校验 history 恰好连续 V3…V8；后续 V10/V11/V12 只能从该 history 继续。两者各只含一个 MySQL 8 原子 ALTER，并以前置校验验证所有记录（含软删除项目）。随后校验 `flyway_schema_history` 恰好成功至 V8。单个迁移失败时保留诊断，修复数据后受控 `flyway repair` 再重跑；不得把部分 DDL 当整体事务回滚。V9 在步骤 04 UI 制品就绪前不进入可部署制品；开发分支即使包含也持续用 target=8 阻断。原子发布才使用 target=9 且要求 `AUTH_ENFORCEMENT_ENABLED=true`，任一条件不满足 readiness 503。

生产发布时，必须先确认步骤 04 UI 制品就绪、所有旧实例停止接新请求、在途写归零、后台任务停止且进程清单无旧实例，再运行纯 DML `V9__commit_auth_cutover.sql`：锁固定行、重复执行时验证已为 true、设置 `auth_required_cutover=true`。V9 后永不恢复匿名项目 API；旧实例 readiness 503 并停止后台任务，回滚制品须认识 V3–V9、强制认证且 fail closed。

## 3. 成员、OWNER 与授权版本

- 团队创建事务创建 OWNER membership、审计；当前用户 authz_version 递增后，响应前更新 Authentication 快照并保存 SecurityContext。
- 所有可能改变 OWNER 数量的 PATCH/DELETE/转移/禁用都先锁 team，再按 user_id 顺序锁全部相关 membership；普通接口和专门 `POST /api/teams/{id}/owner-transfer` 复用同一事务守卫。新增/提升接收者后才降级原 OWNER。
- 禁用用户先按 team_id 排序锁定其所有 OWNER 团队及成员行，验证每队仍有另一 ACTIVE OWNER，再改变状态；两个 OWNER 并发禁用不能互相绕过。
- 移除 team_member 时同事务把其全部 project_member 置 REMOVED；团队归档而非硬删除，只有 OWNER 可归档，项目保留软删除历史。
- 成员、角色、可见性或团队状态变化计算全部受影响用户，去重后每人 authz_version 只递增一次。若含当前操作者，更新其 Session Authentication；若权限降低则允许明确强制重新登录，但 API 响应必须声明。

## 4. 邀请与注册

token 至少 256-bit CSPRNG，数据库仅存唯一 SHA-256/HMAC 摘要。交付链接使用 URL fragment；前端读取后清除地址，再在 POST body 交换，token 不进入路径、查询、日志或 referrer。创建/交换响应均 `Cache-Control: no-store`。

- INVITE_ONLY 新用户：`POST /api/auth/register { invitationToken, username, password, displayName }`，token 必填；服务端从邀请绑定 email，事务内创建固定 ACTIVE/USER/version0 用户、ACTIVE team_member、消费邀请和审计，不自动登录。OPEN 仅在步骤 02 已批准的 local/dev 配置中允许无 token 注册，创建 USER 后可自行创建首个团队；CLOSED 一律拒绝。
- 已有用户：登录后 `POST /api/invitations/accept { invitationToken }`。校验当前 normalized email；已是成员仍原子消费 token并幂等返回 membership。
- 接受用条件更新 PENDING 且未过期；撤销与接受竞争只有一个成功。无效、过期、已用、撤销统一 410 `INVITATION_INVALID_OR_EXPIRED` 防枚举。
- OWNER/ADMIN 可邀请 ADMIN/MEMBER，不可邀请 OWNER。

## 5. API

授权动作与接口形成唯一表格，Controller 和服务层使用同一枚举：

| 接口 | 动作 |
| --- | --- |
| POST /api/teams | TEAM_CREATE（任意 ACTIVE 用户；OPEN 注册用户由此建首队） |
| GET /api/teams、GET /api/teams/{id} | TEAM_READ |
| PATCH /api/teams/{id} | TEAM_SETTINGS_MANAGE |
| POST /api/teams/{id}/archive | TEAM_ARCHIVE |
| GET/PATCH/DELETE /api/teams/{id}/members[/{userId}]、owner-transfer | TEAM_MEMBER_MANAGE |
| GET/POST/DELETE /api/teams/{id}/invitations[/{inviteId}] | TEAM_INVITATION_MANAGE |
| GET /api/teams/{id}/audit-logs | TEAM_AUDIT_READ |
| POST /api/teams/{id}/projects | PROJECT_CREATE（团队 OWNER/ADMIN） |
| GET /api/projects、GET /api/teams/{id}/projects、GET /api/projects/{id} | PROJECT_READ |
| PUT /api/projects/{id} | PROJECT_MANAGE；仅允许名称、描述、模板，禁止入口字段 |
| DELETE /api/projects/{id} | PROJECT_DELETE |
| GET/PUT/DELETE /api/projects/{id}/members[/{userId}] | PROJECT_MEMBER_MANAGE |
| GET /api/projects/{id}/revisions | REVISION_READ |
| PUT /api/projects/{id}/snapshot | CHECKPOINT_CREATE |
| POST /api/projects/{id}/revisions/{v}/restore | REVISION_RESTORE |
| PATCH /api/admin/users/{id}/status、platform-role | USER_MANAGE |
| POST /api/admin/platform-access、GET /api/admin/audit-logs | PLATFORM_ACCESS |

TEAM_READ 要求有效 team_member；TEAM_SETTINGS_MANAGE/ARCHIVE 仅 OWNER；TEAM_MEMBER_MANAGE 与 INVITATION_MANAGE 为 OWNER/ADMIN但仍受角色上限；TEAM_AUDIT_READ 为 OWNER/ADMIN。动作枚举完整为 TEAM_CREATE、TEAM_READ、TEAM_SETTINGS_MANAGE、TEAM_ARCHIVE、TEAM_MEMBER_MANAGE、TEAM_INVITATION_MANAGE、TEAM_AUDIT_READ、PROJECT_CREATE、PROJECT_READ、PROJECT_EDIT、PROJECT_MANAGE、PROJECT_DELETE、CHECKPOINT_CREATE、REVISION_READ、REVISION_RESTORE、PROJECT_MEMBER_MANAGE、USER_MANAGE、PLATFORM_ACCESS。

唯一项目创建入口是 POST /api/teams/{teamId}/projects，校验 PROJECT_CREATE 并执行 ProjectTemplateService+revision1；旧 POST /api/projects 删除映射并返回 404/405。列表均分页，邀请 token 只在 body。平台角色不自动获得业务权限；平台介入要求 10–500 字原因、目标项目和单次动作，写审计且不创建 membership。

DTO 严格拒绝 actor、role 上限外值、状态、版本或创建者等服务端字段。项目列表/详情按 TEAM/RESTRICTED 和有效成员 SQL 过滤。

## 6. 审计

成功敏感变更与 SUCCESS audit_log 同事务，写审计失败则回滚。拒绝/失败操作由外层独立小事务记录 FAILURE，但不得记录密码、token、Cookie、CSRF、源码或完整邮箱；metadata 有 schema 白名单与大小上限。

OWNER/ADMIN 只能分页读取本团队日志；PLATFORM_ADMIN 可读平台管理/介入日志。分页使用 `(occurred_at,id)` 游标。bootstrap、迁移、recovery 使用 SYSTEM/MAINTENANCE actor。AdminRecoveryCommand 在 V6 后写恢复审计；V6 前发生的恢复以启动日志 request ID 留痕，迁移时补 SYSTEM 记录。

## 7. 与 Outbox 的边界

audit_log 不是控制事件队列。步骤 03 只在授权事务中预留稳定领域事件类型和聚合序号契约：`USER_DISABLED / TEAM_MEMBER_REMOVED / PROJECT_MEMBER_REMOVED / ROLE_DOWNGRADED`。步骤 09 添加 collab_control_event 表后，把这些事件与业务变更同事务写入 Outbox；在此之前协作 feature flag 必须关闭。

步骤 06 可依赖稳定授权决定：userId、teamId、projectId、effectiveRole、capabilities、authzVersion。步骤 05 的输入报告必须证明每个活动项目 team/creator 非空、current revision≥1、对象有效；步骤 03 不创建 collab_document。

## 8. 测试与验收

快速测试覆盖完整角色/可见性矩阵、授予上限（ADMIN 不碰 OWNER、MANAGER 不碰 MANAGER）、自我提权、team_member 硬前提、SQL 范围列表、全部服务入口授权、所有 OWNER 变更路径的统一锁和并发禁用、当前 Session 版本刷新、邀请两条流程/410/竞态/no-store、管理员 API、审计不可修改和秘密过滤。

真实 MySQL/MinIO 集成覆盖 Flyway target=6→禁用 Flyway 运行迁移命令重跑/故障注入→报告→V7/V8→步骤04就绪后的V9；version0 生成 revision1、对象写后 DB 失败补偿、既有 revision 回填、LEGACY_OWNER 校验、旧实例/后台任务退出、cutover 后匿名不可恢复。前端契约不再期待 412，陈旧 ETag 使用步骤 01 的 409。

验收要求报告零异常、所有项目完整指针一致且活动项目满足步骤 05 前置、每队有 ACTIVE OWNER、权限/邀请/审计无旁路、cutover 不可逆，`mvn test`、前端 lint/test/build 和 `mvn -Pintegration verify` 全部通过；使用根 .env、本机 MySQL/MinIO，禁止 Docker且不输出秘密。












