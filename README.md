# Web Editor

面向 HTML、CSS 和 JavaScript 的在线编辑器。前端使用 React/Vite，后端使用 Spring Boot；MySQL 保存项目元数据，MinIO 保存不可变的项目快照。

## 本地启动

要求 Node.js 20+、JDK 21、Maven 3.9+，以及本机安装并运行的 MySQL 8 和 MinIO。
本项目使用仓库根目录的 `.env` 连接本地服务，不使用 Docker 进行开发或验收。

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

前端地址为 `http://localhost:5173`，后端健康检查为 `http://localhost:8080/api/health`，MinIO 控制台为 `http://localhost:9001`。

启动后端前，确保 `.env` 中配置的 MySQL 和 MinIO 服务已经在本机运行。不要提交 `.env`。

## 验证

```bash
cd frontend
npm run lint
npm run build
cd ../backend
mvn test
```

完整方案见 [docs/development-plan.md](docs/development-plan.md)。

接口说明见 [docs/api.md](docs/api.md)，环境变量与生产部署说明见 [docs/deployment.md](docs/deployment.md)。
