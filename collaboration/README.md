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

创建正文为 `{ "name": "项目名", "template": "vanilla", "entry": "/index.html" }`；复制正文为 `{ "name": "副本名" }`。所有有效成员同权；失败返回 `COLLAB_INITIALIZATION_FAILED` 和 `X-Initializing-Project`，前端据此重试同一个保留 ID。INITIALIZING 项目不出现在列表或详情中，复制初始化失败重试时重新读取源项目当前持久化状态，不能改用模板。删除固定返回 `COLLAB_DELETE_COORDINATION_REQUIRED`，等待 Step09。

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

上述记录对应 Step07 验收；Step08 已补齐离线日志、持续编辑与 Presence，见下节。项目删除与 Outbox 主动撤权仍由 Step09 完成。生产开关保持关闭，Step11 才发布完整 V2。

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
