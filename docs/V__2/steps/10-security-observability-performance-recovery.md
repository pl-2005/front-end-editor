# 步骤 10：安全、可观测性、性能与故障恢复

> 前置：步骤 09 的协作协调、Outbox、fence 和撤权链路通过。  
> 目标：形成可量化的安全门禁、容量基线、故障演练和恢复手册。

## 1. 安全加固

- JWT Bearer 签名/声明/期限、刷新凭据轮换、WebSocket Origin、内部 HMAC 和 ticket 按步骤 02/06 固定契约回归；
- 所有用户输入执行 Unicode/路径/大小/JSON schema 校验；拒绝未知服务端字段；
- MinIO 对象私有、服务端流式读取、有界解压和 content-type 白名单；
- 协作 Update 在网关临时 clone 校验后才广播；Awareness 只允许有限字段；
- 日志和 trace 绝不包含密码、访问 JWT、刷新凭据、ticket、源码、Yjs binary、MinIO 凭据；
- 依赖锁文件、SCA、SBOM、密钥轮换和最小数据库权限纳入 CI；
- 身份/团队/项目/协作每个 API 运行授权矩阵和 404 防枚举回归。

安全测试包括：伪造 JWT 算法/kid/iss/aud/过期时间、刷新凭据重放、退出所有设备或改密后的旧 JWT、浏览器存储泄漏检查、重放 ticket/HMAC nonce、跨用户 IndexedDB、路径穿越、压缩炸弹、Yjs 恶意结构、越权 snapshot/restore/delete、旧匿名入口和错误码枚举。

## 2. 可观测性

统一 requestId/traceId，Spring、网关、浏览器错误事件可关联但不上传源码。结构化事件至少包含：

- auth：登录成功/失败/限流、JWT 校验失败原因类别、刷新凭据创建/轮换/重放/过期与 `token_version` 撤销；
- ACL：授权拒绝、角色变更、版本水位；
- collab：握手、房间、Origin拒绝、Update拒绝、generation、CAS、epoch、fence；
- storage：对象读写、hash/size、孤儿、清理；
- outbox：待处理、重试、最老年龄、永久失败。

指标设 SLO：API p50/p95/p99、WS 握手和同步延迟、房间/连接/消息速率、persist 延迟、pending/durable 差距、checkpoint/restore 成功率、Outbox lag、MinIO 错误、Redis 可用性/延迟/刷新凭据数/重放拒绝、JWT 401 比例、DB 锁等待和线程/内存。告警阈值、负责人、runbook 链接写入运维文档。

## 3. 性能与容量

以步骤 01/06 默认限制为基线，按首期单网关部署拓扑规划容量；需要调优时可评估：

- 连接建立、房间广播、文本 Update、结构 Update、Viewer 房间；
- 100/500/1000 房间分层，热点房间连接上限；
- checkpoint/restore 与普通编辑并发；
- DB 慢查询、MinIO 延迟、内部 HMAC 和 Outbox backlog。

容量模型给出：最大用户/团队/项目、每房连接、单项目文件数/总字节、网关内存、DB连接池、Bucket增长、保留窗口和清理速率。超过硬上限必须拒绝或降级只读，不能无界排队。

## 4. 故障演练

逐项注入并记录预期状态：

1. Spring 不可达：ticket/握手/internal fail closed；
2. 网关重启：新连接重载 generation，旧连接关闭，客户端离线队列重发；
3. MinIO 5xx/对象损坏：persist/checkpoint失败、对象隔离、告警；
4. MySQL 锁等待/主从切换：写入超时不覆盖、operation可恢复；
5. Redis 不可用/重启：登录和刷新失败关闭、readiness 失败；已签发 JWT 仍须通过 MySQL 用户存在性与 `token_version` 校验，丢失的刷新凭据要求重新登录；
6. Outbox 重复/乱序/长时间失败：幂等、顺序水位、报警；
7. 进程 SIGTERM/断电：flush durable 条件，重启对账；
8. ticket/nonce 密钥轮换：current/next窗口；
9. 退出所有设备/改密/成员撤权：旧 JWT 因 `token_version` 变化立即拒绝；成员撤权由实时 ACL 拒绝，连接和票据最终关闭；
10. schema/epoch/generation损坏：read-only/隔离，禁止自动猜修。

每次演练保存 requestId、operationId、source/target epoch、恢复时间和数据完整性报告；失败项必须有修复 issue，不能以“重启即可”结案。

## 5. 备份与恢复

MySQL 按 RPO/RTO 目标备份并定期恢复演练；MinIO 版本对象和 collab 对象分层保留、校验哈希。恢复顺序：先保持 Spring 写入口、Outbox worker、网关和票据端点维护/关闭；恢复数据库与 projects/collab 对象并校验全部 pointer/hash；对每个可恢复 collab_document 在恢复事务中推进全局不可回退 epoch（即使恢复快照的 epoch 较旧也必须 +1），清理/ABORT 所有旧 collab_operation/fence lease，并发布强制 close/invalidate 事件；等待旧 HMAC nonce 窗口失效或轮换双向密钥。网关仅在 epoch bump、对象校验和 Outbox replay 完成后启动。客户端收到 epoch 不匹配必须清理对应 IndexedDB Y.Doc/pending queue，重新 bootstrap，不能把事故后的本地更新写回恢复环境。缺对象项目进入维护/只读报告，不删除历史。

Redis 刷新凭据不作为需要恢复的业务数据；Redis 丢失或灾难恢复切换后要求用户重新登录。切换恢复环境时隔离或清理旧刷新凭据命名空间，并更换 JWT 签名密钥、停用旧 `kid`，防止旧 JWT 与已回退的 MySQL `token_version` 混用；清理仅针对本应用命名空间，不执行共享实例级清空。

定期生成项目指针、revision、collab generation/epoch、对象 hash/size、团队 OWNER 的一致性报告，并检查 Outbox 的完整性；项目/版本修复通过受控命令执行。

## 6. 发布准备

功能验收确认 JWT 与刷新凭据、权限隔离、协作持久化、恢复/删除 fence、告警和故障恢复行为符合前述契约。后端单元、前端 lint/test/build、网关 typecheck/test、依赖扫描、迁移 dry-run 和压测可作为开发检查，不作为 V2 完成门禁。不要求本机 MySQL/MinIO/Redis 专用集成验证或双浏览器 E2E；运行应用仍使用根 `.env` 和本机服务，禁止 Docker。

发布必须有 rollback 制品兼容 V3–V12；V9 后永不恢复匿名。feature flag、密钥、DB migration、网关和前端版本必须有兼容矩阵与审批记录。

## 7. 验收

功能验收确认安全边界生效、告警可触发且不泄露秘密、故障路径符合 fail-closed/可恢复规则、版本/对象/权限/Outbox 状态一致。安全扫描、压测、故障演练报告和备份恢复报告不作为完成条件。

## 8. 后续契约

步骤 11 将运行配置、兼容矩阵和功能验收结果整理进发布说明。


