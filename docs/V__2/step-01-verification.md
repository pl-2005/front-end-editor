# 步骤 01 实施与验收记录

基线提交：`137109dbf3215c5ed3d3de8cbe09534c08bc67eb`。开始时存在用户的 README 修改、V1 文档目录迁移和 V2 方案文档；这些改动保留，未重置或提交。

## 已实现

- V3 增量增加 `lock_version`，V1/V2 迁移保持原样。
- 项目写入区分 `version` 与 `stateVersion`，单资源响应返回强 ETag；元数据和软删除要求强 If-Match。
- 元数据使用乐观锁；删除、快照、恢复持有项目行锁。后续协作固定锁顺序为 project → collab_document。
- 更新 DTO 不接受 entry 或未知字段；保存和恢复继续通过快照投影入口。
- GZIP 解压最多读取 10 MiB + 1 字节，存储对象解码后重新验证结构，失败统一返回 STORAGE_CORRUPT。
- 前端保存、恢复和重命名同步两个版本；响应乱序保持版本单调，重命名重新读取权威元数据。
- 派生 Sandpack 文件不修改输入对象；自动保存仍保留，等待步骤 07 替换事实源。

## 验证命令

前端：`npm run lint`、`npm run test`、`npm run build`。
后端快速测试：`mvn test`（H2）。
真实集成：仓库根执行 `./scripts/verify-integration.ps1`，加载根 `.env` 后执行 `mvn -Pintegration verify`。

集成测试必须使用空的专用本机 MySQL schema。存在任何表时拒绝清理/复用。测试仅清理本次在空 schema 创建的三张表；MinIO 每次创建独占随机 Bucket，只删除本次记录的对象和该 Bucket。任何未知对象会使 Bucket 删除失败并报告名称。不得将 IT_DB_URL 指向开发库。

真实测试覆盖 target 2 → V3 存量数据/版本/对象指针保留、两个事务重命名、元数据与快照两种提交顺序、删除与快照、恢复与元数据、MinIO 保护期/引用/协作前缀隔离；并发使用 barrier/latch，不用 sleep 猜测。

## 当前门禁

已有通过记录：前端 27 测试及 lint/build；后端 22 快速测试和 5 个真实 IT。损坏对象 HTTP 回归、延迟 PUT/GET 元数据乱序回归已通过。独立子 agent 最终复审通过，允许进入步骤 02。

独立审查曾发现恢复后的列表旧 ETag、响应乱序以及 IT 清理和覆盖缺口，均已修正；最终复审已通过。

## 保留约束与后续工作

当前快照 MinIO I/O 仍位于事务内，这是步骤 05 明确的重构项，不可沿用到 Y.Doc CAS 持久化。

本次接口变化要求前后端原子发布。未部署生产、未执行降级 Flyway、未启用协作。回滚必须停止写入并使用理解 V3 契约的兼容制品，不能单独关闭 If-Match 伪装兼容。

全部运行使用本机服务，无 Docker；未打印或提交根 `.env` 凭据。本文件不宣称 V2 身份或协作系统已完成。
