# 步骤 01：基线冻结与并发、存储护栏

> 前置：V1 当前代码与 `docs/V__1`  
> 后续依赖：步骤 02、03、05  
> 目标状态：在引入身份和协作之前，消除现有项目写入竞态，固定 V1 兼容契约，并为新的对象命名空间预留安全边界。

## 1. 目标

本步骤完成以下基础整改：

1. 记录一份可重复验证的 V1 行为基线；
2. 为 `project` 增加独立 JPA 乐观锁版本；
3. 统一项目元数据更新、软删除、快照保存和恢复的并发语义；
4. 将内容版本与元数据锁版本明确分离；
5. 固定版本快照与未来协作状态的对象命名空间；
6. 给快照解压、对象扫描和运行时派生文件补充安全回归测试；
7. 保持 V1 功能可用，为步骤 02 提供稳定接口。

## 2. 非目标

- 不增加用户、Session、团队或权限表；
- 不创建 `collab_document` 或 Hocuspocus 服务；
- 不引入 Yjs、Monaco 或新前端路由；
- 不改变现有快照 JSON/GZIP 格式；
- 不把实时协作对象放入 MinIO；
- 不修改已经发布的 `V1__create_project_tables.sql` 或 `V2__allow_revision_hash_reuse.sql`。

## 3. 开始前检查

### 3.1 工作区保护

1. 执行 `git status --short`，记录已有用户改动；不得覆盖或回滚无关变更。
2. 确认仓库根 `.env` 存在，但不得输出文件内容或任何凭据。
3. 确认本机 MySQL、MinIO 已按 `.env` 启动。
4. 禁止使用 `docker-compose.yml`、Docker 或 Docker Compose。

### 3.2 V1 基线命令

按仓库现有方式加载根 `.env` 后执行：

```powershell
cd frontend
npm run lint
npm run test
npm run build

cd ../backend
mvn test
```

若基线失败，先记录失败用例和原因；不得把原有失败误报为本步骤回归，也不得在未理解原因时修改无关代码。

## 4. 设计决策

### 4.1 两个版本字段

| 字段 | 含义 | 使用者 |
| --- | --- | --- |
| `project.current_version` | 用户可见源码快照版本 | 快照保存、版本列表、恢复 |
| `project.lock_version` | 项目行元数据并发版本 | JPA `@Version`、`If-Match` |

禁止使用 `current_version` 代替 JPA 乐观锁。一次快照保存更新项目指针时，两个版本都可能递增；只修改名称时仅 `lock_version` 变化。

### 4.2 并发规则

- 元数据更新和软删除携带客户端已读取的 `stateVersion`，使用强 ETag 条件请求：响应发送 `ETag: "<stateVersion>"`，请求发送 `If-Match: "<stateVersion>"`；拒绝弱标签、`*`、多标签和裸数字；
- 快照保存/恢复继续使用 `expectedVersion`，并在事务中悲观锁定项目行；
- 所有写操作首先定位同一个活动项目，再执行状态校验；软删除必须使用悲观写锁，并在持锁后校验强 ETag；
- 元数据更新和快照保存使用不同前置版本，允许无业务冲突的操作按数据库串行顺序都成功；无论提交顺序如何，都不得丢失名称、状态或快照指针，两个版本字段必须单调；
- 本步骤只有一张需要锁定的业务表。未来引入协作表后，固定顺序为 `project → collab_document`；
- 冲突不得静默覆盖，统一返回 `409 PROJECT_STATE_CONFLICT` 或现有 `VERSION_CONFLICT`。

### 4.3 入口文件规则

- `PUT /api/projects/{id}` 从本步骤起只允许修改名称、描述和模板，不允许修改入口文件；
- V1 快照端点仍可在保存合法快照时更新 `project.entry_file`；
- 步骤 07 启用 Y.Doc 后，入口文件将迁移为协作文档中的 `entryFileId`，数据库字段只保留最近检查点路径投影。

### 4.4 对象前缀

```text
projects/{projectId}/revisions/...   # 现有 JSON/GZIP 版本
collab/...                           # V2 未来 Y.Doc，当前禁止写入
```

现有 `OrphanSnapshotCleaner` 只能扫描 `projects/` 并只删除没有 `project_revision` 引用的版本对象。未来的 `collab/` 必须由步骤 05 的独立清理策略处理。

## 5. 数据库迁移

新增迁移：

```text
backend/src/main/resources/db/migration/V3__add_project_lock_version.sql
```

迁移内容：

```sql
ALTER TABLE project
    ADD COLUMN lock_version BIGINT NOT NULL DEFAULT 0;
```

要求：

- 不重命名或重排 V1/V2；
- MySQL 与 H2 测试配置都能执行；
- 对存量项目回填为 `0`；
- 迁移设计保证从仅有 V1/V2 的库可升级；
- 不在迁移中插入用户、密码或任何凭据。

## 6. 后端改造

### 6.1 领域模型

修改：

```text
backend/src/main/java/com/webeditor/project/domain/Project.java
```

增加：

```java
@Version
@Column(name = "lock_version", nullable = false)
private long lockVersion;
```

并增加只读 getter。业务代码不得手工设置或递增该字段。

### 6.2 响应契约

修改 `ProjectResponses.Summary`、`ProjectResponses.Details` 和 `ProjectResponses.SnapshotSaved`，新增：

```json
{
  "stateVersion": 3
}
```

`stateVersion` 映射 `lock_version`；现有 `version` 继续映射 `current_version`。创建、详情、更新、保存和恢复响应都必须携带提交后的最新 `stateVersion`。返回单个项目资源的 HTTP 响应同时发送强 `ETag: "<stateVersion>"`；前后端命名必须保持区分。

### 6.3 元数据更新和删除

修改：

```text
backend/src/main/java/com/webeditor/project/controller/ProjectController.java
backend/src/main/java/com/webeditor/project/application/ProjectService.java
backend/src/main/java/com/webeditor/project/application/ProjectRequests.java
backend/src/main/java/com/webeditor/project/repository/ProjectRepository.java
```

详细要求：

1. `PUT /api/projects/{id}` 和 `DELETE /api/projects/{id}` 要求单个强 `If-Match: "<stateVersion>"`；拒绝弱 ETag、通配符、多标签和裸数字。
2. 缺少或语法错误返回 `400 INVALID_STATE_VERSION`。
3. 更新服务读取活动项目并校验当前 `lockVersion`，JPA flush 时仍由 `@Version` 做最终竞态保护。
4. 删除必须通过 `findActiveByIdForUpdate` 对项目行加悲观写锁，并在持锁后校验 ETag；步骤 09 再把顺序扩展为先取得 fence，后锁 `project → collab_document`。
5. `ObjectOptimisticLockingFailureException` 映射为 `409 PROJECT_STATE_CONFLICT`。
6. Update DTO 删除 `entry`；明确配置 `spring.jackson.deserialization.fail-on-unknown-properties=true`，携带 `entry` 或其他未知字段返回 400。
7. 删除后继续保持软删除，不能删除 revision 或 MinIO 对象。

### 6.4 快照和恢复

检查并调整：

```text
backend/src/main/java/com/webeditor/project/application/SnapshotService.java
```

要求：

- 保存和恢复继续通过 `findActiveByIdForUpdate` 悲观锁项目；
- 在持锁后重新校验 `expectedVersion`；
- 项目指针更新必须由受管实体完成，使 `lock_version` 同时递增；保存和恢复响应（包括内容哈希未变化的去重分支）返回事务完成后的最新 `stateVersion`；
- 元数据更新与快照保存并发时允许按串行顺序都成功，但不得覆盖名称、删除状态、`current_version` 或 `current_object_key`；元数据在陈旧 `stateVersion` 上 flush 时必须冲突；
- 暂时保留现有 MinIO I/O 位于事务内的实现，但记录为步骤 05 重构项，不把它用于未来实时 Y.Doc 持久化。

### 6.5 有上限的解压

修改：

```text
backend/src/main/java/com/webeditor/project/application/SnapshotCodec.java
```

用有上限的读取替代无界 `GZIPInputStream.readAllBytes()`：

- 以实际解压后的 JSON 字节数计数，上限至少覆盖合法 10 MB 未压缩快照；
- 读取 MinIO 历史对象时，损坏 GZIP 或超限解压统一映射为脱敏的 `503 STORAGE_CORRUPT`，不分配无界内存；客户端提交的非法 JSON 快照仍使用 `400 INVALID_SNAPSHOT`；
- `ProjectService.get` 和恢复路径解码后都重新执行文档结构校验；
- 正常历史快照保持兼容。

### 6.6 孤立对象清理边界

修改或补充测试：

```text
backend/src/main/java/com/webeditor/storage/OrphanSnapshotCleaner.java
backend/src/test/java/com/webeditor/storage/OrphanSnapshotCleanerTests.java
```

必须证明：

- 只列举 `projects/`；
- 有 revision 引用的对象不删除；
- 保护期内对象不删除；
- 即使测试存储里存在 `collab/` 对象也完全不扫描、不删除；
- 软删除项目的 revision 仍有引用，因此本步骤不承诺释放其对象。

## 7. 前端兼容改造

修改：

```text
frontend/src/types/project.ts
frontend/src/api/projects.ts
frontend/src/App.tsx
```

要求：

1. `ProjectSummary/ProjectDetails/SnapshotSaved` 增加 `stateVersion`；
2. 更新和删除请求发送 `If-Match: "<stateVersion>"`；
3. 更新、快照保存和恢复成功后替换打开项目及项目列表中的最新 `version/stateVersion`；`useProjectSave` 的回调同时传递两个版本；
4. `409 PROJECT_STATE_CONFLICT` 提示用户重新加载项目元数据；
5. 更新项目请求不再发送 `entry`；
6. 内容哈希去重保存也必须消费响应中的 `stateVersion`；恢复后重载取得两个最新版本；
7. “另存副本”在初始保存成功后必须用返回的新 `stateVersion` 作为后续清理条件，不能持有创建响应中的旧值；
8. 保持现有自动保存链路，步骤 07 前不能提前删除。

### 7.1 运行态派生文件回归

为 `prepareSandpackFiles` 增加测试，固定以下事实：

- 输入对象不被修改；
- HTML charset、Vite script 等只出现在返回的派生对象；
- 后续 V2 的 Sandpack Bridge 不得把派生字段反写权威源码。

本步骤不重构 Sandpack 状态源，只建立测试护栏。

## 8. 错误码

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | `INVALID_STATE_VERSION` | `If-Match` 缺失、不是单个强 ETag 或数值非法 |
| 404 | `PROJECT_NOT_FOUND` | 项目不存在或已软删除 |
| 409 | `PROJECT_STATE_CONFLICT` | JPA 锁版本或客户端 stateVersion 过期；这是项目统一错误契约，不使用 HTTP 412 |
| 409 | `VERSION_CONFLICT` | 快照 `expectedVersion` 过期 |
| 400 | `INVALID_SNAPSHOT` | 客户端提交的快照不合法 |
| 503 | `STORAGE_CORRUPT` | 已存对象损坏或解压后超过服务端上限 |

异常响应继续使用现有 `ApiError` 格式，不能包含实体、SQL、对象键或堆栈。

## 9. 测试清单

### 9.1 后端快速测试

- Flyway 创建 `lock_version`；
- Summary/Details/SnapshotSaved 返回不同语义的 `version/stateVersion`，单资源响应返回合法强 ETag，响应体 `stateVersion` 与 ETag 数值完全一致；
- 更新和删除缺失 `If-Match`，以及弱标签、通配符、多标签、裸数字；
- 陈旧 `If-Match` 返回 409；
- 更新 DTO 无法改变入口；
- 新内容保存、内容哈希去重、恢复后 `version/stateVersion` 分别按预期变化；
- GZIP 正常、损坏和解压超限；
- 清理器忽略 `collab/`。

### 9.2 前端功能检查

- 更新/删除正确发送强 ETag `If-Match`；
- 自动保存、哈希去重、恢复成功后同时刷新 `version/stateVersion`；
- 自动保存后仍可重命名和删除，不产生稳定的陈旧 ETag 冲突；
- `PROJECT_STATE_CONFLICT` 与 `VERSION_CONFLICT` 显示不同提示；
- 现有项目切换、草稿、保存和版本恢复功能保持可用。

## 10. 可选开发检查

```powershell
cd frontend
npm run lint
npm run test
npm run build

cd ../backend
mvn test
```

## 11. 验收条件

- V3 Flyway 迁移设计保留现有项目与版本数据，迁移后项目仍可读取；
- `version` 与 `stateVersion` 在 API 和 UI 中无混用；
- 元数据、删除、保存和恢复不会静默覆盖；快照响应刷新 `stateVersion`，自动保存后仍可正常更新/删除；
- 更新项目不能旁路修改入口；
- 超限压缩内容安全失败；
- 对象清理不触碰保留的 `collab/` 命名空间或仍被引用的对象；
- V1 项目操作与版本功能仍可正常使用；
- 功能验收过程不输出或提交 `.env` 凭据，不使用 Docker。

## 12. 回滚与兼容

- 应用回滚到不认识 `lock_version` 的 V1 代码时，新增列不会影响读取，但旧代码不再提供并发保护；生产回滚前必须停止写入并评估风险；
- 不删除 `lock_version` 列，不回滚已执行 Flyway；
- `stateVersion` 是新增响应字段，但强 ETag 和禁止 Update `entry` 都是行为变化；本步骤不支持新后端与旧前端混合运行，前后端必须在同一维护窗口原子发布；
- 发布前先停止写流量，发布后用严格模式冒烟验证，再恢复写入；不得用仅关闭 `If-Match` 的开关伪装兼容，因为旧前端仍会发送已经禁止的 `entry`；
- 生产回滚优先使用“认识 V3 但关闭新行为”的兼容制品，不执行降级 Flyway；发布前确认该制品兼容已迁移的 schema。

## 13. 向下一步骤提供的稳定产物

步骤 02 可以依赖：

- 稳定的强 ETag `stateVersion/If-Match` 契约及统一 JSON 冲突响应；
- 创建、详情、更新、保存、恢复都会返回最新 `stateVersion`。

步骤 03 可以依赖：

- 后续 Flyway 从 V3 之后继续追加；
- 项目范围化后仍保留 `stateVersion`，所有更新/删除 fixture 必须携带强条件版本；
- 元数据 API 不接受入口或其他未知字段。

步骤 05 可以依赖：

- 固定锁顺序为 `project → collab_document`；
- `projects/` 与 `collab/` 的对象所有权和清理器完全分离；
- 当前事务内 MinIO I/O 是明确待重构项；
- 抽取通用对象存储不得改变现有快照格式、哈希或对象 key。

共同基线：受限解压、V1 功能保持可用，且全程不使用 Docker。

