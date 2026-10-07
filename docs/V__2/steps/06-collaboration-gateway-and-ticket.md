# 步骤 06：协作网关、票据与自动持久化

> 文档定位：已完成步骤的设计与实施记录。阶段限制和测试数量按当时情况保留；最终行为见 [V2 交付索引](../README.md)、[开发指南](../development.md)和 [API](../api.md)。

> 前置：步骤 05 的初始 Y.Doc 和 CAS API。状态：已实现并完成自动检查及本机功能验收（2026-10-04）。

## 实现记录

追加 V11：MySQL `collab_ticket` 保存 256-bit opaque 票据摘要和授权水位，`collab_hmac_nonce` 保存内部请求 nonce。Spring 实现 Bearer 票据签发、事务内条件更新单次消费、握手实时授权和独立 revalidate。旧 `/api/projects/**` 仍关闭，仅精确开放票据 POST 路由。握手内部响应拆为 identity 和 authorization；前者仅包含本文约定的身份字段，后者携带网关续租需要的 authzVersion，不含项目角色或能力列表。

`collaboration/` 接入 Hocuspocus 4.7，监听 loopback 的 `/collaboration`。Origin 在 HTTP upgrade 阶段检查，连接与房间有容量限制；网关和初始化服务使用接收端本机 SQLite nonce 表，Spring 使用 MySQL nonce 表，接收端重启不能清空有效 nonce。SQLite 仅保存 nonce/expiry，不保存项目源码、票据或凭据；运行目录须使用持久磁盘。双向请求分别使用 storage/gateway audience 和独立密钥，内部调用不允许重定向。

Update 校验使用 `beforeHandleMessage`：从 Sync/SyncReply 中提取 SyncStep2/Update，在临时 Y.Doc 校验后同步登记 pending，再应用真实文档并广播；Hocuspocus 后续重复应用同一更新由 Yjs 幂等处理。禁止依赖广播后的 onChange 校验。未解析依赖的 Update 拒绝，避免隐藏结构在后续更新中生效。Awareness 绑定连接首次提交的 clientId，服务端覆盖身份，丢弃其他客户端状态和协议临时 Awareness 的合成状态；校验光标/选择区相对位置与活动文件，不持久化 Presence。

每连接使用单调时钟维护最长 5 秒租约，提前 1.5 秒复核；复核失败、超时或旧结果迟到都停止写入。Room 独立维护 dirty/durable 序号、当前 generation、有界 pending、唯一 persist promise 和不可变请求快照。1 秒防抖、最长 5 秒保存；失败暂停写入并退避重试，响应丢失复用同一幂等键/正文，CAS 冲突重载权威状态并重放 pending，epoch 冲突冻结关连接。未持久化房间阻止 Hocuspocus unload；正常停机失败时保留进程和队列并重试。

复制及复制初始化重试均先调用网关 flush，确认目标序号 durable 后才加载源文件。首次 flush 失败不预留副本；describe/load 期间 generation 推进时有界重读，epoch 改变则拒绝。票据已开启而 Spring 网关协调关闭时复制 fail closed，不退回直接读取旧指针。内部 Java HTTP 客户端固定 HTTP/1.1，避免 h2c Upgrade 被当作 WebSocket 握手。

验证：后端 43 个测试、协作模块 14 个测试及 TypeScript 编译通过。覆盖票据并发单用、过期/跨项目/旧 epoch/撤权、内部 nonce 重放、复制 flush 失败不创建项目、真实 Hocuspocus Provider 同步、Origin 提前拒绝、Awareness 身份覆盖/防冒用、恶意 Update 隔离、授权续租失败、保存期间新增编辑、响应丢失幂等重试、CAS 合并、故障 pending 保留和最长保存延迟。

本机功能验收使用根 `.env` 的 MySQL/MinIO/Redis，无 Docker。V11 已执行，真实票据连接、自动保存、复制 flush、末位离房 flush、网关重启恢复通过；临时服务停止，验收账号、团队及项目数据保留本机。启动与验收脚本见 [协作模块说明](../../../collaboration/README.md)。生产票据/网关开关仍默认关闭；正式编辑器、离线日志与删除/Outbox 主动撤权分别留给 Step07、08、09。

文档与交付核对（2026-10-05）：更新根 README、V2 迁移主线和 Step05 衔接记录；Step07 可以依赖已完成的握手、同步和持久化协议继续开发。连接建立时发送 ready 身份和当前 persistence 状态；失败后成功保存的空房间可安全卸载，未持久化房间仍保留。Hocuspocus server/provider 固定为 4.7.0，协议升级需重新检查广播前校验路径。

## 短期票据与握手

追加 `collab_ticket`（token 摘要、user/project/team、epoch、authz_version、签发/过期/消费时间）和内部 HMAC nonce 表。浏览器用 JWT Bearer 调用 `POST /api/projects/{id}/collab-ticket`；Spring 复核有效团队成员和项目状态，签发约 60 秒有效、单次消费的 256-bit opaque 票据。票据只通过 WebSocket 认证消息发送，不进入 URL、日志、LocalStorage 或 IndexedDB。

网关先按精确 allowlist 校验 Origin，再调用 Spring 内省。Spring 原子消费摘要，重新检查用户、`authz_version`、团队成员关系、项目状态与 epoch。Spring 不可达时拒绝。成功仅返回 userId、displayName、avatarColor、projectId、teamId、epoch、ticketId；所有有效成员均可编辑，不携带项目角色或能力列表。内部 API 使用与票据分离的双向 HMAC 密钥、timestamp、nonce 和 audience；内部路由不暴露公网。

## 房间与 Update

房间名 `project:{id}:epoch:{epoch}`；同房间只有一个初始化任务。网关复用步骤 05 的 Y.Doc schema/编码模块，从当前对象指针加载并校验 Y.Doc 后才允许连接。Awareness 只允许本人 cursor、selection、activeFileId 等受限字段，身份由内省结果覆盖；不持久化 Presence。

每个连接的写入授权租约最长 5 秒；到期前网关向 Spring 复核当前成员关系和 `authz_version`，复核失败或 Spring 不可达时停止该连接写入。每个 Update 只在未过期租约内处理：先在当前权威 Y.Doc 的临时副本应用，校验 schema、epoch、入口、路径、扩展名、文件数、单文件/总字节限制；通过后才应用到房间、记录 pending 并广播。撤权事件、fence、持久化故障或无效结构时也立即拒写。限制消息大小、Update 速率、房间连接数和总内存。

## 自动持久化

每房只运行一个 persist promise，维护 `dirtySequence`、`durableSequence`、`expectedGeneration` 和有界 pending Update。1 秒防抖、最长 5 秒触发 flush；最后成员离房和正常停机也 flush。只有 Spring 返回确定 generation/hash 且 durableSequence 覆盖目标序号，界面才显示“已持久化”。这些 flush 仅更新当前 Y.Doc 指针，**不创建检查点或历史版本**。

超时/5xx 保留 pending、暂停写入并退避重试；响应丢失按幂等键/hash 对账。相同 epoch 的 CAS 冲突加载权威状态、按序重放 pending 并重新校验后重试；epoch 冲突冻结旧房并关闭连接。长期失败不释放未持久化状态；内存上限触发时拒绝新房。突然进程崩溃后依赖客户端离线日志重发仅在内存广播的更新。

## 内部接口与启用

网关调用 `describe/load/persist`，并通过受 HMAC 保护的 `POST /internal/collaboration/connections/revalidate` 传入 userId、projectId、epoch、authzVersion，获取当前成员授权结果；该接口不消费协作票据。Spring 可调用网关的受 HMAC 保护 `POST /internal/collaboration/projects/{id}/flush`，取得本次调用捕获序号对应的 durable generation，供项目复制读取当前文件；如果 flush 失败，复制不创建项目。步骤 09 增加删除 fence 和控制事件 ACK；无 checkpoint/capture/restore 接口。步骤 06–08 只对受控项目进行功能检查，步骤 09 完成删除与撤权链路后，步骤 11 才公开启用协作。三层开关（Spring 票据、网关握手、反向代理入口）任一关闭即拒绝。

功能验收确认 Origin 在票据消费前拒绝、票据单用和握手实时授权、恶意 Update 不污染房间、自动持久化后网关重启可恢复、CAS 冲突不覆盖、故障保留 pending、离房 flush 不生成 revision。运行应用使用根 `.env` 的本机服务，不使用 Docker，不输出秘密。
