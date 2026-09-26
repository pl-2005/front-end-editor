# 步骤 08 实施与验收记录（已通过）

实施与验收日期：2026-09-26

## 实施结果

- 使用 `y-indexeddb` 保存按用户、项目和 epoch 隔离的 Y.Doc；pending 更新按本地序号缓存，并设置 10 MiB、10,000 项和 7 天上限。重连后由 Yjs 同步，服务端 generation 确认后清理已同步队列。
- 授权编辑会话断网后保留本地文档并允许 EDITOR 继续编辑；恢复联网后重新取得票据并同步。刷新页面可从同一授权命名空间恢复已同步内容。Viewer 在线或离线均保持只读。
- 增加离线包导出、epoch 冲突隔离和旧缓存清理。会话授权版本失效后，后续 API 请求返回 401，浏览器清理协作 IndexedDB 并回到登录页；启动阶段尚未加载用户资料的 401 也会清理协作缓存。
- Presence 由 Awareness 承载，不写入 Y.Doc 或持久层。网关使用票据身份替换客户端身份，并限制 cursor/selection 的字段、大小和文档坐标。修复 Hocuspocus 空状态删除标记抢先占用 socket client ID 的问题；Monaco 远端光标在行尾也可见。
- 文件树支持 tombstone 恢复和冲突路径提示；协作期间旧快照、恢复与删除入口受后端写入栅栏保护。
- 入口文件切换继续受既有 `PROJECT_MANAGE` 门禁限制。将它放宽为 `PROJECT_EDIT` 的提议未获自动审批，本轮未扩大权限范围。

## 验收结果

- 前端 Vitest：13 个文件、60 项测试通过；TypeScript 检查和 Vite 生产构建通过。构建仍有大 chunk 提示。
- 浏览器 Playwright：1 条双浏览器端到端流程通过，覆盖协同编辑与远端撤销/重做、文件结构变化、在线用户与远端光标、EDITOR 离线编辑和重连、刷新恢复、Viewer 离线只读、epoch 变化后的离线包导出，以及授权版本撤销后的会话失效和 IndexedDB 清理。
- 协作网关：14 项测试通过，TypeScript 构建通过；包含 Awareness 身份过滤、空状态标记、文档坐标边界、双客户端同步与持久状态重启恢复。
- 后端 Surefire：174 项通过；Failsafe 集成测试：27 项通过（Baseline 10、IdentitySession 8、OwnershipMigration 6、TeamOwnership 3）。使用根 `.env` 配置的本机 MySQL 和 MinIO，IT 采用专用 schema 和临时 bucket，运行后清理完成。
- `.env` 中 `FLYWAY_TARGET` 为 8，而当前验收 schema 需要迁移到 11。仅在 Maven 验收进程中设置 `FLYWAY_TARGET=11`；未修改 `.env`。未使用 Docker。

## 验收边界

- 本轮没有做浏览器原生 IndexedDB 配额耗尽、HTTP 5xx/乱序丢包注入，也未做多标签页 Presence TTL 压测；缓存容量、序号确认、结构冲突和 tombstone 由单元测试覆盖。以上故障与容量演练应在步骤 10 的故障注入和运行监控验收中补足。
- 本轮撤权验收覆盖授权版本失效后的下一次请求/页面恢复路径。现有已连接 WebSocket 的主动关闭和降级由步骤 09 的 Outbox 契约接管；本步骤不宣称实现了撤权后即时关闭所有活跃连接。
- 协作生产白名单仍须保持关闭，直至步骤 09/10 的剩余控制面、撤权和运行演练完成。
