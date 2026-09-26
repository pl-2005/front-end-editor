# 步骤 05：协作状态与对象存储地基

> 前置：步骤 03/04 联合发布完成；所有非旧匿名活动项目已有有效 revision ≥ 1。
> 目标：建立协作文档描述、Y.Doc 二进制对象存储和 CAS 内部服务；协作功能仍关闭。

## 1. V10 数据模型

创建 `collab_document`：

- project_id 主键/FK；
- epoch BIGINT ≥1；
- generation BIGINT ≥0；
- object_key/hash/size/content_type（generation=0 时可空）；
- bootstrap_revision_version、last_checkpoint_version；
- last_checkpoint_generation；
- schema_version、updated_at、lock_version。

约束：generation 在当前 epoch 单调；generation=0 必须无对象且 bootstrap revision 非空；初始回填 collaboration_mode=DISABLED；步骤 06–08 仅在受控功能检查中将白名单项目切换为 PILOT，步骤 09 完成后生产项目才可切换为 ENABLED；generation>0 必须完整对象元数据；last_checkpoint_generation≤generation；对象键匹配项目/epoch/generation 命名空间。唯一键覆盖 project/epoch/generation 和 object_key。

仅为 `legacy_unowned=false` 的项目（包括活动、软删除但可恢复项目）按当前 revision 回填唯一行；软删除的团队项目也必须保持一项目一描述，以便恢复。旧匿名项目不生成 `collab_document`：

~~~text
epoch=1
generation=0
bootstrap_revision_version=current_version
last_checkpoint_version=current_version
last_checkpoint_generation=0
~~~

V10 前置 SQL/应用报告只验证非旧匿名项目的 team/creator/revision/object 指针，并核对旧匿名项目没有协作描述；不合规则失败，不猜测修复。新项目创建事务从本步骤起同时创建 revision1 和 collab_document。

## 2. MinIO 命名空间

版本对象继续位于 `projects/{projectId}/revisions/{version}-{hash}.json.gz`；协作对象仅位于 `collab/projects/{projectId}/epochs/{epoch}/{generation}-{hash}.yjs`，content-type 为 application/octet-stream。

浏览器/网关不持有 MinIO 凭据。Spring 内部服务执行上传、读取和校验。最大二进制大小、超时、流式哈希、禁止路径穿越与有界读取由配置固定。严禁现有 revision 清理器扫描 collab/。

新增 CollabOrphanCleaner（步骤05即启用）：只检查 collab_document 当前引用，并通过可扩展 `CollabObjectReferenceProvider` 聚合引用。对象上传先建立带 owner/expiry 的短期写入租约；只有超过“最大上传/CAS时长+安全窗口”、租约过期、连续两轮无引用的对象才删除，删除前最终重检。步骤 09 在启用 operation 写入前原子注册 operation 引用 provider；失败可重试且不影响 revision 清理器。

## 3. CAS 服务

`CollabStateService` 提供内部方法，尚不开放公网：

- describe(projectId)：返回 epoch/generation/bootstrap/current object；
- load(projectId, epoch, generation)：严格按描述读取并验证 hash/size；
- persist(projectId, expectedEpoch, expectedGeneration, bytes)：验证 Y.Doc 大小后计算 hash，目标 generation=expected+1；
- bootstrapSnapshot(projectId, expectedEpoch)：Spring 锁定/校验项目 ACTIVE、当前 epoch 相等且 generation=0，只能从 collab_document.bootstrap_revision_version 解析 revision并有界解压；调用方不能选择版本。

persist 顺序：上传不可变对象 → 数据库条件更新 `WHERE epoch=? AND generation=?` → 成功返回新描述。CAS 失败时对象成为候选孤儿，返回 409，不覆盖当前指针。相同目标 key/hash 重试幂等；相同 generation 不同 hash 视为完整性故障并报警。

数据库事务不能包住 MinIO；所有失败点、重试和孤儿补偿都有故障注入测试。稳定结果码：epoch 不同为 409 `COLLAB_EPOCH_CONFLICT`，generation CAS 失败为 409 `COLLAB_GENERATION_CONFLICT`，对象哈希/大小/缺失为 500 `COLLAB_STORAGE_CORRUPT`；同一目标 key/hash 已提交返回当前描述作为幂等成功。

## 4. 内部鉴权边界

预留 `/internal/collaboration/*`，默认不启用路由。步骤 06 使用独立高熵服务凭据、网络限制和请求大小限制启用；绝不接受浏览器 JWT 替代内部凭据。内部调用仍通过 ProjectAccessService 获取授权事实，不把网关传入角色当权威。

## 5. 读写一致性与项目生命周期

状态矩阵：

- feature flag=false 且 generation=0：V1 snapshot、restore、delete 保持可用；snapshot/restore 在更新项目 current_version 的同一数据库事务同步 `bootstrap_revision_version`、`last_checkpoint_version`，last_checkpoint_generation 保持0并递增描述 lock_version；delete 同事务改变项目状态，描述保留。
- `collaboration_mode=PILOT/ENABLED` 或 generation>0：旧浏览器 snapshot/restore/delete 统一返回 409 `COLLABORATIVE_PROJECT_REQUIRES_CHECKPOINT`，直到步骤09提供协调路径；不得静默覆盖 Y.Doc。
- 步骤 06–08 可在非生产功能检查中显式开启 feature flag，并仅对 PILOT 项目检查协作功能；生产 feature flag=true 仅在步骤 09 的 fence、Outbox 和撤权链路完成后允许，此时所有写入走协作协调。
- 普通 REST 元数据更新不改变 collab generation；
- 项目软删除不立即删除对象；清理器按保留策略处理；
- collab_document 不硬删除，项目删除状态与后续 fence 由步骤 09 协调；
- epoch/generation/current_version 各自语义不得混用。

## 6. 功能检查

确认约束、回填、CAS 成败、幂等对象、哈希/大小错误、路径校验和 generation0 行为符合设计。

功能验收覆盖：

- V9→V10 回填计数和唯一性，以及旧实例停写门禁；
- flag=false 连续 snapshot/restore 同步 generation0 基线，generation>0 旧入口返回固定409；
- 新项目 revision1+collab_document 同事务；
- 两个 persist 同 generation 仅一个提交；
- 上传成功/DB失败产生可清理孤儿，DB成功/对象损坏 readiness/读取失败；
- revision 与 collab 清理器互不越界，上传租约和删除前最终重检消除 CAS 窗口；
- 大对象、压缩炸弹和超时受限。

不要求独占 IT schema/Bucket 或本机 MySQL/MinIO 集成测试；运行应用时不打印 `.env` 凭据，不使用 Docker。

## 7. 发布与验收

维护窗口先停止 V9 旧写流量并等待在途请求结束，再执行 V10；只启动具备“revision1 + collab_document”同事务创建和 generation0 兼容推进逻辑的新实例，最后再次对账所有非旧匿名活动项目后开放流量。禁止 V9 实例与回填并发创建。回滚制品必须认识 V10并维持相同创建/同步不变量；不得删除 collab_document 或对象。任何非旧匿名项目缺描述、描述指向无效 revision、对象越界或 CAS 功能检查失败均阻止步骤 06。

验收：每个非旧匿名项目（含可恢复软删项目）恰有一条描述，旧匿名项目没有描述；generation0 语义统一；新项目同步创建描述；上传租约覆盖 upload→CAS 窗口且删除前二次确认；CAS 不丢更新；两个对象命名空间和清理器完全隔离。

## 8. 后续契约

步骤 06 可依赖 describe/load/persist/bootstrapSnapshot 和稳定错误码。步骤 09 在同一模型上增加 collab_operation/fence/outbox；步骤 10 增加巡检、修复和容量指标。






