# 开发与部署

> 历史归档：本文记录 V1 阶段行为，不代表当前 V2。旧匿名项目、快照写入及历史接口已隔离/关闭；当前说明见 [V2 索引](../V__2/README.md)，本地操作见 [开发指南](../V__2/development.md)。

## 本地开发

要求 Node.js 20+、JDK 21、Maven 3.9+，以及本机安装并运行的 MySQL 8 和 MinIO。
本项目的本地开发和验收统一读取仓库根目录 `.env`，不使用 Docker。

先按 `.env` 中的地址和凭据启动本机 MySQL、MinIO，再在 PowerShell 中启动后端：

```powershell
cd backend
Get-Content ..\.env | ForEach-Object {
  if ($_ -match '^\s*([^#][A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
mvn spring-boot:run

# 新终端
cd frontend
npm install
npm run dev
```

Vite 开发服务器通过 `/api` 代理后端。默认地址：前端 `http://localhost:5173`、API `http://localhost:8080`、MinIO 控制台 `http://localhost:9001`。

## 环境变量

复制 `.env.example` 并替换所有凭据。生产环境必须通过部署平台的密钥管理注入密码，不要提交 `.env`。

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DB_URL` | MySQL JDBC URL | 本机 `web_editor` 数据库 |
| `DB_USERNAME` / `DB_PASSWORD` | 数据库凭据 | 仅开发默认值 |
| `MINIO_ENDPOINT` | MinIO API 地址 | `http://localhost:9000` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO 凭据 | 仅开发默认值 |
| `MINIO_BUCKET` | 私有快照 Bucket | `web-editor` |
| `MINIO_INITIALIZE_BUCKET` | 启动时创建 Bucket | `true` |
| `CORS_ALLOWED_ORIGINS` | 允许的前端来源 | `http://localhost:5173` |
| `ORPHAN_CLEANUP_CRON` | 孤立对象清理计划 | 每天 03:30 |
| `ORPHAN_CLEANUP_GRACE_PERIOD` | 新对象清理保护期 | `24h` |

清理任务只删除保护期之前、且没有 `project_revision` 引用的 `projects/` 对象，避免删除仍在事务提交过程中的上传。

## 生产部署要点

1. 使用外部 MySQL 8 和私有 MinIO Bucket，限制后端账号权限。
2. 后端以 JDK 21 运行；Flyway 在启动时自动执行数据库迁移。
3. 使用 `npm run build` 生成前端静态文件，由 CDN 或反向代理提供。
4. 将 `/api` 转发至 Spring Boot，并仅通过 HTTPS 对外服务。
5. 设置准确的 `CORS_ALLOWED_ORIGINS`，不要在生产环境使用通配来源。
6. 备份 MySQL 与 MinIO；两者必须作为同一恢复点管理。

## 发布前检查

```bash
cd frontend
npm run lint
npm run test
npm run build
cd ../backend
mvn test
```

健康检查地址为 `GET /api/health`。接口细节见 [api.md](api.md)。
