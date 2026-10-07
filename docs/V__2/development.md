# V2 本地开发、配置与验证

所有应用运行和功能验收使用仓库根 `.env`，连接本机 MySQL、MinIO、Redis；不使用 Docker 或 Docker Compose，不打印或提交凭据。完整生产构建本机入口见 [项目 README](../../README.md)，发布操作见 [发布说明](step11-release.md)。

## 环境准备

需要 Node.js 24+、JDK 21、Maven 3.9+、MySQL 8、MinIO 和 Redis；联合备份另需本机 mysqldump。首次配置从 [.env.example](../../.env.example)创建根 `.env`，已有配置不要覆盖。数据库须预先创建，应用用户须能执行 Flyway V1–V13；JPA 使用 validate，MinIO 默认自动初始化私有 bucket。

前端与协作模块分别执行 `npm ci`，依赖以各自 lockfile 为准。推荐 Windows 构建脚本 `collaboration/scripts/build-step11.ps1` 执行后端打包、前端测试/lint/类型检查/构建、协作测试并生成不可覆盖发布包。脚本使用 `mvn -o`；首次依赖未缓存时，可先在 backend 执行 `mvn dependency:go-offline`，缺失插件依赖按 Maven 提示准备后再构建。构建无需读取或输出 `.env`。

## 配置分组

下表列出当前运行用配置名与非敏感默认值，密钥实际值只保留在根 `.env` 或受限进程环境。

| 配置 | 用途/默认策略 |
| --- | --- |
| DB_URL、DB_USERNAME、DB_PASSWORD | MySQL JDBC 与应用账号 |
| MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY | MinIO API 与凭据 |
| MINIO_BUCKET、MINIO_INITIALIZE_BUCKET | 私有 bucket；默认 web-editor、true |
| SPRING_DATA_REDIS_HOST/PORT/USERNAME/PASSWORD/SSL_ENABLED | Redis；默认 localhost:6379、无 SSL |
| JWT_SECRET、JWT_ISSUER、JWT_AUDIENCE、JWT_ACCESS_TTL | 独立签名密钥；默认 issuer=web-editor、audience=web-editor-api、TTL=10m |
| AUTH_REDIS_NAMESPACE | 刷新与节流前缀；默认 web-editor:auth |
| AUTH_REFRESH_IDLE_TIMEOUT/MAX_LIFETIME、AUTH_MAX_REFRESH_FAMILIES_PER_USER | 默认 30m、12h、5 |
| COLLAB_CREATION_ENABLED/TICKET_ENABLED/GATEWAY_ENABLED | 创建、票据、握手开关；默认全部 false |
| COLLAB_INITIALIZER_SECRET/STORAGE_SECRET/GATEWAY_SECRET | 三个独立 HMAC 密钥，均至少 32 字节，不与 JWT 复用 |
| COLLAB_INITIALIZER_URL/PORT | 默认 loopback:8091/internal/initialize、8091 |
| COLLAB_GATEWAY_PORT/INTERNAL_URL、COLLAB_SPRING_URL | 默认网关 8092、Spring 8080 |
| COLLAB_ALLOWED_ORIGINS | 逗号分隔精确 Origin；默认 http://localhost:5173 |
| COLLAB_INITIALIZER_NONCE_PATH/GATEWAY_NONCE_PATH | 持久 SQLite；升级保留，不使用临时发布目录 |
| COLLAB_MAX_ROOMS/CONNECTIONS/ROOM_CONNECTIONS | 默认 50/200/20 |
| COLLAB_MAX_MEMORY_BYTES | 默认 512 MiB |
| COLLAB_MAX_MESSAGES_PER_SECOND/BYTES_PER_SECOND | 每连接默认 100 条/秒、4 MiB/秒 |
| COLLAB_MAX_PENDING_BYTES/PENDING_UPDATES | 每房默认 24 MiB/10000 |
| COLLAB_RECOVERY_WINDOW/CONFIRMATION_WINDOW/CLEANUP_CRON | 协作清理默认 30d/24h/每日 04:00 |
| ORPHAN_CLEANUP_CRON/GRACE_PERIOD | V1 projects/ 清理默认每日 03:30/24h |
| COLLAB_MAINTENANCE_ENABLED/SECRET/URL | 默认 false；独立维护密钥；默认 loopback:8080 |
| COLLAB_BACKUP_RETAIN_DAYS、MYSQLDUMP_PATH | 备份默认 30 天；可指定 mysqldump 路径 |
| LOCAL_API_URL、LOCAL_COLLAB_URL、LOCAL_VITE_CACHE_DIR | 仅 Vite 服务端读取的开发代理/缓存覆盖 |

以上共享前缀的缩写均展开为完整变量名，例如 `COLLAB_MAX_PENDING_UPDATES`。`DB_NAME`、`DB_ROOT_PASSWORD` 是模板附带变量，当前 Spring 不读取；应用不需要数据库 root 账号。浏览器配置不得承载内部密钥或服务凭据。

固定协议限制为 100 文件、1 MiB/文件、10 MiB 总正文、12 MiB Y.Doc、2 MiB Update；离线待确认日志 1.5 MiB，200 KiB 以上文件降低语言服务。网关可配置参数须为正安全整数。

## 分进程开发

受控开发时在根 `.env` 设置 creation/ticket/gateway=true、maintenance=false，配置独立密钥及精确页面 Origin。生产默认关闭策略见发布说明。V2 编辑器需要 Spring、初始化服务与网关，仅启动 Vite/API 不足以编辑。

终端一在仓库根执行，下例通过 Node 的 dotenv 解析器加载配置，避免引号被当作密钥字符；解析结果直接赋值，不输出凭据：

```powershell
$taskConfigJson = @'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
process.stdout.write(JSON.stringify(parseEnv(readFileSync('.env', 'utf8'))))
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw '读取根配置失败' }
$taskConfig = $taskConfigJson | ConvertFrom-Json
$taskConfig.PSObject.Properties | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process')
}
Remove-Variable taskConfigJson, taskConfig
Push-Location backend
mvn spring-boot:run '-Dspring-boot.run.arguments=--server.address=127.0.0.1'
Pop-Location
```

终端二、三分别从仓库根启动两个 Node 服务，启动器自行读取根 `.env`：

```powershell
Push-Location collaboration
npm run build
npm start
Pop-Location
```

```powershell
Push-Location collaboration
npm run start:gateway
Pop-Location
```

终端四从仓库根执行 `cd frontend`、`npm run dev`，打开 `http://localhost:5173`。Vite 读取根 `.env` 的本地代理配置；`/api` 默认代理到 localhost:8080，精确 `/collaboration` 默认代理到 loopback:8092。Origin 白名单须与实际浏览器地址完全一致，localhost 与 127.0.0.1 是不同 Origin。

## 检查与验收

普通代码检查从仓库根执行；每组检查确认成功后再继续：

```powershell
Push-Location frontend
npm run lint
npm test
npm run build
Pop-Location
Push-Location backend
mvn test
Pop-Location
Push-Location collaboration
npm test
Pop-Location
```

后端快速测试使用测试配置/H2 等隔离替身，不证明本机三服务可用。应用功能验收脚本读取根 `.env` 并连接本机真实服务，保留其新增账号、团队、项目和对象，结束关闭自己启动的进程；不得把验收账号/备份或凭据提交 Git。

完整检查和验收优先使用以下现有入口：

```powershell
./collaboration/scripts/build-step11.ps1
Push-Location collaboration
node scripts/verify-step11-local.mjs
# 需要已连接的 web-access CDP proxy 时追加 --browser
Pop-Location
```

`--browser` 默认使用 localhost:3456，可通过进程变量 CDP_PROXY_URL 覆盖，只操作验收标签页。Step11 后端/网关/初始化/前端端口为 18098/18099/18100/15175；与 `start:local` 不得同时运行。脚本前端默认 `.codex-build/step11-frontend`，可用 STEP11_FRONTEND_DIR 指定其他已构建目录。

阶段脚本与所需后端构建目录如下，命令在 collaboration 目录运行；后端 jar 文件名统一为 backend-0.1.0-SNAPSHOT.jar。后端在 backend 目录执行 `mvn -o package "-Deditor.build.directory=绝对构建目录"`，Node 脚本运行前须构建 collaboration。07/08 浏览器脚本还需前端依赖和 CDP proxy；10 仅 --browser 时需要 proxy，11 使用构建静态前端。

| 阶段 | 脚本 | 根目录下后端构建目录 |
| --- | --- | --- |
| 05 | scripts/verify-local.mjs | .codex-build/step05-backend |
| 06 | scripts/verify-step06-local.mjs | .codex-build/backend-check |
| 07 | scripts/verify-step07-local.mjs | .codex-build/step07-backend |
| 08 | scripts/verify-step08-local.mjs | .codex-build/step08-backend |
| 09 | scripts/verify-step09-local.mjs | .codex-build/step09-backend |
| 10 | scripts/verify-step10-local.mjs | .codex-build/step10-backend |
| 11 | scripts/verify-step11-local.mjs | .codex-build/step11-backend |

原有 Step11 记录为后端 59、协作 25、前端 82 项测试及本机流程通过；这些是历史交付证据，后续测试数量变化以实际输出为准，不宣称每次文档更新均已重跑。详细覆盖见 [步骤 11](steps/11-release-deploy-and-functional-acceptance.md)。

## 常见排查

| 现象 | 检查 |
| --- | --- |
| LOCAL_START_FAILED | 三服务、独立密钥、构建产物、端口占用；受限日志位于 .codex-build |
| 协作暂未开放/连接失败 | 三项开关、初始化/API/网关进程、Origin 与精确 WS 代理 |
| 已同步但未持久化 | pending/durable 指纹、MinIO/MySQL、CAS、paused；不丢弃队列 |
| 刷新后需要登录 | 凭据仅放内存，是当前设计；授权后再恢复同 epoch 日志 |
| 409 或 428 | 重新取得元数据 ETag 并显式重试；不使用 generation 替代 |
| 项目被 fence | 查询 operation/recovery 与 Outbox，按运维对账；不删除 nonce/fence 文件 |

`/api/health` 仅是进程健康；readiness 只检查数据库。备份和恢复依 [运维说明](step10-operations.md)，不可手工猜测或修改对象指针。
