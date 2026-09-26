# 步骤 09：检查点、恢复、删除与 Fence 协调

> 前置：步骤 05–08 通过；协作项目已使用 Y.Doc。  
> 目标：把检查点、恢复、软删除和撤权变更纳入可恢复的 fence/Outbox 状态机，封堵所有旧写旁路。

## 1. V12 数据模型

创建 `collab_control_event`：aggregate_type/id、aggregate_sequence、event_type、payload（含 sourceEpoch/targetEpoch）、created_at、published_at、attempts、last_error；唯一聚合序号。敏感业务变更、audit_log 和该 Outbox 行在同一数据库事务写入，先提交业务事实再由 publisher 重试发送；发布失败不回滚事实。

创建 `collab_operation`：operation_id、project_id、operation_type CHECKPOINT/RESTORE/DELETE/REVOKE、expected_project_version、expected_epoch/generation、state PREPARED/COMMITTED/ABORTED、fence_token、target_epoch、captured_generation、idempotency_key、lease_expires_at、created/updated_at、error_code。

唯一约束覆盖 operation idempotency key 和 project+active destructive operation。写入业务表、审计和 Outbox 必须同一数据库事务。

## 2. Capture/检查点

唯一检查点入口是 Spring API；浏览器请求携带 If-Match/expectedVersion，Spring 授权后创建 idempotency key 并调用网关 capture。网关先 flush 当前房间，等待 durable generation，返回 requestId/projectId/epoch/capturedGeneration/规范文件快照/hash。

Spring 重新规范化文件、检查 V1 白名单/大小/入口并 SHA-256，不信任网关 hash；在事务内插入新 revision：

- MANUAL/AUTO/LEAVE：同一 collab epoch+generation+hash 可复用已有 revision，但单调更新 last_checkpoint_generation；
- RESTORE：即使 hash 相同也创建新 revision；
- source 固定枚举，created_by 为实际用户或 SYSTEM。

revision 写入对象后再提交 DB 指针；对象失败不提交，DB失败对象进入步骤 05 清理租约。响应包含 version、stateVersion/current_version、capturedGeneration。超时由 requestId 对账，不能重复创建版本。

## 3. Restore

流程：

1. 创建 PREPARED operation，锁 project/collab_document；
2. 请求网关 fence：停止新写入，等待 dirtySequence durable，关闭/冻结旧房并返回 durable-close ACK、fenceToken、source epoch、capturedGeneration；若 ACK/租约不可得则 503，不进入数据库变更；
3. 重新检查 If-Match、current_version、epoch/generation 和项目/用户权限；
4. 从目标 revision 读取并校验，写新 RESTORE revision（不覆盖历史对象）；
5. 在同一事务锁定并 CAS source epoch，递增 current_version/stateVersion，切换 epoch=old+1、generation=0、bootstrap_revision_version=new version、last checkpoint 字段，写含 sourceEpoch/targetEpoch 的审计和 Outbox；旧 epoch 不可能再被接受；
6. COMMITTED 后调用网关 finalize，关闭旧房并让新连接从新 epoch bootstrap。

数据库失败时 ABORTED 并解除 fence；Spring 不可达、租约未知或状态 PREPARED 时 fail closed。长期 PREPARED recovery job 查询提交痕迹后只能补 finalize 或安全 ABORTED，禁止猜测。

## 4. Delete

删除是软删除：fence+flush 后锁 project/collab_document，检查版本，写 deleted 状态和 Outbox，COMMITTED 后关闭房间。对象和审计保留窗口由步骤 10/治理策略处理；不硬删 collab_document 或历史 revision。

恢复已删除项目是显式管理员/OWNER 操作，创建新的 restore revision/epoch；删除请求不可绕过 fence。所有旧 project snapshot/revision 写入口在 collaboration_mode=ENABLED 下固定返回 409。

## 5. 撤权与 Outbox

步骤 03 的用户禁用、团队移除、项目成员移除、角色降级事务同时写 USER_DISABLED/TEAM_MEMBER_REMOVED/PROJECT_MEMBER_REMOVED/ROLE_DOWNGRADED 事件。Outbox publisher 至少一次调用网关：

- 关闭受影响连接；
- 使房间进入 readOnly/fenced；
- 删除/失效票据；
- 发送结果写 published_at 或重试。

网关重复事件按 aggregate_sequence 幂等；事件顺序倒退不执行。发布失败不回滚已提交授权，持续重试并报警。

## 6. 一致性与租约

Fence token 为不可猜测随机值，绑定 project/sourceEpoch/operation/lease。网关 durable-close ACK 是旧房最后可接受 update 的边界；Spring 只有在 ACK 后以 source epoch CAS 切换 target epoch。租约到期不自行恢复写入，必须查询 operation：COMMITTED finalize、ABORTED 且 epoch未变才解除，PREPARED/未知继续 fail closed。Spring 只在持有固定顺序 project→collab_document 锁后改变指针。

所有 API 支持 requestId/idempotency key；非幂等调用不盲目重试。维护窗口 drain 在途请求，禁止旧实例继续写。

## 7. 测试

单元/集成：manual/auto/leave 去重、restore 同 hash 新 revision、If-Match/stateVersion、对象/DB故障补偿、fence durable-close ACK/lease续期/超时、ACK丢失 fail closed、source epoch CAS、PREPARED recovery、delete/restore、Outbox重复/乱序/重试、撤权实时关房、旧入口409。

双用户 E2E：一人编辑时另一人 checkpoint；恢复期间房间只读并切换 epoch；删除后连接关闭；撤权后旧票据/连接失败；重启 publisher 最终送达。真实 MySQL/MinIO 使用独占资源，不用 Docker。

## 8. 发布与验收

先在白名单项目运行 capture/restore/delete 演练，检查审计、Outbox、对象引用和指标；通过后才扩大。开启 collaboration_mode=ENABLED 的项目必须全部经过本步骤，旧快照链路不存在写入口。

验收：已广播更新不被破坏性操作覆盖；恢复永远新 revision/epoch；删除不会丢历史；撤权最终关闭连接；操作重试可收敛；所有 fence 状态可解释并可恢复。

## 9. 后续契约

步骤 10 负责安全、性能、故障演练和容量；步骤 11 负责发布流水线、备份恢复和最终 E2E 门禁。


