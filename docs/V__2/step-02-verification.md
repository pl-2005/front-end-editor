# 步骤 02 实施与验收记录

基线：步骤 01 通过验收后的工作区。开始时存在用户的 `README.md` 修改、V1 文档目录迁移和 V2 方案文档，这些改动保留，未重置或提交。

## 已实现

### 配置与启动期校验

- 新增 `editor.auth.*` 属性（`SecurityProperties`），在 `application.yml` 显式映射根 `.env` 的 `AUTH_*`、`SESSION_*`、`BOOTSTRAP_ADMIN_*`；`.env.example` 补齐占位值，本机 `.env` 追加非秘密默认值（不改动已有条目）。
- `AUTH_REGISTRATION_MODE` 缺失按 `INVITE_ONLY`；空值或非法值启动失败。`OPEN` 要求 `local`/`dev` profile 且 `AUTH_ALLOW_OPEN_REGISTRATION=true`，否则启动失败。
- `SESSION_MAX_LIFETIME` 不得短于 `SESSION_IDLE_TIMEOUT`；`BOOTSTRAP_ADMIN_ENABLED=true` 时用户名、密码、显示名必填，缺失即启动失败。
- `AUTH_ENFORCEMENT_ENABLED` 默认 `false`（暗置）。`cutover` 置位后若该开关为 false，readiness 保持 503（fail closed）。

### 数据库迁移

- `V4__create_identity_tables.sql`：`app_user`（`normalized_*` 使用 `utf8mb4_0900_bin`、状态/角色/版本 CHECK、email 成对约束）与只有固定键的 `system_bootstrap_lock`。
- `V5__create_spring_session_tables.sql`：Spring Session 官方 MySQL schema（主表、属性表、`PRINCIPAL_NAME` 索引）；`spring.session.jdbc.initialize-schema: never`，Flyway 是唯一建表者。
- V1–V3 未修改。集成测试验证 V3 存量项目/版本/对象指针在 V4/V5 之后保持不变。

### 安全链

- `SecurityConfig`：条件化授权矩阵（暗置态旧 `/api/projects/**` 保持匿名并忽略 CSRF；强制态匿名不可达业务 API、`/api/projects/**` 仅平台管理员）、CORS 精确来源 + credentials + 放行 `If-Match`/`X-XSRF-TOKEN` + 暴露 `ETag`/`Retry-After`、禁用 form login/HTTP Basic/重定向与 LogoutFilter。
- `JsonAuthenticationFilter`：严格 4 KiB 体积与 `login/password` 字段限制；节流 → 认证 → 完整会话策略 → 显式保存 SecurityContext → 删除旧 CSRF token → 返回安全用户视图；失败统一 401。
- `ActiveAccountFilter`（位于 SecurityContext 恢复之后、授权之前）：绝对期限、账号存在性、`ACTIVE` 状态与 `authz_version` 一致性；DISABLED/LOCKED 返回 423 并按 principal 撤销全部会话；版本不符或超时清理后返回 401。
- `JsonAuthenticationEntryPoint` / `JsonAccessDeniedHandler`：Filter 层直接输出统一 `ApiError`，CSRF 失败返回 403 `CSRF_INVALID`，其余权限不足 403 `ACCESS_DENIED`。
- 会话策略：`ChangeSessionIdAuthenticationStrategy` + `SessionLimitStrategy`（`SpringSessionBackedSessionRegistry` 枚举，超出 `AUTH_MAX_SESSIONS_PER_USER` 时淘汰最久未使用会话而非拒绝登录）。
- `LoginThrottle`：有容量与 TTL 的单实例缓存，键为规范化登录标识摘要 + 可信客户端 IP 摘要，连续失败指数递增延迟；`Retry-After` 为整数秒。仅在直连对端命中 `AUTH_TRUSTED_PROXIES` 时解析转发头。
- 密码使用 `DelegatingPasswordEncoder`（bcrypt）；rehash 使用 compare-and-set 且**不**递增 `authz_version`，因此不会无谓作废既有会话。

### 身份域与接口

- `IdentityService`：注册（固定 `ACTIVE/USER/authz_version=0`）、认证（账号不存在、密码错误、非 ACTIVE 统一为同一 401）、改密（校验当前密码、递增版本、撤销其他会话、保留当前会话）、平台状态/角色迁移（同事务递增版本，进入不可登录状态时删除全部会话）。
- `AuthController`：`GET /api/auth/csrf`（`Cache-Control: no-store`）、`POST /api/auth/register`（201，不自动登录）、`POST /api/auth/login`（Filter 处理）、`POST /api/auth/logout`（204）、`GET /api/auth/me`、`PUT /api/auth/password`（204，当前会话换发新 ID）。
- 登录、注册、`/me` 共用同一安全 DTO（`id/username/email/displayName/avatarColor/platformRole/globalCapabilities`），不含哈希、Session ID 或 `authzVersion`。
- `BootstrapAdminService`/`BootstrapAdminRunner`：固定行 `SELECT ... FOR UPDATE` 后复查用户表，只在 `app_user` 为空时创建首个 `ACTIVE/PLATFORM_ADMIN`，日志只记 user ID；已有账号但无 ACTIVE 管理员时拒绝创建并要求走恢复命令。
- `AdminRecoveryRunner`：`--spring.main.web-application-type=none --app.maintenance.recover-admin=true` 离线运行，web 上下文或参数不全即失败；新密码只从 stdin/密钥文件读取；恢复后置 `ACTIVE/PLATFORM_ADMIN`、递增版本并撤销全部会话。

### 健康检查

- `GET /api/health` 保持 liveness；新增匿名可读的 `GET /api/health/readiness`：初始化未完成、无 ACTIVE 平台管理员或 cutover 与强制认证状态矛盾时返回 503。

### 前端

- `api/client.ts`：统一 `credentials: 'include'`；GET 不无条件设置 `Content-Type`；非安全方法附加内存中的 CSRF token（header 名以服务端返回为准）；403 `CSRF_INVALID` 时清空 token、重取并**只重试一次**；401 清空 token 并广播未认证、423 广播账号状态且不重试、403 不退出；支持 204、非 JSON 错误与 `AbortSignal`；`Retry-After` 解析为整数秒。
- `api/auth.ts`、`types/auth.ts`：csrf 引导、注册、登录、退出、当前用户、改密；登录/改密/退出后立即重取 token。
- `api/projects.ts` 迁移到统一 client，保留步骤 01 的强 ETag 与 `If-Match` 行为。

## 验证命令与结果

前端：`npm run lint` 通过；`npm run test` 45 项通过（新增 client/auth 18 项）；`npm run build` 通过。

后端快速测试：`mvn test` 125 项通过（步骤 01 的 22 项全部保留并通过）。

真实集成：仓库根执行 `pwsh ./scripts/verify-integration.ps1`，加载根 `.env` 后执行 `mvn -Pintegration verify`：`BaselineIT` 5 项 + `IdentitySessionIT` 8 项通过，BUILD SUCCESS。集成运行使用专用**空** MySQL schema 与独占随机 MinIO Bucket，只清理本次创建的表与 Bucket，未使用 Docker，未打印 `.env`。

本机 HTTP 冒烟（`mvn spring-boot:run` 注入根 `.env`，端口 8080）：liveness 200、readiness 503 `no_active_platform_admin`、`/api/auth/csrf` 200 且带 `Cache-Control: no-store` 与 `HttpOnly; SameSite=Lax` Cookie、无 CSRF 的登录 403 `CSRF_INVALID`、带 CSRF 的未知账号登录 401、匿名 `/api/projects` 200（暗置态）、`/api/auth/me` 401、`INVITE_ONLY` 注册 503、登录多余字段 400、匿名 logout 401。冒烟后确认开发库 Flyway 版本为 V1–V5、`app_user` 为空、`auth_required_cutover=0`。

## 覆盖要点

- 登录/注册/改密/退出的 token 生命周期、失败不轮换 token、登录成功轮换；CSRF 缺失 403。
- 429 的整数 `Retry-After` 与 CORS `Access-Control-Expose-Headers`。
- 确定性规范化、用户名禁止 `@`、登录列选择、多字节 72 字节边界（拒绝而非截断）。
- 注册固定 USER 字段、拒绝客户端角色/状态/版本字段、注册模式 fail-safe、非开发 OPEN 拒绝、CLOSED/INVITE_ONLY 的 HTTP 契约。
- bootstrap：空库创建、`{bcrypt}` 落库、幂等不创建第二个管理员、有账号但无 ACTIVE 管理员时拒绝、离线恢复后 readiness 转 200（H2 与真实 MySQL 各覆盖一次）。
- Session：持久化跨 `ApplicationContext` 重启、按稳定 user-ID principal 撤销、最大会话数与最旧淘汰、绝对过期删除行、session fixation、改密保留当前会话并使其他会话失效。
- `AUTH_ENFORCEMENT_ENABLED` 两态请求矩阵（普通用户 403、平台管理员 200、匿名 401）；cutover 与强制认证矛盾时 readiness 503。
- 前端：credentials、CSRF 生命周期、401/403/423 分流、204/非 JSON 错误、GET 不带 `Content-Type`、秘密不进入任何浏览器持久层（含 IndexedDB）、项目 ETag 回归。
- 复审后补强：登录/改密轮换后旧 CSRF token 失效、错误 token 值 403、真实 `POST /api/auth/logout` 与 `PUT /api/auth/password` 的缺 token 场景、空闲超时落到 `MAX_INACTIVE_INTERVAL`、绝对期限不因访问续期、节流缓存的容量与 TTL 上限。

## 当前门禁

快速测试、前端检查与真实 MySQL/MinIO 集成测试全部通过。两轮独立子 agent 对抗式复审均给出「无阻塞问题」，第二轮确认结论对冻结制品成立并已实际执行集成验证。所有非阻塞项已逐项处理，步骤 03 可以开始。

### 独立复审与处理

复审确认为正确的关键点：两态授权矩阵（含 health 仅 GET、两种模式下都不存在匿名 `/api/projects` 通道）、`/api/auth/csrf` 响应体与 `Cache-Control: no-store`、`HttpOnly; SameSite=Lax`、登录失败不轮换 token、绝对期限删除行并清 Cookie、423 与 401 分流、bootstrap 单管理员与 readiness 三种 503 原因、`SessionRevocationService` 走 `PRINCIPAL_NAME` 索引、V4/V5 与规格 DDL 一致且含 `utf8mb4_0900_bin`、V1/V2 未修改、`.env.example` 只有占位值、无步骤 03 之后的越界实现。

据此修正的内容：

- 新增 `AuthEndpointTests` 三条用例，覆盖规格 §11 要求但此前缺失的「轮换旧 token 失效」与「错误 token」：登录成功后旧 token 再用即 403 `CSRF_INVALID`（且会话仍有效）、改密后同理、错误 token 值 403。
- 修正 `unsafeAuthEndpointsRequireCsrfToken`：此前发的是未映射的 `DELETE /api/auth/logout`，现在覆盖真实的 `POST /api/auth/logout`、`PUT /api/auth/password`、`POST /api/auth/register` 缺 token 场景。
- 新增 `SessionTimeoutTests`：把配置的空闲超时（7 分钟 → 420 秒）断言到 `SPRING_SESSION.MAX_INACTIVE_INTERVAL`，补上规格 §11 的「idle」一半。
- 强化绝对期限用例：把 `LAST_ACCESS_TIME` 设为刚刚，证明绝对期限不因访问续期、未被误配成第二个空闲超时。
- 移除 `IdentityInputTests` 源码中的裸 NUL 字节（改为 `"bad" + (char) 0 + "name"` 构造），该文件此前会被 git 判定为二进制而无法评审。
- 收紧 `BootstrapAdminServiceTests` 中的弱断言（不再接受任意 `RuntimeException`，改为断言 400 `VALIDATION_FAILED`）；移除未被使用的 `IdentityException.rateLimited()`；补上节流缓存的容量上限与窗口过期两条用例（规格要求的「有容量和 TTL」此前只靠代码阅读确认）。
- 前端：`register()` 按规格 §9 清空内存 token；`auth.test.ts` 增加 IndexedDB 断言，证明令牌与凭据不进入任何浏览器持久层（含草稿库）。
- `scripts/verify-integration.ps1` 补齐 CLAUDE.md 已记载但脚本此前未做的校验：`IT_DB_URL` 必须是本机且 schema 与开发库不同、`IT_MINIO_ENDPOINT` 必须本机、`IT_MINIO_BUCKET_PREFIX` 不得等于 `MINIO_BUCKET`，使契约在整轮构建之前就失败。
- 复审未能验证的真实 MySQL 项目已由第二轮复审实际执行覆盖：`pwsh ./scripts/verify-integration.ps1` 退出码 0（surefire 125、`BaselineIT` 5、`IdentitySessionIT` 8、BUILD SUCCESS），运行后 `web_editor_it` 表数为 0；并用 `information_schema` 确认开发库 `app_user.normalized_username`/`normalized_email` 为 `utf8mb4` + `utf8mb4_0900_bin`。
- 清理 `SessionAuthenticationSupport.invalidate()` 中失效后的 `saveToken(null, …)`：核对 Spring Security 6.5.5 源码后确认该调用在会话已失效时走 `getSession(false)` 并直接返回，本来就是空操作，因此这是删除死代码而非行为修复（此前把它当成缺陷修复的判断有误，特此更正）。
- 第二轮复审又指出并已修正两处：`verify-integration.ps1` 的本机校验此前会误拒合法配置（`[::1]` 形式的 IPv6 主机、以及无 scheme 的地址），现改为去掉方括号后比对并对无主机的地址给出明确报错；`LoginThrottleTests` 的窗口过期用例把 1 毫秒窗口改为 100 毫秒窗口 + 400 毫秒等待，消除 `isPresent()` 断言对亚毫秒调度的依赖。

### 三处刻意的解释（供复审与后续步骤判断）

- `BOOTSTRAP_ADMIN_EMAIL` 视为可选：V4 的 `app_user.email` 允许 NULL，且规格写的是「任一**必填**值缺失则启动失败」，因此只有用户名、密码、显示名强制。若步骤 03/04 需要邮箱必填，应连同 V6 的约束一起收紧。
- 本步骤未新增 `CurrentUser` 组件：规格把它列在「建议目录」中，但当前唯一消费者是 `AuthController` 的私有读取，抽成公共组件此刻是死代码。步骤 03 引入 ACL 授权服务时再与首个真实消费者一起落地。
- 规格配置清单之外新增了 `AUTH_TRUSTED_PROXIES`（默认空），用于实现 §4「仅在明确可信代理列表后解析转发头」；未配置时一律使用 `remoteAddr`。

## 保留约束与后续工作

- 本步骤**不**面向用户发布：`AUTH_ENFORCEMENT_ENABLED` 默认 false，唯一的原子启用窗口在步骤 02–04 之间，启用时必须同时具备登录入口与 401 导航（步骤 04）。`cutover` 仍为 false，由步骤 03 在同一事务置位。
- `/api/admin/users/**` 的正式管理 API 与审计随步骤 03 开放；本步骤只交付禁用/启用应用服务与测试，协作连接撤销在步骤 09 接 Outbox 前保持关闭。
- 登录节流是单实例内存实现，多实例方案留给步骤 10。
- 本地开发库尚未创建平台管理员（`app_user` 为空，readiness 为 503）。启用强制认证前需一次性配置 `BOOTSTRAP_ADMIN_*` 或离线恢复命令，并在成功后从 `.env` 移除密码。
- 全部运行使用本机 MySQL/MinIO，无 Docker；未打印或提交根 `.env` 凭据。本文件不宣称 V2 团队、ACL 或协作系统已完成。
