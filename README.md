# Web Editor

一个面向 HTML、CSS 和 JavaScript 的浏览器在线编辑器。V2 使用 Spring Boot 管理身份、团队授权和项目元数据，Hocuspocus 网关负责 Yjs 协作与自动持久化，MySQL 保存当前文档指针，MinIO 保存 Y.Doc 二进制。正式 Monaco/Yjs/Sandpack 编辑器接入仍待 Step07。

> V2 已完成 Step06：身份认证、团队授权、Y.Doc 存储底座、单次协作票据、安全网关和自动持久化。当前代码强制 Bearer 认证并隔离 V1 匿名项目；受控新项目直接初始化 Y.Doc，协作启用后的项目复制先 flush 最新编辑。启动、内部协议与本机验收见 [collaboration/README.md](collaboration/README.md)。票据与网关开关默认关闭；正式编辑器、离线日志、删除与主动撤权协调分别由 Step07–09 完成，公开入口在 Step11 开放。完整进度见 [docs/V__2/README.md](docs/V__2/README.md)。

## V1 功能记录

- 项目：新建、打开、重命名和软删除；
- 文件：目录树展示，以及文本文件的新建、编辑、重命名和删除；
- 运行：实时预览、刷新预览、运行日志与编译错误控制台；
- 保存：停止编辑 1.5 秒后自动保存，也可使用 `Ctrl/Cmd + S` 手动保存；
- 草稿：未保存内容写入 IndexedDB，刷新或网络恢复后可继续处理；
- 并发保护：基于版本号检测写入冲突，可重新加载或另存副本；
- 版本历史：查看历史快照，并将任一历史内容恢复为一个新版本；
- 存储维护：启动时初始化 MinIO Bucket，并定时清理无数据库引用的孤立快照。

上述保存、草稿、版本历史和软删除流程记录 V1 行为。V2 不开放旧快照写入和版本历史接口，协作项目删除等待 Step09；当前前端尚未接入 Step06 网关。项目不支持 npm 依赖管理、服务端代码执行或 Git 集成。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite、Sandpack、IndexedDB、Vitest |
| 后端 | Java 21、Spring Boot 3.5、Spring Web、Spring Data JPA、Bean Validation |
| 协作服务 | Node.js 24+、TypeScript、Yjs、Hocuspocus 4.7 |
| 数据与存储 | MySQL 8、Flyway、MinIO、Redis；内部 nonce 接收端使用 MySQL/本机 SQLite |

## 项目结构

```text
front-end-editor/
├── frontend/                  # React 编辑器、预览、草稿与 API 客户端
├── backend/                   # Spring Boot API、领域逻辑和存储适配
├── collaboration/             # Y.Doc 编码、协作网关、内部协议与验收脚本
├── docs/
│   ├── V__1/                  # V1 接口、部署与架构记录
│   └── V__2/                  # V2 总方案、开发步骤与进度
├── .env.example               # 本地配置模板
└── README.md
```

## 本地运行

### 1. 准备环境

- Node.js 24+
- JDK 21
- Maven 3.9+
- 本机运行的 MySQL 8、MinIO 和 Redis

本项目本地开发和验收使用仓库根目录的 `.env`，直接连接本机 MySQL、MinIO 与 Redis，不使用 Docker 或 Docker Compose。首次运行可从模板创建配置：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，填写本机服务地址与凭据。确保 `DB_URL` 指向已创建的数据库，数据库用户能够执行 Flyway 迁移，`MINIO_ENDPOINT` 指向 MinIO API 端口且凭据有效。默认配置会自动创建私有 Bucket。

`.env` 已被 Git 忽略，请勿提交真实凭据。

### 2. 启动后端

在仓库根目录执行：

```powershell
cd backend
Get-Content ..\.env | ForEach-Object {
  if ($_ -match '^\s*([^#][A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
mvn spring-boot:run
```

Flyway 会在启动时自动执行数据库迁移。健康检查地址为 `http://localhost:8080/api/health`。

### 3. 启动前端

打开新终端，在仓库根目录执行：

```powershell
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。Vite 会将 `/api` 请求代理到 `http://localhost:8080`。

### 4. 受控协作服务

按 [协作模块运行说明](collaboration/README.md#step06-网关启动与协议)配置三个独立内部 HMAC 密钥、精确 Origin 白名单以及 Spring/网关地址，构建协作模块后分别执行 `npm start` 和 `npm run start:gateway`。初始化服务默认监听本机 8091，网关默认监听本机 8092 的 `/collaboration`；`/internal/` 不得通过公网代理暴露。仅受控开发环境开启创建、票据与网关开关；浏览器正式编辑器和生产入口仍等待后续步骤。

## 常用命令

```powershell
# 前端检查
cd frontend
npm run lint
npm run test
npm run build

# 后端测试（另一个终端）
cd backend
mvn test

# 协作模块检查（另一个终端）
cd collaboration
npm ci
npm test
```

## V1 数据与保存机制记录

Sandpack 在浏览器中编译和运行用户代码，后端不会执行项目代码。保存时前端携带当前版本号提交完整文件集合；后端校验内容并计算哈希，将 GZIP 快照写入 MinIO，再在 MySQL 中记录版本元数据。内容未变化时不会创建重复版本，版本不一致时返回 `409 VERSION_CONFLICT`。

编辑内容同时保存在浏览器 IndexedDB 中。只有草稿基于服务端当前版本时才会自动恢复，旧版本草稿会保留提示，避免静默覆盖新内容。

V2 使用 Y.Doc 作为内容事实源：有效 Update 在广播前验证，网关以 1 秒防抖、最长 5 秒延迟保存完整文档，并通过 generation CAS 切换当前指针。保存失败保留 pending 并暂停写入；离房和正常停机也 flush。同步与持久化是独立状态，不创建 revision 或用户历史版本。浏览器离线更新重发由 Step08 完成。

## 默认地址

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 API | `http://localhost:8080/api` |
| 健康检查 | `http://localhost:8080/api/health` |
| Y.Doc 初始化服务（仅本机内部） | `http://127.0.0.1:8091/internal/initialize` |
| 协作网关（受控入口） | `ws://127.0.0.1:8092/collaboration` |
| Redis（仅本机内部） | `localhost:6379` |
| MinIO API | `http://localhost:9000` |
| MinIO 控制台 | `http://localhost:9001` |

实际地址以 `.env` 和本机服务配置为准。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DB_URL` | MySQL JDBC 连接地址 |
| `DB_USERNAME` / `DB_PASSWORD` | 应用数据库凭据 |
| `MINIO_ENDPOINT` | MinIO API 地址 |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO 凭据 |
| `MINIO_BUCKET` | 保存快照的私有 Bucket |
| `MINIO_INITIALIZE_BUCKET` | 启动时是否自动创建 Bucket |
| `SPRING_DATA_REDIS_HOST` / `SPRING_DATA_REDIS_PORT` | 本机 Redis 连接 |
| `AUTH_REDIS_NAMESPACE` | 刷新凭据与登录节流键前缀 |
| `JWT_SECRET` | JWT 的 HS256 签名密钥，至少 32 字节随机内容 |
| `COLLAB_CREATION_ENABLED` | 受控项目创建、复制和初始化重试开关，默认关闭 |
| `COLLAB_TICKET_ENABLED` / `COLLAB_GATEWAY_ENABLED` | Spring 票据与网关握手开关，默认关闭 |
| `COLLAB_INITIALIZER_SECRET` / `COLLAB_STORAGE_SECRET` / `COLLAB_GATEWAY_SECRET` | 三个独立的内部 HMAC 密钥 |
| `COLLAB_ALLOWED_ORIGINS` | 网关允许的精确 Origin，逗号分隔 |
| `COLLAB_SPRING_URL` / `COLLAB_GATEWAY_INTERNAL_URL` | 网关与 Spring 双向内部调用地址 |
| `COLLAB_INITIALIZER_NONCE_PATH` / `COLLAB_GATEWAY_NONCE_PATH` | Node 接收端的持久化 nonce 文件路径 |
| `ORPHAN_CLEANUP_CRON` | 孤立快照定时清理表达式 |
| `ORPHAN_CLEANUP_GRACE_PERIOD` | 孤立快照清理保护期 |

V2 配置模板见 [.env.example](.env.example)，协作接口和验收说明见 [collaboration/README.md](collaboration/README.md)，发布计划见 [步骤 11](docs/V__2/steps/11-release-deploy-and-functional-acceptance.md)。V1 部署和接口记录分别见 [docs/V__1/deployment.md](docs/V__1/deployment.md)与 [docs/V__1/api.md](docs/V__1/api.md)。

V2 本地启动时需在根 `.env` 中配置 `JWT_SECRET`，可用 PowerShell 生成随机值：`[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`。不要提交实际密钥。浏览器通过 Vite `/api` 代理同源请求；后端不开放浏览器跨源 CORS。

## 当前限制

- 单个项目最多 100 个文件；
- 单文件最大 1 MB，未压缩快照最大 10 MB；
- 支持 HTML、CSS、JavaScript、JSON、TXT 和 Markdown 文本文件；
- 文件路径必须以 `/` 开头，不能包含 `..`、反斜杠、空字符或空路径段。
