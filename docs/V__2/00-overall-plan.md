# Web Editor V2：身份系统与多人在线编辑器整体开发总方案

> 文档版本：V2.0 方案稿  
> 编制日期：2026-09-22  
> 适用仓库：`front-end-editor`  
> 文档性质：V2 开发的架构基线、范围边界和实施总纲  
> 事实优先级：当前代码与 Flyway 迁移 > `docs/V__1/架构v-1.md` > V1 其他说明文档 > 历史规划

## 1. 文档目标

V2 在现有单人 Web 编辑器上引入两项核心能力：

1. 正式身份系统：用户、会话、团队、邀请、项目级权限和操作审计；
2. 多人在线编辑：同项目多用户实时编辑、远端光标、断线恢复、协作状态持久化、低频版本检查点和在线版本恢复。

本方案同时定义数据边界、权限边界、版本语义、失败恢复方式、迁移路径和验收标准。后续详细开发步骤必须服从本方案；如实施中需要改变这里的架构决策，应先更新本方案并完成重新审查。

### 当前实施进度

进度记录已重置。步骤 01–11 均为未开始；实施状态和验收证据应在后续完成时补录。本文其余章节描述目标架构、实施要求和验收标准，不代表当前已实现状态。

## 2. V1 现状与升级依据

### 2.1 已实现基线

当前项目已经具备：

- React、TypeScript、Vite 前端；
- Sandpack 虚拟文件、浏览器内编译、预览和控制台；
- 项目和文件管理；
- 1.5 秒防抖完整快照保存；
- IndexedDB 草稿恢复；
- 客户端 `expectedVersion` 加数据库项目行 `PESSIMISTIC_WRITE` 的快照并发保护；
- MySQL 项目/版本元数据；
- MinIO 不可变 JSON/GZIP 项目快照；
- 版本历史和“恢复为新版本”；
- 快照校验、哈希去重、失败补偿和孤立快照清理。

关键实现位置：

- `frontend/src/App.tsx`
- `frontend/src/editor/EditorWorkspace.tsx`
- `frontend/src/hooks/useProjectSave.ts`
- `frontend/src/persistence/drafts.ts`
- `backend/src/main/java/com/webeditor/project/application/ProjectService.java`
- `backend/src/main/java/com/webeditor/project/application/SnapshotService.java`
- `backend/src/main/java/com/webeditor/project/application/SnapshotValidator.java`
- `backend/src/main/java/com/webeditor/storage/OrphanSnapshotCleaner.java`
- `backend/src/main/resources/db/migration/`

### 2.2 必须保留的 V1 约束

- 用户代码只在浏览器 Sandpack 沙箱中执行；Spring Boot 和协作网关均不得执行项目代码。
- MySQL 保存结构化元数据，不保存源码正文。
- MinIO Bucket 保持私有，浏览器不得获得 MinIO 凭据。
- 用户可见历史版本继续使用规范化 JSON、SHA-256、GZIP 和不可变完整快照。
- 版本号单调递增；恢复历史内容必须生成新版本，不能回退版本号。
- 单项目最多 100 个文件、单文件最大 1 MB、未压缩快照最大 10 MB。
- 文件路径、入口文件和扩展名继续接受服务端校验。
- 项目继续采用软删除，彻底清除另行设计保留策略。
- API 继续使用统一成功/错误响应，并禁止泄露数据库、MinIO、Session、票据和堆栈信息。
- 本地开发、集成测试和验收使用仓库根目录 `.env`，连接本机 MySQL 和 MinIO；不使用 Docker 或 Docker Compose。

### 2.3 协作开发前必须修复的 P0 问题

1. `ProjectService.update/delete` 没有行锁，`Project` 也没有 JPA `@Version`。它们与检查点保存并发时可能覆盖版本指针或状态。V2 必须增加独立 `lock_version` 并统一项目写操作的锁顺序。
2. 当前孤儿清理扫描 `projects/`，只根据 `project_revision.object_key` 判断引用。Yjs 对象必须使用独立的 `collab/` 顶层前缀和独立清理规则，否则活动协作状态可能在保护期后被误删。
3. 当前入口文件同时存在于 `project.entry_file` 和快照 `entry`。V2 实时阶段以 Y.Doc 的稳定 `entryFileId` 为事实源，`project.entry_file` 只保存最近检查点的路径投影。
4. 当前恢复接口只更新版本快照，无法重置在线房间。V2 必须用 epoch 和恢复协调器替代单纯的数据库恢复。
5. 当前 Sandpack 文件既是编辑源又是运行源，运行时补丁存在回写到快照的风险。V2 必须把 Y.Doc 原始文件与 Sandpack 派生运行文件彻底分离。

## 3. V2 范围

### 3.1 本期包含

- 本地用户名/邮箱和密码身份；
- Spring Security、JDBC Session、CSRF 和安全 JSON 错误响应；
- 邀请制注册，可配置开发环境开放注册；
- 团队、团队成员、邀请、项目成员和有效权限；
- 项目及版本操作审计；
- 短期协作票据；
- 独立 Node.js/Hocuspocus 协作网关；
- Yjs CRDT、Monaco、`y-monaco`、`y-indexeddb`；
- 多文件实时协作、Presence、远端光标和 Viewer 只读；
- Y.Doc 二进制持久化及 generation CAS；
- 手动检查点、周期检查点、末位成员离房检查点；
- epoch 化历史恢复、删除关房和权限撤销；
- 本机 MySQL/MinIO 集成验证和双浏览器端到端验收。

### 3.2 本期不包含

- 企业 SSO、SAML、MFA、短信登录和复杂账号找回；
- 跨区域、多活或无状态多实例协作集群；
- 首期 Redis 广播；
- Git 集成、代码评审、评论、聊天、音视频；
- npm 依赖可视化管理；
- 服务端构建或执行用户代码；
- 二进制文件及超出 V1 白名单的源码类型；
- 项目硬删除和法规级数据保留系统。

## 4. 总体架构

```mermaid
flowchart LR
    U[浏览器用户] -->|同源 HTTPS /api| API[Spring Boot API]
    U -->|WSS /collab + 短期票据| GW[Hocuspocus 协作网关]
    U -->|Yjs 本地缓存| IDB[(IndexedDB)]
    U -->|派生运行文件| SP[Sandpack Runtime]

    API -->|身份/团队/权限/版本/Session| DB[(MySQL 8)]
    API -->|版本快照与协作状态对象| OBJ[(MinIO)]
    GW -->|内部认证 API：加载、CAS 持久化、检查点| API
    API -->|事务 Outbox 控制事件| DB
    API -.->|关闭房间/切换 epoch/撤权| GW
```

### 4.1 运行单元

| 单元 | 技术 | 主要职责 |
| --- | --- | --- |
| 浏览器应用 | React、Router、Monaco、Yjs、Sandpack | 身份交互、团队/项目 UI、协同编辑、离线缓存、浏览器运行 |
| 业务 API | Spring Boot 3.5、Spring Security、JPA | 身份、Session、CSRF、授权、项目、版本、审计、协作票据和对象存储 |
| 协作网关 | Node.js、TypeScript、Hocuspocus、Yjs | WebSocket 房间、CRDT 同步、Awareness、只读连接、Y.Doc 编解码 |
| MySQL | MySQL 8、Flyway | 用户、团队、权限、Session、项目、版本、协作指针和 Outbox |
| MinIO | 私有 Bucket | 不可变版本快照和不透明 Y.Doc 二进制状态 |

### 4.2 信任边界

- 浏览器是不可信客户端；前端传入的 `userId`、角色、团队和权限不得作为授权依据。
- Spring Boot 是业务授权和持久化权威。
- 协作网关是受信内部服务，但只能通过独立内部凭据访问最小范围接口。
- 用户代码 iframe 不得获得 Session、CSRF、协作票据、内部 Token 或 MinIO 凭据。
- Awareness 是临时展示数据，不是审计或授权身份来源。

## 5. 身份、团队和权限方案

### 5.1 认证方式

- 密码使用 Spring Security `DelegatingPasswordEncoder`，初始编码采用 bcrypt；数据库只保存哈希。
- REST 使用 Spring Session JDBC 和 HttpOnly Session Cookie。
- 状态变更请求使用 CSRF Token，SPA 通过 `X-XSRF-TOKEN` 发送。
- 生产 Cookie 使用 `Secure`、`HttpOnly` 和合适的 `SameSite`；前端、`/api`、`/collab` 推荐同源。
- 默认注册模式为 `INVITE_ONLY`；开发环境可显式配置为 `OPEN`。
- 首个管理员仅在数据库无用户时通过一次性环境变量初始化；初始化值不得写日志，成功后应删除相关变量。
- 登录按“规范化登录名 + IP”限流，连续失败实施递增延迟。
- `app_user.platform_role` 只有 `PLATFORM_ADMIN` 和 `USER`。只有平台管理员可以禁用/启用用户、查看待认领历史项目和执行平台迁移；平台角色不替代团队/项目权限。
- 每个受保护请求都必须确认用户仍为 `ACTIVE`。禁用用户时按 principal 索引删除其全部 Spring Session，并通过 Outbox 关闭其协作连接；匿名登录统一返回认证失败，不暴露用户是否存在或已禁用。
- 修改密码后轮换当前 Session ID，并使该用户的其他 Session 失效。Session 固定攻击防护、空闲超时、最大有效期和并发会话策略由配置明确控制。

### 5.2 组织模型

```mermaid
erDiagram
    APP_USER ||--o{ TEAM_MEMBER : joins
    TEAM ||--o{ TEAM_MEMBER : contains
    TEAM ||--o{ TEAM_INVITATION : issues
    TEAM ||--o{ PROJECT : owns
    APP_USER ||--o{ PROJECT_MEMBER : assigned
    PROJECT ||--o{ PROJECT_MEMBER : grants
    PROJECT ||--o{ PROJECT_REVISION : versions
    PROJECT ||--|| COLLAB_DOCUMENT : collaborates
```

团队角色：

- `OWNER`：团队设置、成员、邀请、所有项目和团队删除；
- `ADMIN`：成员管理、邀请、创建和管理项目；
- `MEMBER`：访问团队可见项目。

项目角色：

- `MANAGER`：项目设置、成员、删除、检查点和恢复；
- `EDITOR`：实时编辑和创建检查点；
- `VIEWER`：只读查看、预览和 Presence。

项目可见性：

- `TEAM`：团队成员至少获得 Viewer 能力；
- `RESTRICTED`：仅显式项目成员及团队 OWNER/ADMIN 可访问。

任何项目权限成立都必须同时满足：用户为 `ACTIVE`、团队为有效状态、用户存在有效 `team_member`。本期不实现显式 deny/override；`project_member` 只能在团队成员关系之上授予额外项目能力，有效角色取用户可获得角色中的最高权限，不能让已退出团队的用户继续访问。移除团队成员时，在同一事务删除/失效其全部 `project_member`；权限服务仍把团队成员关系作为硬前提，形成双重保护。

`app_user.authz_version` 是用户授权撤销水位。禁用/启用用户、团队成员增删或角色变化、项目成员增删或角色变化时，必须在同一事务递增所有受影响用户的版本。

角色变更规则：

- 团队必须始终至少有一名有效 `OWNER`；最后一名 OWNER 不得退出、被移除或被降级，必须先转移所有权。
- `OWNER` 可授予 OWNER/ADMIN/MEMBER；`ADMIN` 最多授予 ADMIN/MEMBER，不能创建或降级 OWNER。
- 团队 OWNER/ADMIN 可授予项目 MANAGER；项目 MANAGER 最多授予 EDITOR/VIEWER，不能授予超越自己的角色。
- 操作者不能通过修改自身角色提升权限；所有角色变更记录审计日志。

### 5.3 授权动作

后端以动作而不是 UI 按钮为授权单位：

```text
TEAM_CREATE
TEAM_READ
TEAM_SETTINGS_MANAGE
TEAM_ARCHIVE
TEAM_MEMBER_MANAGE
TEAM_INVITATION_MANAGE
TEAM_AUDIT_READ
PROJECT_CREATE
PROJECT_READ
PROJECT_EDIT
PROJECT_MANAGE
PROJECT_DELETE
CHECKPOINT_CREATE
REVISION_READ
REVISION_RESTORE
PROJECT_MEMBER_MANAGE
USER_MANAGE
PLATFORM_ACCESS
```

统一由 `ProjectAccessService`/团队授权服务计算有效权限；`USER_MANAGE` 只授予平台管理员。不可见资源返回 404 防止 ID 枚举；资源可见但动作不足返回 403。列表查询必须在 SQL 层按当前用户范围过滤，禁止“先查全部再在 Java 过滤”。

## 6. 数据架构

### 6.1 新增及变更表

| 表 | 关键字段或变化 |
| --- | --- |
| `app_user` | 登录名、邮箱、密码哈希、显示名、颜色、状态、`platform_role`、`authz_version`、密码修改时间 |
| Spring Session 表 | 由 Flyway 显式创建，不依赖自动建表 |
| `team` | 名称、创建人、状态、时间戳 |
| `team_member` | 团队、用户、角色、状态、加入时间，联合唯一 |
| `team_invitation` | Token 哈希、角色、过期/接受/撤销时间、创建人 |
| `project_member` | 项目、用户、角色、状态、授权人，联合唯一 |
| `project` | 新增 `team_id`、`created_by`、`visibility`、`lock_version` |
| `project_revision` | 新增 `created_by`、`source`、`collab_epoch`、`collab_generation`；`LEGACY` 记录的协作字段可空 |
| `collab_document` | `collaboration_mode`、`epoch`、`generation`、对象键、哈希、大小、`bootstrap_revision_version`、`last_checkpoint_version`、`last_checkpoint_generation` |
| `audit_log` | 操作者、动作、目标、结果、结构化元数据和时间 |
| `collab_control_event` | 聚合类型、聚合 ID、聚合内序号、关闭房间、切换 epoch、用户/成员撤权等事务 Outbox 事件 |
| `collab_operation` | fence token、操作类型、预期版本/epoch、`PREPARED/COMMITTED/ABORTED` 状态、目标 epoch、租约时间 |

不得改写已经发布的 V1/V2 Flyway 文件；所有变化使用后续增量迁移。

### 6.2 三种版本维度

必须严格区分：

| 维度 | 含义 | 何时变化 |
| --- | --- | --- |
| `project.current_version` | 用户可见的不可变检查点版本 | 手动、周期、离房检查点或恢复 |
| `collab_document.epoch` | 一次协作文档生命周期 | 历史恢复、整房间重置或维护型压缩 |
| `collab_document.generation` | 当前 epoch 内持久化 Y.Doc 的 CAS 代次 | 网关成功持久化新状态 |

`generation` 在 `(projectId, epoch)` 内单调递增，每个新 epoch 从 0 开始。generation 0 表示尚未生成 Y.Doc 对象，网关需从 `bootstrap_revision_version` 初始化；首次成功持久化为 generation 1。普通字符编辑只产生 Yjs Update，不直接增加 `current_version`。

`last_checkpoint_generation` 表示当前 epoch 中已经纳入最近检查点的最大 generation，更新只能使用单调 `max` 语义。普通 `MANUAL/AUTO/LEAVE` 检查点若投影内容哈希与当前 revision 相同，可不新增 revision，但仍推进该字段；`RESTORE` 无论哈希是否相同都必须创建新的单调 revision。普通检查点增加 `(project_id, collab_epoch, collab_generation)` 唯一约束。

### 6.3 MinIO 对象命名空间

```text
projects/{projectId}/revisions/{version}-{hash}.json.gz
collab/projects/{projectId}/epochs/{epoch}/{generation}-{hash}.yjs
```

- `projects/` 仅存用户可见不可变版本，沿用现有 revision 引用判断。
- `collab/` 存 Y.Doc 二进制 generation，由 `collab_document` 引用并使用独立保留/清理任务。
- 协作状态使用 `application/octet-stream`，版本快照使用 `application/gzip`。
- 浏览器和协作网关均不直接持有 MinIO 凭据；网关通过 Spring 内部 API 存取。

### 6.4 存量归属和版本 0 项目

存量归属必须在步骤 03 完成，不能推迟到最终部署阶段：

1. 先以可空字段执行 additive migration，并关闭匿名项目接口；
2. 创建首个有效平台管理员和一个明确的迁移团队；
3. 将所有存量项目分配到该团队和创建者；无法自动归属的项目写入独立 `legacy_project_claim` 迁移表，仅平台管理员可处理，不能复用当前软删除 `status`；
4. 在步骤 03 的退出门禁前完成认领、引用检查和数据报告；
5. 再通过后续 Flyway 迁移将 `project.team_id`、必要创建者字段收紧为非空。

步骤 03 只负责身份归属、关闭匿名访问和版本基线（`LEGACY/MANUAL/AUTO/LEAVE/RESTORE` 为固定 revision source 枚举）：V2 新建项目由服务端 `ProjectTemplateService` 生成规范默认文件并同步创建初始 revision 1；不能再由每个浏览器分别写入 `DEFAULT_FILES`。现有 `current_version=0` 项目也在认领时用同一服务端模板创建 revision 1。步骤 03 尚不创建 `collab_document`。

步骤 05 创建 `collab_document` 表，并为所有活动项目按其当前 revision 回填唯一描述行：`epoch=1, generation=0, bootstrap_revision_version=current_version, last_checkpoint_version=current_version, last_checkpoint_generation=0`。步骤 05 同时升级新项目创建流程，使此后新项目在 revision 1 之外一并创建协作描述。步骤 05 的退出门禁才要求每个活动项目恰有一条 `collab_document`；在此之前协作 feature flag 必须关闭。网关首次打开时以 CAS 方式只初始化一次。

## 7. 协作文档和编辑器设计

### 7.1 唯一事实源

```text
Y.Doc
├── y-monaco ──> Monaco 编辑器
├── 文件结构订阅 ──> React 文件树
└── 防抖单向投影 ──> SandpackProvider ──> Preview / Console
```

Y.Doc 是实时项目内容唯一事实源。Sandpack 只接收派生文件，不允许把运行时补丁反写 Y.Doc。现有 `SandpackCodeEditor` 被 Monaco 替代，`SandpackPreview` 和 `SandpackConsole` 保留。

### 7.2 Y.Doc Schema

```text
meta: Y.Map
  schemaVersion
  epoch
  entryFileId

files: Y.Map<fileId, Y.Map>
  id
  path
  language
  deletedAt
  content: Y.Text

fileOrder: Y.Array<fileId>
```

- `fileId` 使用稳定 UUID，路径不再充当文件身份。
- 选中文件、Awareness 活动文件和入口均使用 `fileId`。
- 新建、重命名、逻辑删除和入口切换在单个 Yjs transaction 内完成。
- 删除先写 tombstone，避免“远端删除、当前用户继续输入”直接丢失内容；后续 epoch 压缩时清理 tombstone。
- 同路径并发冲突采用确定性归一化：稳定顺序的获胜文件保留路径，其余文件生成带短 ID 的冲突路径，并在 UI 提示处理。
- 入口文件不得被删除；检查点投影前再次验证全部结构不变量和 V1 大小限制。

### 7.3 本地缓存

`y-indexeddb` 文档名至少包含：

```text
web-editor:{userId}:{projectId}:{epoch}
```

- 未完成当前用户和项目授权前不得显示本地缓存内容。
- 注销、403、项目删除、成员移除和 epoch 切换时必须销毁 provider/binding，并按策略清理或封存旧缓存。
- 旧 epoch 的 Update 永远不得合入新 epoch。
- V1 `web-editor/drafts` 不自动导入任意用户；迁移期只提供明确的“认领/导出旧草稿”流程，之后废弃。

### 7.4 状态展示

前端必须区分：

- 协作连接：`connecting/syncing/online/offline/reconnecting/forbidden/failed`；
- 网关持久化：最近一次 generation 成功时间；
- 历史检查点：`idle/creating/success/failed`。

不能把“WebSocket 已同步”“Y.Doc 已持久化”和“历史版本已创建”合并显示为同一个“已保存”。

## 8. 协作网关与票据

### 8.1 连接流程

1. 浏览器通过 Session 请求项目详情，获得 `effectiveRole/capabilities` 和当前 epoch。
2. 浏览器调用 `POST /api/projects/{id}/collab-ticket`。
3. Spring 再次授权并签发约 60 秒有效的单用途 opaque 随机票据；V11 共享表只保存 token 摘要及 user/project/team/epoch/role/capabilities/authzVersion/过期与消费时间。
4. 票据只保存在内存，通过 Hocuspocus 认证消息传送，不得进入 URL、日志、LocalStorage 或 IndexedDB。
5. 网关在 Origin 校验后调用 Spring 内省接口；Spring 原子消费摘要并按数据库当前用户状态、团队成员、项目权限、epoch 和 `authzVersion` 重新授权。只有复核通过才加入 `project:{id}:epoch:{epoch}` 房间。Spring 不可达时 fail closed。
6. 网关校验严格的 WebSocket `Origin` allowlist。Viewer 建立只读连接，网关拒绝其文档 Update，不能只依赖 Monaco `readOnly`。
7. 重连时重新申请票据；禁用、退出团队或撤权用户不能取得新票据。撤权前已经签发但尚未使用的票据也会因握手复核的 `authzVersion` 过旧而被拒绝；网关重启不会清除这一保障。

Opaque 票据无签名密钥或 kid。两个方向内部 API 使用互相独立的 HMAC 密钥集合与 keyId/audience，支持双钥轮换；所有秘密来自 `.env`/生产密钥管理且禁止记录。

### 8.2 双向内部接口

网关调用 Spring（`COLLAB_GATEWAY_TO_API_TOKEN`）：

```http
GET  /internal/collaboration/projects/{id}/describe
GET  /internal/collaboration/projects/{id}/state?epoch={epoch}&generation={generation}
PUT  /internal/collaboration/projects/{id}/state?expectedEpoch={epoch}&expectedGeneration={generation}
GET  /internal/collaboration/projects/{id}/bootstrap?epoch={expectedEpoch}
POST /internal/collaboration/projects/{id}/checkpoints
POST /internal/collaboration/events/{eventId}/ack
POST /internal/collaboration/tickets/introspect
GET  /internal/collaboration/operations/{fenceToken}
```

Spring 调用网关（`COLLAB_API_TO_GATEWAY_TOKEN`）：

```http
POST   /internal/admin/projects/{id}/captures
PUT    /internal/admin/projects/{id}/fence
POST   /internal/admin/projects/{id}/fence/{fenceToken}/commit
DELETE /internal/admin/projects/{id}/fence/{fenceToken}
POST   /internal/admin/control-events
```

- 二进制持久化请求携带 epoch 和期望 generation，后端用 CAS 拒绝旧房间迟到写入。
- 首次房间从 `bootstrap_revision_version` 创建 Y.Doc；generation 0 到 1 的初始化也使用 CAS，保证只有一个权威初始化结果。
- 手动检查点唯一发起者是 Spring：浏览器请求 Spring，Spring 请求网关 flush/capture，再由 Spring提交。
- 周期和末位成员离房检查点唯一调度者是网关：先持久化 generation，再调用 Spring 的幂等检查点接口。双方不得同时调度同一类型检查点。
- 每次 capture 返回 `requestId/projectId/epoch/capturedGeneration/snapshot/hash`，并保证该 generation 已持久化。
- 所有内部调用定义连接/响应超时、幂等键、关联 ID 和有限重试；不能对非幂等操作盲目重试。
- Spring 对网关返回的快照重新执行规范化和 SHA-256，不能信任网关传入的 hash。
- 两个方向分别用 HMAC 签入 keyId、audience、method、canonical path/query、content-type、body hash、timestamp、nonce；nonce 在共享数据库唯一表防重放，常量时间比较。内部请求限制体积、速率和来源，不接受任意对象键。

### 8.3 破坏性操作写栅栏

恢复和删除在提交数据库事务前必须使用持久化操作记录并同步获取网关 fence lease：

1. Spring 先创建带唯一操作 ID 的 `collab_operation(PREPARED)`，再请求网关对指定项目/epoch flush 并进入 `fencing/read-only`；网关返回 `fenceToken`、epoch 和 capturedGeneration。
2. Spring 在数据库事务内按固定顺序锁定 `project` 和 `collab_document`，重新校验请求的 `expectedVersion`、epoch、generation 及项目状态，完成恢复/删除并把操作置为 `COMMITTED`，同时写入 Outbox。
3. 数据库提交成功后，Spring 同步调用网关 `commit/finalize fence`；Outbox 用于响应丢失或进程崩溃后的最终补偿。
4. 数据库事务失败时，Spring 把操作置为 `ABORTED` 并主动解除 fence。
5. fence 租约到期时网关不得自行恢复写入，必须查询 Spring 中的操作状态：`COMMITTED` 则关闭旧房间或切换 epoch；`ABORTED` 且项目仍为原 epoch 才解栅栏；`PREPARED`、Spring 不可达或状态未知时 fail closed/续租。
6. 后端恢复任务检查长期 `PREPARED` 操作：只有确认项目仍为原状态且没有提交痕迹时才标记 `ABORTED`；否则补发 finalize。
7. 网关不可达或无法取得 fence 时，破坏性操作返回 503，不得无保护继续。

Outbox 保证提交后的最终送达，但不能替代操作开始前的同步写屏障和提交确认协议。

## 9. 保存、检查点和版本恢复

### 9.1 保存语义和旁路封堵

V1 的 1.5 秒 REST 完整快照保存退出多人编辑主链路。V2 使用：

- Yjs Update：实时同步；
- Y.Doc generation：短防抖持久化工作状态；
- 手动检查点：用户主动创建可见版本；
- 自动检查点：有变化时约每 5 分钟创建；
- 离房检查点：最后成员离开并经过短暂 grace period 后创建。

协作项目的入口只能通过 Y.Doc 结构命令修改，`PUT /api/projects/{id}` 不再接受 `entry`。浏览器版 `PUT /api/projects/{id}/snapshot` 在步骤 07 启用协作后返回 `409 COLLABORATIVE_PROJECT_REQUIRES_CHECKPOINT`，并在步骤 09 完成后移除；检查点只能来自网关权威 capture。复制项目使用显式的服务端复制接口，不得用客户端快照覆盖已有项目。

步骤 06–08 尚未完成恢复/删除协调时，协作功能由 feature flag 控制，并禁用协作项目的旧恢复、删除及浏览器快照入口，避免形成旁路写入。

### 9.2 检查点流程

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as Spring API
    participant G as Collaboration Gateway
    participant M as MinIO
    participant D as MySQL

    B->>A: 创建手动检查点(requestId)
    A->>A: Session + CSRF + CHECKPOINT_CREATE
    A->>G: flush/capture(expectedEpoch, requestId)
    G->>A: epoch + capturedGeneration + snapshot/hash
    A->>D: 按顺序锁定 project、collab_document
    A->>A: 复核 active、epoch、generation，并校验快照
    A->>M: 上传不可变 JSON/GZIP
    A->>D: 新增/复用 revision，记录 generation
    A-->>B: version/hash/createdBy/source
```

网关必须先确保持久化 capturedGeneration，再返回投影。提交阶段要求 epoch 与当前值相同、capturedGeneration 不大于当前 generation，并与 `last_checkpoint_generation` 比较：小于时作为陈旧请求拒绝/无操作；等于时只返回既有幂等结果；大于时才允许创建或复用检查点。字段更新只能取 `max`，不得倒退。检查点记录准确的 `collab_epoch/collab_generation`。如果恢复或删除先获得锁并改变 epoch/status，迟到检查点返回 `COLLAB_EPOCH_CONFLICT` 或资源不可用，绝不能创建 revision。若检查点先提交，后续恢复在更高版本上继续，版本仍单调。

检查点接口使用全局唯一 request ID 和数据库幂等记录。网关投影是多人房间权威状态，不能由任意浏览器提交完整文件作为最终状态。

### 9.3 恢复流程

历史恢复由 `RestoreCoordinator` 完成：

1. 校验 `REVISION_RESTORE`、当前版本和当前 epoch；
2. 创建持久化 fence 操作并同步取得旧房间 fence lease，保证不再接受新的编辑；
3. 按固定顺序锁定项目和 `collab_document`，在锁内重新校验 `expectedVersion`，并复核 fence 捕获的 epoch/generation；
4. 将历史快照复制为新的 revision；即使内容哈希相同也不得去重恢复事件；
5. 设置 `epoch + 1`、`generation=0`、空状态对象、`bootstrap_revision_version=新版本`、`last_checkpoint_version=新版本`、`last_checkpoint_generation=0`；
6. 在同一数据库事务写入 `RESET_PROJECT_EPOCH` Outbox 事件；
7. 网关幂等关闭旧房间；新房间由恢复快照初始化为 generation 1；
8. 客户端收到重置事件后销毁旧 provider/model/cache，获取新票据并连接新 epoch。

删除使用相同 fence 和锁顺序：先冻结并 flush，事务中软删除和写入 `PROJECT_DELETED`，再由 Outbox 关闭房间。不得让 Java 后端实现 Yjs 编解码；JSON 快照与 Y.Doc 的转换由网关负责。

### 9.4 邀请、复制和导入边界

- 邀请 Token 放在 URL fragment，前端读取后通过 POST body 交换并立即清理地址；Token 不进入代理访问日志。
- “另存副本”必须让用户明确选择“当前协作状态副本”或“最近版本副本”；前者由 Spring 请求网关 capture，后者读取指定 revision，然后创建全新项目、初始 revision 和协作描述。
- 本期不提供把客户端任意文件集合导入既有协作项目的接口；未来导入也必须表现为受管控的新 epoch 操作。

## 10. 并发、一致性和控制事件

### 10.1 项目写入并发

- `project.lock_version` 使用 JPA `@Version` 保护普通元数据更新。
- 检查点、恢复、软删除和 epoch 更新统一按 `project → collab_document` 顺序加锁。
- 内容版本 `current_version` 与 JPA `lock_version` 分离。
- 项目元数据更新使用 `If-Match`/锁版本，冲突返回稳定的 `409 PROJECT_STATE_CONFLICT`。

### 10.2 协作状态 CAS

- 网关持久化携带 `(projectId, epoch, expectedGeneration)`。
- 后端只接受当前 epoch 和 generation 的下一次原子更新。
- generation 在每个 epoch 内从 0 开始递增；旧 epoch 或过期 generation 冲突后，网关停止当前写入并重新加载描述。
- MinIO 先写不可变 generation 对象，再用短数据库事务切换指针；失败对象由独立清理任务回收。
- 有效 Update 应先应用到临时 Y.Doc 副本并执行角色、消息体、文件数量/大小及结构预算校验，验证通过后才进入权威房间和广播。若 Hocuspocus 扩展点无法保证“广播前验证”，必须增加协议拦截层，不能以“事后检查”替代。
- 违规连接被断开；房间进入异常状态时从最后有效 generation 重建，禁止覆盖有效指针。

### 10.3 事务 Outbox

以下事件必须可靠送达网关：

- `PROJECT_DELETED`
- `RESET_PROJECT_EPOCH`
- `USER_DISABLED`
- `TEAM_MEMBER_REMOVED`
- `PROJECT_MEMBER_REMOVED`
- `ROLE_DOWNGRADED`

事件带唯一 ID、`aggregate_type`、`aggregate_id` 和聚合内顺序号，由网关幂等处理和确认。Spring dispatcher 使用有上限的指数退避；超过最大重试进入死信状态并告警，保留人工重放能力。事件定义保留期，网关重启后可按最后确认游标重放。同一项目控制事件不得乱序。首期不要求消息队列。

### 10.4 Y.Doc 维护型 rollover

tombstone 数量、Y.Doc 二进制大小或持续时间达到配置阈值时触发维护型 epoch rollover。该操作复用 fence、检查点、epoch 初始化和 Outbox 流程，保留内容但压缩 CRDT 历史；必须在 UI 和审计中标记为维护操作。

## 11. API 与错误契约

### 11.1 新增外部 API 分组

```text
/api/auth/**
/api/admin/users/**
/api/teams/**
/api/invitations/**
/api/projects/**
/api/projects/{id}/members/**
/api/projects/{id}/collab-ticket
/api/projects/{id}/checkpoints
/api/projects/{id}/revisions/**
```

认证及安全 Filter 发生的错误也必须输出现有 JSON 错误结构。至少新增：

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| 401 | `AUTHENTICATION_REQUIRED` | 未登录、Session 失效或匿名登录失败 |
| 403 | `ACCESS_DENIED` | 已认证但动作权限不足 |
| 403 | `CSRF_INVALID` | CSRF 缺失或无效 |
| 409 | `PROJECT_STATE_CONFLICT` | 元数据锁版本冲突 |
| 409 | `COLLAB_EPOCH_CONFLICT` | 协作 epoch 已切换 |
| 409 | `COLLAB_GENERATION_CONFLICT` | 协作状态 CAS 冲突 |
| 410 | `INVITATION_INVALID_OR_EXPIRED` | 邀请失效、过期或已使用 |
| 423 | `USER_DISABLED` | 仅用于已经认证但随后被禁用的会话 |

邀请 Token、用户是否存在和登录失败原因应避免过度区分，防止账号枚举。

## 12. 前端架构演进

建议目录：

```text
frontend/src/
├── app/                 # Router、AppShell、受保护路由
├── api/                 # client、auth、teams、projects、collaboration
├── auth/                # SessionProvider、登录/注册
├── teams/               # 团队切换、成员和邀请
├── collaboration/       # Y.Doc schema、provider、presence、persistence
├── editor/              # Monaco、文件树、Sandpack bridge、历史
└── types/
```

关键生命周期：

```text
CSRF bootstrap
→ 当前用户
→ 团队和路由项目
→ 项目详情与 capabilities
→ 短期票据
→ Y.Doc + y-indexeddb
→ HocuspocusProvider
→ MonacoBinding
→ Sandpack 单向投影
```

React StrictMode 下初始化和清理必须幂等。项目切换、注销、撤权和 epoch 重置时必须销毁 Monaco binding/model、Provider、Y.Doc observers、IndexedDB provider 和 Awareness listeners，防止幽灵连接与跨项目污染。

## 13. 安全要求

- 所有项目和版本读取先确认用户 ACTIVE、有效团队成员关系和动作权限，后读取 MinIO。
- Session、CSRF、密码、邀请 Token、协作票据、内部 Token、MinIO 凭据禁止写日志。
- 邀请 Token 只保存哈希且只能接受一次；密码重置 Token 采用同一原则。
- 协作票据短期有效、绑定用户/项目/角色/epoch，不保存浏览器持久层。
- WebSocket 校验 Origin，并限制连接数、消息大小、Update 速率、Y.Doc 大小、tombstone 数量和单项目内存。
- Viewer 的写入在网关拒绝，前端只读仅为体验层。
- 内部接口使用独立认证链、固定来源和常量时间凭据比较。
- Yjs Update 在广播前先应用到临时副本并验证权限、结构和容量；检查点投影后再次校验。无效房间进入隔离状态，从最后有效 generation 重建且不覆盖有效指针。
- GZIP 解压使用上限，禁止无界 `readAllBytes()` 处理不可信输入。
- 用户代码预览使用独立来源或严格 sandbox iframe，不继承应用身份凭据；配置 CSP 和 Referrer-Policy，禁止把父页面 URL、Cookie 或票据传入预览。
- 权限撤销后立即拒绝新票据，并通过 Outbox 关闭或降级现有连接。

## 14. 可观测性与运行保障

至少增加：

- API：登录成功/失败、401/403、检查点耗时、恢复耗时、Outbox 积压；
- 网关：活动连接、项目房间、Update 速率、持久化成功/失败、内存和重连；
- 存储：MySQL/MinIO 可用性、对象上传失败、孤儿对象数量；
- 审计：成员变更、角色变更、项目删除、版本恢复、用户禁用；
- 健康检查：liveness 与 readiness 分离，readiness 覆盖 MySQL、MinIO 及网关内部连通性。

日志只记录内部 ID、结果和关联 ID，不记录秘密或源码正文。自动/离房检查点的 `created_by` 可空，并通过 `source=AUTO/LEAVE` 与审计中的系统 actor 表达，禁止伪造普通用户。

## 15. 本地开发与部署

本地进程：

```text
Vite frontend      :5173
Spring Boot API    :8080
Hocuspocus gateway :1234
MySQL              按根 .env
MinIO              按根 .env
```

Vite 代理：

- `/api` → Spring Boot；
- `/collab` → Hocuspocus，启用 WebSocket。

生产环境由同一个 HTTPS 域名暴露静态页面、`/api` 和 `/collab`；反向代理需支持 WebSocket Upgrade、合理空闲超时和请求大小限制。首期协作网关单实例，不使用 Redis；扩容前必须另行完成多实例房间路由和广播设计。

新增配置按类别命名，至少包括 Session/Cookie、注册模式、首个管理员、票据秘密、内部 Token、网关地址、协作状态大小、自动检查点和 Outbox 重试。`.env.example` 只包含占位值，不得提交真实秘密。

## 16. 测试策略

### 16.1 自动化层次

- 后端单元/Controller：身份、CSRF、错误契约、权限矩阵、邀请、审计、CAS、恢复协调；
- 前端单元/组件：Session、401/403、权限 UI、Y.Doc 命令、Sandpack 单向桥接、生命周期；
- 网关单元/集成：票据、Viewer 拒写、房间初始化、Update、持久化、重连和事件处理；
- 本机集成：真实 MySQL 的锁/唯一约束/Session/Flyway，真实 MinIO 的对象与补偿；
- 浏览器 E2E：两个独立 browser context 完成登录、邀请、并发编辑、断网、撤权和恢复。

H2 只用于快速测试，不能替代 MySQL 行锁、Session JDBC 和迁移验证。

### 16.2 发布门禁

```powershell
cd frontend
npm run lint
npm run test
npm run build

cd ../backend
mvn test

cd ../collab-server
npm run lint
npm run test
npm run build
```

集成和验收命令必须加载根 `.env`，连接本机 MySQL/MinIO，并且不得使用 Docker。

## 17. 实施步骤与依赖

详细步骤每一步使用独立文档，严格按顺序执行：

| 步骤 | 主题 | 前置产物 | 主要交付 |
| --- | --- | --- | --- |
| 01 | 基线冻结与并发/存储护栏 | V1 代码 | 锁版本、命名空间、测试基线和兼容约定 |
| 02 | 身份认证、Session 与 CSRF | 01 | 用户、登录、Session、JSON 安全错误 |
| 03 | 团队、邀请、项目 ACL、审计与存量归属 | 02 | 团队域、权限服务、历史项目认领、范围化项目 API |
| 04 | 前端身份、团队和权限壳层 | 03 | Router、Session UI、团队/邀请/权限 UI |
| 05 | 协作对象存储与状态底座 | 01、03、04 | 通用对象存储、collab_document 建表/全量回填、generation CAS |
| 06 | 协作网关与短期票据 | 02、03、05 | Hocuspocus 服务、票据、内部 API、只读连接 |
| 07 | Yjs 文件模型、Monaco 与 Sandpack 桥接 | 04、06 | Y.Doc schema、Monaco 协同编辑、运行态解耦 |
| 08 | 结构化文件操作、Presence 与离线恢复 | 07 | 原子文件命令、冲突规则、Awareness、y-indexeddb |
| 09 | 检查点、版本恢复、删除与撤权协调 | 05、06、08 | 权威检查点、epoch、Outbox、关房流程 |
| 10 | 安全、可观测性、性能和故障恢复 | 09 | 限流、指标、健康、清理、容量与故障演练 |
| 11 | 发布切换、部署与端到端验收 | 10 | 约束收紧验证、部署文档、备份恢复演练、全链路验收 |

任何步骤未通过其自动化测试和验收条件，不得开始依赖它的下一步骤。步骤 03 后端开发门禁必须完成全部历史项目归属、版本 0 转 revision 1、V6–V8 contract 与 target=8 验收后才能开始步骤 04；生产匿名关闭由步骤 03 的 V9 与步骤 04 登录 UI 联合原子发布完成，V9 在 UI 就绪前不得进入部署制品；步骤 05 必须为全部项目（含可恢复软删项目）回填唯一协作描述；步骤 06–08 通过 feature flag 开发，直到步骤 09 的 fence、epoch 和撤权链路完成后才允许正式启用协作项目。

## 18. 总体验收标准

### 身份与隔离

- 登录、退出、当前用户、修改密码、邀请注册和 CSRF 行为正确。
- 未认证返回 401；无权限返回约定的 403/404；安全错误保持统一 JSON。
- 用户无法通过列表、详情、版本、恢复、票据或猜测 ID 访问其他团队/项目。
- 禁用、退出团队、移除成员和角色降级同时影响 REST、新票据、撤权前签发但尚未使用的票据及已连接房间；残留 `project_member` 不能绕过团队成员硬前提。
- 最后一名 OWNER 保护和角色授予上限生效。

### 实时协作

- 两个浏览器在同一行或不同文件编辑后最终收敛。
- 新建、重命名、逻辑删除和入口操作在全部客户端一致。
- Viewer 可以查看但无法通过客户端或直接协议写入。
- 断网编辑、刷新和重连不丢内容；旧 epoch 不污染新 epoch。
- 网关重启后从最后有效 Y.Doc generation 恢复；握手仍通过 Spring 复核授权，不因网关内存清空接受已撤权旧票据。

### 版本与存储

- 输入字符不会逐次创建 revision；手动/自动/离房检查点按策略去重；generation 12 先提交而 generation 10 后到时，旧请求不得创建更高版本或倒退水位。
- 恢复历史创建新 revision 和新 epoch，全部客户端重连。
- `current_version` 全局单调；epoch 单调；generation 在各自 `(projectId, epoch)` 内从 0 开始单调，三者语义独立。
- 版本和协作对象使用不同前缀及清理器，活动对象不会被误删。
- MySQL 不保存源码正文，浏览器不获得 MinIO 或内部服务凭据。

### 回归与运行

- V1 项目管理、文件限制、Sandpack 预览、控制台和版本历史无功能回退。
- 全部前端、后端、协作服务检查通过。
- 真实本机 MySQL/MinIO 和双浏览器 E2E 通过。
- 全程使用根 `.env` 且不使用 Docker/Docker Compose。

## 19. 主要风险与控制

| 风险 | 控制措施 |
| --- | --- |
| Yjs 与 Sandpack 成为双写事实源 | Y.Doc 唯一可写，Sandpack 只接受派生投影 |
| 实时状态与版本历史混淆 | 明确 Update、generation、checkpoint 三层语义 |
| 路径并发冲突 | 稳定 fileId、原子命令、确定性冲突归一化 |
| 旧房间覆盖恢复结果 | 持久化 fence 状态机、提交确认、到期状态复核、epoch 校验、generation CAS、Outbox 最终关房 |
| 权限或用户状态只在前端执行 | 每次授权校验 ACTIVE + team_member，票据握手实时复核 authzVersion，后端统一权限服务，网关拒绝 Viewer Update |
| 跨用户浏览器缓存泄露 | `userId:projectId:epoch` 隔离及注销/撤权清理 |
| 协作对象被旧清理器误删 | 独立 `collab/` 前缀、引用表和清理任务 |
| 项目元数据并发覆盖版本指针 | 独立 `lock_version` 和统一锁顺序 |
| 网关故障丢失最近编辑 | y-indexeddb、短防抖 generation 持久化、重连合并 |
| 初期架构过重 | 单网关、JDBC Session、数据库 Outbox；首期不引入 Redis/MQ |

## 20. 完成定义

V2 只有在以下条件全部满足时才视为完成：

1. 所有详细步骤文档的验收条件完成；
2. 现有 V1 回归测试及 V2 新测试全部通过；
3. 步骤 03 已完成存量项目归属、版本 0 初始化和非空约束收紧；步骤 04 UI 就绪后已联合执行 V9/认证切换，且没有匿名项目接口；
4. 双用户真实浏览器协作、断线、撤权、旧票据重接入拒绝、恢复、破坏性操作 fence 和服务重启验收通过；
5. 安全审查确认没有明文密码、长期浏览器 JWT、跨用户缓存和越权读取；
6. 运维文档可以在不使用 Docker 的前提下从根 `.env` 启动和验证三个应用进程；
7. 本方案、API、部署说明和实际代码保持一致；
8. MySQL 与 MinIO 完成同一恢复点的备份/恢复演练，并验证 revision 指针、collab generation 指针、fence 操作状态和 Outbox 游标一致。


