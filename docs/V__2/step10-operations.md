# Step10 运维：指标、联合备份与当前文件恢复

本文只描述受控运维。没有用户历史版本、checkpoint、恢复已删除项目或 V1 revision 回退。生产入口开放流程见 Step11；当前仅本机运行，公网未切换，所有 `/internal/` 路由必须在反向代理阻断。

本机环境与依赖准备见 [开发指南](./development.md)，当前架构见 [架构说明](./architecture.md)，部署及回滚见 [发布说明](./step11-release.md)。

## 配置与身份

使用仓库根 `.env` 的本机 MySQL、MinIO、Redis，禁止 Docker。新增 `COLLAB_MAINTENANCE_SECRET` 是独立的至少 32 字节随机密钥，不得与 JWT、storage、gateway、initializer 密钥相同，不发送给浏览器。短密钥或复用密钥导致启动失败；未配置时运维认证拒绝请求。

Spring 的 `/internal/collaboration/maintenance/**` 和 `/internal/collaboration/metrics` 显式要求 `COLLAB_MAINTENANCE` 权限。安全链先校验原始有界正文的 HMAC，再授予该权限；普通 JWT 和 storage/gateway 密钥均不能访问。签名沿用六行协议，audience=`maintenance`，时差最多 30 秒，nonce 持久化 MySQL，重启不能重放。运维 JSON 正文上限 4096 字节，不允许 query。命令行仅访问 HTTP loopback `127.0.0.1`，不跟随重定向。

工具在 `collaboration` 目录运行，自动加载根 `.env`。`COLLAB_MAINTENANCE_URL` 默认 `http://127.0.0.1:8080`，`COLLAB_BACKUP_RETAIN_DAYS` 默认 30 天，`MYSQLDUMP_PATH` 可指定已安装的 mysqldump。不得打印 `.env`、密钥、认证响应或数据库/对象正文。

## 只读指标

```powershell
cd collaboration
npm run build
node scripts/maintenance.mjs metrics
```

该命令无需开启维护模式，但需要独立运维密钥。Spring 返回固定名称的进程计数器、Redis 当前可用性、Outbox 未确认数/最老事件年龄和持续维护项目数。Redis 连接及命令超时均为 2 秒。计数器包括认证/授权拒绝、票据、CAS、persist 次数/失败/累计耗时、清理结果、Outbox 和恢复结果；进程重启后计数归零，外部监控应使用 rate/delta。

网关的 `GET /internal/collaboration/metrics` 使用 gateway HMAC/audience，返回房间/连接/原始 socket 数、RSS、pending bytes 和每房 projectId/epoch/generation/pending updates/durable gap/paused/fenced，以及握手、拒绝更新、持久化及控制失败计数。没有源码、Yjs binary、票据、用户凭据或任意标签。每房诊断条目受房间总数上限约束。

建议采集间隔 5–15 秒。persist failure/paused、Redis 不可用、恢复 FAILED 应立即告警；Outbox lag 超过 5 秒需要调查并持续重试，授权租约最多 5 秒仍兜底拒绝写入。pending/durable 差距持续超过保存最大延迟 5 秒、RSS 接近上限、清理失败应告警。具体阈值可按单网关实际容量调整，不能以关闭授权或丢弃 pending 消除告警。

固定限制：100 文件、单文件 1 MiB、总正文 10 MiB、Y.Doc 12 MiB、Update 2 MiB。默认 50 房间、200 总连接、20 单房连接、512 MiB RSS、100 消息/秒及 4 MiB/秒/连接。`COLLAB_MAX_PENDING_BYTES`/`COLLAB_MAX_PENDING_UPDATES` 默认 24 MiB/10000。未认证连接另限制 4 MiB+2048 字节、100 条排队消息、1 个待认证文档。参数必须为正安全整数；超限拒绝或暂停，不无界排队。扩展到多网关需另行设计路由/同步。

## 停写与维护模式

1. 关闭外部票据和写路由，停止旧写流量。正常停止网关必须成功 flush；flush 失败保持关闭写入口并修复存储，不强制退出仍有 pending 的进程。突然崩溃后仅内存更新不保证恢复，客户端日志不能跨新 epoch 自动重放。
2. 停止旧 Spring/网关实例，确保没有其他进程继续使用同一数据库写文件。首期单网关是本流程的前提。
3. 配置 `COLLAB_CREATION_ENABLED=false`、`COLLAB_TICKET_ENABLED=false`、`COLLAB_GATEWAY_ENABLED=false`、`COLLAB_MAINTENANCE_ENABLED=true`，仅在 loopback 启动 Spring 和受信编码服务。任一公共开关仍打开时，维护模式启动失败。
4. 维护模式拒绝非认证 API 的 POST/PUT/PATCH/DELETE，以及内部 persist；签名恢复/备份仍可调用。读取和重新登录可用。维护操作不得并行运行多个 API 实例。

## 联合备份

```powershell
# 备份目录必须不存在；其父目录应预先建立并限制访问。
node scripts/maintenance.mjs backup ../.codex-build/backup-20261006 backup_20261006
```

工具先拒绝存在 PREPARED 删除或 PREPARED/FAILED 恢复的未解决操作，再分页枚举所有团队协作文档指针（包括软删除项目最后保留的对象），逐项目登记有效备份引用，核对对象键/hash/size，并由受信 Yjs 模块验证 schema、身份和内容大小。软删除指针的元数据 epoch 已递增，备份文件使用对象键中的实际 binary epoch，不恢复该项目。停机前应按 Step09 对账解决未提交删除；不以手工清除操作状态替代 durable fence 确认。

随后复制二进制到本地 `.yjs` 文件，再使用本机 mysqldump 的 single-transaction/no-tablespaces 模式导出 MySQL。数据库密码只进入子进程环境，不能进入命令参数、日志或 manifest。完成后才写 `manifest.json`，记录对象指针、文件名、保留截止时间、数据库 SHA-256 和后续可重复使用的 recovery operation ID。没有 manifest 的目录不是完成备份，不得用作恢复依据。已有目录/文件不会覆盖；失败时保留不完整目录以便检查。

整个过程中保持文件写入口关闭，不并行执行其他维护命令，确保 dump 与导出的对象属于同一稳定指针集合。dump 完成后工具再次核对所有指针及未解决操作；发现维护恢复导致指针变化时拒绝生成完成 manifest。数据库备份包含用户密码摘要和业务元数据、binary 包含源码；把备份目录放在受限存储，按本机运维规则转移并保护，不能提交 Git。只有数据库、只有 MinIO 或两者来自不同时间的备份均不完整。

清理器只删除规范 `collab/` 对象：超过年龄保护窗口且经过二次确认，并排除所有当前指针（含软删除）、有效备份引用、上传租约和 PREPARED/FAILED 恢复的源/目标对象。清理窗口及单次备份保留期最大 3650 天；当前引用和未解决恢复对象持续保护，不按年龄强删。重复登记备份不会缩短已有保留期。对象删除失败保留 DELETING 并下次重试，计数告警；不会影响其他候选对象。旧 `projects/` 数据沿用旧保留规则。

## 恢复当前文件

恢复环境必须与旧环境隔离并保持停写；由运维恢复配套 MySQL dump 和 manifest 所列 MinIO 对象至其原对象键，校验备份文件的 SHA-256/size。不能在正在提供服务的数据库上执行恢复。此步骤不由工具自动导入 SQL，也不提供用户可选历史版本。

隔离旧 Redis 刷新凭据命名空间，并轮换 JWT 密钥；刷新数据丢失要求重新登录。恢复环境使用新的持久 `COLLAB_GATEWAY_NONCE_PATH`/`COLLAB_INITIALIZER_NONCE_PATH`，隔离旧环境的 fence、水位和 nonce 文件，避免旧 Outbox 高水位压过回退数据库的新事件。旧环境进程必须停止；恢复后的删除操作仍按数据库真实状态核对，不能直接删除 fence 文件来恢复原环境写入。数据库可能恢复旧授权水位，不能混用旧 JWT、刷新凭据或仍运行的旧实例。

```powershell
# 对恢复后所有活动项目逐个重建；manifest 的 operation ID 支持失败后重试。
node scripts/maintenance.mjs recover-all ../.codex-build/backup-20261006

# 单项目修复/重复确认：预期 epoch/generation 来自当前指针，operation ID 使用同一个 UUID。
node scripts/maintenance.mjs recover PROJECT_ID EXPECTED_EPOCH EXPECTED_GENERATION OPERATION_UUID
```

`recover-all` 先检查活动项目集合及当前指针与 manifest 完全匹配，避免漏项目或对不同数据库执行。单项目请求先锁 project → collab_document，持久化 `collab_recovery PREPARED` 并保护源对象；事务外读取并核对当前对象，再由受信编码器从当前有效文件重建新 Y.Doc。新对象使用同项目、epoch+1、generation=1，文件内容和入口保持一致，旧 CRDT 历史/文件 ID 不复用。

新对象上传后回读验证 hash/size，再按原 epoch/generation 条件原子切换指针和 COMMITTED 状态。重复的 operation ID 返回原提交回执；复用 ID 携带不同前置水位拒绝。不会仅修改 epoch 并继续引用旧 epoch 对象，不写 revision/checkpoint。旧源对象保留有效恢复备份引用。

缺失/损坏/超限对象、编码/上传/数据库失败保持 PREPARED 或 FAILED；原指针不覆盖。该状态持久化，退出全局维护模式、进程重启或租约到期也不会解除项目 fence。票据、内部 persist 和删除均拒绝；前端暂停编辑，保留本地未同步日志。禁止猜测指针或自动回退 V1 revision。

检查 `GET /internal/collaboration/maintenance/projects/{id}/status`、`.../pointer`（同样需要 maintenance HMAC）。修复原对象/存储后，用同一 operation ID 重试。COMMITTED 与目标指针在同一事务，确认丢失时重试即可；不要手工把状态改成 COMMITTED。恢复失败对象始终受清理保护。

全部活动项目对象校验和重建成功后，关闭维护 API 模式，重新启动网关并受控检查从新指针加载内容。旧票据、旧连接/epoch 和 IndexedDB 队列不得进入新文档；前端清理旧 epoch 缓存，要求重新取得当前项目身份。最后按 Step11 发布程序恢复外部入口。

## 验证命令

```powershell
# 在仓库根目录执行；构建不读取/打印 .env。
$step10BuildPath = Join-Path (Get-Location).Path '.codex-build/step10-backend'
cd backend
mvn -o package "-Deditor.build.directory=$step10BuildPath"
cd ../collaboration
npm test
node scripts/verify-step10-local.mjs
# 可选真实浏览器预览隔离验证：使用已连接的 web-access CDP proxy。
node scripts/verify-step10-local.mjs --browser
```

验收脚本读取根 `.env`，使用本机三项服务；临时 Spring/编码/网关端口 18090/18096/18097，浏览器模式额外 Vite 15174。临时密钥仅在内存中，不改根配置。脚本验证 pending/失败重试、停写、对象备份、真实 epoch 重建、幂等、旧票据/旧 epoch 拒绝和网关重启；结束关闭自己的进程及验收标签页，保留验收项目与受限本地备份。
