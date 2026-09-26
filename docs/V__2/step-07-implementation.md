# 步骤 07 实施与验收记录（已完成）

验收日期：2026-09-24

## 实现结果

- 锁定前端依赖：Yjs 13.6.27、y-monaco 0.1.6、Hocuspocus Provider 4.0.0、Monaco Editor 0.52.2；同时安装 y-indexeddb 9.0.12，但本步骤不启用离线缓存。
- 协作票据响应带 epoch；项目页以 `project:{projectId}:epoch:{epoch}` 连接房间，网络恢复后重新连接并重新申请一次性票据。epoch 变化会锁定旧文档并要求重新加载。
- 增加受 PROJECT_READ 和协作开关保护的 `GET /api/projects/{id}/collab-status`。界面分别显示 WebSocket 同步状态、Y.Doc 持久化 generation 和最近历史检查点 generation/version。
- Y.Doc 文件 schema 校验覆盖项目/epoch、稳定 fileId、路径、入口、tombstone、扩展名白名单、文件数和大小；同名并发创建按 fileId 字典序稳定选出原路径保留者，其余路径增加稳定冲突后缀。前端在网关观察到本地更新前归一化，并有双副本并发收敛单测。
- Monaco 对活动 fileId 使用稳定 `web-editor://project/{projectId}/file/{fileId}` URI，通过 y-monaco 双向绑定；模型切换时销毁 binding/model，Y.UndoManager 提供协作撤销/重做。项目页实际在 React StrictMode 下运行。
- 文件树创建、重命名、逻辑删除和入口切换分别用一个 Yjs transaction；修正展示路径 `/foo.js` 与文档相对路径 `foo.js` 在文件选择、重命名、删除和入口切换处的映射。
- 移除 SandpackCodeEditor 和旧自动快照链路。Sandpack 只消费 Y.Doc 的 80 ms 有界防抖投影；初始自动运行关闭，收到同步文档后才投影/运行。运行时文件补丁和预览错误没有写回 Y.Doc 的通路。派生文件不修改源文件有单测。
- 项目连接失败保持只读；不使用旧 IndexedDB 草稿或 DEFAULT_FILES 初始化权威文档；恢复历史版本入口在步骤 09 fence/epoch 协调就绪前保持关闭。
- Vite 读取仓库根 `.env` 并代理 `/api` 与 `/collab`。隔离 E2E runner 启动本机 Spring、Vite 和 Node 网关，生成临时 HMAC key，在独立 MySQL schema 和 MinIO bucket 中迁移至 V11；只把测试项目切到 PILOT，结束后删除隔离资源。

## 验收结果

- 浏览器 E2E：1 项通过。两个独立浏览器完成协作文本同步、generation 持久化、Undo/Redo、文件创建/重命名/tombstone 删除、文件树同步、Monaco fileId 模型切换、浏览器 StrictMode 生命周期、断网/恢复/重签票据，以及 Viewer 只读界面验收。
- 网关：12 项 Node 测试通过，覆盖 Viewer/非法更新拒绝、原始文档不受非法 Update 影响、真实双 WebSocket 同步和服务重启加载。
- 后端：`mvn -q test` 的 Surefire 174 项通过，失败/错误/跳过均为 0；本步骤隔离 E2E 同时真实启动 Spring + Node 网关并使用本机 MySQL/MinIO。
- 前端：`npm test -- --run` 的 12 个测试文件、54 项通过；`npm run lint` 无错误，有 1 条 `authProvider.tsx` Fast Refresh warning；`npm run build` 通过。
- 构建预算决策：Monaco 保持项目页延迟加载。应用入口 324.39 KB（gzip 101.08 KB），workspace 764.33 KB（gzip 251.83 KB），Monaco editor API 2,256.84 KB（gzip 577.38 KB），TypeScript worker 5,925.09 KB 原始体积且按需加载。接受 Monaco 延迟加载核心 chunk 不超过 600 KB gzip，应用入口不超过 105 KB gzip；当前满足预算。Vite 仍会对超过默认 500 KB 的 Monaco chunk 发出提示。
- 全程使用本机已安装服务和专用临时 E2E 资源，没有使用 Docker；根 `.env` 未修改，生产协作开关仍为关闭。

## 步骤门禁

步骤 07 验收通过，可以开始步骤 08「离线更新、Presence 与结构操作」。跨网关实例协调、离线缓存、完整 Presence、检查点/恢复仍按后续步骤交付；当前仍禁止生产协作流量。
