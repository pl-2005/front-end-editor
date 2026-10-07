# Web Editor

面向 HTML、CSS 和 JavaScript 的浏览器多人编辑器。用户注册登录后创建或加入团队，团队成员共同编辑项目文件；Monaco 提供补全与诊断，Sandpack 提供预览和控制台，Yjs 负责同步与离线合并。

V2 步骤 01–11 已开发完成，原有自动检查和本机功能验收记录见 [V2 交付索引](docs/V__2/README.md)。当前交付范围为本机运行，公网入口切换、目标 nginx/TLS 验证及历史候选回滚尚未执行。

## 功能与边界

- 自助注册、登录、凭据刷新、改密和退出所有设备。
- 团队创建、发现、加入审批、站内邀请、成员管理和所有权转移；OWNER 管理成员，所有有效成员对团队项目同权。
- 项目创建、复制、修改元数据和软删除；多文件协作、文件结构操作、在线成员及远端光标。
- HTML/CSS/JS 补全与诊断、JS checkJs、文本撤销/重做、预览和运行日志。
- 自动持久化当前 Y.Doc、有界离线日志、重新授权后合并；同步与持久化分别显示。
- 删除前持久化并冻结房间，撤权关闭旧连接；指标、联合备份、当前内容恢复和发布包校验。

首期为单网关实例。支持 HTML/CSS/JS/JSON/TXT/Markdown；每项目最多 100 文件，单文件 1 MiB、总正文 10 MiB、Y.Doc 12 MiB、Update 2 MiB。超过 200 KiB 的文件使用基础高亮并停用昂贵语言服务。V2 不提供用户历史版本、检查点或历史回退，也不提供 npm 依赖管理、服务端代码执行或 Git 集成。

## 本机快速运行

准备 Node.js 24+、JDK 21、Maven 3.9+ 和本机 MySQL 8、MinIO、Redis。使用仓库根 `.env` 配置服务与独立密钥；仅首次配置时复制 [.env.example](.env.example)，不要覆盖已有 `.env`。不使用 Docker 或 Docker Compose，不打印或提交凭据。

以下命令从仓库根目录执行；首次安装依赖，已有安装可跳过 `npm ci`。构建脚本使用 Maven 离线模式，首次使用须先准备 Maven 依赖，具体见 [开发指南](docs/V__2/development.md)。

```powershell
Push-Location frontend
npm ci
Pop-Location
Push-Location collaboration
npm ci
Pop-Location
./collaboration/scripts/build-step11.ps1
Push-Location collaboration
npm run start:local
Pop-Location
```

打开 `http://127.0.0.1:15175`，注册并登录后创建团队和项目。启动器读取根 `.env`，仅在本次进程开启创建、票据和网关，不改写根配置。它提供构建后的前端及同源 REST/WebSocket；正常 `Ctrl+C` 停止会先 flush 网关。运行期间不要同时执行 Step11 验收，两者使用同一组端口。

| 服务 | 本机完整启动器 | 分进程开发默认值 |
| --- | --- | --- |
| 浏览器入口 | `http://127.0.0.1:15175` | `http://localhost:5173` |
| Spring API | `http://127.0.0.1:18098/api` | `http://localhost:8080/api` |
| 协作网关 | `ws://127.0.0.1:18099/collaboration` | `ws://127.0.0.1:8092/collaboration` |
| 初始化服务 | `http://127.0.0.1:18100/internal/initialize` | `http://127.0.0.1:8091/internal/initialize` |

MySQL、MinIO 和 Redis 的实际地址以根 `.env` 为准。内部路径由浏览器入口阻断；浏览器只访问同源 `/api/` 和精确 `/collaboration`。

## 技术与结构

| 模块 | 技术与职责 |
| --- | --- |
| `frontend/` | React、TypeScript、Vite、Ant Design、Monaco、Yjs、Sandpack、IndexedDB；身份与团队界面、协作编辑和预览 |
| `backend/` | Java 21、Spring Boot 3.5、Security、JPA、Flyway；身份、授权、元数据、指针与控制事件 |
| `collaboration/` | Node.js 24+、Hocuspocus 4.7、Yjs；初始化、网关、自动持久化和运维工具 |
| 数据服务 | MySQL 8、私有 MinIO、Redis；Node 接收端以 SQLite 持久化 nonce/fence |
| `deploy/` | 同源 nginx 配置模板 |
| `docs/V__2/` | 当前设计、开发、接口、运维、发布及步骤记录 |
| `docs/V__1/` | V1 历史资料 |

## 文档入口

[全部文档索引](docs/README.md)按使用场景导航。当前版本重点文档：

- [V2 交付状态与步骤记录](docs/V__2/README.md)
- [架构](docs/V__2/architecture.md)与[数据流](docs/V__2/data-flow.md)
- [REST API](docs/V__2/api.md)与[协作内部协议](collaboration/README.md)
- [本地开发、配置与验证](docs/V__2/development.md)
- [指标、备份与恢复](docs/V__2/step10-operations.md)
- [发布、回滚与本机运行](docs/V__2/step11-release.md)

V1 快照、版本历史和匿名项目资料仅供历史参考；旧数据保留且隔离，不进入 V2 用户流程。
