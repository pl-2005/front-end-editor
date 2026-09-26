# 步骤 02：身份认证、Session 与 CSRF

> 前置：步骤 01 已完成并通过验收  
> 后续依赖：步骤 03、04、06  
> 发布约束：数据库与暗置代码可先部署，但强制认证必须与步骤 04 登录壳原子启用

## 1. 目标与边界

本步骤引入本地账号、平台角色、Spring Security、JDBC Session、CSRF 和统一 JSON 安全错误。除健康检查与认证入口外，业务 API 均进入认证边界；步骤 03 完成 ACL 前，只有平台管理员可访问历史项目。

不实现团队、邀请、协作票据、OAuth/SSO/MFA、邮件找回和完整认证 UI；不使用 Redis、JWT LocalStorage 或内存用户仓库。

## 2. 依赖与代码结构

`backend/pom.xml` 增加：

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.session</groupId>
  <artifactId>spring-session-jdbc</artifactId>
</dependency>
```

建议目录：

```text
com.webeditor.identity/{controller,application,domain,repository}
com.webeditor.common.security/
  SecurityConfig
  CurrentUser
  JsonAuthenticationFilter
  JsonAuthenticationEntryPoint
  JsonAccessDeniedHandler
  ActiveAccountFilter
```

## 3. 数据库迁移

### 3.1 V4：用户表

新增 `V4__create_identity_tables.sql`：

```sql
CREATE TABLE app_user (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    normalized_username VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    email VARCHAR(254) NULL,
    normalized_email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_color CHAR(7) NOT NULL,
    status VARCHAR(20) NOT NULL,
    platform_role VARCHAR(30) NOT NULL,
    authz_version BIGINT NOT NULL DEFAULT 0,
    password_changed_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_app_user_normalized_username UNIQUE (normalized_username),
    CONSTRAINT uk_app_user_normalized_email UNIQUE (normalized_email),
    CONSTRAINT chk_app_user_status CHECK (status IN ('ACTIVE','DISABLED','LOCKED')),
    CONSTRAINT chk_app_user_platform_role CHECK (platform_role IN ('PLATFORM_ADMIN','USER')),
    CONSTRAINT chk_app_user_authz_version CHECK (authz_version >= 0),
    CONSTRAINT chk_app_user_email_pair CHECK (
      (email IS NULL AND normalized_email IS NULL) OR
      (email IS NOT NULL AND normalized_email IS NOT NULL)
    )
);

CREATE TABLE system_bootstrap_lock (
    singleton_id TINYINT NOT NULL,
    auth_required_cutover BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (singleton_id),
    CONSTRAINT chk_system_bootstrap_singleton CHECK (singleton_id = 1)
);

INSERT INTO system_bootstrap_lock(singleton_id, auth_required_cutover, updated_at)
VALUES (1, FALSE, CURRENT_TIMESTAMP(6));
```

V4 是 MySQL 生产迁移；当前 H2 快速测试不执行 MySQL Flyway 脚本，改用与实体等价的 test schema/仓储单测。所有 Flyway 与 collation 行为由步骤 01 的真实 MySQL integration profile 验证，`mvn test` 与 `mvn -Pintegration verify` 都必须通过。

规范化顺序固定为：trim、Unicode NFKC、`Locale.ROOT` 小写、规范化后长度校验。规范化列在 V4 DDL 显式使用 `utf8mb4_0900_bin`，集成环境要求 MySQL 8。用户名禁止包含 `@`；login 含 `@` 时只查邮箱，否则只查用户名，从语法上消除跨字段身份歧义。应用产生规范化值，唯一索引负责并发兜底，用户不硬删除。

### 3.2 V5：JDBC Session

新增 `V5__create_spring_session_tables.sql`，复制当前依赖版本官方 MySQL schema，包含 Session 主表、属性表及 principal name 索引。Flyway 是唯一建表者：

```yaml
spring.session.jdbc.initialize-schema: never
```

Session principal 是可序列化的稳定用户 ID 值对象，只保存必要 ID、用户名、平台角色和 `authzVersion` 快照，禁止把 JPA 实体放进 Session。`Authentication.getName()` 必须返回十进制 user ID，或显式配置 `PrincipalNameIndexResolver` 从该稳定 ID 建 `PRINCIPAL_NAME` 索引；所有按用户撤销必须走这个索引并做集成测试。

## 4. 用户、密码与状态

- `ACTIVE` 可认证；`DISABLED`、`LOCKED` 不可认证。
- 新密码按 Unicode code point 为 10–64 个字符，UTF-8 不超过 72 bytes，以适配 bcrypt；禁止静默截断。
- 使用 `PasswordEncoderFactories.createDelegatingPasswordEncoder()`，新哈希带 `{bcrypt}` 前缀。
- 匿名登录失败按总方案统一为 401 `AUTHENTICATION_REQUIRED`，不得暴露账号是否存在、密码错误或状态。
- 哈希升级使用行锁或 compare-and-set，防止并发改密后被旧凭据 rehash 覆盖。

状态或权限迁移规则：`DISABLED/ACTIVE`、`LOCKED/ACTIVE`、平台角色变更和改密均在同一事务原子递增 `authz_version`；所有进入不可登录状态的迁移同时删除该用户全部 JDBC Session。`ActiveAccountFilter` 位于 SecurityContext 恢复之后、授权之前，每次受保护请求读取数据库状态和版本：DISABLED 清理会话后返回 423 `USER_DISABLED`；LOCKED 返回 423 `USER_LOCKED`；版本不一致或超时清理后返回 401 `AUTHENTICATION_REQUIRED`。步骤 03 只追加团队/项目授权变化的版本递增规则。

首期登录节流采用有容量和 TTL 的单实例缓存，键为规范化登录标识摘要与可信客户端 IP 摘要。仅在明确可信代理列表后解析转发头；成功清理账号维度状态，响应不泄露账号存在性。步骤 10 再升级多实例方案。

## 5. 注册与首个管理员

### 5.1 注册模式

`AUTH_REGISTRATION_MODE=CLOSED|OPEN|INVITE_ONLY`：

- 缺失默认 `INVITE_ONLY`；空值或非法值启动失败。步骤 02 中该模式返回 503，步骤 03 实现邀请后接管；这与总方案的生产默认一致。
- `OPEN` 还要求激活 `local`/`dev` profile 且 `AUTH_ALLOW_OPEN_REGISTRATION=true`；其他环境出现 OPEN 时启动失败。
- `INVITE_ONLY` 在步骤 03 完成前返回 503 `REGISTRATION_NOT_READY`。
- 注册成功返回 201 和安全用户视图，**不自动登录**，随后显式调用登录接口。
- CLOSED 返回 403 `REGISTRATION_CLOSED`。

### 5.2 Bootstrap 管理员

配置由根 `.env` 或生产密钥管理注入：

```text
BOOTSTRAP_ADMIN_ENABLED=false
BOOTSTRAP_ADMIN_USERNAME
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
BOOTSTRAP_ADMIN_DISPLAY_NAME
```

规则：

1. 缺失 enabled 按 false，非法值启动失败；启用时任一必填值缺失则启动失败。
2. 只在 `app_user` 为空时创建 `ACTIVE / PLATFORM_ADMIN / authz_version=0` 用户，密码立即编码，日志只记用户 ID。
3. 初始化在 readiness 为成功、业务端口接流量前完成。
4. V4 同时创建只有固定键的 `system_bootstrap_lock` 表；初始化事务先对固定记录 `SELECT ... FOR UPDATE`，再复查用户表。即使不同节点配置了不同用户名，也只能由一个节点创建首个管理员；等待节点重读并验证已存在 ACTIVE 平台管理员，否则启动失败。
5. 无论注册模式为何，只要数据库为空且 bootstrap 关闭，或数据库非空但不存在 ACTIVE 平台管理员，`GET /api/health/readiness` 都返回 503。改造现有健康控制器，不引入 Actuator；反向代理只向该端点为 200 的实例导流。自助注册服务端固定写入 `ACTIVE / USER / authz_version=0`，请求 DTO 不包含且拒绝角色、状态或版本字段。
6. 已有任意用户时初始化器不得擅自改密或创建第二个管理员。应用只短暂读取秘密并尽力清除可控内存副本；成功后由运维从 `.env`/部署密钥配置移除密码、关闭开关并重启，JVM 不声称能删除外部环境变量。
7. bootstrap runner 完成前，`/api/health/readiness` 返回 503；成功且存在 ACTIVE 管理员后返回 200。现有 `/api/health` 仅作 liveness，不得用于导流。
8. 本步骤交付 `AdminRecoveryCommand`，只能以 `--spring.main.web-application-type=none --app.maintenance.recover-admin=true` 离线启动；它先锁固定记录，要求正常 Web 实例已停写，按 user ID 查找既有用户，校验目标唯一且未删除，只接受 stdin/密钥文件中的新密码（不接受命令行明文），将其设为 ACTIVE PLATFORM_ADMIN、递增版本并撤销全部 Session。若目标不存在、系统仍有写流量或参数不完整则失败；集成测试覆盖恢复后 readiness 转 200。

Flyway 不写明文或预计算管理员密码。

## 6. Session 与绝对期限

配置：

```text
SESSION_COOKIE_NAME=WEB_EDITOR_SESSION
SESSION_IDLE_TIMEOUT=30m
SESSION_MAX_LIFETIME=12h
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=Lax
```

Cookie 为 HttpOnly；生产 Secure 且仅 HTTPS。`SESSION_IDLE_TIMEOUT` 映射到 Spring Session `maxInactiveInterval`。`SESSION_MAX_LIFETIME` 是从首次创建时间计算且不可因访问续期的绝对期限；请求过滤器每次认证请求比较 `creationTime + maxLifetime`，到期时删除 JDBC Session、清空上下文和 Cookie并返回 401。它不能被误配成第二个 idle timeout。

认证成功必须通过组合 `SessionAuthenticationStrategy` 执行 session fixation protection，并接入 JDBC-backed `SpringSessionBackedSessionRegistry`。`AUTH_MAX_SESSIONS_PER_USER` 默认 5；达到上限淘汰最久未使用（LRU）的 Session，而不是拒绝新登录，策略由测试固定。退出必须依次清空 SecurityContext、使 Session 失效、删除持久化 Session、清除 Cookie，返回 204。

## 7. CSRF 的唯一契约

使用 `HttpSessionCsrfTokenRepository`，显式 `setHeaderName("X-XSRF-TOKEN")`；用 `CsrfTokenRequestAttributeHandler` 或等价处理确保延迟 token 被读取时真正生成。

1. `GET /api/auth/csrf` 读取请求属性中的 `CsrfToken`，创建匿名预认证 Session。
2. 通过现有 `ApiResponse` 包装返回 `{token, headerName}`，响应带 `Cache-Control: no-store`。
3. 登录、注册及所有 POST/PUT/PATCH/DELETE（含 logout、改密）必须携带响应指定的头。
4. 登录和改密成功后服务端移除 Session 中旧 token；客户端丢弃旧 token并再次 GET。
5. 登录失败不轮换 token，允许用同一 token重试。
6. token 只存在前端内存，不写 Cookie、LocalStorage、日志或 Sandpack。
7. 缺失或错误 token 由专用 handler 返回 403 `CSRF_INVALID`。

开发通过 Vite `/api` 代理同源。确需跨源时只允许 `CORS_ALLOWED_ORIGINS` 精确列表，启用 credentials，放行 OPTIONS 以及 `Content-Type`、`If-Match`、`X-XSRF-TOKEN`，暴露 `ETag`、`Retry-After`；禁止 `*` 与 credentials 组合。

## 8. API 与 SecurityFilterChain

```http
GET  /api/auth/csrf
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

匿名仅允许只读 `GET /api/health`、`GET /api/health/readiness`、`GET /api/auth/csrf`，以及登录和注册；后两者仍受 CSRF 与注册模式约束。不得用 `/api/health/**` 通配开放 POST 等非 GET 方法；请求矩阵覆盖未认证 readiness 在系统就绪/未就绪时分别返回 200/503。其余 `/api/**` 要求认证。步骤 03 前，平台管理员可访问现有 `/api/projects/**` 以迁移历史数据，普通用户返回 403；不得保留匿名兼容路径。

### 8.1 JSON 登录落地流程

自定义 `JsonAuthenticationFilter` 严格限制请求体大小和字段，只接受 `login/password`：

1. 节流检查后反序列化并调用 `AuthenticationManager`。
2. 成功后调用完整 `SessionAuthenticationStrategy`（包括 fixation 和配置的并发 Session 策略）。
3. 创建空 `SecurityContext`、写入 Authentication，并由 `HttpSessionSecurityContextRepository` 显式保存。
4. 删除旧 CSRF token，返回 200 安全用户视图。
5. 失败时记录节流结果、清空临时上下文，并用 JSON failure handler 返回统一 401。
6. 禁用 form login、HTTP Basic 和重定向处理。

登录、注册与 `/me` 共用同一个安全用户 DTO，只含 `id/username/email/displayName/avatarColor/platformRole/globalCapabilities`；`globalCapabilities` 是受限动作枚举数组（USER_MANAGE/PLATFORM_ACCESS），普通用户为空。不含哈希、Session ID 或 `authzVersion`。

修改密码验证当前密码，事务内更新哈希、时间和版本；提交后删除除当前外的所有 Session，构造含新 `authzVersion` 的 Authentication，执行当前 Session fixation，并用 SecurityContextRepository 保存到新 Session，最后删除旧 CSRF，返回 204。测试必须证明当前会话继续有效而旧会话失效。logout 使用同一 Cookie 配置显式清理并返回 204。

Filter 层直接生成现有 `ApiError`：未认证 401 `AUTHENTICATION_REQUIRED`；拒绝 403 `ACCESS_DENIED`；CSRF 403 `CSRF_INVALID`。不能依赖 Controller 的全局异常处理器。

本步骤只实现用户启用/禁用应用服务及测试；`/api/admin/users/**` 正式管理 API 随步骤 03 审计一起开放。禁用会撤销 Session；协作连接撤销在步骤 09 接 Outbox 前由 feature flag 保持关闭。

## 9. 前端客户端基础

新增或改造 `frontend/src/api/client.ts`、`auth.ts`、`types/auth.ts`：

- 所有 API fetch 固定 `credentials: 'include'`；GET/HEAD 无 body 时不无条件设置 `Content-Type`。
- 应用启动先 GET CSRF，再发需要 token 的请求；非安全方法从内存附加服务端返回的 headerName。
- 登录、注册、logout、改密以及 403 `CSRF_INVALID` 后清空内存 token；登录/改密成功后立即重取，logout 后为匿名 Session 重取。
- 401 清空身份和 CSRF并进入未认证状态；423 清空身份、展示账号状态且不自动重试；403 不退出。主动撤销后旧 Cookie通常得到 401，423 只保证已恢复上下文的并发在途请求。普通业务请求不得无限自动重试。
- client 支持 JSON、204、非 JSON 错误、`AbortSignal`，且不记录密码、CSRF、Cookie。
- projects API 迁移到统一 client，并保留步骤 01 的 ETag 行为。

步骤 02 不单独面向用户发布。唯一开关为 `AUTH_ENFORCEMENT_ENABLED`，默认 `false`。关闭时旧 `/api/projects/**` 保持匿名且忽略 CSRF；身份端点仍受本步骤 Session/CSRF 保护，其他新管理端点不开放。开启时一次性启用完整认证、CSRF 与管理员临时规则，不能部分开启。仅当步骤 02–04 测试全绿且登录入口、401 导航可用时启用。两种状态均建立 SecurityFilterChain 请求矩阵测试。步骤 03 完成归属迁移时，在同一事务把固定行 `auth_required_cutover=true`；此后配置缺失或 false 必须拒绝启动/保持 readiness 503，任何回滚制品也必须强制认证并 fail closed，绝不能恢复匿名项目路径。步骤 02 暗置期回滚才允许关闭开关。临时 harness 只供测试且不得含凭据。

## 10. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 输入格式错误 |
| 401 | `AUTHENTICATION_REQUIRED` | 未登录、Session/绝对期限/版本失效或匿名登录失败 |
| 423 | `USER_DISABLED` | 已认证用户随后被禁用 |
| 423 | `USER_LOCKED` | 已认证用户随后被锁定 |
| 403 | `ACCESS_DENIED` | 已认证但无权限 |
| 403 | `CSRF_INVALID` | token 缺失或错误 |
| 403 | `REGISTRATION_CLOSED` | 自助注册关闭 |
| 409 | `USERNAME_ALREADY_EXISTS` | 合法注册中的用户名冲突 |
| 409 | `EMAIL_ALREADY_EXISTS` | 合法注册中的邮箱冲突 |
| 429 | `AUTH_RATE_LIMITED` | 登录节流；响应必须带整数秒 `Retry-After` |
| 503 | `REGISTRATION_NOT_READY` | 邀请注册尚未接管 |

匿名登录绝不返回用户状态专用错误。

## 11. 测试与验证

后端快速测试覆盖：登录/注册/me 的同一安全 DTO 与 globalCapabilities、429 Filter/Controller 的整数 Retry-After 和 CORS 暴露、密码哈希及多字节 72-byte 边界、确定性规范化、用户名 `@` 拒绝与登录列选择、并发唯一冲突、注册固定 USER 字段、注册模式 fail-safe、非开发 OPEN 拒绝、bootstrap 空库/无管理员/readiness/不同配置节点并发、JSON 登录后的 `/me` Session 恢复、稳定 user-ID principal 索引、最大 Session 数与最旧淘汰、改密后当前 Session 新版本、失败不残留认证、session fixation、CSRF 首次生成及轮换旧 token 失效、logout 清理、idle 与绝对过期、全部状态/角色迁移及版本递增、423/401 分流、Filter 顺序和 JSON 错误、AUTH_ENFORCEMENT_ENABLED 两态请求矩阵、普通用户/管理员临时项目边界，以及步骤 01 回归。

MySQL 集成测试复用步骤 01 的 `integration` profile 和独占测试 schema：V3→V4/V5 无损迁移；Session 跨 ApplicationContext 重启；按 principal 删除；并发注册/bootstrap；绝对过期删除。只清理测试 schema，禁止 Docker。

前端测试覆盖：credentials；启动/登录/改密/logout 的 token 生命周期；401、403 与 423 分流；204/非 JSON 错误；GET 不乱加 Content-Type；秘密不进入日志或持久化；认证 mock 下项目及 ETag 回归。

```powershell
cd frontend
npm run lint
npm run test
npm run build

cd ../backend
mvn test
mvn -Pintegration verify
```

真实集成验证按步骤 01 的安全 `.env` 加载方式执行，必须传播退出码，不打印 `.env`，连接本机 MySQL/MinIO，不使用 Docker。

## 12. 验收、发布与回滚

- V4/V5 可由 V3 无损升级；密码、Session、CSRF、bootstrap 秘密不泄露。
- Session 持久、按稳定 user-ID 撤销、并发上限、idle/绝对过期、改密、423 状态和 `authz_version` 行为正确。
- 强制认证开启后匿名和普通用户均不能访问历史项目，平台管理员可执行迁移。
- Filter 错误为统一 JSON，前端 client 可完整处理认证与 CSRF。
- 快速测试、前端检查和真实 MySQL 集成测试全部通过。
- 只允许维护窗口原子启用步骤 02–04；先停止旧写流量，执行迁移和管理员冒烟，再切换带登录壳的前端并开启 `AUTH_ENFORCEMENT_ENABLED`。仅在步骤 03 cutover 前可关闭开关回退；cutover 后回滚仍强制认证并 fail closed。旧 V1 前端不得连接已开启认证的新后端。
- Flyway 不回滚；兼容回滚制品需认识 V3–V5 且默认拒绝匿名。JDBC Session 表保留，bootstrap 密码立即移除。

## 13. 向后续步骤交付

- 步骤 03：`app_user`、平台管理员、稳定 user ID、`authz_version`、JDBC Session 撤销、`CurrentUser`、强制认证/CSRF 和临时 fail-closed 项目规则；迁移从 V6 开始。
- 步骤 04：稳定的 csrf/register/login/logout/me/password API 与统一前端 client；负责最终登录壳和认证开关发布门禁。
- 步骤 06：用户 ID、显示名、颜色、状态和版本；协作票据携带版本，握手必须向 Spring 内省并与数据库当前值比较。













