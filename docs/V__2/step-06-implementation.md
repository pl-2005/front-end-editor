# 步骤 06 实施与验收记录

## 已完成

- 新增 V11，保存协作单次票据摘要和内部请求 nonce；票据带用户、项目、团队、epoch、角色、能力和授权版本快照。
- 增加 `COLLABORATION_ENABLED`，默认关闭；票据签发在开关关闭或项目协作模式为 `DISABLED` 时 fail closed。
- 新增 Session/CSRF 保护的 `POST /api/projects/{id}/collab-ticket`。后端通过 `ProjectAccessService` 实时检查读取权限，生成 256-bit 随机 opaque token，仅返回一次并设置 `Cache-Control: no-store`；数据库只写 SHA-256 摘要，默认 60 秒过期。
- 新增服务端票据内省逻辑：事务内锁定并原子消费，之后重新检查 ACTIVE 用户、`authz_version`、团队/项目授权、角色、能力和 epoch；输出不包含票据 claims，VIEWER 标记只读。
- 增加票据与 nonce 定期清理任务；扩展 H2 测试 schema；`.env.example` 加入关闭状态和密钥环变量示例。
- 新增内部 describe/bootstrap/state GET/PUT 与 ticket introspect 路由；内部请求以独立 gateway-to-API HMAC key ring 校验，签名覆盖 audience、method、规范化 path/query、content-type、Idempotency-Key、body SHA-256、timestamp 和 nonce，最多接受 30 秒时钟偏差，并通过 V11 共享 nonce 表拒绝重放。
- 内部请求体限制 10 MiB、响应 `no-store` 并带 requestId；仅内部协作路由豁免 CSRF，路由自身仍须通过 HMAC。配置开关关闭时内部请求 fail closed。
- 新增独立 Node 22+/TypeScript Hocuspocus v4 网关包。WebSocket `/collab` 在 `onUpgrade` 阶段按完整 Origin allowlist 拒绝来源后，才会进入使用单次票据的 `onAuthenticate`；房间名和 ticket 中项目/epoch 必须一致。
- 增加 Nginx 入口配置样例：[collaboration-proxy.example.conf](./collaboration-proxy.example.conf)，feature flag 关闭时拒绝 `/collab`，只转发该 WebSocket 路径，并拒绝公网 `/internal/` 请求。
- 网关从 Spring generation 0 bootstrap 或精确 generation 读取 Y.Doc，首次初始化通过 generation CAS；Y.Doc schema、文件数、路径、单文件/总大小及入口在连接前校验。
- 通过 Hocuspocus `beforeHandleMessage` 解出实际 Yjs SyncStep2/Update payload，在应用/广播前应用到临时 clone 并完整校验；Viewer、非法 Update、超大消息和超速更新拒绝。Awareness 的 user 字段由服务端身份覆盖。
- 每房间持久化单飞，保留有界 pending updates，1 秒 debounce/5 秒 max delay；CAS generation 冲突时从权威状态重放 pending updates 并复验；epoch 冲突冻结房间，持久化故障降级只读且保留内存更新，shutdown 在 durable 前不正常退出。
- 新增 `collab_persist_idempotency` 账本，以 `(project_id, Idempotency-Key)` 唯一约束序列化提交；请求摘要、expected epoch/generation 和完整响应快照与文档 generation CAS 在同一 SQL 事务中提交。相同 key/请求重放原结果，相同 key 携带不同请求返回 409；网关同一待提交批次（包含超时重试和 CAS rebase）复用随机 UUID。
- 网关内部 API 客户端拆分 2 秒连接超时与 10 秒响应体超时；GET 对网络失败和 502/503/504 最多尝试 3 次，PUT 不在 HTTP 客户端盲目重试，由持久化循环用同一幂等键恢复。
- 完成反向 API→网关内部 listener（独立 `COLLAB_GATEWAY_INTERNAL_HOST/PORT`，只绑定 loopback、精确 loopback source allowlist）；校验独立 key ring、audience/keyId、规范化 query、content-type、Idempotency-Key、body hash、时间窗与恒时签名后，再调用 Spring 共享 nonce 接口登记重放键。步骤 09 路由在登记后仍 fail closed 返回 `FEATURE_DISABLED`。
- Viewer 在解析 Hocuspocus/Yjs 消息前拒绝 Update；Yjs Update 硬限 128 KiB，Awareness 按 socket 固定首个 clientId、删除伪造的其他 clientId、覆盖 user、仅透传约定字段且每状态不超过 4 KiB。
- 网关以默认 512 MiB、最高 2 GiB 的实例内存预算限制已加载 Y.Doc 编码大小与 pending update；Update 临时校验并发封顶 8 个；达到预算时拒绝打开新房/接收新 Update，durable 后释放计数。
- 新增 HMAC 双向 canonical/双钥轮换/篡改拒绝、反向请求先登记共享 nonce、Awareness 伪造/超限和恶意 Y.Doc 克隆隔离自动化用例；CAS rebase/epoch freeze 的持久化状态机也有 Node 测试。
- 新增真实 Hocuspocus WebSocket 验收：Origin 在票据内省前拒绝；两个 writer 共用一个房间并同步更新；非法 Y.Doc 更新与 Viewer 写入均不改变权威文档；进程重启后从持久化字节恢复。
- 修复只读握手：允许空的 Yjs SyncStep2 握手响应通过，任何携带结构或删除项的只读更新仍拒绝；网关空闲超时从 5 秒调至 30 秒，覆盖常见协作静默间隔。
- 对接真实 Spring bootstrap 快照时将单个前导 `/` 规范化为 Y.Doc 相对路径，并拒绝规范化后的路径冲突。
- 新增真实 MySQL/MinIO 集成断言：票据摘要存储、单次消费、`authz_version` 撤权复核；幂等结果原样回放、同键异请求返回 409；孤儿清理租约按数据库时钟判断。

## 验收结果（2026-09-24）

- 网关：`npm run typecheck`、`npm run build`、`npm test` 通过；12 个测试全部通过，包含真实 WebSocket 网关进程与重启场景。
- 联合 Spring + 网关：新增真实进程组验收，使用当前 Spring 集成服务、独立 HMAC 密钥与 Node 网关，验证两个 WebSocket 客户端加入房间、首代状态持久化、网关重启后连接并加载现存代、同票据第二次握手拒绝、`authz_version` 变化后新握手拒绝。
- 后端：本机 MySQL/MinIO 隔离集成脚本通过；Flyway 验证并运行到 V11；Surefire 174 项、Failsafe 27 项，失败/错误均为 0。测试使用 `.env` 指定的独立集成 schema 与临时 bucket，未使用 Docker。
- 网关 Node 测试共 12 项全部通过；包含 Origin 前置拒绝、双客户端 Yjs 更新同步、Viewer/恶意更新拒绝和独立网关重启后的文档恢复。
- 后端过滤器测试覆盖双钥签名、query 篡改及 source allowlist；真实集成用例覆盖票据消费和撤权、幂等持久化及对象清理。
- 未执行生产迁移、未更改 `.env`；生产协作开关保持关闭。

## 验收边界与后续约束

- 跨网关实例的房间广播/协调和全局内存预算未实现；本次验收边界为单网关实例，多实例部署不得启用协作流量。
- `.env` 中的开发 Flyway target 保持原样；集成只迁移隔离 schema 到 V11，没有对开发 schema 执行迁移，也没有使用 Docker。

步骤 06 单实例验收通过。按照开发方案，步骤 09 控制路由仍 fail closed；生产协作开关保持 false，直到步骤 09 协调链路完成并联合发布。
