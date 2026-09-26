# 步骤 07：Yjs 文件模型、Monaco 与 Sandpack 派生桥

> 前置：步骤 06 网关内省、加载、持久化和服务端 Update 校验通过。  
> 目标：Y.Doc 成为唯一编辑事实源，Monaco 负责文本编辑，Sandpack 只消费派生文件。

## 1. 依赖与切换范围

新增前端依赖：Yjs、y-monaco、Hocuspocus client、y-indexeddb、Monaco。固定版本并记录 bundle 预算。保留 SandpackPreview/Console，移除 SandpackCodeEditor 作为权威编辑器；步骤 08 才增加离线队列和完整 Presence。

ProjectWorkspace 初始化顺序：权限/票据 → WS 房间 → Y.Doc schema 校验 → 文件树/Monaco → 单向派生 Sandpack。连接失败显示只读或失败状态，不回退匿名 REST 写入。

## 2. Y.Doc Schema

~~~text
meta: Y.Map { schemaVersion, projectId, epoch, entryFileId }
files: Y.Map<fileId, Y.Map { id, path, language, deletedAt, content:Y.Text }>
fileOrder: Y.Array<fileId>
~~~

fileId 是稳定 UUID，路径不是身份。创建、重命名、逻辑删除、入口切换在一个 Yjs transaction 内完成。入口不可删除；删除写 tombstone。每次 transaction 后校验文件数、路径归一化、大小、entry 和 V1 白名单。

路径规则：Unicode NFKC、/ 分隔、禁止 .、..、反斜杠、NUL、绝对路径；同路径并发冲突使用稳定 fileId 归一化，胜者保留路径，其余生成带短 ID 的冲突路径并提示。不可识别 schemaVersion 只读隔离，不迁移覆盖。

## 3. Monaco

每个活动 fileId 一个 Monaco model，URI 使用 web-editor://project/{projectId}/file/{fileId}，销毁时释放 model。y-monaco 双向绑定只对当前 Y.Text 生效；切换文件先解绑旧 model，再绑定新 model，避免监听器重复。

VIEWER/无 PROJECT_EDIT 使用 Monaco readOnly，并在网关层拒绝 Update。输入、撤销/重做、composition、粘贴和大文本均走 Yjs transaction；禁止直接修改 Sandpack 文件对象。

文件树操作调用结构命令，不能通过路径字符串直接写 Y.Map。入口切换显示 PROJECT_MANAGE；结构操作要求 PROJECT_EDIT。

## 4. Sandpack 派生桥

订阅 Y.Doc transaction，在 React 外部 store 中做有界、可取消的投影：读取 active 非删除文件，按 fileId/path 生成 Sandpack files，校验 entry/白名单/总大小，再更新 SandpackProvider。派生桥单向 Y.Doc→Sandpack；运行时修改不得回写 Y.Doc。投影采用版本号和 debounce，旧投影完成后丢弃；预览错误不阻塞协作持久化。

## 5. 连接与状态 UI

显示 connecting/syncing/online/offline/reconnecting/forbidden/failed；区分 WebSocket 已同步、Y.Doc generation 已持久化和历史 checkpoint。重连重新申请 ticket。房间 userId/displayName/avatarColor/capabilities 来自网关内省，Awareness 只展示 cursor/selection/activeFileId；客户端不把角色放入 Y.Doc。

## 6. 迁移现有代码

- App.tsx/ProjectWorkspace 接入 CollabProvider；
- EditorWorkspace 替换 SandpackCodeEditor 为 Monaco；
- 文件树从 Y.Map/fileOrder 渲染；
- useProjectSave 改为只调用 checkpoint facade，不能每 1.5 秒上传完整快照；
- DEFAULT_FILES 仅异常占位展示，不写入权威文档；
- preview/console 保持接口，消费派生 files。

## 7. 测试

单元：schema 不变量、路径/冲突归一化、fileId、tombstone、entry、schema 版本隔离、Yjs transaction。

浏览器：两个 context 同房同步文本/重命名/文件树、undo/redo、VIEWER 只读、断线重连、投影 debounce 丢旧版本、Sandpack 错误不污染 Y.Doc、Monaco model 释放和 StrictMode 无重复绑定。

集成：网关 Update 校验、Y.Doc reload、generation 增长、旧 ticket 重连失败、对象命名空间、真实 MySQL/MinIO。独占 E2E schema/Bucket，不打印秘密，不用 Docker。

## 8. 发布与验收

以项目白名单 feature flag 试点，不打开全量协作；generation0 和新 Y.Doc 初始化均通过。回滚只能停协作并保留对象，不能让旧 Sandpack 保存链路覆盖 generation>0 文档。

验收：Y.Doc 是唯一事实源；Monaco 与文件树实时一致；Sandpack 只派生；Viewer 无写副作用；重连和 schema/大小错误安全失败；预览/控制台继续工作。

## 9. 后续契约

步骤 08 接管 y-indexeddb 离线更新、Presence 和结构命令冲突 UX。步骤 09 的 checkpoint/restore/delete 只通过协调 facade，不由编辑器直写 revision。
