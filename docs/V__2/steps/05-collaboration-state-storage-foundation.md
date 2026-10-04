# 步骤 05：Y.Doc 初始文件与当前状态持久化

> 前置：步骤 01、03、04。状态：已实现并完成自动检查和本机功能验收（2026-10-04）。目标：新项目无需 revision 即有可恢复的权威文件状态。

## 实现记录

追加 V10 迁移，新增 `collab_document`、持久化幂等回执、对象租约/清理 guard、备份引用表；项目状态扩展为 INITIALIZING。`collaboration/` 提供共享 TypeScript Y.Doc schema/编码模块及仅监听 loopback 的 HMAC 初始化服务。Spring 实现模板初始化、不可见失败记录重试、当前指针复制、describe/load/persist，以及事务外 MinIO I/O 和 generation CAS。

团队 UI 接入创建、复制和初始化重试，所有有效成员同权；V2 项目响应不暴露旧 version、JSON files 或 MinIO 对象键。V1 snapshot/revision/restore 对协作项目关闭，删除仍等待 Step09。创建默认受 `COLLAB_CREATION_ENABLED=false` 控制，仅受控验收打开，公开入口留给 Step11。

自动检查：后端 36 个测试、前端 lint/43 个测试/生产构建、协作模块 4 个测试通过。故障测试覆盖对象上传失败和数据库提交失败不产生可见空项目；并发测试覆盖两个 persist 仅一个切换指针，幂等回执可跨后续保存重放；清理测试覆盖当前文档、上传租约、有效备份和恢复保护窗口。

本机功能验收使用根 `.env` 的 MySQL/MinIO/Redis，无 Docker。V10 已执行，真实创建与复制均生成哈希和大小匹配的 Y.Doc；CAS 竞争、幂等重试、epoch 拒绝、旧入口隔离通过，后端重启后恢复当前指针并解码二进制通过。临时后端与编码服务已停止，验收数据保留在本机。运行和内部协议见 [协作模块说明](../../../collaboration/README.md)。初始 nonce 缓存为单进程内存，Step06 将补全持久化 nonce 与双向协议；完整备份编排留给 Step10。

真实 MySQL 验收发现 JDBC Map 对 DATETIME 返回 LocalDateTime，与 H2 的 Timestamp 不同；对象 guard 已改为 ResultSet 显式读取时间并转换 Instant，修复后重新执行本机流程和后端测试。

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
