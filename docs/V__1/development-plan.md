# Web 在线编辑器开发方案

> 历史归档：本文记录 V1 阶段行为，不代表当前 V2。旧匿名项目、快照写入及历史接口已隔离/关闭；当前说明见 [V2 索引](../V__2/README.md)，本地操作见 [开发指南](../V__2/development.md)。

## 1. 项目目标

本项目实现一个面向 HTML、CSS 和 JavaScript 的 Web 在线编辑器。前端使用 Sandpack 提供虚拟文件、代码编辑、浏览器内构建和实时预览；后端使用 Spring Boot 管理项目及版本；MySQL 保存结构化元数据；MinIO 保存项目文件快照。

第一版包含以下能力：

- 创建、查询、修改和删除项目；
- 创建、编辑、重命名和删除文本文件；
- 实时预览 HTML、CSS 和 JavaScript；
- 展示运行日志和编译错误；
- 自动保存、手动保存及刷新恢复；
- 保存冲突检测和基础版本恢复。

第一版不支持 npm 依赖管理、服务端代码执行、多人实时协作和 Git 集成。

## 2. 总体架构

```text
React + Sandpack
├── 项目文件树
├── SandpackCodeEditor
├── SandpackPreview
├── SandpackConsole
└── 自动保存状态
        │ REST/JSON
        ▼
Spring Boot
├── 项目管理
├── 文件快照管理
├── 乐观锁与参数校验
└── MinIO 存储适配器
      │             │
      ▼             ▼
    MySQL          MinIO
  项目及版本元数据   压缩项目快照
```

代码编辑和预览完全在浏览器中完成。后端不编译或执行用户代码，只负责持久化、查询和版本管理。

## 3. 仓库结构

保留当前 Vite 前端结构，在仓库中新增独立的 Spring Boot 模块：

```text
front-end-editor/
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── api/
│   │   ├── editor/
│   │   ├── hooks/
│   │   ├── persistence/
│   │   └── types/
│   └── package.json
├── backend/                     # Spring Boot 后端
│   ├── pom.xml
│   └── src/main/
│       ├── java/
│       └── resources/
├── docs/
└── docker-compose.yml
```

后端按业务模块组织：

```text
backend/src/main/java/.../
├── project/
│   ├── controller/
│   ├── application/
│   ├── domain/
│   └── repository/
├── storage/
│   ├── MinioConfig.java
│   └── MinioStorageService.java
└── common/
    ├── exception/
    └── response/
```

## 4. 前端设计

### 4.1 技术选型

- React、TypeScript、Vite；
- `@codesandbox/sandpack-react`；
- IndexedDB，用于未保存草稿和网络失败恢复；
- 原生 `fetch` 或统一的轻量 API 客户端。

### 4.2 编辑器组成

```tsx
<SandpackProvider template="vanilla" files={project.files}>
  <EditorToolbar />
  <SandpackLayout>
    <ProjectFileTree />
    <SandpackCodeEditor showTabs showLineNumbers />
    <SandpackPreview showOpenInCodeSandbox={false} />
  </SandpackLayout>
  <SandpackConsole />
</SandpackProvider>
```

使用自定义 `ProjectFileTree` 完成新建、删除、重命名和目录展示，通过 Sandpack 上下文提供的文件操作同步运行时状态。加载不同项目或恢复版本时，应使用 `projectId + version` 作为 Provider 的 `key`，确保运行环境完全重建。

### 4.3 保存策略

- 用户停止编辑 1～2 秒后触发防抖保存；
- `Ctrl+S` 立即保存；
- 文件内容哈希未改变时跳过请求；
- 保存时携带当前 `expectedVersion`；
- HTTP 409 时停止覆盖并提示重新加载或另存副本；
- 请求失败时将最新草稿写入 IndexedDB，网络恢复后重试；
- 界面明确展示“未保存”“保存中”“已保存”和“保存失败”。

## 5. 后端设计

### 5.1 技术选型

- Spring Boot、JDK 21；
- Spring Web MVC；
- Spring Data JPA；
- Bean Validation；
- MySQL Driver；
- MinIO Java SDK；
- Flyway 数据库迁移。

### 5.2 核心接口

```http
POST   /api/projects
GET    /api/projects?page=0&size=20
GET    /api/projects/{id}
PUT    /api/projects/{id}
DELETE /api/projects/{id}

PUT    /api/projects/{id}/snapshot
GET    /api/projects/{id}/revisions
POST   /api/projects/{id}/revisions/{version}/restore
```

项目详情接口返回元数据和当前完整文件集合，使前端可以直接初始化 Sandpack。列表接口只返回元数据，不读取 MinIO 快照。

保存快照请求示例：

```json
{
  "expectedVersion": 3,
  "entry": "/index.html",
  "files": {
    "/index.html": { "code": "<div id=\"app\"></div>" },
    "/styles.css": { "code": "body { margin: 0; }" },
    "/index.js": { "code": "console.log('hello')" }
  }
}
```

成功后返回新版本号、内容哈希和保存时间。若 `expectedVersion` 与数据库当前版本不一致，返回 `409 Conflict`。

### 5.3 保存事务流程

1. 校验项目状态、版本号、文件路径、数量和大小；
2. 对规范化后的快照计算 SHA-256；
3. 若哈希与当前版本一致，直接返回当前版本；
4. 将 JSON 快照压缩为 GZIP，并上传新的 MinIO 对象；
5. 在 MySQL 事务中写入版本记录并更新项目当前版本；
6. 数据库失败时记录或删除已上传的孤立对象；
7. 定时清理没有数据库引用的 MinIO 对象。

MinIO 和 MySQL 无法组成同一个本地事务，因此必须先创建不可变对象，再提交数据库指针。禁止覆盖已有版本对象。

## 6. 数据模型

### 6.1 `project`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | bigint | 主键 |
| `name` | varchar(100) | 非空 |
| `description` | varchar(500) | 可空 |
| `template` | varchar(30) | 默认 `vanilla` |
| `entry_file` | varchar(255) | 默认 `/index.html` |
| `current_version` | int | 默认 0 |
| `current_object_key` | varchar(500) | 当前快照对象名 |
| `status` | tinyint | 1 正常，0 已删除 |
| `created_at` | datetime(6) | 创建时间 |
| `updated_at` | datetime(6) | 更新时间 |

### 6.2 `project_revision`

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `id` | bigint | 主键 |
| `project_id` | bigint | 项目外键，建立索引 |
| `version` | int | 项目内版本号 |
| `object_key` | varchar(500) | MinIO 对象名 |
| `content_hash` | char(64) | SHA-256 |
| `size_bytes` | bigint | 压缩后大小 |
| `created_at` | datetime(6) | 创建时间 |

对 `(project_id, version)` 和 `(project_id, content_hash)` 建立唯一索引。项目删除默认采用软删除，MinIO 对象由后台清理任务延迟删除。

## 7. MinIO 设计

Bucket 使用 `web-editor` 并保持私有：

```text
web-editor/
└── projects/
    └── {projectId}/
        └── revisions/
            ├── 1-{hash}.json.gz
            ├── 2-{hash}.json.gz
            └── 3-{hash}.json.gz
```

一个版本保存为一个完整快照，避免将每个文本文件存为独立小对象。完整快照方便原子加载、版本恢复、导出和迁移。MinIO 的访问密钥只配置在后端，不返回前端。

建议通过环境变量配置：

```text
DB_URL=jdbc:mysql://localhost:3306/web_editor
DB_USERNAME=...
DB_PASSWORD=...
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=web-editor
```

仓库仅提交 `.env.example` 或配置示例，不提交真实凭据。

## 8. 校验与安全

- 单项目最多 100 个文件；
- 单文件最大 1 MB，未压缩快照最大 10 MB；
- 第一版仅允许 HTML、CSS、JS、JSON、TXT 和 Markdown 文本；
- 文件路径必须以 `/` 开头，拒绝 `..`、反斜杠、空字符和重复路径；
- 后端不执行用户代码，不提供 shell 或 Node.js 环境；
- MinIO Bucket 不公开，前端只能通过业务 API 获取项目；
- 开发环境 CORS 仅允许 `http://localhost:5173`；
- API 使用统一错误格式，不向客户端泄露数据库或 MinIO 异常详情；
- 生产环境使用 HTTPS，并通过环境变量或密钥服务管理凭据。

## 9. 测试方案

前端重点测试文件操作、保存状态机、版本冲突处理和草稿恢复。后端使用 JUnit 及 Spring Boot Test 覆盖项目 CRUD、快照校验、乐观锁和异常映射；存储集成测试验证 MySQL 元数据与 MinIO 对象的一致性。合并前至少执行：

```bash
cd frontend
npm run lint
npm run build
cd ../backend
mvn test
```

## 10. 实施里程碑

### 阶段一：基础设施

- 创建 `backend/` 模块；
- 接通本地 MySQL 和 MinIO；
- 使用 Flyway 创建数据表；
- 完成统一响应和异常处理。

### 阶段二：项目持久化

- 实现项目 CRUD；
- 实现快照压缩、上传、读取和版本校验；
- 完成当前版本加载接口。

### 阶段三：Sandpack 编辑器

- 构建文件树、编辑器、预览和控制台布局；
- 接入项目加载、文件操作和保存 API；
- 实现防抖保存、状态提示和 IndexedDB 草稿。

### 阶段四：稳定性

- 增加版本列表和恢复；
- 补充测试、大小限制和异常提示；
- 增加孤立对象清理任务；
- 完成开发、部署和接口文档。

## 11. 第一版验收标准

- 可以创建、打开、重命名和删除项目；
- 可以管理多个 HTML、CSS 和 JavaScript 文件；
- 编辑结果能够实时预览并显示控制台信息；
- 刷新页面后可以从后端恢复最近一次保存；
- 网络错误不会导致当前草稿直接丢失；
- 多页面同时编辑时不会静默覆盖较新的版本；
- MySQL 中不保存源码正文，MinIO 中不暴露真实访问凭据；
- 前后端构建、Lint 和自动化测试全部通过。
