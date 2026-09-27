# 步骤 07：Yjs、Monaco 语言服务与 Sandpack 派生桥

> 前置：步骤 06 网关握手、同步和自动持久化可用。状态：未开始。

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
