# 步骤 02：身份认证、JWT 与刷新凭据

> 前置：步骤 01 已完成并通过验收  
> 后续依赖：步骤 03、04、06  
> 发布约束：身份代码和登录壳先完成；步骤 11 在完整协作功能就绪后统一启用强制认证与 V2 入口

## 1. 目标与边界

本步骤实现本地账号、Spring Security、短期 JWT、Redis 刷新凭据和统一 JSON 安全错误。步骤 11 公开切换后，除明确的匿名健康检查、注册、登录、刷新和团队发现入口外，业务 API 均要求 Bearer 认证；历史匿名项目不向新账号开放。

不实现团队、邀请、协作票据、OAuth/SSO/MFA、邮件找回和完整认证 UI；Redis 仅承担刷新凭据和登录节流，不承担项目元数据或协作房间广播；不使用 Cookie、浏览器持久化 Token 或内存用户仓库。

## 2. 依赖与代码结构

`backend/pom.xml` 增加：

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-security-oauth2-jose</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

建议目录：

```text
com.webeditor.identity/{controller,application,domain,repository}
com.webeditor.common.security/
  SecurityConfig
  CurrentUser
  JsonAuthenticationFilter
  JwtAuthenticationFilter
  JsonAuthenticationEntryPoint
  JsonAccessDeniedHandler
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
    authz_version BIGINT NOT NULL DEFAULT 0,
    password_changed_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_app_user_normalized_username UNIQUE (normalized_username),
    CONSTRAINT uk_app_user_normalized_email UNIQUE (normalized_email),
    CONSTRAINT chk_app_user_authz_version CHECK (authz_version >= 0),
    CONSTRAINT chk_app_user_email_pair CHECK (
      (email IS NULL AND normalized_email IS NULL) OR
      (email IS NOT NULL AND normalized_email IS NOT NULL)
    )
);
```

V4 只创建新账号表；旧入口没有身份数据，不迁移旧账号或会话，也不创建认证切换状态表。V4 是 MySQL 生产迁移；当前 H2 快速测试不执行 MySQL Flyway 脚本，改用与实体等价的 test schema/仓储单测。功能验收确认迁移后可注册、登录并按规范化值处理唯一约束，不将本机 MySQL 集成测试设为门禁。

规范化顺序固定为：trim、Unicode NFKC、`Locale.ROOT` 小写、规范化后长度校验。规范化列在 V4 DDL 显式使用 `utf8mb4_0900_bin`，运行环境要求 MySQL 8。用户名禁止包含 `@`；login 含 `@` 时只查邮箱，否则只查用户名，从语法上消除跨字段身份歧义。应用产生规范化值，唯一索引负责并发兜底，用户不硬删除。

### 3.2 V5：Token 撤销水位

V5 执行 `V5__add_token_version.sql`：给 `app_user` 新增非负 `token_version BIGINT NOT NULL DEFAULT 0`。`token_version` 是用户全部 JWT 和刷新凭据的撤销水位；退出登录和修改密码在 MySQL 事务中递增。`authz_version` 保留为团队/项目授权与协作票据水位，两者语义独立。V5 不创建 Session 表或会话撤销任务表。

Redis 只保存刷新凭据摘要、轮换状态和登录节流计数。连接地址、端口、认证和可选 TLS 从根 `.env` 的 `SPRING_DATA_REDIS_*` 配置注入；本地使用已安装的 Redis 服务，不启动容器。刷新凭据使用应用独立的 `AUTH_REDIS_NAMESPACE`，不得清空共享 Redis 数据库。Redis 不可用时登录和刷新失败关闭；已签发 JWT 的受保护 API 仍必须查询 MySQL 用户存在性与 `token_version`，不得因 Redis 故障跳过该检查。

## 4. 用户、密码与登录节流

- 新密码按 Unicode code point 为 10–64 个字符，UTF-8 不超过 72 bytes，以适配 bcrypt；禁止静默截断。
- 使用 `PasswordEncoderFactories.createDelegatingPasswordEncoder()`，新哈希带 `{bcrypt}` 前缀。
- 匿名登录失败按总方案统一为 401 `AUTHENTICATION_REQUIRED`，不得暴露账号是否存在或密码是否错误。
- 哈希升级使用行锁或 compare-and-set，防止并发改密后被旧凭据 rehash 覆盖。

凭据撤销规则：改密和退出所有设备在 MySQL 事务中递增 `token_version` 与 `authz_version`。每个受保护请求在 JWT 签名/期限校验后从 MySQL 确认用户存在且 `token_version` 一致；用户不存在或版本不一致返回 401 `AUTHENTICATION_REQUIRED`。Redis 中未及时删除的旧刷新凭据也因版本不一致无法换取新 JWT。步骤 03 的团队成员关系变化只递增 `authz_version`，服务端每次重新查询当前成员关系，不从 JWT 的角色声明授权。

登录节流使用 Redis 中有 TTL 的原子计数器，键为规范化登录标识摘要与可信客户端 IP 摘要；容量和过期策略明确配置。仅在明确可信代理列表后解析转发头；成功清理账号维度状态，响应不泄露账号存在性。Redis 不可用时登录和注册限流路径失败关闭。

## 5. 开放自助注册

正式方案不设邀请门槛：`POST /api/auth/register { username, email?, password, displayName? }` 在所有部署环境均可匿名调用，仍受注册/IP 限流和唯一约束保护。成功返回 201 和安全用户视图，不自动登录，客户端随后显式调用登录接口。服务端创建 `token_version=0 / authz_version=0` 用户；DTO 不接受团队、成员角色、账号状态或版本字段，未知字段按契约拒绝。团队邀请仅发送给已注册用户，并在登录后的“我的邀请”中处理；注册本身不需要邀请。

注册接口在本地、测试和生产环境执行同一规则：任何未认证用户均可注册账号。不设置注册模式，也不依据 profile 或环境变量改变注册资格。注册和登录请求通过 Redis 限流与递增延迟控制；限流计数有 TTL，不改变账号状态。

## 6. JWT 与刷新凭据

配置：

```text
JWT_ISSUER=web-editor
JWT_AUDIENCE=web-editor-api
JWT_ACCESS_TTL=10m
JWT_SECRET=<random-secret-at-least-32-bytes>
AUTH_REFRESH_IDLE_TIMEOUT=30m
AUTH_REFRESH_MAX_LIFETIME=12h
AUTH_MAX_REFRESH_FAMILIES_PER_USER=5
AUTH_REDIS_NAMESPACE=web-editor:auth
```

API 访问凭据是 HS256 签名的短期 JWT，浏览器通过 `Authorization: Bearer <accessToken>` 发送。生产仅通过 HTTPS 传输。`JwtAuthenticationFilter` 调用 Spring Security 的 JWT 解码器，只接受 HS256，验证签名、`iss`、`aud`、`sub`、`jti`、`iat`、`nbf`、`exp` 与时钟偏差；至少 32 字节随机的 `JWT_SECRET` 从根 `.env` 或生产密钥管理注入，不进入日志或仓库。签发和校验使用同一个密钥；轮换密钥会使旧访问 JWT 失效。JWT 只含稳定 user ID、`token_version` 和必要标准声明，不含密码、邮箱、团队/项目角色或源码。过滤器每次从 MySQL 确认用户存在且 `token_version` 一致；资源 ACL 在服务层按当前数据库状态查询，JWT 声明不是授权事实源。

登录成功另签发至少 256-bit 随机刷新凭据；Redis 只保存摘要、user ID、`token_version`、family ID、空闲/绝对期限与轮换状态。`POST /api/auth/refresh` 原子消费旧凭据并返回新的 JWT 和刷新凭据；已消费摘要的标记保留至 family 绝对期限，重放旧凭据时使该 family 失效。轮换不得延长首次签发时的绝对期限。超过每用户 family 上限时淘汰最旧 family。刷新时重新确认 MySQL 用户存在且 `token_version` 一致。Redis 丢失只导致刷新失效和重新登录，不恢复旧凭据。

## 7. 浏览器凭据与请求边界

服务端设置 `SessionCreationPolicy.STATELESS`，不创建 `HttpSession`，不设置认证 Cookie，并显式关闭 CSRF Token 校验。登录、刷新响应包含凭据时使用 `Cache-Control: no-store`。前端只在内存中保存访问 JWT 与刷新凭据，不放入 Cookie、LocalStorage、sessionStorage、IndexedDB、URL、日志、Analytics、Sandpack 或共享查询缓存；整页刷新或新标签页需要重新登录。

浏览器应用、`/api` 和 `/collab` 保持同源；开发由 Vite `/api` 代理，生产由同源反向代理提供。浏览器业务 API 不开放跨源 CORS。所有写入接口只接受预期的 JSON 内容类型和字段；GET/HEAD/OPTIONS 不得改变持久状态。WebSocket 仍用步骤 06 的短期票据和 Origin 白名单，不把访问 JWT 放在 WebSocket URL 或子协议中。非浏览器内部接口继续使用独立认证链。

浏览器可读取的 Bearer 凭据会受同源脚本执行影响；步骤 10 必须覆盖 CSP、脚本依赖扫描、预览 iframe 隔离和 XSS 回归。刷新凭据在页面存活期间可延长登录；浏览器整页刷新后需重新登录，这是本期无 Cookie 且不持久化凭据的明确体验约束。

## 8. API 与 SecurityFilterChain

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

匿名仅允许只读 `GET /api/health`、`GET /api/health/readiness`、`GET /api/teams/discover`，以及登录、开放注册和凭有效刷新凭据调用的 `/api/auth/refresh`；团队发现仅返回允许申请加入的团队基本资料，且有分页、查询长度和 IP 限流。注册与登录受账号唯一约束和限流保护，刷新受凭据单次消费与限流保护。不得用 `/api/health/**` 通配开放 POST 等非 GET 方法；请求矩阵覆盖未认证 readiness 在系统就绪/未就绪时分别返回 200/503。其余 `/api/**` 要求 `Authorization: Bearer`。步骤 03 完成前，历史匿名项目对新账号一律不可见，迁移只通过停写后的离线流程执行；不得保留匿名兼容路径。空用户库不影响 readiness，首个用户通过自助注册创建。

### 8.1 JWT 请求过滤器

受保护业务请求统一经过 Spring Security 过滤器链中的 `JwtAuthenticationFilter`，流程固定为：

```text
请求 → JwtAuthenticationFilter → 解析 Bearer JWT → 验证签名与声明
     → 查询 MySQL 用户与 token_version → 构造 Authentication
     → 放入当前请求的 SecurityContext → Controller → 服务层 ACL 校验
```

`JwtAuthenticationFilter` 作为单个 `OncePerRequestFilter` 注册在 `SecurityFilterChain` 中，位于匿名认证和授权判断之前，不再额外注册为 Servlet Filter，也不启用另一套 Bearer 认证过滤器。它对受保护路径要求且只接受一个格式正确的 Bearer 凭据；缺失、重复或格式错误均返回 401。登录、注册、刷新和上述匿名 GET 不由该过滤器强制认证；刷新接口自行校验请求体中的刷新凭据。

过滤器用 Spring Security JWT 解码器验证 JWT，先完成签名与声明检查，再按 `sub` 查询 MySQL：用户必须存在，且数据库 `token_version` 与 JWT 一致。通过后用数据库中的用户 ID 构造已认证的 `Authentication`，放入本请求的 `SecurityContext`；`CurrentUser` 从该上下文取得身份，Controller 不自行解析 JWT。服务层查询当前团队成员关系；成员管理额外检查 OWNER，不从 JWT 或 `Authentication` 的旧快照决定权限。过滤器在请求结束时清理上下文，不跨请求保存，也不创建 Session。JWT 无效、用户不存在或版本不符时不建立 `Authentication`，由统一认证入口返回 JSON 401；异常时清理上下文。鉴权不足由统一拒绝处理器返回 JSON 403。

### 8.2 JSON 登录落地流程

自定义 `JsonAuthenticationFilter` 严格限制请求体大小和字段，只接受 `login/password`：

1. 节流检查后反序列化并调用 `AuthenticationManager`。
2. 成功后从 MySQL 读取当前 `token_version`，生成签名 JWT 和 Redis 刷新凭据，并限制并发 family 数量。
3. 返回 200 安全用户视图及 `{accessToken, refreshToken, expiresIn}`，设置 `Cache-Control: no-store`，不创建服务器 Session 或 Cookie。
4. 失败时记录节流结果、清空临时上下文，并用 JSON failure handler 返回统一 401。
5. 禁用 form login、HTTP Basic、容器 Session 和重定向处理；受保护请求由上述 `JwtAuthenticationFilter` 统一认证，不启用 Resource Server 自动添加的 Bearer 过滤器。

登录、注册与 `/me` 共用同一个安全用户 DTO，只含 `id/username/email/displayName/avatarColor`，不含平台角色、全局管理员能力、哈希或 `authzVersion`。只有登录/刷新响应的专用字段包含凭据，`/me` 不重复返回凭据。

修改密码验证当前密码，在 MySQL 事务内更新哈希、时间、`token_version` 和 `authz_version`，返回 204 后要求所有设备重新登录；Redis 旧刷新凭据因版本不匹配无法使用，后台可按 user ID 清理。`POST /api/auth/logout` 使用当前 Bearer JWT，在 MySQL 中递增 `token_version` 与 `authz_version`，使该用户所有访问 JWT、刷新凭据和未消费协作票据失效，然后清理当前页内存凭据并返回 204。步骤 09 接入 Outbox 后，改密写 `USER_CREDENTIALS_REVOKED`、退出写 `USER_LOGGED_OUT`；网关消费事件后关闭该用户现有协作连接，投递失败重试并告警。退出登录在本期定义为“退出所有设备”，避免依赖 Redis 删除成功作为唯一撤销条件。

Filter 层直接生成现有 `ApiError`：缺失、过期、签名/声明错误或版本失效的 JWT 返回 401 `AUTHENTICATION_REQUIRED`；已认证但动作不足返回 403 `ACCESS_DENIED`。不能依赖 Controller 的全局异常处理器。

本步骤不提供平台管理员或账号状态变更入口。退出所有设备与改密通过 `token_version` 撤销旧 JWT/刷新凭据；协作连接撤销在步骤 09 接 Outbox 前由 feature flag 保持关闭。

## 9. 前端客户端基础

新增或改造 `frontend/src/api/client.ts`、`auth.ts`、`types/auth.ts`：

- API fetch 固定 `credentials: 'omit'`；登录/注册/刷新以外的请求从内存附加 `Authorization: Bearer <accessToken>`。GET/HEAD 无 body 时不无条件设置 `Content-Type`。
- 应用启动内存无凭据即进入 anonymous；登录后 GET `/api/auth/me`。访问 JWT 临近过期时单飞调用刷新接口，原子替换内存中的两项凭据；刷新失败清空凭据并返回登录页。整页刷新需要重新登录。
- 401 清空凭据和身份并进入未认证状态；403 不退出；429 遵循 `Retry-After`，不无限自动重试。普通业务请求不得无限自动重试。
- client 支持 JSON、204、非 JSON 错误、`AbortSignal`，且不记录密码、访问 JWT 或刷新凭据。
- projects API 迁移到统一 client，并保留步骤 01 的 ETag 行为。

步骤 02 不单独面向用户发布。步骤 01–10 在开发或隔离环境完成功能检查，生产 V1 入口继续按原行为运行。V2 制品从启动起对业务 API 强制 Bearer 认证，不提供关闭认证的配置开关。只有身份、团队、新项目 Y.Doc、协作、删除和撤权功能全部就绪，步骤 11 才在停写窗口部署完整 V2，并在受控检查通过后切换外部入口。入口切换前不向生产用户暴露 V2；切换后只允许回滚到同样强制认证且兼容全部已执行迁移的制品。V2 的 SecurityFilterChain 请求矩阵必须覆盖匿名入口、受保护 API 和旧 V1 路径拒绝规则。

## 10. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 输入格式错误 |
| 401 | `AUTHENTICATION_REQUIRED` | 缺失、过期、无效或已撤销 JWT，或匿名登录失败 |
| 403 | `ACCESS_DENIED` | 已认证但无权限 |
| 409 | `USERNAME_ALREADY_EXISTS` | 合法注册中的用户名冲突 |
| 409 | `EMAIL_ALREADY_EXISTS` | 合法注册中的邮箱冲突 |
| 429 | `AUTH_RATE_LIMITED` | 登录节流；响应必须带整数秒 `Retry-After` |

匿名登录不区分账号是否存在或密码是否正确。

## 11. 测试与验证

后端快速测试覆盖：登录/注册/me 的安全 DTO、429 的整数 Retry-After、密码哈希及多字节 72-byte 边界、确定性规范化、用户名 `@` 拒绝与登录列选择、并发唯一冲突、开放注册拒绝特权字段、空用户库 readiness、JWT 签名/HS256 算法/iss/aud/期限校验、`JwtAuthenticationFilter` 的 Bearer 解析/重复头拒绝、MySQL 用户存在性及 `token_version` 核对、构造 `Authentication`/设置与清理 `SecurityContext`、Controller 读取 `CurrentUser`、资源 ACL 实时查询、无重复 Bearer Filter、Redis 刷新凭据原子轮换/重放/上限/绝对期限、改密与退出所有设备、无 Cookie/无容器 Session、Redis 故障下旧 JWT 的数据库核对、429/401 分流、Filter 顺序和 JSON 错误、V2 匿名及受保护请求矩阵、旧 V1 路径拒绝规则、历史匿名项目不可见边界，以及步骤 01 回归。

功能验收覆盖注册与登录、JWT Bearer 请求、刷新凭据轮换与过期、退出所有设备和改密后的旧凭据失效、错误响应及限流。需要运行应用时按仓库根 `.env` 连接本机服务，不创建专用集成测试 schema 或 Redis 命名空间作为验收前提。

前端测试覆盖：`credentials: omit`、Bearer 头、启动/登录/刷新/改密/退出的内存凭据生命周期、单飞刷新、整页刷新后匿名、401/403/429 分流、204/非 JSON 错误、GET 不乱加 Content-Type、凭据不进入日志或持久化、认证 mock 下项目及 ETag 回归。

```powershell
cd frontend
npm run lint
npm run test
npm run build

cd ../backend
mvn test
```

上述开发检查可按需运行，不作为功能验收门禁；运行应用时不打印 `.env` 凭据，也不使用 Docker。

## 12. 验收、发布与回滚

- V4/V5 可由 V3 无损升级；密码、JWT 签名密钥和刷新凭据不泄露。
- JWT 无 Cookie，访问凭据短期有效；刷新凭据单次轮换、空闲/绝对过期、退出所有设备、改密、429 限流和 `token_version` 行为正确。
- V2 匿名用户不能访问项目，登录用户只能访问所属团队授权的项目；历史匿名项目按步骤 03 的隔离规则保持不可访问。
- Filter 错误为统一 JSON，前端 client 可完整处理 Bearer 认证与刷新失败。
- 注册、登录、刷新、退出和改密的功能验收通过。
- 步骤 11 在完整 V2 制品就绪后，先停止旧写流量并执行全部迁移，再切换登录壳、API 和网关外部入口。V2 服务从启动起强制认证；切换后仅可使用强制认证且兼容迁移的回滚制品，旧 V1 前端不得连接新后端。
- Flyway 不回滚；兼容回滚制品需认识最终已执行的全部迁移、当前 JWT 签名密钥与 Redis 刷新凭据格式，并默认拒绝匿名。刷新凭据按 TTL 过期。

## 13. 向后续步骤交付

- 步骤 03：`app_user`、稳定 user ID、`token_version`/`authz_version`、JWT Bearer 校验、`CurrentUser`、强制认证和历史匿名项目 fail-closed 规则；迁移从 V6 开始。
- 步骤 04：稳定的 register/login/refresh/logout/me/password API 与统一前端 client；登录壳先完成，公开切换由步骤 11 执行。
- 步骤 06：用户 ID、显示名、颜色和版本；协作票据携带版本，握手必须向 Spring 内省并与数据库当前值比较。
