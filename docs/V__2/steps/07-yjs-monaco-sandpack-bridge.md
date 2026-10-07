# 步骤 07：Yjs、Monaco 语言服务与 Sandpack 派生桥

> 文档定位：已完成步骤的设计与实施记录。阶段限制和测试数量按当时情况保留；最终行为见 [V2 交付索引](../README.md)、[开发指南](../development.md)和 [API](../api.md)。

> 前置：步骤 06 网关握手、同步和自动持久化可用。状态：已实现并完成自动检查及本机功能验收（2026-10-05）。

## 实现记录

V2 项目页按需加载 `frontend/src/editor/v2/ProjectWorkspace.tsx`，复用团队项目授权和内存 Bearer 会话。`CollaborationSession` 独立管理每个 user/project/epoch 的 Y.Doc、单次票据、Provider 和 WebSocket；每次重连重新签发票据，过期请求结果丢弃。Hocuspocus Provider 固定为 4.7.0，与网关一致。Step07 阶段断线只读；最终 Step08 已支持有效会话的有界离线编辑，401/403/404、身份或 epoch 不匹配、服务端撤权均停止写入。撤权销毁原文档并清除文件界面；项目切换与注销释放会话、模型和监听器。

`collaboration/src/document-rules.ts` 为浏览器和网关共享路径、扩展名、容量及冲突规则。浏览器按 fileId 读取文件，文件创建、跨扩展名重命名、逻辑删除和入口切换均使用原子 Yjs transaction；路径执行 NFKC 与分隔符规范化，并拒绝遍历、控制字符和不支持扩展名。入口切换界面只提供当前 vanilla 预览可运行的 HTML 入口；入口路径从 Y.Doc 推导，REST `entry` 仅保留创建时元数据，不能作为编辑器或复制文档的入口权威。未知 schema 或异常结构只读隔离，不初始化覆盖。

网关在临时 Y.Doc 完整校验后，按稳定 fileId 保留同名路径获胜者，对其他文件生成保留扩展名、避开已有路径的确定性后缀。归一化更新和客户端更新合并为一次接受、登记 pending、应用与广播；其他非法结构仍在广播前拒绝。初始化与持久化编码继续拒绝未归一化重复路径。前端显示归一化提示，活动文件身份与 Y.Text 不变。

Monaco 每个有效文件建立模型，URI 包含 userId/projectId/epoch/路径，项目相对导入可解析；重命名重建模型并删除旧诊断。y-monaco 0.1.6 固定版本，使用其绑定和 mutex，在本地输入 transaction 前检查只读状态与文本容量，超限输入恢复原模型，不发送污染更新。补全接受使用同一输入链路。本地文本 undo/redo 由 Y.UndoManager 管理，键盘和编辑器菜单统一覆盖，排除远端及结构命令；结构按钮操作不进入文本撤销栈。

文件类型注册表覆盖 HTML/CSS/JS/JSON/TXT/MD。HTML 使用 Monaco 补全及独立 scanner 诊断 worker，检查标签闭合、未知/重复属性，允许可省略闭合标签和自定义元素；CSS 使用原生语言 worker；JS 启用 DOM、JSDoc、checkJs 与项目内导入。诊断按内容版本和工作区任务代次防抖，依赖文件修改、增加、删除及重命名会重新诊断，迟到结果丢弃。超过 200 KiB 的文件改用同类基础高亮语言，停用昂贵补全和诊断，保留编辑、同步和持久化。会话关闭时清除模型、marker、定时器及项目语言 worker；Monaco 通用编辑 worker 由原生 ModelService 在最后一个模型释放时销毁，避免手动终止缓存后破坏再次打开。

Sandpack 仅消费 Y.Doc 投影，300 ms 防抖、最长 1 秒派生，运行时 UTF-8 与 Vite manifest 补丁不进入 Y.Doc。初始化完成时仅重新投影一次最新状态，修复 Sandpack 在构建期间跳过更新的问题；HTML 入口更新后延迟刷新预览，恢复错误 HTML 修复后可能停留的空白页。文件结构或入口变化重建预览环境，防止 Nodebox 残留已删除文件。Preview/Console 保留构建及运行错误；Node 环境控制台使用 Server/Client 切换查看对应日志。V2 不引用 V1 保存 hook、完整快照草稿或版本历史组件。

`persistence` 消息新增 acceptedHash/durableHash，用规范 schema 内容与 CRDT state vector 的 SHA-256 核对当前客户端状态；contentHash 继续表示存储对象二进制哈希。纯文本删除会改变确认指纹，客户端保留的 undo tombstone 与网关 GC 二进制差异不会误报不同步。仅在当前指纹匹配、status=durable 且 durableSequence 覆盖 dirtySequence 时显示“已持久化”；编辑立即使旧确认失效。generation 不用作项目元数据 If-Match。

验证：前端 56 项测试、lint、TypeScript/Vite 构建，协作模块 16 项测试与构建，后端 43 项测试及打包通过。新增覆盖原子文件命令、未知 schema、远端撤销隔离、新票据重连、迟到授权响应、初始持久化状态门禁和房间暂停/恢复、保存确认失效、HTML 诊断、同路径归一化与纯删除/GC 确认、预览初始化重放和关闭后取消任务。真实 Chrome 验收确认三种语言补全接受、HTML/CSS 诊断、JS checkJs/JSDoc 与跨文件导入、重命名/删除模型清理、undo/redo、大文件降级及超限拦截、错误 HTML 修复后预览恢复与控制台、MySQL/MinIO 当前文件、网关重启、新票据重连、再次打开后的模型/worker 生命周期及服务端撤权清理。启动脚本见 [协作模块说明](../../../collaboration/README.md#step07-本机浏览器验收)。

本机验收读取根 `.env`，使用本机 MySQL/MinIO/Redis，无 Docker，不修改根配置、不输出或落盘身份凭据；临时服务和验收标签页结束后关闭，验收账号及项目保留本机。Step07 当时仅准备 y-indexeddb 依赖；离线日志、持续离线编辑及完整 Presence 已由 Step08 实现，删除和 Outbox 主动撤权已由 Step09 实现。生产票据/网关/入口开关不因此开放。

## 唯一编辑源

前端引入 Yjs、y-monaco、Hocuspocus client、y-indexeddb、Monaco。ProjectWorkspace 依次获取项目授权和票据、连接房间、校验 Y.Doc schema、创建文件树/Monaco，再向 Sandpack 单向派生运行文件。旧 SandpackCodeEditor 与 `useProjectSave` 的 V1 完整快照上传退出 V2 主链路；不提供检查点 facade、revision 写入口或版本历史 UI。

Y.Doc schema：

```text
meta: Y.Map { schemaVersion, projectId, epoch, entryFileId }
files: Y.Map<fileId, Y.Map { id, path, language, deletedAt, content:Y.Text }>
fileOrder: Y.Array<fileId>
```

`fileId` 是稳定身份，路径不是。创建、重命名、逻辑删除与入口切换在 Yjs transaction 内完成；路径做 Unicode NFKC、分隔符与遍历检查。入口不可删除；同路径并发冲突按稳定 fileId 归一化并提示。无法识别的 schema 只读隔离，不能自动覆盖。

## Monaco 与可扩展语言能力

每个活动 fileId 绑定一个 Monaco model，虚拟 URI 含 userId/projectId/epoch/规范路径，以支持项目内相对导入；重命名重建 URI 并清除旧诊断。所有有效团队成员可编辑；撤权或房间暂停时停止输入。输入、接受补全、撤销/重做均写 Y.Text；语言服务只读取派生 model，不直接写 Y.Doc。

| 类型 | 补全与提示 | 静态检查 |
| --- | --- | --- |
| `.html` | 标签、属性、常用值、关闭标签 | 语法和标签/属性诊断 |
| `.css` | 选择器、属性、值与单位 | 语法、属性和值诊断 |
| `.js` | 关键字、项目符号、DOM API、相对导入、JSDoc | 语法与启用 checkJs 的静态类型诊断 |

HTML/CSS 不称作类型检查；Sandpack 构建/运行错误仍在 Preview/Console 显示。诊断按内容版本防抖；删除、重命名、项目/epoch 切换、注销或撤权时清理旧任务/model。大文件超出语言预算时保留基础编辑和高亮，提示诊断暂不可用，不阻断同步和持久化。

文件类型注册表统一映射扩展名、Monaco languageId、提供者、worker 配置和释放逻辑。`.json`、`.txt`、`.md` 可先提供基础编辑。新增类型必须同时更新前端注册表、后端/网关白名单、Sandpack 预览能力与验收项；不改变 fileId 或 Y.Doc 协议。

## 派生预览与状态

Y.Doc → 文件树、Monaco、Sandpack files 单向投影；Sandpack 运行时补丁不能反写。投影有界、防抖且可取消，旧结果丢弃。界面区分 connecting/syncing/online/offline/reconnecting/forbidden/failed，并独立显示 WebSocket 已同步与 Y.Doc generation 已持久化；不显示历史版本或检查点状态。

项目切换、注销、撤权和 epoch 变化时销毁 Provider、Y.Doc observers、Monaco binding/model、worker 与 Awareness listener。重连申请新票据，不复用旧授权。

## 功能验收

确认多文件同步、结构操作、undo/redo、Sandpack 预览和控制台正常；HTML/CSS/JS 补全与诊断、JS checkJs 类型错误和跨文件导入可用；旧诊断不残留；编辑后 generation 自动增长且网关重启可加载当前文件。确认没有 V1 完整快照上传、revision 创建或版本控制 UI。无需双浏览器自动化验收；运行应用使用根 `.env` 本机服务，不使用 Docker。
