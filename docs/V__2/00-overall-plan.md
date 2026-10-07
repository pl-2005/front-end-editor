# Web Editor V2：轻量身份与多人协作开发总方案

> 文档性质：V2 设计基线与实施顺序记录。步骤 01–11 已开发完成（2026-10-07）；当前交付见 [README](./README.md)，已实现结构见 [架构](./architecture.md)。现有 V1 数据与迁移保留兼容，后续变更只追加迁移。

## 1. 目标与范围

V2 提供自由注册、创建和加入团队，以及同一团队成员共同编辑项目文件。编辑器以 Y.Doc 为唯一内容事实源，支持多文件协作、Presence、远端光标、离线重连、HTML/CSS/JavaScript 补全与诊断，以及 Sandpack 预览。项目文件自动持久化，界面区分“已同步”和“已持久化”。

V2 **不提供版本控制相关功能**：不创建用户可见历史版本，不提供版本列表、手动或周期检查点、离房检查点、历史恢复、版本比较和回退。Y.Doc 的 `generation` 仅是持久化并发序号，`epoch` 仅用于隔离旧连接和维护型重建，二者都不是用户历史版本。

V1 已有的 `project_revision`、JSON/GZIP 快照和 MinIO `projects/` 对象保留为旧数据，不继续写入，也不暴露给 V2 用户；本期不清理或改写旧数据。V1 匿名项目没有可验证所有者，保持隔离。新团队项目直接从服务端模板初始化 Y.Doc，不创建 `revision 1`。

## 2. 运行边界

- React、Monaco、Yjs、y-monaco、y-indexeddb 负责编辑；Sandpack 只运行派生文件，不能回写 Y.Doc。
- Spring Boot 负责 JWT Bearer 认证、团队授权、项目元数据、协作票据、Y.Doc 对象指针和内部持久化 API。
- 首期单实例 Hocuspocus 网关负责房间、Update 校验与广播、Awareness 和自动持久化；不引入 Redis 广播。
- MySQL 保存用户、团队、项目元数据、协作描述、票据与控制事件，不保存源码正文。
- MinIO 私有 Bucket 保存 Y.Doc 二进制；浏览器和网关不直接持有 MinIO 凭据。Redis 只保存刷新凭据摘要和登录节流。

本地运行和功能验收使用仓库根 `.env` 连接本机 MySQL、MinIO、Redis；不使用 Docker 或 Docker Compose，不打印或提交凭据。不要求专用三服务集成验证、双浏览器端到端自动化或压测报告，按功能流程验收。

## 3. 身份与团队

开放自助注册，注册后显式登录。REST 使用短期 JWT Bearer，刷新凭据存 Redis；凭据只在浏览器内存中，不使用 Cookie、CSRF Token 或服务器 Session。`JwtAuthenticationFilter` 验证 JWT 并把 `Authentication` 放入请求的 `SecurityContext`；服务层按数据库当前团队成员关系授权。

团队只有 `OWNER` 和 `MEMBER`。创建者为首位 OWNER，邀请或申请批准固定加入为 MEMBER。OWNER 仅管理邀请、加入申请、移除成员、加入策略和所有权转移；团队保持一位有效 OWNER。任意有效成员对团队全部项目拥有相同的创建、读取、编辑、文件操作、复制、修改元数据和软删除权限。没有项目角色、项目成员授权表、Viewer 模式或平台管理员。

团队邀请采用站内受邀申请：OWNER 按用户名或邮箱查找已注册用户，确认目标账号后发送；找不到账号时提示注册且不创建邀请。受邀人在“我的邀请”接受或拒绝，OWNER 可撤销。不发送邀请邮件。

团队外用户、待审批申请人和已退出成员不能访问项目。成员移除、退出、改密或退出所有设备提交后，REST、新票据和旧票据握手立即按数据库新状态拒绝；已有连接由 Outbox 控制事件关闭，投递失败持续重试并告警。网关的连接写入授权租约最长 5 秒，过期前必须向 Spring 复核当前成员关系和 `authz_version`，复核失败即停止写入，因此事件延迟也不会让旧连接无限写入。项目列表在 SQL 层按当前成员关系过滤。旧匿名项目不可见，也不能通过猜测 ID 访问。

## 4. 项目与协作文档

新团队项目先保留不可见的 `INITIALIZING` 项目 ID，再由受信内部 TypeScript Y.Doc 编码模块从模板生成初始二进制并写入 MinIO，最后建立唯一 `collab_document` 并将项目置 ACTIVE；成功后才返回项目。失败的初始化记录可重试或补偿，不能对用户显示空项目。`collab_document` 记录 `epoch`、`generation`、对象键、SHA-256、大小和并发锁；初始状态为 `epoch=1, generation=1`。V1 表中 `current_version` 保持默认 0、`current_object_key` 保持 NULL，仅用于兼容旧 schema，不进入 V2 API。不依赖 V1 revision 或浏览器 `DEFAULT_FILES` 初始化。

Y.Doc 包含 `meta(schemaVersion, projectId, epoch, entryFileId)`、按稳定 `fileId` 管理的文件映射和文件顺序。文件内容用 `Y.Text`；创建、重命名、逻辑删除和入口切换在 Yjs transaction 内完成。网关广播前用临时 Y.Doc 验证 schema、路径、入口、扩展名、文件数与大小。单项目上限沿用 100 文件、单文件 1 MB；文档和 Update 另设硬上限。

Monaco 语言能力以文件类型注册表扩展。首期 `.html`、`.css` 提供补全及语法/语义诊断；`.js` 提供补全、JSDoc 提示和启用 checkJs 的静态类型诊断。语言 worker 按 userId/projectId/epoch 隔离，重命名和切换项目时清理旧 model/诊断。Sandpack Preview/Console 只消费 Y.Doc 的单向派生文件。

## 5. 文件持久化策略

每个项目只有一条**当前权威 Y.Doc 指针**。网关加载房间时按 `collab_document` 指针读取并校验 MinIO 对象。有效 Update 先应用到房间 Y.Doc、记录到有界待持久化队列，再广播；每房只有一个持久化任务，以 1 秒防抖、最长 5 秒延迟自动 flush。末位成员离房和正常停机必须 flush，但不创建历史版本。

持久化先上传不可变对象 `collab/projects/{projectId}/epochs/{epoch}/{generation}-{hash}.yjs`，再通过 MySQL 条件更新 `WHERE epoch=? AND generation=?` 切换指针。成功后 generation 递增。CAS 冲突时加载当前权威文档、按序重放 pending Update、完整校验后重试；旧 epoch 直接拒绝。未被引用的对象仅在保护窗口结束且确认不受当前指针、在途租约或有效备份引用后才可清理。

持久化失败时保留 pending Update，暂停房间写入并重试；仅广播在内存的内容不能显示为“已持久化”。客户端 y-indexeddb 按 userId/projectId/epoch 保存离线更新，重连前重新获取票据和成员授权；撤权后关闭房间并清理对应缓存。突然进程崩溃可能丢失仅在网关内存中广播的更新，客户端离线日志负责重发。

V1 浏览器快照保存、revision 写入和历史恢复入口在 V2 切换后关闭。项目元数据更新使用独立 `lock_version`/`If-Match`，不能以 generation 充当元数据版本。项目复制从当前权威 Y.Doc 创建新项目，不读取旧 revision。

## 6. 连接、删除与撤权

浏览器用 JWT Bearer 向 Spring 申请约 60 秒有效的单次 opaque 协作票据；票据只经 WebSocket 认证消息传递，不进入 URL 或持久化存储。网关先校验 Origin，再让 Spring 原子消费票据并复核用户、有效团队成员、项目状态、epoch 和 `authz_version`。Spring 不可达时拒绝连接。所有有效团队成员都能写；票据不含项目角色或能力列表。

软删除时，Spring 请求网关停止新写入并 flush 当前房间，得到 durable-close 确认后，按固定 `project → collab_document` 锁顺序标记删除、递增 epoch 并写控制事件，最后关闭旧房。未得到持久化确认时删除失败关闭。旧 epoch 票据、连接和离线 Update 不得重新写入。成员撤权只关闭受影响用户连接，不冻结其他成员房间。

事务 Outbox 保证删除关房和成员撤权事件最终送达网关；重复事件按水位幂等。维护型 Y.Doc 压缩如需实施，先 flush/fence，再把当前内容重建到新 epoch，不提供历史恢复入口。

## 7. 实施顺序

| 步骤 | 交付内容 |
| --- | --- |
| 01 | 现状、项目并发与旧存储隔离护栏 |
| 02 | 自助注册、JWT Bearer、Redis 刷新凭据 |
| 03 | 团队成员授权、旧匿名项目隔离、关闭 V1 版本入口 |
| 04 | 登录、团队与项目界面联合切换 |
| 05 | 新项目 Y.Doc 初始化、协作对象与 generation CAS |
| 06 | Hocuspocus 网关、单次票据、自动持久化 |
| 07 | Monaco/Yjs/Sandpack 桥与可扩展语言服务 |
| 08 | 离线重连、Presence、远端光标与结构操作 |
| 09 | 软删除关房、成员撤权与持久化协调 |
| 10 | 安全、指标、清理与故障恢复 |
| 11 | 发布和功能验收 |

以下是实施期间的依赖与发布约束记录；所有开发步骤现已完成，当前仅本机运行，公网切换未执行。步骤 01–10 是实现和功能检查顺序，**不逐步公开不完整的 V2**。步骤 03/04 完成身份与团队代码后在开发或隔离环境检查，生产仍使用 V1 入口；步骤 05–09 完成新项目创建、协作、删除和撤权后，步骤 11 在停写窗口执行全部增量迁移并部署完整 V2 制品。V2 服务从启动起强制认证，受控检查通过后再切换登录壳、API 和网关外部入口；无需数据库认证切换状态。切换后旧匿名项目、旧版本 UI/API 和旧快照写链路不能通过回滚重新开放。Flyway 只追加迁移，不改写已发布的 V1/V2 文件；新增迁移编号按落地顺序确定。

## 8. 功能验收

1. 注册、登录、刷新、团队创建与加入、OWNER 成员管理可用；OWNER/MEMBER 对项目同权，旧匿名项目隔离。
2. 新项目直接有持久化初始 Y.Doc；成员可协作编辑多文件，看到 Presence/远端光标，HTML/CSS/JS 补全与诊断、JS 静态类型检查和 Sandpack 预览可用。
3. 编辑后当前 Y.Doc 自动持久化；网关重启从当前指针恢复，离线更新在重新授权后合并；CAS 冲突和存储故障不静默覆盖内容。
4. 软删除和成员撤权关闭对应连接；旧票据、旧 epoch、旧缓存不能继续写入。
5. UI/API 不提供版本列表、检查点、历史恢复或版本比较；旧 V1 revision 数据保留但不进入 V2 业务流程。
