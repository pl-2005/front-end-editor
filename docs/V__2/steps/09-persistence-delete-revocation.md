# 步骤 09：持久化协调、软删除关房与成员撤权

> 前置：步骤 05–08。状态：已实现并完成自动检查及本机功能验收（2026-10-06）。目标：删除和撤权不能绕过当前 Y.Doc 持久化或旧连接隔离。

## 实现记录

追加 V12，新增 `collab_operation` 与 `collab_control_event`。Spring 删除服务先在项目锁内建立幂等 PREPARED，再于数据库事务外请求网关 fence/durable-close；提交事务按 `project → collab_document` 顺序锁行，复核元数据 If-Match、epoch、generation、hash，原子软删除、推进 epoch、提交 operation 并追加 PROJECT_DELETED。并发重复删除只提交一次，元数据变化或数据库回滚则写 ABORTED 与对应事件；ACK 丢失或数据库结果未知时保留 fence。事务内 operation/文档使用 FOR UPDATE 当前读，避免 MySQL 默认可重复读的旧快照干扰对账。

网关对项目设置独立 fence，禁止新 Update、握手及异步加载落地，同时允许已接受 pending 继续 flush。无活动房间仍核对当前数据库指针和残留队列；确定 durable 后返回 generation/hash/sequence 及 256-bit fence token。SQLite 持久化 fence/token/回执与事件水位，与现有 nonce 使用相同持久磁盘文件，不保存源码；重启握手及加载再次查询 Spring 控制状态，PREPARED 不会因房间卸载或租约到期而自动解除。

退出所有设备、修改密码、退出团队及 OWNER 移除成员，在原授权事务中更新水位并写 USER_REVOKED。Outbox 每秒投递，失败指数退避、重试并记录脱敏告警；网关先关闭目标用户的旧水位连接，再持久化聚合水位和返回 ACK。当前 authzVersion 为用户级水位，撤权影响该用户的旧连接，其他有效成员房间持续运行，新水位连接不受迟到旧事件影响。最长 5 秒授权租约及握手实时内省继续兜底。

长期 PREPARED 的 60 秒租约到期后，对账器先请求网关确认 durable fence，再锁数据库核对项目状态、原 epoch 和 operation 提交痕迹，安全 ABORT；COMMITTED 的 finalize 由事务 Outbox 持续重试。网关或 Spring 不可达时保持关闭写入。删除保留最后对象键和原始 epoch（对象键及 operation.expected_epoch），已删除项目拒绝 describe/load/persist，清理器仍将保留指针视为引用；没有硬删除或恢复已删除项目。

前端开放有效成员的项目删除按钮，使用元数据 ETag，提交后清理发起者对应缓存并返回团队。Hocuspocus 4.7 文档 CLOSE 帧在 Provider 中使用 code=1000，因此前端同时检查服务端删除/撤权 reason 和传输层 4403，立即停止编辑、清空内容及缓存；临时 fence 原因或 4410 暂停编辑并保留日志。离房、复制和停机仍只更新当前文件，不创建 revision/checkpoint。

验证：后端 50 项测试及打包、协作模块 21 项测试及 TypeScript 构建、前端 79 项测试/lint/TypeScript/生产构建通过。新增覆盖并发/重复删除、删除前最新保存、If-Match 并发变化、数据库回滚、ACK 失败保留 PREPARED、到期对账、授权与 Outbox 同事务回滚、投递重试、重复/乱序事件、单用户主动撤权、fence 存储失败保留 pending、无房间确认、持久控制状态重开，以及临时 fence 保留缓存和文档撤权清理。

本机运行使用根 `.env` 的 MySQL/MinIO/Redis，无 Docker。V12 已执行；真实 Provider 验收通过 MEMBER 编辑期间软删除、durable flush、MinIO 最后对象 hash/size/内容保留、无活动房间删除、重复请求、旧票据/旧 epoch 拒绝、四类 Outbox 主动撤权、其他成员继续保存及网关重启恢复。脚本与内部协议见 [协作模块说明](../../../collaboration/README.md#step09-删除outbox-与故障对账)。临时 Spring、网关及初始化服务均已停止，验收账号与项目保留本机。生产票据、网关及外部协作入口仍保持关闭；下一步为 Step10，公开发布留给 Step11。

## 控制数据

追加 `collab_control_event` 事务 Outbox：事件 ID、聚合 ID/序号、类型、必要的项目/用户/epoch、创建/投递/确认时间与重试状态。追加 `collab_operation`：operation ID、project ID、操作类型 `DELETE/MAINTENANCE`、预期项目 lock_version/epoch/generation、`PREPARED/COMMITTED/ABORTED`、fence token、租约与时间戳。没有 CHECKPOINT 或 RESTORE 操作类型，也不创建 revision。

## 软删除流程

1. 团队成员调用项目删除，携带项目元数据强 `If-Match`。Spring 建立幂等 PREPARED operation。
2. Spring 请求网关 fence：停止该项目的新 Update，flush 到确定的 durable generation，返回 durable-close ACK 与不可猜测 fence token。若当前没有活动房间，网关仍须核对数据库当前指针并确认无待持久化队列后返回 ACK。网关无法确认时返回 503，项目保持原状态且房间不得继续危险写入。
3. Spring 按 `project → collab_document` 顺序锁行，重新校验项目状态、`If-Match`、epoch 和 generation；同一事务标记软删除、递增 epoch、提交 operation 并写 `PROJECT_DELETED` Outbox。当前对象键与其原始 epoch 作为删除前最后持久化文件保留，不再允许 load/persist 已删除项目。
4. COMMITTED 后通知网关关闭旧房并拒绝旧 epoch 票据、连接与离线队列。数据库失败时安全 ABORT；状态未知时保持 fence 并查询 operation，不猜测解栅栏。

删除保留当前 Y.Doc 对象和旧 V1 数据，不提供历史版本恢复或“恢复已删除项目”。项目软删除后的保留期限与最终清理另行制定；本期不硬删。旧 V1 snapshot、revision、restore 写入口始终关闭，不能绕过 fence 更新内容。

## 成员撤权

退出所有设备、改密、退出团队和 OWNER 移除成员，在同一授权事务更新版本水位并写相应控制事件。REST 与新票据立即按当前数据库关系拒绝；网关收到事件后关闭受影响用户连接、拒绝其旧 Update，其他有效成员房间继续运行。Outbox 至少一次投递，网关按聚合序号幂等处理；投递失败重试并告警。事件延迟时，步骤 06 的最长 5 秒写入授权租约到期即重新内省；复核失败或 Spring 不可达则停止写入。旧票据的握手内省始终复核 `authz_version`，网关重启也不能恢复被撤销权限。

## 故障恢复与功能验收

长期 PREPARED 操作通过数据库提交痕迹和网关 fence 状态对账，只能安全补 finalize 或 ABORT。租约到期不自动放开写入；Spring 不可达时 fail closed。末位成员离房和正常停机继续执行步骤 06 的 Y.Doc flush，不调用本步骤创建版本。

功能验收确认编辑期间软删除先 durable flush 再关房、故障时不丢已持久化内容、旧 epoch 写入拒绝、撤权关闭单个用户连接、控制事件重复/乱序安全、网关重启可恢复当前文件。确认没有检查点或历史恢复接口。运行应用使用根 `.env` 的本机服务，不使用 Docker；不要求双浏览器自动化或专用三服务集成验证。
