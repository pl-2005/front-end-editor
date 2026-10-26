# Web Editor

面向 HTML、CSS 和 JavaScript 的浏览器多人编辑器。用户注册登录后创建或加入团队，团队成员共同编辑项目文件；Monaco 提供补全与诊断，Sandpack 提供预览和控制台，Yjs 负责同步与离线合并。

V2 步骤 01–11 已开发完成，原有自动检查和本机功能验收记录见 [V2 交付索引](docs/V__2/README.md)。当前交付范围为本机运行，公网入口切换、目标 nginx/TLS 验证及历史候选回滚尚未执行。

## 功能与边界

- 自助注册、登录、凭据刷新、改密和退出所有设备。
- 团队创建、发现、加入审批、站内邀请、成员管理和所有权转移；OWNER 管理成员，所有有效成员对团队项目同权。
- 项目创建、复制、修改元数据和软删除；多文件协作、文件结构操作、在线成员及远端光标。
- 文件树工具栏及文件夹菜单支持多选上传到当前目录；接受 UTF-8 的 HTML/CSS/JS/JSON/TXT/Markdown，同名文件不会覆盖，整批校验失败时不导入任何文件；上传后通过现有协作同步自动持久化。
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

### 一键启动开发环境

首次在 `frontend` 和 `collaboration` 分别执行 `npm ci`，准备好本机 MySQL、MinIO、Redis 后，从仓库根目录运行：

```powershell
./start-dev.ps1
```

Windows 也可直接双击根目录 `start-dev.bat`，同样会提示输入前端数量。启动器失败时窗口保留错误信息；也支持在命令行执行 `start-dev.bat -FrontendCount 3` 或 `start-dev.bat -Check`。

脚本会提示输入前端实例数量，直接回车默认为两个；也可用 `./start-dev.ps1 -FrontendCount 3` 直接指定数量，跳过输入。数量必须为正整数，端口从 `5173` 连续分配（两个实例为 `http://localhost:5173` 和 `http://localhost:5174`），最大端口为 `65535`；端口被占用时直接报错，不自动换端口。

脚本自动构建协作模块，随后为后端 `EditorApplication`（`mvn spring-boot:run`）、`collaboration` 的 `npm run start`、`npm run start:gateway` 分别打开 PowerShell 窗口并最小化，优先使用已安装的 PowerShell 7（`pwsh.exe`），未安装时回退到 Windows PowerShell；服务窗口正常加载 PowerShell 配置文件。安装了 Windows Terminal 时，为每个服务创建独立终端窗口，等待真实窗口出现后再最小化，确保能从任务栏恢复查看日志；未安装时使用普通 PowerShell 窗口。前端通过与 `npm run dev` 相同的 Vite 入口在后台运行，不显示 PowerShell 窗口；每个实例就绪后，使用默认浏览器打开对应地址。后端从根 `.env` 加载配置，Node 服务和 Vite 沿用各自的根 `.env` 读取逻辑。

启动器会先等待后端 `/api/health/readiness` 返回 `UP`（包含数据库就绪检查），并确认协作初始化服务和网关端口可连接，随后才启动后台前端，由 Vite 在自身就绪后打开浏览器，避免后端尚未启动时出现 502。地址从根 `.env` 的 `LOCAL_API_URL`、`COLLAB_INITIALIZER_URL`、`LOCAL_COLLAB_URL` / `COLLAB_GATEWAY_PORT` 读取，未配置时沿用开发默认值。默认最多等待 180 秒，超时会显示未就绪的服务并取消前端启动与浏览器打开；可用 `./start-dev.ps1 -StartupTimeoutSeconds 300` 调整。

重复运行启动器时，会结合本仓库的进程路径、进程树和监听端口检测各模块，跳过已经运行或正在启动的服务，只补齐未运行的模块。已运行的前端不会重复打开浏览器；增加前端数量时只启动新增端口对应的实例。其他程序占用所需端口时明确报错。启动锁可避免连续双击导致两个启动器同时创建服务；初始化服务和网关均已运行时也跳过重复构建。

根 `.env` 需按上述[分进程开发说明](docs/V__2/development.md#分进程开发)开启创建、票据和网关，并在 `AUTH_ALLOWED_ORIGINS`、`COLLAB_ALLOWED_ORIGINS` 中允许所有实际使用的前端地址；例如启动第三个实例时需加入 `http://localhost:5175`。脚本不修改 `.env`；后端与协作服务端口、数据库和对象存储地址以其中的配置为准。

后端、初始化服务和网关的日志实时输出到各自的 PowerShell 窗口，不保存日志文件；前端后台运行时不保留日志，调试前端可在 `frontend` 目录手动运行 `npm run dev`。可见窗口标题固定显示 `编辑器 | 后端服务`、`编辑器 | 协作初始化`、`编辑器 | 协作网关`，自动恢复 Maven/npm 覆盖的标题。可见服务窗口在服务退出或启动失败后仍保留，便于查看错误。各服务独立运行，可在对应窗口按 `Ctrl+C` 停止该服务；后台前端通过 `stop-dev.bat` 统一停止。不要与使用相同端口的其他开发实例同时运行。

可执行 `./start-dev.ps1 -Check` 仅检查启动命令是否存在、根 `.env` 是否可解析及两个模块是否已安装依赖；此检查不打开窗口或启动服务，也不验证数据库连通性、配置有效性或端口占用。

双击根目录 `stop-dev.bat`，或执行 `./stop-dev.ps1`，可一次关闭本仓库启动器打开的全部服务窗口及其 Maven、Node、Vite 子进程，包括已最小化的窗口和后台前端。通过启动命令中的仓库路径识别服务，也支持已启动的旧窗口；不会停止本机 MySQL、MinIO、Redis 或其他项目的进程。启动器仅在 `.codex-build/dev-sessions/` 保存窗口句柄、标题及宿主进程标识，供关闭脚本校验并关闭 Windows Terminal 保留的空窗口，不保存服务日志或凭据。关闭采用进程树强制终止，请先等待编辑内容持久化完成。`./stop-dev.ps1 -WhatIf` 可预览关闭范围。

Windows 窗口回归验证可执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-dev-windows.ps1`：它创建三个独立的临时服务窗口，验证最小化后的任务栏窗口条件及统一关闭行为，结束后清理临时进程和窗口，不启动真实应用服务。

重复启动验证可执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-dev-processes.ps1`，覆盖进程归属、端口冲突、启动中和失败窗口、重复启动及增加前端实例数量；验证使用进程快照，不启动或停止真实服务。

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
- [文件上传、目录管理与限制](docs/V__2/file-explorer.md)
- [指标、备份与恢复](docs/V__2/step10-operations.md)
- [发布、回滚与本机运行](docs/V__2/step11-release.md)

V1 快照、版本历史和匿名项目资料仅供历史参考；旧数据保留且隔离，不进入 V2 用户流程。

浏览器登录使用 HttpOnly 刷新 Cookie，页面重载先恢复有效会话；访问令牌仅保留在内存。多标签页需要 Web Locks 和站点存储。认证 Origin/Cookie 配置、开发方案及验收见 [浏览器会话恢复](docs/auth-session/README.md)。
