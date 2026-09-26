# 步骤 09 实施记录

状态：步骤 09 单网关本地完整验收通过（2026-09-26）

## 已落地

- 新增 V12：`collab_operation` 保存幂等操作、PREPARED/COMMITTED/ABORTED、fence token 哈希及恢复租约；活动操作按项目唯一。
- 新增 `collab_control_event` 与聚合序号表，支持按聚合严格递增的 Outbox 事件序号。
- 新增事务内 Outbox 写入服务；团队/项目成员移除、角色降级和用户从 ACTIVE 禁用时，在业务事务中追加对应撤权事件。
- 旧快照保存/恢复和项目删除在协作项目上继续返回 409，避免绕过协作操作流程。
- 网关管理端点接入首批 capture/fence/finalize/abort 处理：capture 在文档锁边界 flush 并投影未删除文件；fence 在序列化消息边界冻结、flush 后返回 durable generation 和 ACK；finalize 关闭旧房间，abort 仅在授权后解冻。
- 持久化层增加 fence 屏障：已排队的更新在取得文档锁后重新检查冻结状态，避免先检查、后排队造成 fence 穿透。
- 增加 Spring→网关独立 HMAC 管理客户端及 Outbox 定时投递器；按聚合顺序至少一次发送，成功后标记 published，失败保留并增加 attempts/error code。
- 网关接收撤权事件并关闭匹配用户的项目房间连接；按聚合序号处理重复事件和乱序缺口。此序号游标目前驻留内存，网关重启后依赖 Outbox 的未确认事件重投。
- 增加权威协作检查点 API：Spring 请求网关 capture，重新校验规范文件、入口、白名单与大小，按内容 hash 创建 revision，并单调推进 `last_checkpoint_generation`；相同内容不产生多余 revision。
- 历史恢复与软删除接入 PREPARED→fence durable ACK→数据库提交→Outbox/finalize。恢复生成新单调 revision 与 epoch，旧 epoch 指针归零；删除保留 revision 和协作文档元数据。
- 增加过期 PREPARED 操作恢复器：确认项目版本和 source epoch 仍匹配后，先重新取得 fence，再安全 ABORT；遇到未知状态或网关不可达时保留 fence/操作待恢复。
- 前端加入在线手动检查点按钮，恢复/删除请求携带确定性幂等键。
- capture 在持有 Y.Doc 串行锁时确认快照 generation 已 durable；若 flush 与 capture 之间有新编辑，则再次 flush，避免快照内容领先于返回的 generation。
- PREPARED 的 RESTORE/DELETE 操作期间，Spring 拒绝新协作票据并在握手复核时再次拒绝；网关 fence 会等待已开始的票据握手结束，再关闭所有已接入连接。

## 完整验收结果（2026-09-26）

- `scripts/verify-integration.ps1`：网关 typecheck/build 与 14 项 Node 测试通过；Maven Surefire 174 项、真实本机 MySQL/MinIO Failsafe 27 项通过，Flyway 验证并执行至 V12。
- `frontend`：lint 0 error（保留 2 条既有 warning），Vitest 13 个文件/60 项通过，生产构建通过。
- `frontend npm run test:e2e`：双浏览器真实服务流程通过。验收覆盖协作项目旧 snapshot 写入口返回 409、检查点幂等重放、相同 hash 恢复仍生成新 revision/epoch、恢复 API 成功提交但客户端响应丢失后的幂等对账、fence 已生效但 ACK 丢失后的 fail-closed/PREPARED 恢复、恢复事务失败后的 revision 对象补偿清理、软删除事务失败后的安全恢复、DELETE 成功后有权限重放及失权后 404、历史 revision 保留、Outbox 顺序/失败重试/重复事件幂等，以及撤权最终关闭旧 WebSocket。E2E 使用随机独立 schema/Bucket 并自动清理。
- 首轮集成脚本暴露 V12 新增表未纳入四个 IT 套件清理列表；已按外键顺序补齐，随后完整 Failsafe 再跑全绿。集成运行只使用专用 `web_editor_it` schema 与随机 E2E bucket，未使用 Docker，也未修改开发数据库。

## 验收边界

- 本次完整验收范围是单网关实例与本机隔离 MySQL/MinIO。网关的 Outbox 聚合序号消费位点驻留进程内存；多网关协调及跨实例持久化游标仍属于后续扩展，部署多个网关前必须补齐并单独验收。
- 验收通过不等于生产发布。生产 `COLLABORATION_ENABLED` 保持关闭；正式启用仍需按白名单项目执行文档规定的发布演练并确认运行指标。
- 所有测试均从仓库根 `.env` 读取配置；没有打印或提交 `.env` 凭据，没有使用 Docker。
