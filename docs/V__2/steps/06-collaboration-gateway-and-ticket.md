# 步骤 06：协作网关、票据与自动持久化

> 前置：步骤 05 的初始 Y.Doc 和 CAS API。状态：未开始。

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
