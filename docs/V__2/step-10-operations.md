# 步骤 10 运维门禁与演练记录

## 初始告警阈值（上线前由服务负责人确认）

下表是 staging 初始门槛，不是已观测的生产 SLO。部署后先取 7 天基线，再由负责人调整并记录变更。

| 信号 | 告警条件 | 处理 |
| --- | --- | --- |
| API 延迟 | p95 > 500 ms 持续 5 分钟；p99 > 2 s 持续 5 分钟 | 按 requestId 查日志，先看 DB 锁等待及 MinIO 超时 |
| API 错误 | 5xx 比例 > 1%（至少 100 请求）持续 5 分钟 | 降低写流量；检查 DB/MinIO/readiness |
| 网关内存 | RSS > 80% 配置上限持续 2 分钟 | 禁止新房间，排查未 durable/degraded 房间 |
| 房间容量 | 活跃房间 > 80% `COLLAB_MAX_ROOMS_PER_INSTANCE` 持续 5 分钟 | 拒绝扩大白名单；当前单实例设计不支持横向房间迁移 |
| 持久化滞后 | `degradedRooms > 0` 或 `durableRooms < rooms` 连续两次采样 | 暂停协作写入并按故障步骤恢复 |
| Outbox | 最老未发布事件 > 300 秒 | 检查网关可达性及永久失败告警；保持顺序处理 |
| PREPARED 操作 | 最老 PREPARED > 300 秒 | 保持项目冻结，检查操作 source epoch/version 后运行恢复器 |
| MinIO/DB | 5xx/超时出现即告警；DB 锁等待 > 2 秒 | 进入维护模式，避免重复提交破坏性操作 |

告警负责人、通知渠道和升级策略由实际运维环境填写，仓库不假定 Slack、PagerDuty 或其他外部系统已接入。

## 数据库与对象存储最小权限

应用账号与迁移账号分开。应用 `DB_USERNAME/DB_PASSWORD` 只需要业务 schema 的 `SELECT, INSERT, UPDATE, DELETE`；不要授予全局权限、`FILE`、`PROCESS`、`SUPER` 或 `GRANT OPTION`。迁移账号通过 `FLYWAY_DB_USERNAME/FLYWAY_DB_PASSWORD` 单独提供，仅在发布/迁移窗口使用，并限于应用 schema 的 DDL 与 Flyway history 所需 DML 权限。根 `.env` 可以在本地暂时让两者相同，但部署环境必须分离。

集成测试使用 `IT_DB_USERNAME` 和可选的 `IT_FLYWAY_DB_USERNAME`，两者只授权给专用 IT schema；不得授予开发 schema 或全局权限。MySQL 账号在服务外创建，变更授权应先在隔离实例试跑并审计。

MinIO 桶保持 private。应用身份只授予目标桶的 `GetObject/PutObject/DeleteObject` 与清理任务所需的限定 `ListBucket`；关闭生产 `MINIO_INITIALIZE_BUCKET`，桶创建和策略管理使用单独运维身份。协作网关不持有 MinIO key。

## 双向 HMAC 密钥轮换

Spring 与 Gateway 的 key ring 独立轮换，任意时刻都不能复用同一 secret。操作顺序：

1. 安全生成新随机 secret，保存进密钥管理系统；通过受控环境注入 API→Gateway 和 Gateway→API 各自的 `current,next` key rings。
2. 先部署接收端，使新旧 keyId 均被接受；滚动部署发送端改用新 keyId。若部署边界是单实例，维护窗口保持 ticket 与协作写入口关闭。
3. 观察至少两个 nonce 窗口及内部请求错误告警；确认双方新 key 流量成功、旧 key 流量为零后，从接收端移除旧 key。
4. 泄露事件不等待轮换窗口：立即关闭协作、撤销旧 key、清理内部 nonce 窗口并审计票据/Outbox；恢复前验证旧 key 请求一律被拒。

不得在命令行参数、日志、SBOM 或仓库中放置明文 secret。双 key 窗口期间要保证 API 和网关兼容；不能先移除旧 key 再部署发送端。

## 本机故障演练命令

以下命令只针对隔离 IT schema/Bucket，由 `scripts/verify-integration.ps1` 从根 `.env` 读取连接信息。脚本不使用 Docker。

| 演练 | 自动覆盖 | 证据 |
| --- | --- | --- |
| HMAC/ticket 重放与 key overlap | `npm test` 网关 API/internal 测试；后端内部 HMAC filter 测试 | 网关测试输出及 Surefire XML |
| Origin、恶意 Update、clone 未污染 | 网关 `gateway.integration.test.ts`、`document.test.ts` | Node 测试输出 |
| 路径穿越、压缩炸弹/损坏快照 | 后端 `SnapshotCodecTests`、网关 `document.test.ts` | Surefire/Node 测试输出 |
| ACL、旧入口、恢复/fence/Outbox | 后端 Failsafe 与 Playwright 双浏览器 E2E | Failsafe XML 与 E2E report |
| MinIO 类型/大小、revision/collab 引用清理 | `BaselineIT.realMinioCleanerPreservesReferencedRecentAndCollabObjects` 与协作持久化 IT | Failsafe XML、独立 Bucket 自动清理 |
| 网关进程重启与 durable reload | 网关真实 WebSocket integration test | Node integration test |

无法安全自动化的断电、生产主从切换、真实密钥管理器、外部告警投递仍须 staging/生产演练；不能用单元测试代替。
