# 步骤 06：协作网关、Opaque 票据与内部协议

> 前置：步骤 05 通过。协作开关默认关闭，仅隔离测试可开启。  
> 目标：Hocuspocus 网关完成实时房间、严格授权、Update 校验和 CAS 持久化。

## 1. V11 与票据

V11 创建 `collab_ticket`：id、唯一 token_hash、user/project/team、epoch、effective_role、capabilities_json、authz_version、issued/expires/used 时间；以及 `internal_request_nonce(audience,key_id,nonce_hash,expires_at)` 唯一键供多 API 实例共享防重放。定时任务删除已使用/过期票据和 nonce。

浏览器以 Session+CSRF 调用唯一端点 `POST /api/projects/{id}/collab-ticket`。Spring 实时授权后生成至少 256-bit opaque token；只返回一次，响应 no-store。TTL 60 秒，数据库仅存 SHA-256 摘要。原子消费使用条件 UPDATE：unused、未过期且摘要匹配；并发内省只能一个成功。VIEWER 为 readOnly，EDITOR/MANAGER 可写。

token 只经 Hocuspocus auth 消息传输，不进 URL、日志、LocalStorage/IndexedDB。Opaque 票据无客户端 claims、签名或 kid；内部请求认证密钥与票据完全独立。

## 2. 三层启用门禁与 Origin

`COLLABORATION_ENABLED` 默认 false，Spring 发票端点、网关握手和反向代理 /collab 三层都检查；任一关闭即 fail closed。步骤 06 受控测试只能用隔离 profile、独占数据库/Bucket和显式 true，生产在步骤 09 前不得开启。

网关在读取/消费 ticket **之前**校验 WebSocket Origin 精确 allowlist；缺失、`null`、大小写/端口不匹配均拒绝。仅在受控非浏览器测试 profile 允许显式无 Origin。只信任来自列明代理 IP 的转发头，并测试伪造边界。

## 3. 每次握手实时内省

网关调用 `POST /internal/collaboration/tickets/introspect`，body 为 token。Spring 原子消费后再读取当前用户 ACTIVE、authz_version、team/project membership、项目状态和 epoch；与票据快照任一不符即拒绝，Spring 不可达也拒绝。

成功仅返回 userId、displayName、avatarColor、projectId、teamId、epoch、effectiveRole、capabilities、readOnly、ticketId。房间名由该结果生成 `project:{id}:epoch:{epoch}`。客户端身份和 Awareness 用户字段均被覆盖。

## 4. 固定内部协议

网关 → Spring：

~~~http
POST /internal/collaboration/tickets/introspect
GET  /internal/collaboration/projects/{id}/describe
GET  /internal/collaboration/projects/{id}/bootstrap?epoch={expectedEpoch}
GET  /internal/collaboration/projects/{id}/state?epoch={epoch}&generation={generation}
PUT  /internal/collaboration/projects/{id}/state?expectedEpoch={e}&expectedGeneration={g}
Content-Type: application/octet-stream
Idempotency-Key: randomUUID（同一待提交批次重试时复用）
~~~

PUT body 是 raw Y.Doc binary，成功 JSON 返回 epoch/generation/objectKey/hash/size；幂等键相同且 payload hash 相同返回同一结果，不同 payload 为 409。超时：connect 2s、response 10s（大对象配置上限）；GET 可有限重试，PUT 只按幂等键重试。稳定错误沿用步骤05。

Spring → 网关的步骤09预留路由当前返回 404/feature-disabled：

~~~http
POST /internal/admin/projects/{id}/captures
PUT /internal/admin/projects/{id}/fence
POST /internal/admin/projects/{id}/fence/{token}/commit
DELETE /internal/admin/projects/{id}/fence/{token}
POST /internal/admin/control-events
~~~

两个方向使用独立密钥集合 `COLLAB_GATEWAY_TO_API_KEYS` 和 `COLLAB_API_TO_GATEWAY_KEYS`。每个请求签入 keyId、audience、method、规范化 path、排序并百分号编码的 query、content-type、Idempotency-Key（缺省为空）、body SHA-256、timestamp、nonce；TLS 上恒定时间校验，30 秒窗，nonce 插入 V11 共享表后才处理。支持 current/next 双钥，响应带 requestId。入口代理不暴露 internal 路径。

## 5. 房间加载

同房间只有一个 initialization promise。describe 后：generation0 调 bootstrap(expectedEpoch) 并构造规范 Y.Doc；否则精确 load epoch/generation。校验 schemaVersion、epoch、文件结构和总预算后才接入连接。generation0 首次持久化也 CAS。

## 6. Update 验证与广播

Viewer Update 在解析/应用前拒绝。Writer Update 先应用到当前权威状态的临时 clone，验证 schema、epoch、entry、文件数、路径唯一/长度、单文件与总字节预算；只有通过后才应用到权威 Y.Doc、记录 pending update，再广播。合法编码但破坏结构的 update 关闭发送连接且不污染房间。

Awareness clientId 绑定连接；只能改自己的 cursor/selection/activeFileId，断开只删除自己的状态。

配置给出默认值和硬上限：预认证5秒、单消息256KiB、单Update128KiB、文档5MiB、100文件、每文件1MiB、每房50连接、每实例500房、每连接每秒50 update；超过时限流/关闭。

## 7. 单房间持久化状态机

每房只有一个 persist promise，并维护 `dirtySequence`、`durableSequence`、`expectedGeneration` 和有界 pendingUpdates。1秒防抖、5秒最大延迟触发；flush 只有在 durableSequence≥调用时捕获的 dirtySequence 且 Spring 返回确定 generation/hash 才成功。

- 超时/5xx：指数退避+抖动有限重试，pending 不释放，房间进入 degraded/read-only；
- 响应丢失：先 describe 对账幂等键/hash，再决定成功或重试；
- generation冲突且 epoch相同：加载权威状态，在临时副本按序重放 pending updates、重新完整校验，再以新 generation 有限 CAS 重试；
- epoch冲突：冻结房间，保留 pending/诊断，不再广播，关闭连接并等待步骤09/人工处置；
- 长期失败：房间隔离且不释放内存状态，报警；达到全局安全内存上限后进程拒绝新房，而非丢弃 pending。

graceful shutdown 停新连接，等待每房最新 dirtySequence durable；失败退出非零并保持实例不被正常终止策略误判。突然进程崩溃仍可能丢失仅内存广播，步骤08客户端 Yjs 本地日志负责重发；本步骤不得主动丢失、冲突覆盖或释放未持久化更新。

## 8. 测试

Spring：V11、票据摘要/TTL/并发单消费/no-store、每握手数据库复核、三层 flag、两方向 HMAC（query篡改/audience/key轮换/共享nonce）、internal公网拒绝。

网关：Origin 在消费前拒绝；同房单加载；generation0；Viewer预应用拒绝；恶意结构 update 不广播；Awareness绑定；单飞 persist、响应丢失对账、5xx恢复、CAS重放、epoch冻结、长期故障与 shutdown durable 条件。

真实集成使用独占资源启动 Spring+gateway，两个WS客户端验证跨进程 reload、ticket重放、撤权后新握手失败。禁止 Docker和秘密日志。

## 9. 验收与后续

本步骤状态已重置为未开始。完成实现后，在此记录验收日期、测试结果、真实集成范围和已知限制；验收前不得视为完成。

先暗置内部API和网关，生产三层开关保持 false。验收要求每次握手实时授权、Origin严格、ticket单用、Viewer服务端只读、非法Update不污染、CAS冲突保留pending、内部协议双向密钥隔离。

步骤07接入浏览器 Y.Doc；步骤08提供崩溃后的客户端重发；步骤09启用反向控制、fence和正式生产开关。
