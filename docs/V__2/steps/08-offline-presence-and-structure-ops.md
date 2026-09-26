# 步骤 08：离线更新、Presence 与结构操作

> 前置：步骤 07 Y.Doc/Monaco/Sandpack 桥通过。  
> 目标：在不改变授权和服务端事实源的前提下，提供可恢复的离线编辑、Presence 与结构命令体验。

## 1. 本地缓存命名空间

使用 y-indexeddb，文档名固定为 `web-editor:{userId}:{projectId}:{epoch}`。IndexedDB 记录包含 schemaVersion、lastServerGeneration、pending update sequence、更新时间和受限大小；不存访问 JWT、刷新凭据、ticket 或 MinIO 凭据。

用户登出、账号切换、项目撤权时立即关闭房间、停止 provider，清除当前内存 Y.Doc/Monaco/Sandpack 和对应 IndexedDB doc、pending queue；不得读取其他 userId 记录。旧 V1 draft 只能显式导入，导入前重新通过服务端 PROJECT_EDIT 和大小校验。

## 2. 离线状态机

状态：online/syncing/offline/reconnecting/forbidden/failed。断线期间：

- Yjs 本地 transaction 可继续编辑，pending update 有上限和序号；
- 文件结构命令与文本更新统一进入本地队列；
- 达到磁盘/字节/时间上限时停止写入并提示导出；
- 只读用户离线仍不可编辑；
- 关闭标签页前尽力 flush，浏览器重启依赖 y-indexeddb；
- 重新联网先申请新 ticket、校验 epoch/authz，再按序发送 pending。

服务端拒绝 401/403/409 时不自动覆盖本地内容：401/403 关闭房间并清除内存/cache/queue，只有重新内省仍具 PROJECT_READ 时才允许用户主动导出本地包；无读权限不得导出。epoch 冲突也先清除在线房间，授权仍有效时才保存导出包并等待步骤 09 处理。成功响应更新 durable generation 和序号；服务端幂等键为 project/epoch/clientId/sequence。

## 3. Presence

Awareness 只发送短暂 cursor、selection、activeFileId、displayName、avatarColor 和受限状态；服务端以内省 userId 覆盖身份。Presence 有 TTL/心跳和断开清理，不写 MySQL、revision 或 Y.Doc。

渲染按 userId+connectionId 去重；同一用户多标签页分别显示或合并为明确规则。文本选择范围经过文件长度/行列预算校验，禁止携带源码大块、token 或任意 JSON。

## 4. 结构操作 UX

创建、重命名、逻辑删除、入口切换均调用 07 的单 transaction 命令。UI 提供：

- 同路径冲突提示和确定性冲突路径；
- tombstone 恢复/永久清理须具备 PROJECT_EDIT；
- 入口删除、非法路径、超限和 schema 错误明确阻止；
- 远端 tombstone 与本地编辑冲突显示恢复/复制选项，不静默丢内容；
- VIEWER 看到结构变化但无操作控件。

离线结构操作失败时保留原 transaction 和可导出变更记录，不直接修改路径字符串重试。

## 5. 与 Sandpack 和保存链路

离线期间 Sandpack 只运行本地 Y.Doc 派生文件，预览结果标记为本地未同步。服务端旧写入硬门覆盖 `collaboration_mode=PILOT/ENABLED`（即使 generation=0）或 generation>0：PUT /api/projects/{id}/snapshot、旧 revision 写入口和旧恢复入口统一返回 409 `COLLABORATIVE_PROJECT_REQUIRES_CHECKPOINT`；只有 mode=DISABLED 且 generation=0 才允许 V1 链路。客户端旧 useProjectSave 不得上传完整快照；checkpoint facade 仅在步骤 09 支持 durable flush 后调用，否则显式 unavailable。

重连成功后先完成服务端同步和结构不变量校验，再恢复预览“已同步”标志。generation durable、WebSocket synced、checkpoint created 三个状态分别展示。

## 6. 测试

单元：队列上限、序号/幂等、命名空间、epoch 绑定、结构冲突、tombstone、Presence TTL/去重/过滤。

浏览器双 context：在线编辑、断网继续编辑、刷新/浏览器重启恢复、按序重连、撤权变只读、epoch 冲突导出、同路径并发、VIEWER 离线拒写、Presence 多标签页。

故障注入：重复/乱序/丢失 update、服务端 409/5xx、IndexedDB 满、过期 ticket、schema 超限；不允许丢失可导出的 pending。

## 7. 发布与验收

步骤 08 仅在非生产功能检查中对白名单项目使用 `collaboration_mode=PILOT` 和显式网关开关；生产协作开关保持关闭，不把项目切换为 `ENABLED`。步骤 09 的 fence、Outbox 与撤权链路通过后，才按受控发布流程开启生产协作；网关开关是部署配置，不能与数据库项目状态声称处于同一事务。功能检查确认撤权/登出时内存和 IndexedDB 清理；监控本地队列大小、重连耗时、导出次数、Presence 连接和失败原因。回滚关闭协作入口但保留缓存，禁止旧 REST 快照覆盖 generation>0。

验收：用户/项目/epoch 缓存隔离；离线内容可恢复或导出；重连不会绕过 ACL/epoch；Presence 不进入持久化；结构冲突可解释处理；VIEWER 和撤权用户无写副作用。

## 8. 后续契约

步骤 09 接管 durable checkpoint、restore/delete、epoch 切换、fence 和撤权关闭房间。步骤 10 增加容量、离线队列和异常告警。


