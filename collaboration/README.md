# Step05–06 协作文档与网关模块

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

创建正文为 `{ "name": "项目名", "template": "vanilla", "entry": "/index.html" }`；复制正文为 `{ "name": "副本名" }`。所有有效成员同权；失败返回 `COLLAB_INITIALIZATION_FAILED` 和 `X-Initializing-Project`，前端据此重试同一个保留 ID。INITIALIZING 项目不出现在列表或详情中，复制初始化失败重试时重新读取源项目当前持久化状态，不能改用模板。删除通过 Step09 durable fence/Outbox 协调，见下节协议。

## 内部存储协议

这些路由不应通过公网反向代理；代理必须拒绝 `/internal/`。首期为单实例。Spring 将内部 nonce 写入 MySQL；初始化服务和网关使用接收端本机 SQLite nonce 表，重启后有效 nonce 仍不可重放。SQLite 文件仅保存 nonce/expiry，部署时须设置在持久磁盘目录。

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

备份工具通过 `CollabBackupService.pinCurrent` 在复制对象前登记保护引用，并同时保留匹配的 MySQL 元数据和所有被引用的 Y.Doc 二进制。仅备份数据库不足以恢复文件。Step10 联合备份工具与失败对账见 [运维说明](../docs/V__2/step10-operations.md)；V1 清理器继续只扫描 `projects/`。

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

该 Step05 脚本使用 loopback 18085/18091 端口，验收后停止其启动的 Spring 和初始化服务，并验证一次后端重启后的恢复。它不开启协作票据或网关；开启 Step06 后，复制及复制初始化重试必须先 flush 房间最新编辑。

## Step06 网关启动与协议

先执行 `npm ci`、`npm run build`。根 `.env` 配置独立、至少 32 字节且不同的 `COLLAB_STORAGE_SECRET`、`COLLAB_GATEWAY_SECRET` 和 `COLLAB_INITIALIZER_SECRET`。受控环境才打开 `COLLAB_TICKET_ENABLED=true`、`COLLAB_GATEWAY_ENABLED=true`；Spring 和网关使用同一开关配置，Spring 通过 `COLLAB_GATEWAY_INTERNAL_URL` 访问网关，网关通过 `COLLAB_SPRING_URL` 访问 Spring。不要把这三个密钥发送到浏览器。

```powershell
cd collaboration
npm start
# 另一个终端启动网关，Spring 按仓库 README 加载根 .env 后启动。
npm run start:gateway
```

启动器仅向网关传递协作配置和必要系统环境，不传入 MySQL、MinIO 或 JWT 凭据。两个 Node 服务仅监听 loopback。默认入口是 `ws://127.0.0.1:8092/collaboration`；浏览器入口由反向代理提供，只转发该精确路径，拒绝 `/internal/`。生产反向代理协作入口在 Step11 前保持关闭，默认 Spring 票据和网关握手开关均为 false。

`COLLAB_ALLOWED_ORIGINS` 使用逗号分隔的精确 Origin，如 `http://localhost:5173`，不支持通配符、缺失 Origin 或 URL query 参数。浏览器使用 JWT 调用 `POST /api/projects/{id}/collab-ticket`，响应 data 包含 ticket/expiresAt/projectId/epoch；将 ticket 交给 Hocuspocus Provider 的 token 配置，通过认证消息发送，房间名为 `project:{id}:epoch:{epoch}`。重连必须新申请票据，不能将票据放到 URL 或持久化存储。

内部新增路由：

| 接收端 | 方法与路径 | 正文/结果 |
| --- | --- | --- |
| Spring | `POST /internal/collaboration/tickets/consume` | JSON ticket/projectId/epoch → identity 和 authorization |
| Spring | `POST /internal/collaboration/connections/revalidate` | JSON userId/projectId/epoch/authzVersion → 当前授权 |
| 网关 | `POST /internal/collaboration/projects/{id}/flush` | 空正文 → projectId/epoch/generation/contentHash/durableSequence |

网关 → Spring 使用 `COLLAB_STORAGE_SECRET`、audience=`storage`；Spring → 网关使用 `COLLAB_GATEWAY_SECRET`、audience=`gateway`。沿用上面的六行 HMAC 格式，每次请求生成新 nonce；保存重试的业务幂等键/预期 generation/正文保持一致。Java 内部 flush 固定 HTTP/1.1，避免 h2c Upgrade 与 WebSocket 路径混用。nonce 至少保留到 30 秒时间窗完全结束；默认 SQLite 文件放在 `.codex-build`，正式运行须配置 `COLLAB_GATEWAY_NONCE_PATH` 和 `COLLAB_INITIALIZER_NONCE_PATH` 为持久目录。

服务端发送 Hocuspocus stateless 消息：`ready` 提供验证后的 identity；`persistence` 提供 epoch/generation/contentHash/dirtySequence/durableSequence/status。status 为 pending/durable/failed/forbidden，只有 durableSequence 覆盖 dirtySequence 才能显示已持久化；WebSocket synced 是独立状态。Awareness 的 user 由服务端覆盖；cursor/selection 使用 `{anchor, head}` Yjs 相对位置，activeFileId 可以是有效文件 ID 或 null。禁止客户端 stateless 广播和认证 token 更新；使用重新连接申请新票据。

默认硬上限：50 房间、200 总连接、20 单房连接、512 MiB 进程 RSS、100 消息/秒/连接、4 MiB 入站数据/秒/连接；对应 `.env.example` 的 `COLLAB_MAX_*` 可配置。每房 pending 上限 24 MiB/10000 更新；文档和 Update 限制仍由共享 LIMITS 固定。存储失败暂停写入，保留 pending 并退避重试；末位离房及正常停机 flush，失败房间不能 unload。突然进程崩溃后的未持久化恢复仍依赖 Step08 客户端日志。

## Step06 本机功能验收

```powershell
# 在仓库根目录执行，构建输出使用绝对路径。
$repositoryRoot = (Get-Location).Path
$backendBuildPath = Join-Path $repositoryRoot '.codex-build/backend-check'
cd backend
mvn -o package "-Deditor.build.directory=$backendBuildPath"
cd ../collaboration
npm run build
node scripts/verify-step06-local.mjs
```

脚本读取根 `.env` 的本机 MySQL/MinIO/Redis，使用 loopback 18086/18092/18093，临时内部密钥只存在进程内，不修改根配置、不打印凭据；验证票据单用、真实 Provider 同步、自动保存、复制前 flush、离房 flush 及网关重启恢复，最后停止临时服务。验收账号、团队和项目保留本机。故障与并发覆盖通过后端测试和协作模块测试完成；正式编辑器及浏览器验收见 Step07。

## Step07 本机浏览器验收

V2 项目工作区已接入 Monaco/Yjs 与单向 Sandpack 投影。Vite 从根 `.env` 读取本机代理配置：API 默认 localhost:8080，WebSocket 默认 127.0.0.1:8092 的精确 `/collaboration`；可用仅服务端读取的 `LOCAL_API_URL`、`LOCAL_COLLAB_URL` 覆盖。Origin 白名单必须匹配浏览器页面 origin。内部 HMAC、MySQL、MinIO、JWT 和刷新凭据不传给浏览器配置。

连接的 ready 身份和 schema/epoch 校验通过，并收到初始 persistence 状态后才可编辑。persistence 除 generation/contentHash/dirtySequence/durableSequence/status 外提供 acceptedHash/durableHash：对规范 schema 内容与 CRDT clocks 的 SHA-256，覆盖纯删除，避免 undo 保留数据与网关 GC 导致的二进制差异。对象 contentHash 的含义不变。当前本地指纹匹配且 durableSequence 覆盖 dirtySequence 时，才显示已持久化。

使用本机 MySQL/MinIO/Redis 和已连接的 web-access CDP proxy（默认 localhost:3456）；只新建、操作验收标签页。后端构建目录使用绝对路径：

```powershell
$step07BuildPath = Join-Path (Get-Location).Path '.codex-build/step07-backend'
cd backend
mvn -o package "-Deditor.build.directory=$step07BuildPath"
cd ../frontend
npm ci
npm run build
npm run lint
npm test
cd ../collaboration
npm ci
npm test
node scripts/verify-step07-local.mjs
```

脚本读取根 `.env`，在独立 Vite/Java/网关进程中使用 loopback 15173/18086/18092/18093，避免 Vite 编译干扰网关五秒租约。验证真实补全接受、HTML/CSS/JS 诊断、跨文件导入、结构操作、undo/redo、容量保护、大文件降级、Sandpack 控制台、自动持久化、网关重启、新票据、工作区重开和服务端撤权后的模型清理。结束后关闭临时服务和验收页，保留验收账号、项目与 `.codex-build/step07-workspace.png`；身份及内部凭据仅在内存中，不修改根 `.env`。可用 CDP_PROXY_URL 覆盖本机 proxy 地址。

上述记录对应 Step07 验收；Step08 已补齐离线日志、持续编辑与 Presence，见下节。项目删除与 Outbox 主动撤权的协议和验收见 Step09 一节。生产开关保持关闭，Step11 才发布完整 V2。

## Step08 本机浏览器验收

本地日志使用 `web-editor:{userId}:{projectId}:{epoch}`，待确认更新预算为 1.5 MiB；缓存保存受限 Yjs 更新、待同步计数和恢复提示的 fileId，不保存身份凭据。多标签页原子合并缓存，持久化确认匹配后再清零计数。正常关闭工作区保留日志，授权失效清理日志及内容。重启浏览器后须重新登录；不支持完全离线登录。Sandpack 离线消费本地文档，首次运行仍需可用的运行依赖。

Awareness 的 user 增加服务端绑定的 connectionId，ready.identity 同时提供该字段；相对选区允许 Yjs 正常编码的 `tname: null`。前端按用户和连接显示成员及远端光标，远端删除时可恢复为新文件或验证访问权后复制，恢复提示在重新打开后保留。

协作颜色按可见 userId 分配并解决冲突，同一用户多标签页共用颜色。Monaco 在远端光标旁持续显示同色姓名标签，与选区高亮和成员列表一致；标签随光标移动，切换文件或离房后清理。浏览器验收额外检查姓名可见、颜色一致及折叠光标和文件切换行为，截图保存在 `.codex-build/step08-cursor-label.png`。

```powershell
# 从仓库根目录执行；编译输出集中在 .codex-build，避免修改依赖缓存。
$step08BuildPath = Join-Path (Get-Location).Path '.codex-build/step08-backend'
cd backend
mvn -o package "-Deditor.build.directory=$step08BuildPath"
cd ../frontend
npm test
npm run lint
node node_modules/typescript/bin/tsc -p tsconfig.app.json --incremental --tsBuildInfoFile ../.codex-build/step08-app.tsbuildinfo
node node_modules/typescript/bin/tsc -p tsconfig.node.json --incremental --tsBuildInfoFile ../.codex-build/step08-node.tsbuildinfo
node node_modules/vite/bin/vite.js build --configLoader runner --outDir ../.codex-build/step08-frontend
cd ../collaboration
npm test
node scripts/verify-step08-local.mjs
```

浏览器脚本需要已连接的 web-access CDP proxy（默认 localhost:3456），读取根 `.env` 连接本机 MySQL/MinIO/Redis，在 loopback 15173/18086/18092/18093 启动临时服务。只操作新建验收标签页，通过切断协作传输并模拟票据请求网络错误验证离线编辑；应用静态资源与 Sandpack 运行依赖保持可用。覆盖文本与结构编辑、跨扩展名重命名、本地预览日志、新票据合并、两标签页成员/远端选区、删除冲突恢复、页面重载与重新登录后的重发、网关重启和撤权清理。退出团队缓存范围、旧 epoch、容量及存储错误由自动测试覆盖。

脚本不修改根 `.env`，不打印或写入身份凭据；结束后关闭临时服务和自身标签页，保留验收账号、项目及 `.codex-build/step08-workspace.png`。`LOCAL_VITE_CACHE_DIR` 仅用于服务端配置，可将开发缓存定向到工作区可写目录，不进入浏览器环境变量。V2 生产开关保持关闭。

## Step09 删除、Outbox 与故障对账

V12 新增 `collab_operation` 和 `collab_control_event`。项目删除携带元数据强 If-Match；所有有效成员同权。Spring 先提交 PREPARED，随后通过内部 fence 请求停止网关新 Update 并 flush，收到 durable-close ACK 后按 `project → collab_document` 锁顺序再次核对元数据版本、epoch、generation 和 hash，同一事务软删除、递增 epoch、提交 operation 及 PROJECT_DELETED 事件。最后对象键保持不变，其原始 epoch 同时保留在对象键和 operation.expected_epoch 中；已删除项目禁止 describe/load/persist，本期不硬删。

| 接收端 | 方法与路径 | 正文/结果 |
| --- | --- | --- |
| Spring | `GET /internal/collaboration/projects/{id}/control` | 项目 epoch、ACTIVE/FENCED/DELETED、当前 operation ID |
| Spring | `GET /internal/collaboration/operations/{id}` | operation 状态、预期水位及提交后的 fence 回执 |
| 网关 | `POST /internal/collaboration/projects/{id}/fence` | operationId → projectId/operationId/epoch/generation/contentHash/durableSequence/fenceToken |
| 网关 | `POST /internal/collaboration/control` | Outbox 事件 → id/aggregateSequence ACK |

继续使用 storage/gateway audience、独立 HMAC 密钥和持久化 nonce；这些路由不向浏览器或公网开放。网关的 SQLite nonce 文件同时保存 fence/token/durable 回执和事件聚合水位，不保存源码。该文件必须位于持久磁盘。房间卸载不会清除 fence；握手和房间加载复核 Spring 控制状态，重启不能绕过 PREPARED。

fence 不阻止已有 pending 的持久化。flush、网络或 ACK 失败返回 503，项目状态保持不变，队列和 fence 保留。数据库回滚后用新事务确认 PREPARED、项目 ACTIVE 及原 epoch，写 ABORTED 和 OPERATION_ABORTED 事件；提交结果未知时不直接解除 fence。PREPARED 租约为 60 秒，对账器每 10 秒检查到期操作，先查询并确认网关 durable fence，再根据数据库提交痕迹安全 ABORT；COMMITTED 的 finalize 由可靠 Outbox 重试完成。租约过期本身不会恢复写入，Spring/网关不可达时继续 fail closed。

退出所有设备、改密、退出团队及 OWNER 移除成员，在原授权事务更新水位并追加 USER_REVOKED。当前 authzVersion 是用户级水位，事件关闭该用户所有旧水位连接，不冻结其他成员的房间；新水位连接不受迟到旧事件影响。Outbox 启动 1 秒后按 1 秒轮询，失败指数退避至最多 60 秒并输出仅含事件 ID/次数的告警；至少一次投递，网关持久化聚合水位处理重复/乱序，ACK 后 Spring 标记确认。事件延迟时保留最长 5 秒授权租约兜底。

永久删除/撤权通过 forbidden 状态或关闭原因触发前端内容及对应缓存清理。Hocuspocus 4.7 的文档 CLOSE 帧在 Provider 中使用 code=1000，因此同时检查 `COLLAB_USER_REVOKED`、`COLLAB_PROJECT_DELETED`、`COLLAB_AUTHORIZATION_EXPIRED`，也接受传输层 4403。临时 PREPARED 用 `COLLAB_PROJECT_FENCED` 或传输层 4410，暂停编辑并保留日志，重新取得票据后可恢复；删除 API 成功也会清理发起者项目缓存。普通离房、停机和复制仍只 flush 当前状态，不创建 revision/checkpoint。

```powershell
# 从仓库根目录执行。
$step09BuildPath = Join-Path (Get-Location).Path '.codex-build/step09-backend'
cd backend
mvn -o package "-Deditor.build.directory=$step09BuildPath"
cd ../collaboration
npm test
node scripts/verify-step09-local.mjs
```

脚本使用根 `.env` 的本机 MySQL/MinIO/Redis，在 loopback 18089/18094/18095 启动临时 Spring、网关及初始化服务。验证编辑中 durable 删除、无活动房间删除、重复删除、旧票据拒绝、MinIO 最后对象保留、四类 Outbox 主动撤权、其他成员继续编辑及网关重启恢复。MinIO 签名读取仅由验收脚本使用本机配置，网关没有 MinIO 凭据。结束后关闭临时进程，验收账号及项目保留；不使用 Docker，不修改根 `.env`，不打印或落盘身份/内部凭据。生产协作入口仍等待 Step11。

## Step10 安全、指标与当前文件恢复

V13 新增持续恢复 fence 和幂等回执；恢复仅在关闭创建/票据/网关的维护模式执行，重建当前内容到新 epoch 的 generation 1 对象后原子切换指针。缺失、损坏、上传和数据库失败不会覆盖当前指针或解开项目 fence。运维路由使用独立 maintenance HMAC 权限，普通 JWT 和网关密钥不能访问。

`scripts/maintenance.mjs` 提供脱敏指标、MySQL/MinIO 联合备份、单项目恢复及全活动项目恢复；默认只访问 loopback 并加载根 `.env`。备份保护当前/软删除对象，dump 后复核指针；清理排除上传租约、有效备份及未解决恢复的源/目标对象。详细配置、容量、协议、命令和失败对账见 [Step10 运维说明](../docs/V__2/step10-operations.md)。

```powershell
# 后端先构建到 .codex-build/step10-backend；使用本机服务，禁止 Docker。
npm test
node scripts/verify-step10-local.mjs
# 可选真实浏览器预览 sandbox/no-referrer 检查，需要已连接的 web-access CDP proxy。
node scripts/verify-step10-local.mjs --browser
```

验收脚本保留验收账号、项目和受限备份目录，关闭自己启动的进程和标签页，不修改根 `.env` 或打印凭据。生产公开入口继续等待 Step11。
