# 步骤 08：离线编辑、Presence 与结构操作

> 前置：步骤 07。状态：未开始。

## 离线状态

y-indexeddb 文档名为 `web-editor:{userId}:{projectId}:{epoch}`，只保存受限大小的 Yjs 本地更新和必要序号，不存 JWT、刷新凭据、票据或 MinIO 凭据。断线期间允许当前有效成员继续在本地编辑，文本与结构 transaction 都进入有界队列；达到容量上限时停止新增编辑并提示导出。

重连前重新申请协作票据，服务端复核当前成员关系、项目状态和 epoch。相同 epoch 时按序合并并等待当前 Y.Doc 指针持久化；旧 epoch 不得合入。401/403、退出团队或被移除时关闭房间，清理对应内存与 IndexedDB 队列；仅在服务端仍确认项目访问权时才允许主动导出本地包。项目删除后也不得将旧缓存写回。

## Presence 与文件结构

Awareness 只传 cursor、selection、activeFileId 与受限显示状态；网关按内省结果绑定 userId，离房清理临时状态，不写 MySQL、MinIO 或 Y.Doc。前端展示远端光标和在线成员；同一用户多标签页按 userId+connectionId 明确区分。

创建、重命名、逻辑删除、入口切换使用步骤 07 的原子 Yjs 结构命令。跨扩展名重命名更新 language 与 Monaco model；同路径冲突给出确定性路径及提示；远端删除与本地输入冲突提供恢复/复制当前内容的选择。所有有效团队成员同权操作，撤权用户不能继续编辑。

Sandpack 离线预览只读取本地 Y.Doc，明确标记“本地未同步”。界面分别显示连接同步和当前状态持久化进度，不出现 checkpoint 或历史版本状态。旧 V1 snapshot/revision/restore 接口对 V2 项目持续关闭。

## 功能验收

确认断网继续编辑、刷新/浏览器重启后的本地更新、重新授权后的重连合并、epoch 冲突隔离、撤权清理、Presence/远端光标、结构冲突提示和 Sandpack 本地预览。持久化成功后网关重启可加载最新项目文件。无需专用三服务集成环境或双浏览器自动化；使用根 `.env` 的本机服务，不使用 Docker。
