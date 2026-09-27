# 步骤 01：现状与并发、存储护栏

> 前置：当前 V1 代码和已发布 Flyway V1/V2。状态：未开始。

## 目标

记录 V1 项目与对象存储现状，为身份切换和 Y.Doc 协作准备安全边界。V1 的版本历史仅是迁移前现状；V2 不继续提供该功能。

- 给 `project` 增加独立 `lock_version`（Flyway V3），元数据更新与软删除使用强 `If-Match` 和 409 `PROJECT_STATE_CONFLICT`。它是项目行并发锁，不是用户内容版本。
- 项目元数据更新只允许名称、描述、模板；入口文件以后以 Y.Doc 的 `entryFileId` 为准。
- 明确旧 `projects/` JSON/GZIP 对象由旧 revision 引用，新增 `collab/` Y.Doc 对象使用单独引用和清理器。旧清理器绝不扫描 `collab/`。
- 在 V2 切换前保留 V1 数据和旧 API 的现状行为；切换后关闭浏览器快照保存、revision 写入、历史列表与恢复入口。不得用旧快照覆盖 Y.Doc。
- 旧对象读取必须有界解压，不能无界分配内存。Sandpack 的运行派生文件不能回写编辑源。

## 数据与接口

V3 追加 `project.lock_version BIGINT NOT NULL DEFAULT 0`，不修改 V1/V2 迁移。项目详情与元数据操作返回 `stateVersion`/强 ETag；更新和删除要求单个强 `If-Match`。JPA `@Version` 与数据库锁共同防止并发覆盖。项目删除进入协作模式后还需步骤 09 的关房与 flush 协调。

`current_version`、`project_revision` 和 V1 快照对象暂时保留为旧数据；任何 V2 新项目不能依赖它们完成初始化或保存。服务端模板生成初始 Y.Doc 的工作在步骤 05 完成。

## 功能验收

确认项目元数据更新/删除的陈旧 ETag 返回 409、旧数据不受迁移破坏、`collab/` 不被旧清理器扫描、损坏或超限旧压缩对象安全失败。仅按需运行开发检查；运行应用时使用根 `.env` 的本机服务，不使用 Docker，不输出凭据。

交付步骤 02/03/05 的稳定边界：项目锁版本、固定 `project → collab_document` 锁顺序、旧对象与协作对象的隔离规则。
