# 当前项目数据流

本文描述当前已实现的单人编辑器数据流。浏览器中的 Sandpack 负责编辑和预览；后端负责项目元数据、快照版本管理；MySQL 保存结构化元数据，MinIO 保存压缩后的文件快照，IndexedDB 保存尚未同步的本地草稿。

## 总览

```mermaid
flowchart LR
    U[用户]
    subgraph Browser[浏览器 / React 前端]
        APP[App 项目界面与状态]
        API[API 客户端 fetch /api]
        SP[Sandpack 编辑器与预览]
        SAVE[自动保存 / 手动保存]
        IDB[(IndexedDB 本地草稿)]
    end
    subgraph Server[Spring Boot 后端]
        C[ProjectController]
        PS[ProjectService]
        SS[SnapshotService]
        VAL[快照校验与编解码]
        REPO[Spring Data JPA Repository]
        STORE[SnapshotStorage / MinIO 适配器]
    end
    DB[(MySQL)]
    OBJ[(MinIO 快照对象)]

    U --> APP
    APP <--> SP
    SP --> SAVE
    SAVE --> IDB
    APP <--> API
    SAVE <--> API
    API <--> C
    C --> PS
    C --> SS
    PS <--> REPO
    SS --> VAL
    SS <--> REPO
    SS <--> STORE
    REPO <--> DB
    STORE <--> OBJ
```

## 项目打开与草稿恢复

```mermaid
sequenceDiagram
    actor U as 用户
    participant A as App / 前端
    participant API as 项目 API
    participant PS as ProjectService
    participant DB as MySQL
    participant MINIO as MinIO
    participant IDB as IndexedDB
    participant SP as Sandpack

    A->>API: GET /api/projects?size=100
    API->>PS: 查询项目列表
    PS->>DB: 查询有效项目元数据
    DB-->>A: 项目摘要（版本、名称等）
    A->>API: GET /api/projects/{id}
    API->>PS: 获取项目详情
    PS->>DB: 查询元数据和当前快照对象键
    opt 项目已有快照
        PS->>MINIO: 读取并解压当前快照
        MINIO-->>A: entry 与 files
    end
    A->>IDB: 按 projectId 读取本地草稿
    IDB-->>A: baseVersion、entry、files（若存在）
    Note over A: 仅当草稿 baseVersion 等于服务端 version 时自动恢复
    A->>SP: 初始化编辑器文件并运行预览
```

## 编辑与保存

```mermaid
sequenceDiagram
    actor U as 用户
    participant SP as Sandpack 编辑器
    participant SAVE as useProjectSave
    participant IDB as IndexedDB
    participant API as PUT /api/projects/{id}/snapshot
    participant SS as SnapshotService
    participant DB as MySQL
    participant MINIO as MinIO

    U->>SP: 编辑代码 / 新建或删除文件
    SP->>SAVE: 当前 entry 与 files 改变
    SAVE->>IDB: 写入草稿（包含 baseVersion）
    Note over SAVE: 内容变更后 1.5 秒自动保存；也支持 Ctrl/Cmd+S 与网络恢复后重试
    SAVE->>API: expectedVersion + entry + files
    API->>SS: 校验并保存快照
    SS->>SS: 校验路径/文件限制，计算哈希并 GZIP 编码
    SS->>DB: 锁定项目并检查 currentVersion
    alt expectedVersion 匹配且内容有变化
        SS->>MINIO: 写入不可变压缩快照
        SS->>DB: 新增 revision 并更新项目当前版本/对象键
        DB-->>SAVE: 新 version、stateVersion、hash
        SAVE->>IDB: 删除已同步草稿
    else 内容哈希与当前版本相同
        SS-->>SAVE: 返回当前版本，不重复创建版本
        SAVE->>IDB: 删除已同步草稿
    else 版本不匹配（409）
        SS-->>SAVE: VERSION_CONFLICT
        SAVE->>IDB: 保留草稿
        Note over SAVE: 标记冲突，用户可重新加载或另存副本
    end
```

## 版本历史与恢复

```mermaid
sequenceDiagram
    actor U as 用户
    participant UI as RevisionHistory
    participant API as 项目 API
    participant PS as ProjectService
    participant SS as SnapshotService
    participant DB as MySQL
    participant MINIO as MinIO

    U->>UI: 打开版本历史
    UI->>API: GET /api/projects/{id}/revisions
    API->>PS: 查询版本摘要
    PS->>DB: 查询 revision 元数据
    DB-->>UI: 版本号、时间、大小、当前标记
    U->>UI: 选择一个历史版本并确认
    UI->>API: POST /api/projects/{id}/revisions/{version}/restore（expectedVersion）
    API->>SS: 恢复指定版本
    SS->>DB: 锁定项目、检查当前版本并查找源 revision
    SS->>MINIO: 读取源快照
    SS->>MINIO: 以新版本对象键写入快照
    SS->>DB: 新增 revision 并更新项目当前版本
    API-->>UI: 返回新版本信息
    UI->>API: GET /api/projects/{id}（重新加载）
```

## 数据归属与一致性

| 数据 | 存放位置 | 说明 |
| --- | --- | --- |
| 项目名称、模板、入口、当前版本与对象键、状态 | MySQL `Project` | 删除采用软删除；元数据更新使用 `If-Match`/状态版本保护。 |
| 版本号、对象键、内容哈希、压缩大小、创建时间 | MySQL `ProjectRevision` | 每次内容变化或版本恢复新增一条版本记录。 |
| entry 与完整文件集合 | MinIO | 按项目与版本保存 GZIP 压缩快照，文件内容不存入 MySQL。 |
| 尚未保存的 entry 与文件集合 | 浏览器 IndexedDB | 以 projectId 为键，记录其基于的服务端版本；版本相符才自动恢复。 |
| 当前编辑内容与运行预览 | 浏览器内存 / Sandpack | Sandpack 在客户端运行项目代码，后端不执行用户代码。 |

恢复旧版本会复制其快照内容并创建一个新的当前版本，历史记录不会被覆盖。项目快照保存使用项目当前内容版本做并发检查；项目重命名、删除等元数据操作则使用独立的 `stateVersion` / ETag 检查。
