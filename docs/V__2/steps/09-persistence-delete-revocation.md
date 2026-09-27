# 步骤 09：持久化协调、软删除关房与成员撤权

> 前置：步骤 05–08。状态：未开始。目标：删除和撤权不能绕过当前 Y.Doc 持久化或旧连接隔离。

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
