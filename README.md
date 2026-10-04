# Web Editor

一个面向 HTML、CSS 和 JavaScript 的浏览器在线编辑器。编辑与预览由 React、Vite 和 Sandpack 在浏览器中完成；Spring Boot 提供项目和版本管理 API，MySQL 保存元数据，MinIO 保存不可变的压缩文件快照。

> V2 已实现身份认证、团队授权和 Step05 协作存储底座。当前代码强制 Bearer 认证并隔离 V1 匿名项目；受控新项目直接初始化并持久化 Y.Doc，创建、复制和初始化重试说明见 [collaboration/README.md](collaboration/README.md)。协作网关、编辑器接入与删除协调仍待后续步骤。本页其余项目/版本说明记录的是 V1 功能，不代表当前 V2 代码已可公开切换。V2 实施顺序见 [docs/V__2/README.md](docs/V__2/README.md)。

## 已实现功能

- 项目：新建、打开、重命名和软删除；
- 文件：目录树展示，以及文本文件的新建、编辑、重命名和删除；
- 运行：实时预览、刷新预览、运行日志与编译错误控制台；
- 保存：停止编辑 1.5 秒后自动保存，也可使用 `Ctrl/Cmd + S` 手动保存；
- 草稿：未保存内容写入 IndexedDB，刷新或网络恢复后可继续处理；
- 并发保护：基于版本号检测写入冲突，可重新加载或另存副本；
- 版本历史：查看历史快照，并将任一历史内容恢复为一个新版本；
- 存储维护：启动时初始化 MinIO Bucket，并定时清理无数据库引用的孤立快照。

当前版本不支持 npm 依赖管理、服务端代码执行、多人实时协作或 Git 集成。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite、Sandpack、IndexedDB、Vitest |
| 后端 | Java 21、Spring Boot 3.5、Spring Web、Spring Data JPA、Bean Validation |
| 数据与存储 | MySQL 8、Flyway、MinIO |

## 项目结构

```text
front-end-editor/
├── frontend/                  # React 编辑器、预览、草稿与 API 客户端
├── backend/                   # Spring Boot API、领域逻辑和存储适配
├── docs/
│   ├── api.md                 # REST API 与错误说明
│   ├── deployment.md          # 环境变量和部署说明
│   └── development-plan.md    # 架构设计与验收标准
├── .env.example               # 本地配置模板
└── README.md
```

## 本地运行

### 1. 准备环境

- Node.js 20+
- JDK 21
- Maven 3.9+
- 本机运行的 MySQL 8 和 MinIO

本项目本地开发和验收使用仓库根目录的 `.env`，直接连接本机 MySQL 与 MinIO，不使用 Docker。首次运行可从模板创建配置：

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
```

## 数据与保存机制

Sandpack 在浏览器中编译和运行用户代码，后端不会执行项目代码。保存时前端携带当前版本号提交完整文件集合；后端校验内容并计算哈希，将 GZIP 快照写入 MinIO，再在 MySQL 中记录版本元数据。内容未变化时不会创建重复版本，版本不一致时返回 `409 VERSION_CONFLICT`。

编辑内容同时保存在浏览器 IndexedDB 中。只有草稿基于服务端当前版本时才会自动恢复，旧版本草稿会保留提示，避免静默覆盖新内容。

## 默认地址

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 API | `http://localhost:8080/api` |
| 健康检查 | `http://localhost:8080/api/health` |
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
| `ORPHAN_CLEANUP_CRON` | 孤立快照定时清理表达式 |
| `ORPHAN_CLEANUP_GRACE_PERIOD` | 孤立快照清理保护期 |

完整配置和生产部署建议见 [docs/deployment.md](docs/deployment.md)。接口请求、响应和限制见 [docs/api.md](docs/api.md)。

V2 本地启动时需在根 `.env` 中配置 `JWT_SECRET`，可用 PowerShell 生成随机值：`[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`。不要提交实际密钥。浏览器通过 Vite `/api` 代理同源请求；后端不开放浏览器跨源 CORS。

## 当前限制

- 单个项目最多 100 个文件；
- 单文件最大 1 MB，未压缩快照最大 10 MB；
- 支持 HTML、CSS、JavaScript、JSON、TXT 和 Markdown 文本文件；
- 文件路径必须以 `/` 开头，不能包含 `..`、反斜杠、空字符或空路径段。
