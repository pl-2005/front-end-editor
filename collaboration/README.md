# Step05 协作文档模块

`src/document.ts` 是初始化服务和后续网关共用的 Y.Doc schema、编码、加载、复制与校验模块。文件用稳定 fileId 与 Y.Text 管理；支持 HTML/CSS/JS/JSON/TXT/Markdown。上限为 100 文件、单文件 1 MiB、正文合计 10 MiB、完整二进制 12 MiB；后续网关 Update 上限为 2 MiB。

## 本地启动

需要 Node.js 24+、Java 21、本机 MySQL、MinIO 和 Redis。使用仓库根 `.env`，禁止 Docker。配置两个独立、至少 32 字节的随机密钥 `COLLAB_INITIALIZER_SECRET` 和 `COLLAB_STORAGE_SECRET`，不可打印或提交。初始化服务默认端口 8091，Spring 默认访问 `http://127.0.0.1:8091/internal/initialize`。只在开发或隔离环境设置 `COLLAB_CREATION_ENABLED=true`，生产公开入口仍等待 Step11。

```powershell
cd collaboration
npm ci
npm run build
npm start
```

启动器从根 `.env` 读取配置，给编码服务子进程仅传入初始化 HMAC 密钥、端口和必要的系统环境变量，不传入 MySQL、MinIO 或 JWT 凭据。编码服务只监听 loopback，不执行项目代码。另开终端按仓库 README 加载根 `.env` 并启动 Spring。

## 团队项目 API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/teams/{teamId}/projects` | 服务端 vanilla 模板创建；成功返回 201 |
| POST | `/api/teams/{teamId}/projects/{id}/initialize` | 重试不可见初始化记录；已 ACTIVE 时幂等返回 |
| POST | `/api/teams/{teamId}/projects/{id}/copy` | 从当前持久化指针复制并生成新身份 |
| GET | `/api/teams/{teamId}/projects/{id}` | 项目元数据及 collaboration 描述，无 V1 version/files/objectKey |

创建正文为 `{ "name": "项目名", "template": "vanilla", "entry": "/index.html" }`；复制正文为 `{ "name": "副本名" }`。所有有效成员同权；失败返回 `COLLAB_INITIALIZATION_FAILED` 和 `X-Initializing-Project`，前端据此重试同一个保留 ID。INITIALIZING 项目不出现在列表或详情中，复制初始化失败重试时重新读取源项目当前持久化状态，不能改用模板。删除固定返回 `COLLAB_DELETE_COORDINATION_REQUIRED`，等待 Step09。

## 内部存储协议

这些路由不应通过公网反向代理；代理必须拒绝 `/internal/`。初始阶段为单实例，nonce 缓存在进程内且有容量上限；Step06 将统一双向协议与数据库 nonce。

| 方法 | 路径 |
| --- | --- |
| GET | `/internal/collaboration/projects/{id}/describe` |
| GET | `/internal/collaboration/projects/{id}/epochs/{epoch}/generations/{generation}/load` |
| POST | `/internal/collaboration/projects/{id}/epochs/{expectedEpoch}/generations/{expectedGeneration}/persist/{idempotencyKey}` |

persist 正文是已经由受信网关校验的 Y.Doc 二进制，Content-Type 必须为 `application/octet-stream`；Spring 只负责有界读取、SHA-256、存储和 CAS，不在 Java 中解码。幂等键允许 1–100 个英文字母、数字、下划线或短横线。

请求包含 `X-Collab-Timestamp`（UTC epoch 秒）、`X-Collab-Nonce`（UUID）、`X-Collab-Signature`（小写十六进制 HMAC-SHA256），允许 30 秒时差，nonce 不可重放。签名输入是以下六项用真实换行连接，无末尾换行：

```text
METHOD
PATH（无 query）
AUDIENCE
TIMESTAMP
NONCE
SHA256(BODY)
```

内部存储 audience 为 `storage`，使用 `COLLAB_STORAGE_SECRET`；初始化 audience 为 `initializer`，使用独立的 `COLLAB_INITIALIZER_SECRET`。GET 的 body 为空。幂等键和预期代次进入签名路径。初始化服务响应同时提供项目 ID、epoch、长度和哈希，Spring 核验后上传对象。

## 清理与备份

对象仅位于 `collab/projects/{id}/epochs/{epoch}/{generation}-{hash}.yjs`。上传前持久化 10 分钟租约；上传期间不持有数据库事务，提交指针时再次锁定对象 guard 并检查租约。网络超时、CAS 失败或数据库失败的对象由清理器处理，不能即时删除。

清理器只扫描规范的 `collab/` 对象，先检查对象年龄，再记录首次无引用观察；间隔至少 `max(COLLAB_RECOVERY_WINDOW, COLLAB_CONFIRMATION_WINDOW)` 后，在同一个 guard 下再次检查当前指针、租约和有效备份引用，然后标记 DELETING，事务外删除，最后标记 DELETED。DELETING/DELETED 对象不能被新上传或备份重新认领。默认恢复窗口 30 天，确认窗口 24 小时。

备份工具应通过 `CollabBackupService.pinCurrent` 在复制对象前登记保护引用，并同时保留匹配的 MySQL 元数据和所有被引用的 Y.Doc 二进制。仅备份数据库不足以恢复文件。备份工具的完整编排留给 Step10；V1 清理器继续只扫描 `projects/`。

## 验证

`npm test` 检查编码、重载、复制、路径/schema/大小校验和初始化服务 HMAC。后端 `CollaborationStorageTests` 检查初始化失败回滚、CAS 竞争、幂等回执、epoch/损坏错误、清理/备份保护和 V1 写入隔离。

本机功能验证脚本使用根 `.env` 的服务配置，只在子进程中生成临时 HMAC 密钥，不修改根配置。它会保留临时验收账号、团队、项目和 MinIO 对象，身份凭据不写入状态文件。需先确保本机三项服务运行，并构建后端到指定目录：

```powershell
cd backend
mvn -o package "-Deditor.build.directory=E:/labStudy/DEMOS/front-end-editor/.codex-build/step05-backend"
cd ../collaboration
npm run build
node scripts/verify-local.mjs
```

脚本使用 loopback 18085/18091 端口，验收后停止其启动的 Spring 和初始化服务，并验证一次后端重启后的恢复。此步骤还未启动协作房间；Step06 接入网关后，复制必须先 flush 房间最新编辑。
