# 步骤 03：团队、邀请、项目 ACL 与旧项目隔离

> 前置：步骤 01、02 已完成。  
> 文档/开发顺序门禁：步骤 03 后端、V6–V8 和 target=8 验收通过后才开始步骤 04；这就是“步骤 03 完成”的开发含义。生产验收的匿名关闭由步骤 03/04 联合发布完成：UI 就绪后才交付 V9，并以 target=9 与认证开关原子切换。

## 1. 唯一领域模型

团队角色为 `OWNER / ADMIN / MEMBER`；项目角色为 `MANAGER / EDITOR / VIEWER`；项目可见性为 `TEAM / RESTRICTED`。有效项目角色取以下能力最高值：

- 团队 OWNER/ADMIN 对所属团队的非旧匿名项目具有 MANAGER 能力；
- TEAM 项目的有效团队成员至少为 VIEWER；
- RESTRICTED 项目只有 OWNER/ADMIN 或有效 project_member 可见；
- project_member 只在 ACTIVE team_member 之上生效。

授予上限：OWNER 可授予团队全部角色；ADMIN 最多授予 ADMIN/MEMBER，且不能创建、修改、移除或降级任何 OWNER；OWNER/ADMIN 可授予 MANAGER；MANAGER 最多授予 EDITOR/VIEWER，且不能创建、修改、移除或降级另一个 MANAGER。服务端同时比较操作者等级、目标当前等级和目标新等级，禁止利用合法枚举绕过层级；禁止自我提权。最后一个有效 OWNER 不得退出、被移除或被降级。

统一 `ProjectAccessService`/`TeamAccessService` 返回 `teamId/effectiveRole/capabilities/authzVersion`。Controller、ProjectService、SnapshotService、revision 读取/恢复、MinIO 读取和未来内部 API 都在服务层调用；列表在 SQL 层按权限过滤，禁止查全量后 Java 过滤。不可见资源为 404，可见但动作不足为 403。只有项目条件写使用步骤 01 的 If-Match。

## 2. 迁移分阶段执行

MySQL DDL 有隐式提交，迁移各阶段不能当作一个数据库事务；新项目的 MinIO 写入另按对象补偿规则处理。

### 2.1 V6 additive migration

`V6__add_team_acl_and_legacy_isolation.sql` 创建：

- `team`：id、name、唯一 slug、`status ACTIVE/ARCHIVED`、`join_policy REQUEST/INVITE_ONLY`（默认 REQUEST）、created_by、时间戳；
- `team_member`：team_id/user_id 联合主键、`role OWNER/ADMIN/MEMBER`、`status ACTIVE/REMOVED`、joined_at、created_by、updated_at；
- `team_invitation`：id、team_id、唯一 token_hash、normalized_email、`role ADMIN/MEMBER`、`status PENDING/ACCEPTED/REVOKED/EXPIRED`、expires/accepted/revoked/created 时间；
- `team_join_request`：id、team_id、user_id、`status PENDING/APPROVED/REJECTED/WITHDRAWN`、申请说明（长度受限）、created/decided 时间；team_id/user_id/status 索引及保证单用户单团队至多一个 PENDING 请求的约束；
- `project_member`：project_id/user_id 联合主键、`role MANAGER/EDITOR/VIEWER`、`status ACTIVE/REMOVED`、granted_by、时间戳；

给 `project` additive 增加 nullable team_id、created_by 和 visibility，以及 `legacy_unowned` 标记；停写窗口中把迁移前所有项目标记为 true，新项目固定 false。给 `project_revision` 增加 nullable created_by、source、collab_epoch、collab_generation。source CHECK 固定 `LEGACY/MANUAL/AUTO/LEAVE/RESTORE`。所有 role/status/visibility/source 有 CHECK；FK 默认 RESTRICT，不级联删除目标历史；授权查询建立 team/user/status、project/user/status、project/team/visibility 索引。


### 2.2 旧匿名项目隔离与新项目初始化

V1 项目没有可验证的所有者，不做认领、分配、导入或版本 0 补齐。维护窗口停止旧写流量后，V6 将迁移前既有项目统一标记 `legacy_unowned=true`，保留原项目、revision 和 MinIO 对象。V2 所有项目列表、详情、版本、对象读取、复制、恢复、删除、协作票据和内部网关入口均先排除该标记；不得为旧项目生成 team_member、project_member 或 collab_document。旧匿名项目既不出现在用户 UI，也不能通过猜测 ID 访问。

新项目只能通过团队入口创建，服务端 `ProjectTemplateService` 原子准备项目和初始 revision 1；新行必须 `legacy_unowned=false` 且 `team_id/created_by` 非空。前端 DEFAULT_FILES 只可作为展示 fallback，对象写成功而数据库失败时按步骤 01 的清理规则补偿。生产 V6–V9 在同一停写维护窗口执行；V6 标记旧项目后，旧版本服务不得恢复写入，避免产生未标记的匿名项目。

迁移报告分别统计 `legacy_unowned=true` 的旧项目数量和新项目的完整性；仅新项目需要有效团队、创建者、OWNER、revision 1、对象引用和哈希一致。旧项目的原始不完整状态不阻止新身份系统启用，但旧项目标记错误、任何旧数据越权可读或新项目不完整必须阻止切换。

### 2.3 V7/V8 contract 与 V9 cutover

V7 `V7__contract_project_ownership.sql` 建立条件约束：仅 `legacy_unowned=true` 的旧行允许缺少 `team_id/created_by`，`legacy_unowned=false` 的新行必须非空且有有效团队归属。V8 `V8__contract_revision_metadata.sql` 将既有 revision 标记 `source=LEGACY`，允许其 `created_by` 为空；新 revision 必须有固定来源与符合该来源的创建者语义。两者都不得把旧匿名项目改成用户项目。DDL 前后留存 schema signature；MySQL DDL 隐式提交，部分成功必须按实际 schema 和 Flyway history 精确对账，不得假定事务回滚。最终校验 history 连续 V3…V8，后续 V10/V11/V12 从该 history 继续。

V9 仅在步骤 04 UI 就绪的维护窗口执行。V6 开始前确认旧实例停止接新请求、在途写归零、后台任务停止；V6–V8 完成后运行纯 DML `V9__commit_auth_cutover.sql`：锁 `auth_cutover_state` 固定行，幂等设置 `auth_required_cutover=true`。原子发布使用 target=9 且要求 `AUTH_ENFORCEMENT_ENABLED=true`；任一条件不满足 readiness 503。V9 后不恢复匿名项目 API；回滚制品须认识 V3–V9、强制认证且拒绝旧匿名项目，旧实例不得继续写。

## 3. 成员、OWNER 与授权版本

- 团队创建事务创建 OWNER membership 并递增当前用户 `authz_version`；后续请求从 MySQL 读取最新 ACL，现有访问 JWT 不承载团队角色，无须更新 Token。
- 所有可能改变 OWNER 数量的 PATCH/DELETE/转移都先锁 team，再按 user_id 顺序锁全部相关 membership；普通接口和专门 `POST /api/teams/{id}/owner-transfer` 复用同一事务守卫。新增/提升接收者后才降级原 OWNER。
- 移除 team_member 时同事务把其全部 project_member 置 REMOVED；团队归档而非硬删除，只有 OWNER 可归档，项目保留软删除历史。
- 成员、角色、可见性或团队状态变化计算全部受影响用户，去重后每人 `authz_version` 只递增一次。JWT 只承载身份和 `token_version`，服务端每次重新查询 MySQL ACL；权限降低立即影响 REST、后续协作票据和握手，无须等待 JWT 到期。

## 4. 开放注册、团队加入与邀请

token 至少 256-bit CSPRNG，数据库仅存唯一 SHA-256/HMAC 摘要。交付链接使用 URL fragment；前端读取后清除地址，再在 POST body 交换，token 不进入路径、查询、日志或 referrer。创建/交换响应均 `Cache-Control: no-store`。

- 自助注册：`POST /api/auth/register { username, email?, password, displayName? }` 不需要邀请；创建 version0 用户，不创建团队成员关系，也不自动登录。登录后可创建一个或多个团队，每个创建者成为新团队首位 OWNER。
- 团队创建：`POST /api/teams { name, slug }` 对所有已登录用户开放。服务端在单事务创建 team 和 OWNER membership；并发 slug 冲突返回 409，不留下孤立团队或成员。
- 申请加入：只有 `join_policy=REQUEST` 的 ACTIVE 团队接受 `POST /api/teams/{teamId}/join-requests { message? }`。申请人必须已登录且尚非成员；重复 PENDING 返回既有申请或 409（固定一种契约），被拒后允许重新申请。申请不授予任何团队、项目或成员读取权限。
- 审批申请：OWNER/ADMIN 通过 `POST /api/teams/{teamId}/join-requests/{requestId}/approve` 或 `/reject`。审批事务锁定团队和申请，复核团队状态、策略、申请人存在性及非成员条件；批准以 MEMBER 创建 ACTIVE membership，拒绝不创建 membership。申请人可 `DELETE /api/teams/{teamId}/join-requests/{requestId}` 撤回自己的 PENDING 申请。成员关系和策略变化按需更新受影响用户 authz_version。
- 加入邀请：已登录用户通过 `POST /api/invitations/accept { invitationToken }` 接受邀请。邀请若绑定邮箱，校验当前 normalized email；不绑定邮箱的团队邀请仍绑定目标团队和允许角色。已是成员时仅在邀请目标角色不高于当前角色的情况下原子消费 token并幂等返回 membership，不得借重复接受提升角色。
- 接受用条件更新 PENDING 且未过期；撤销与接受竞争只有一个成功。无效、过期、已用、撤销统一 410 `INVITATION_INVALID_OR_EXPIRED` 防枚举。
- OWNER/ADMIN 可邀请 ADMIN/MEMBER，不可邀请 OWNER。

## 5. API

授权动作与接口形成唯一表格，Controller 和服务层使用同一枚举：

| 接口 | 动作 |
| --- | --- |
| POST /api/teams | TEAM_CREATE（任意已登录用户） |
| GET /api/teams、GET /api/teams/{id} | TEAM_READ |
| GET /api/teams/discover?query=... | TEAM_DISCOVER（仅返回 ACTIVE 且 join_policy=REQUEST 团队的 id/name/slug/简介） |
| POST /api/teams/{id}/join-requests、DELETE /api/teams/{id}/join-requests/{requestId} | JOIN_REQUEST_CREATE / JOIN_REQUEST_WITHDRAW（申请人本人） |
| GET /api/me/team-join-requests | JOIN_REQUEST_READ（仅当前用户自己的申请） |
| GET /api/teams/{id}/join-requests、POST /api/teams/{id}/join-requests/{requestId}/approve、POST /api/teams/{id}/join-requests/{requestId}/reject | JOIN_REQUEST_MANAGE（OWNER/ADMIN） |
| PATCH /api/teams/{id} | TEAM_SETTINGS_MANAGE |
| POST /api/teams/{id}/archive | TEAM_ARCHIVE |
| GET/PATCH/DELETE /api/teams/{id}/members[/{userId}]、owner-transfer | TEAM_MEMBER_MANAGE |
| GET/POST/DELETE /api/teams/{id}/invitations[/{inviteId}] | TEAM_INVITATION_MANAGE |
| POST /api/teams/{id}/projects | PROJECT_CREATE（团队 OWNER/ADMIN） |
| GET /api/projects、GET /api/teams/{id}/projects、GET /api/projects/{id} | PROJECT_READ |
| PUT /api/projects/{id} | PROJECT_MANAGE；仅允许名称、描述、模板，禁止入口字段 |
| DELETE /api/projects/{id} | PROJECT_DELETE |
| GET/PUT/DELETE /api/projects/{id}/members[/{userId}] | PROJECT_MEMBER_MANAGE |
| GET /api/projects/{id}/revisions | REVISION_READ |
| PUT /api/projects/{id}/snapshot | CHECKPOINT_CREATE |
| POST /api/projects/{id}/revisions/{v}/restore | REVISION_RESTORE |

TEAM_READ 要求有效 team_member；TEAM_DISCOVER 只返回显式允许发现的公开基本资料，不代表加入或查看团队资源；JOIN_REQUEST_READ 仅允许读取当前用户自己的申请；TEAM_SETTINGS_MANAGE/ARCHIVE 仅 OWNER；TEAM_MEMBER_MANAGE、JOIN_REQUEST_MANAGE 与 INVITATION_MANAGE 为 OWNER/ADMIN但仍受角色上限。动作枚举完整为 TEAM_CREATE、TEAM_READ、TEAM_DISCOVER、JOIN_REQUEST_CREATE、JOIN_REQUEST_WITHDRAW、JOIN_REQUEST_READ、JOIN_REQUEST_MANAGE、TEAM_SETTINGS_MANAGE、TEAM_ARCHIVE、TEAM_MEMBER_MANAGE、TEAM_INVITATION_MANAGE、PROJECT_CREATE、PROJECT_READ、PROJECT_EDIT、PROJECT_MANAGE、PROJECT_DELETE、CHECKPOINT_CREATE、REVISION_READ、REVISION_RESTORE、PROJECT_MEMBER_MANAGE。

唯一项目创建入口是 POST /api/teams/{teamId}/projects，校验 PROJECT_CREATE 并执行 ProjectTemplateService+revision1；旧 POST /api/projects 删除映射并返回 404/405。列表均分页，邀请 token 只在 body。不存在平台介入或全局业务权限。

DTO 严格拒绝 role 上限外值、状态、版本或创建者等服务端字段。项目列表/详情按 TEAM/RESTRICTED 和有效成员 SQL 过滤。

## 6. 与 Outbox 的边界

步骤 03 只在授权事务中预留稳定领域事件类型和聚合序号契约：`USER_LOGGED_OUT / USER_CREDENTIALS_REVOKED / TEAM_MEMBER_REMOVED / PROJECT_MEMBER_REMOVED / ROLE_DOWNGRADED`。团队加入申请批准产生 `TEAM_MEMBER_ADDED`，申请本身不改变授权状态。步骤 09 添加 collab_control_event 表后，把这些事件与业务变更同事务写入 Outbox；在此之前协作 feature flag 必须关闭。

步骤 06 可依赖稳定授权决定：userId、teamId、projectId、effectiveRole、capabilities、authzVersion。步骤 05 的输入报告必须证明每个非旧匿名活动项目 team/creator 非空、current revision≥1、对象有效；步骤 03 不创建 collab_document。

## 7. 测试与验收

快速测试覆盖完整角色/可见性矩阵、授予上限（团队 ADMIN 不碰 OWNER、项目 MANAGER 不碰 MANAGER）、自我提权、team_member 硬前提、SQL 范围列表、全部服务入口授权、所有 OWNER 变更路径的统一锁和并发成员变化、JWT 在角色变更后仍按最新数据库 ACL 授权、团队创建与首位 OWNER 原子性、join_policy、团队发现不泄露私有资料、申请创建/撤回/批准/拒绝/重复与并发竞态、未获批申请无资源权限、加入策略变更竞态、邀请接受/410/竞态/no-store、旧匿名项目隔离和秘密过滤。

功能验收先确认 V6 旧项目标记、V7/V8 条件约束和 target=8 的开发结果；V9 cutover 在步骤 04 UI 就绪的联合发布窗口执行，之后匿名项目接口不可恢复。还要确认新项目初始 revision1、对象写失败补偿、旧项目不可读、撤权后旧协作票据失效及 JWT REST 权限实时更新。前端契约不再期待 412，陈旧 ETag 使用步骤 01 的 409。本机 MySQL/MinIO/Redis 专用集成验证不作为门禁。

开始步骤 04 的功能门禁：新项目报告零异常、所有非旧匿名活动项目完整指针一致且满足步骤 05 前置、每队有 ACTIVE OWNER、旧匿名项目隔离、权限/邀请无旁路、target=8 已就绪。步骤 04 UI 就绪后再验收 V9 联合切换；运行应用使用根 .env、本机 MySQL/MinIO/Redis，禁止 Docker 且不输出秘密。












