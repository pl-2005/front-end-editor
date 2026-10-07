# Web Editor API

> 历史归档：本文记录 V1 阶段行为，不代表当前 V2。旧匿名项目、快照写入及历史接口已隔离/关闭；当前说明见 [V2 索引](../V__2/README.md)，本地操作见 [开发指南](../V__2/development.md)。

基础路径为 `/api`。除 `204 No Content` 外，成功响应统一为：

```json
{"data": {}, "message": "ok", "status": 200}
```

错误响应包含 `status`、`code`、`message`、`path` 和 `timestamp`。参数校验错误还包含 `violations`。

## 项目

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/projects` | 创建项目 |
| `GET` | `/projects?page=0&size=20` | 分页查询项目元数据 |
| `GET` | `/projects/{id}` | 查询项目及当前完整文件快照 |
| `PUT` | `/projects/{id}` | 修改项目元数据 |
| `DELETE` | `/projects/{id}` | 软删除项目 |

创建请求：

```json
{"name":"示例项目","description":"可选","template":"vanilla","entry":"/index.html"}
```

## 快照和版本

保存当前文件：

```http
PUT /api/projects/{id}/snapshot
```

```json
{
  "expectedVersion": 3,
  "entry": "/index.html",
  "files": {
    "/index.html": {"code": "<main>Hello</main>"},
    "/index.js": {"code": "console.log('ready')"}
  }
}
```

内容未改变时返回当前版本；成功保存新内容时版本加一。`expectedVersion` 不是当前版本时返回 `409 VERSION_CONFLICT`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/projects/{id}/revisions` | 按版本号倒序查询历史 |
| `POST` | `/projects/{id}/revisions/{version}/restore` | 将历史内容恢复为一个新版本 |

恢复请求：

```json
{"expectedVersion": 3}
```

恢复不会倒退版本号。例如当前版本为 3，恢复版本 1 后会创建内容与版本 1 相同的版本 4。版本不存在返回 `404 REVISION_NOT_FOUND`。

## 限制与常见错误

- 最多 100 个文件；单文件最大 1 MB；未压缩快照最大 10 MB。
- 允许扩展名：HTML、CSS、JS、JSON、TXT、Markdown。
- 路径必须以 `/` 开头，且不能含 `..`、反斜杠、空字符或空路径段。
- `400 INVALID_SNAPSHOT`：文件或快照不符合限制。
- `404 PROJECT_NOT_FOUND` / `REVISION_NOT_FOUND`：资源不存在。
- `409 VERSION_CONFLICT`：已有其他编辑会话写入新版本。
- `503 STORAGE_UNAVAILABLE`：MinIO 暂时不可用。
