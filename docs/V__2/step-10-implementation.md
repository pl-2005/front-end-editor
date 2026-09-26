# 步骤 10 实施记录

状态：本机代码与隔离资源验收通过；生产运维门禁待 staging 演练（2026-09-26）

## 本轮落地

- 历史快照从 MinIO 读取时统一使用 11 MiB 压缩对象上限；`SnapshotCodec.decode` 在创建 GZIP 流前再次拒绝空对象或超限对象，解压后仍限制为 10 MiB。这样对象流和展开后的 JSON 都有界，超限按存储损坏失败关闭。
- MinIO 下载前先核对对象元数据大小与命名空间对应的 content-type（`projects/` 必须为 `application/gzip`，`collab/` 必须为 `application/octet-stream`），下载后核对实际字节数与 stat 大小；无界 `readAllBytes()` 路径已移除。
- MinIO 上传同样拒绝空对象、超过 11 MiB 的对象、命名空间与 content-type 不匹配的对象；协作状态配置上限不允许超过 10 MiB。
- Spring 为每个请求设置 `X-Request-Id` 响应头，并将请求 ID 放入 SLF4J MDC；合法上游 ID（最多 64 个 ASCII 安全字符）沿用，否则生成随机 UUID。请求结束后清理 MDC，避免线程复用串号。
- CORS 允许客户端发送并读取 `X-Request-Id`，使跨域 SPA 可以将界面错误报告与服务端日志关联。
- 前端 `ApiError` 保留响应中的 requestId，供错误上报/支持诊断使用；只保留关联标识，不采集请求体或认证数据。
- 协作网关每 30 秒输出一条不含项目 ID、用户 ID、源码、票据或密钥的容量 JSON 记录：房间/连接数、进程内待持久化字节、内存上限、校验并发、durable/degraded/frozen 房间数。SIGTERM/SIGINT 时停止采样。
- 协作开启时，Spring 每分钟记录 Outbox 未发布事件数量/最老年龄及 PREPARED 操作数量/最老年龄；超过 300 秒使用 WARN，查询失败只记录固定错误文本，不输出异常载荷。
- Flyway 可配置独立迁移账号（`FLYWAY_DB_USERNAME/PASSWORD`、IT 对应变量），运行时 datasource 账号仍单独配置；默认兼容本地复用账号，生产需要分离授权。
- 新增依赖安全工作流：前端/网关 `npm audit --audit-level=high`，Java OWASP Dependency-Check CVSS ≥ 7 失败门禁，并上传 CycloneDX SBOM。工作流文件：[dependency-security.yml](../../.github/workflows/dependency-security.yml)。
- 初始 staging 告警阈值、数据库/MinIO 最小授权和双向 HMAC 轮换步骤见[运维门禁与演练记录](./step-10-operations.md)。

## 本机验收（2026-09-26）

- `scripts/verify-integration.ps1`：网关 typecheck/build 与 14 项测试通过；Maven Surefire 176 项、隔离本机 MySQL/MinIO Failsafe 28 项通过，Flyway 验证并迁移至 V12。新增的 MinIO 错误 content-type 回归用例通过。
- 前端 lint：0 error、2 条既有 warning；Vitest 13 个文件 61 项通过；生产构建通过（有 Monaco 大 chunk 提示）；双浏览器 E2E 1 场景通过。
- `npm audit --audit-level=high`：协作网关 0 vulnerabilities；前端 4 moderate、0 high，均在 E2E 专用 `minio` devDependency 的传递依赖中。npm 不提供非破坏性修复，`--force` 会降级 MinIO SDK 到不兼容大版本；未执行强制降级。High 门禁通过，moderate 风险保留并在 CI 继续监测。
- CycloneDX：前端 365 components、网关 44 components、Java 98 components；Node BOM 为临时报告，CI 上传为 artifact；Java BOM 位于 `backend/target/bom.json`。
- 运行集成验收首次发现对象类型检查拦截了一个错误的测试夹具（`collab/` 对象误用 gzip 默认值）；夹具已改为 octet-stream，错误类型回归用例也已加入并通过重跑。

## 本地容量基线（配置上限，不是压测结果）

| 项目 | 默认值/硬上限 | 解释 |
| --- | ---: | --- |
| 网关房间 | 500 / 实例 | 达到上限拒绝新房间 |
| 每房间连接 | 50 | 新连接拒绝，不排队 |
| 网关内存预算 | 512 MiB 默认，可配置至 2 GiB | 更新超过预算时拒绝并等待持久化 |
| 单项目文件 | 100 | 服务端与网关均校验 |
| 单文件源码 | 1 MiB | UTF-8 字节数 |
| Y.Doc 总源码 | 5 MiB | 网关限制；版本快照上限仍为 10 MiB |
| 单个 Update | 128 KiB | 超限拒绝 |
| 单房间待持久化 Update | 5 MiB | 超限进入 degraded，停止写入 |

这些值仅表示当前代码的保护边界。100/500/1000 房间阶梯、热点房、并发 checkpoint/restore、数据库锁等待和 MinIO 延迟基准尚未执行；不得据此承诺生产容量。生产启用协作前须运行压测，记录硬件、房间分布、吞吐、p95/p99、RSS、DB pool 与对象增长并据实调整。

## 可观测性与告警接线

- API 请求 ID 可从响应头取得，并与审计 `requestId` 对照；应用控制台日志已包含 MDC `requestId`。
- 网关 `gateway_capacity` 是标准输出 JSON 行。采集器以 `event` 区分事件；至少对 `degradedRooms > 0`、`frozenRooms > 0`、`rooms/maxRooms > 0.8`、`memoryBytes/maxMemoryBytes > 0.8` 和容量记录缺失超过 2 分钟告警。
- Spring `Collaboration operational summary` 日志采集器对 `outboxPending > 0`、`outboxOldestSeconds > 300`、`preparedOperations > 0` 和 `preparedOldestSeconds > 300` 告警。Spring readiness 失败时不导流。协作持久化观察各房间 generation 与 durable 状态。告警需链接本节恢复步骤。
- 不得将请求/网关日志升级为包含请求体、cookie、csrf、ticket、Yjs 内容、MinIO 凭据或内部 HMAC 的调试日志。

## 故障恢复操作顺序

1. 发现数据/指针不一致或大范围持久化失败：先关闭协作入口和新票据（`COLLABORATION_ENABLED=false`），将 API 写流量置维护；保留数据库、对象和日志现场，记录 UTC 时间及可用 requestId/operationId。
2. 若只重启网关：SIGTERM 停机，等待所有活动房间 flush 成功后进程退出；确认 `gateway_capacity` 中没有 degraded 房间，再启动。若进程不能退出或 durable 房间不齐，保持维护，不强杀后宣称数据已保存。
3. 若 MinIO/数据库恢复：先恢复 MySQL 与 `projects/`、`collab/` 对象到同一恢复点；按对象键计算 SHA-256 并对照 `project_revision`、`collab_document` 指针。禁止按猜测补写指针或删除缺失对象的历史。
4. 逐项目检查 `collab_operation`。PREPARED 状态交由恢复器按 source epoch/version 规则处理；状态不明的项目保持冻结。恢复数据库备份时，每个可恢复 collab_document 必须事务性提升 epoch、generation 归零、清理/ABORT 旧 fence lease 并写入 close/invalidate Outbox 事件，不能恢复较小 epoch。
5. 先启动 Spring，等待 Flyway、readiness、epoch 更新和 Outbox replay 完成；校验没有未处理旧 close 事件及未知 PREPARED 操作。然后启动单个协作网关，观察 durable/degraded/frozen 计数及 MySQL/MinIO错误。
6. 用受权测试用户检查版本/协作文档一致性报告和旧浏览器缓存重连：epoch 不匹配的 IndexedDB 内容必须清理并 bootstrap，不能重放事故前队列。通过后逐步恢复写流量；保留恢复报告和未解决项目列表。

该仓库目前未提供自动化 MySQL/MinIO 备份、哈希巡检、epoch bump DR 命令或两网关协调能力。本节是人工恢复流程，不应被当作已完成的恢复演练。上线前需在隔离 schema/Bucket 实际执行并记录 RPO/RTO、对象核验和客户端缓存结果。

## 尚待 staging/生产环境完成的门禁

- 当前仓库已有自动化回归覆盖 CSRF/Origin/HMAC 与票据重放/轮换、压缩炸弹、路径穿越、恶意 Yjs、离线缓存用户/epoch 隔离、ACL、fence、Outbox 幂等/顺序、网关重启恢复及 MinIO 错误 content-type；本轮全套测试通过。
- CI 配置已加入 SCA/SBOM 门禁，但本地只完成 npm 审计和 BOM 生成；OWASP Dependency-Check 需在 CI 更新 NVD 数据库后确认实际结果。
- 100/500/1000 房间压测和双网关容量验证未执行。总体方案明确不支持跨网关协调，因此多实例不允许用于生产；需在进入多实例设计前更新总体方案。
- 断电、生产 MySQL 主从切换、生产 MinIO 故障、真实 KMS 双钥轮换、外部告警实际投递未在本机执行。
- 本地未做 MySQL+MinIO 同一恢复点备份还原。epoch recovery floor 必须来自备份点之外的单调账本；只对旧备份 epoch 做 `+1` 不能证明全局不回退。需要 staging 提供外部 floor、备份目标和客户端旧 IndexedDB 验收资源。
- 运维文档给出的是 staging 初始阈值；告警负责人、通知渠道、生产 RPO/RTO 与备份保留窗口需由部署方确认并通过演练校准。
