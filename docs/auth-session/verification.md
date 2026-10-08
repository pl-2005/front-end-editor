# 浏览器登录会话恢复检查记录

日期：2026-10-08。实现、测试与本机联调使用仓库根 `.env`；连接本机 MySQL、MinIO、Redis，无 Docker/Docker Compose。服务连接配置和凭据不记录到本文。

## 实现与提交边界

- `AuthOriginFilter` 在 Spring 安全上下文过滤器之前执行，关闭 Servlet 自动注册。所有认证响应设置 no-store；认证修改入口验证精确配置 Origin、自定义头及 application/json。POST logout 单独匿名放行并精确跳过 JWT 过滤器，其他方法、password 和业务 API 仍需要 Bearer。
- `AuthCookie` 固定 HttpOnly、SameSite=Strict、Path=/api/auth、host-only；生产默认 Secure。本机关闭 Secure 必须同时显式启用 local-development，来源只允许 loopback。首次签发和轮换 Cookie Max-Age 都按实际空闲与令牌族剩余时间向下取整。
- 内部 `Credentials` 包含刷新令牌，HTTP 只能通过 `BrowserCredentialsWriter` 输出专用 BrowserCredentials。login/refresh JSON 只包含 user/accessToken/expiresIn；refresh/logout 正文严格为 `{}`，包括尾随 JSON、旧 refreshToken 字段及超过 8 KiB 正文均拒绝。
- 登录先查账号 ID，随后由 TransactionTemplate 启动事务，再以 AppUserRepository.lockById 的 PESSIMISTIC_WRITE 锁读取用户和核对密码、版本。关闭 open-in-view；避免先在同一持久化上下文加载旧用户实体后再加锁。
- 刷新先从 Redis inspect 元数据；事务内获取同一用户写锁、比较版本、准备 JWT/公开 DTO 并预序列化，随后 Lua 重校验旧 token、族内容、空闲截止和族 PTTL，标记 used 并写入下一 token。族 PTTL 不延长；提交后不再查询 MySQL或其他外部依赖。
- Lua 前的准备失败为 AUTH_SERVICE_UNAVAILABLE；Redis execute 超时或缺失结果为 AUTH_REFRESH_OUTCOME_UNKNOWN。Lua 成功后事务结束异常，以及响应准备/交付失败（尚未提交 HTTP 响应时），按结果不确定报告，不发送成功 Cookie，也不把 used token 恢复为可用。已开始的 HTTP 响应或连接中断不能保证错误 JSON 交付。
- Cookie 注销在用户写锁内重新比较版本、重新检查会话，再递增 token/authz 版本并写既有 Outbox。TransactionTemplate 返回时撤销事务已提交，控制器才清 Cookie/返回 revoked。旧版本、缺失、到期或重放 Cookie 返回 local-only，不能撤销新版本会话；依赖或事务失败返回 503。
- MySQL 事务、Redis Lua 与 HTTP 交付不是统一原子提交；严格重放语义保持不变。不确定刷新不自动重发，手动重试可能要求重新登录。

## 前端行为

启动状态为 restoring，模块共享恢复 Promise；StrictMode 重挂载不会重复恢复。restoring/restore-error 不挂载受保护页面；恢复成功保留 pathname/search/hash。401 才进入匿名并清对应缓存；429/5xx/网络故障保留身份代次与 IndexedDB 队列。登录使用公开响应建立身份，无额外 /me 前置依赖。

Web Locks `web-editor-auth-session` 串行 login/refresh/logout/password，覆盖 fetch 和响应解析；等待锁与请求/解析各有 15 秒限时，禁止 steal 和无锁回退。password 锁内直接 refreshUnlocked，不等待排在自身之后的 Promise。普通轮换不修改身份标记；登录切换、注销和确定失效只广播非敏感随机标记。请求取得锁前、锁内和响应后重新检查身份；跨身份迟到业务响应与重试均拒绝。

退出先在锁内写 pending、清内存并通知其他页，网络/协议/服务失败保留 pending；重载不自动恢复。200 revoked 只确认已提交的全账号撤销，local-only 仅确认本机匿名，并提供重新认证入口。运行中临时认证故障显示重试，不卸载工作区或触发 forbid；Retry-After 生效，不确定刷新需要用户手动确认重试。

## 检查与真实验收

| 检查 | 结果 |
| --- | --- |
| backend Maven test/package | 72 项通过；包含认证来源、Cookie、严格 JSON、JWT 503 分类、准备失败不提交、事务结束不确定、Redis 执行超时和旧版本注销保护 |
| frontend npm test/lint/build | 177 项通过；覆盖启动/运行错误、StrictMode 单飞、迟到响应、跨身份重试隔离、退出 pending、锁等待及解析超时、Retry-After、密码锁内刷新和站内返回地址 |
| collaboration npm test/build | 25 项通过，TypeScript 构建通过 |
| verify-step09-local.mjs | 通过；durable delete、empty-room fence、幂等、旧票据、四类撤权、未受影响成员写入、重启恢复 |
| verify-auth-session-local.mjs | 通过；下列本机服务与真实浏览器场景 |

本机服务验收：登录/刷新 JSON 无刷新令牌、Cookie 属性和删除范围、可信 Origin、外站/兄弟域/null Origin/缺自定义头/cross-site 拒绝且不轮换、不发 Cookie；重复 Cookie 和旧 JSON 拒绝；原子轮换和重放撤族；无 Bearer Cookie 注销；revoked/local-only；旧版本 Cookie 不撤新会话；不同浏览器令牌族刷新/注销并发。

令牌族淘汰、空闲到期、绝对寿命与 Cookie 剩余时间使用独立命名空间、加速 3 秒空闲/8 秒绝对寿命验证。默认 10 分钟访问、30 分钟空闲、12 小时最长寿命未修改，未用 12 小时实际等待替代加速测试。协作活动不自行续期。

真实浏览器为 Windows Chrome 154.0.0.0，loopback HTTP，浏览器 CDP Proxy 只操作自建验收标签页。已验证：

1. 登录 UI、项目重载、新标签页、两页同时重载；恢复原 pathname/search/hash，并重新取得协作票据在线。
2. document.cookie 不含刷新令牌，localStorage/sessionStorage 不含 accessToken；协调消息不包含 JWT/密码/票据。
3. 运行中刷新 503 保留用户、会话代次与已挂载 Monaco；手动恢复成功。
4. 真实断开协作后编辑并写 IndexedDB；刷新 503 不改 pendingBytes、不清缓存、不 forbid；恢复后队列重放并清零。
5. 关闭持锁标签页，等待刷新安全获得释放后的锁并完成。
6. 访问令牌过期时修改密码可在同一锁内完成，两页及时清理身份。
7. 模拟退出网络故障，两个标签页及重载页保持 logout-pending；显式重试后确认 revoked。

脚本加载根 `.env`，使用独立应用端口和 Redis 命名空间；Cookie jar 仅驻内存。退出时关闭自建标签页及进程，新增验收账号/团队/项目/对象保留在本机。输出只包含场景、状态码和必要标识；不记录 Authorization、Cookie/Set-Cookie、密码、票据或密钥。

## 环境边界与发布

本次实际验证 Chrome 154；其他浏览器只通过功能检测拒绝不支持 Web Locks/存储的环境，尚未逐浏览器验收。没有关闭用户正在使用的整个浏览器来测试重启；已验证同一浏览器新标签页及页面重载，Cookie 为带 Max-Age 的持久 Cookie。生产 HTTPS 真实代理与 Secure Cookie 交付需在部署环境检查；本机自动测试验证 Secure 属性和生产来源配置拒绝规则。

数据库准备/事务结束、Redis 执行超时及响应故障采用可重复注入测试验证分类和调用边界；没有停掉共享 MySQL/Redis 服务或强制损坏真实数据库提交。此记录不声称跨存储原子性或每种网络响应丢失都能交付错误 JSON。

前后端契约不兼容，必须同批发布、停止旧制品、要求旧页面重载。Redis 格式保持不变，不需数据库迁移。回滚必须同步前后端并由理解 Cookie 契约的后端清 Cookie；必要时使用已验证的命名空间切换/版本撤销，不能清空共享 Redis。详见 [发布说明](../V__2/step11-release.md)。
