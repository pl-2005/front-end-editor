# 步骤 05：Y.Doc 初始文件与当前状态持久化

> 前置：步骤 01、03、04。状态：未开始。目标：新项目无需 revision 即有可恢复的权威文件状态。

## 数据模型

追加 Flyway 迁移创建 `collab_document`，每个 V2 团队项目恰有一行：`project_id`、`collaboration_mode`、`epoch`、`generation`、`object_key`、`content_hash`、`size`、`content_type`、`lock_version` 和时间戳。新项目初始 `epoch=1, generation=1`，对象元数据必须完整。generation 仅表示当前 Y.Doc 指针的 CAS 代次，不供用户浏览。旧匿名项目及其 revision 不创建协作描述，也不回填或认领。

新项目创建先在短数据库事务中保留项目 ID，状态为不可见的 `INITIALIZING`；新迁移将现有 `project.status` 明确约束为 `0=DELETED、1=ACTIVE、2=INITIALIZING`，所有旧/新列表与详情只展示 ACTIVE。服务端模板服务生成规范文件集合，步骤 05 建立共享的 TypeScript Y.Doc 编码模块并由受信内部初始化服务生成和校验初始二进制；Spring 只校验字节上限、哈希及请求元数据后上传 MinIO，不在 Java 中解码 Y.Doc。第二个短事务建立 `collab_document` 并将项目置 ACTIVE。任一步失败则保留不可见初始化记录供重试或补偿，不向用户返回空项目；清理器只在保护窗口和引用复核后删除孤儿对象。项目复制也使用同一初始化流程；步骤 05 只能复制当前持久化指针，房间上线后的复制须先由网关 flush 最新编辑再读取当前指针，不能从旧 revision 复制。浏览器 `DEFAULT_FILES` 仅可作为错误占位，不是持久化来源。

初始化服务只允许 Spring 通过内部 HMAC 身份调用，不暴露浏览器或公网；步骤 06 网关复用同一编码模块并完善双向内部协议。初始化服务不能执行用户代码或持有 MinIO 凭据。

## 对象与 CAS

对象仅位于 `collab/projects/{projectId}/epochs/{epoch}/{generation}-{hash}.yjs`，content-type 为 `application/octet-stream`。旧 `projects/` 快照对象保留但不作为 V2 写路径。Spring 内部服务实现：

- `describe(projectId)`：返回当前 epoch、generation、对象键、哈希和大小；
- `load(projectId, epoch, generation)`：只读当前指针并验证 hash/size；
- `persist(projectId, expectedEpoch, expectedGeneration, bytes)`：Spring 有界读取并计算哈希/大小，Y.Doc 结构已由网关的共享 TypeScript 模块验证；先上传不可变对象，再条件更新 `WHERE epoch=? AND generation=?`，成功后 generation 加一。

同一幂等键和相同内容重试返回同一结果；CAS 冲突返回 `COLLAB_GENERATION_CONFLICT`，旧 epoch 返回 `COLLAB_EPOCH_CONFLICT`，对象损坏返回脱敏的 `COLLAB_STORAGE_CORRUPT`。不能让数据库事务包住 MinIO 网络 I/O，也不能在 CAS 失败时覆盖当前对象指针。

`CollabOrphanCleaner` 只扫描 `collab/`，尊重当前指针、上传/操作租约和有效备份清单；超过备份恢复窗口且双重确认无引用后才删除。备份必须同时保留 MySQL 指针与其指向的 Y.Doc 对象。V1 清理器只扫描 `projects/`，不得碰协作对象。存储上限、路径、schema 和文件大小与网关一致。

## 旧写入口

V2 新项目不写 `project_revision` 或 JSON/GZIP 快照；现有 `project.current_version` 保持数据库默认 0，`current_object_key` 保持 NULL，只为兼容旧表结构，V2 API 不返回或依赖它们。V1 浏览器 snapshot 保存、revision 列表/创建和历史恢复接口对 V2 项目固定关闭；旧匿名项目仍隔离。项目元数据使用独立 `lock_version`。软删除在网关启用后必须经步骤 09 flush/fence；在协调链路完成前，协作项目删除入口保持关闭。

## 功能验收

确认新项目创建后有可加载、哈希匹配的 generation 1 Y.Doc；对象或数据库失败不留下可见空项目；两个并发 persist 只有一个切换当前指针；旧 epoch 不能覆盖当前状态；清理器不碰当前指针或在途对象；V1 revision 不参与新项目初始化。运行应用时使用根 `.env` 的本机 MySQL/MinIO/Redis，不使用 Docker，也不输出凭据。
