# V2 REST API

本文依据当前身份过滤器、AuthController、TeamController、TeamProjectController、CollabTicketController 和 SecurityConfig 整理。浏览器通过同源 `/api` 请求；内部 HMAC 协议见 [协作模块](../../collaboration/README.md)。

## 通用约定

除公开接口外，请求携带 `Authorization: Bearer <accessToken>`，JSON 正文使用 `Content-Type: application/json`。JWT 与用户资料只放页面内存；刷新令牌只由 HttpOnly Cookie 传递，不使用服务器 Session，不开放浏览器跨源 CORS。普通业务请求固定 credentials: omit；认证修改请求使用 same-origin、精确 Origin 和 X-Web-Editor-Request: browser。未知 JSON 字段拒绝，不能上传角色、创建人或存储指针。

一般 JSON 响应包含 `timestamp`、`status`、`code`、`message`、`data`；错误详情依错误类型位于 data，204 无正文。以 HTTP 状态码判断请求成功：当前项目创建/复制 HTTP 为 201，但其 `ApiResponse.ok` 正文仍为 status=200/code=OK。列表分页参数默认 page=0、size=20，size 上限 100。团队分页使用 Spring Page；项目列表 data 为 content/page/size/totalElements/totalPages。

## 身份

| 方法 | 路径 | 正文与行为 | 授权 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | username/email/password/displayName；201 用户资料，注册后显式登录 | 公开、限流 |
| POST | `/api/auth/login` | 仅 login/password；login 为用户名或邮箱 | 公开、限流 |
| POST | `/api/auth/refresh` | 严格空对象 {}；从 Cookie 原子轮换，拒绝旧 refreshToken JSON | Cookie、来源校验、限流 |
| GET | `/api/auth/me` | 当前用户资料 | Bearer |
| POST | `/api/auth/logout` | 严格空对象 {}；200 data.outcome=revoked 或 local-only，成功清 Cookie | Cookie、来源校验，不要求 Bearer |
| PUT | `/api/auth/password` | currentPassword/newPassword；改密并撤销旧会话，204 | Bearer |

登录和刷新 data 为 user/accessToken/expiresIn，expiresIn 单位为秒，JSON 不含刷新令牌。所有认证响应（含错误）Cache-Control: no-store。Cookie 名 web_editor_refresh，HttpOnly、SameSite=Strict、Path=/api/auth、host-only，生产 Secure；Max-Age 为刷新空闲与族寿命剩余时间的较小值向下取整。登录失败不删除已有 Cookie；刷新 401 清 Cookie，400/403/429/503 保留。503 AUTH_SERVICE_UNAVAILABLE 表示提交前不可用，AUTH_REFRESH_OUTCOME_UNKNOWN 表示轮换结果不确定，不自动重发。logout revoked 只在撤销事务提交后返回；local-only 只确认本机匿名，不能声称其他设备已退出。改密码成功清 Cookie，失败保留。user 包含 id/username/email/displayName/avatarColor。密码约束、规范化和错误码细节见 [身份步骤](steps/02-identity-jwt.md)。

## 团队与成员

| 方法 | 路径 | 正文或参数 | 授权/结果 |
| --- | --- | --- | --- |
| POST | `/api/teams` | name、可选 description | 已登录；201，新用户为 OWNER |
| GET | `/api/teams` | page/size | 已登录；本人团队分页 |
| GET | `/api/teams/discover` | query/page/size | 公开只读、限流；仅可申请团队 |
| GET | `/api/teams/{teamId}` | — | 有效成员；团队详情 |
| PUT | `/api/teams/{teamId}` | name、可选 description | OWNER；更新名称及描述，名称必填且最多 100 字，描述最多 500 字，空值清空 |
| GET | `/api/teams/{teamId}/members` | — | 有效成员；成员列表 |
| PUT | `/api/teams/{teamId}/join-policy` | joinPolicy=`REQUEST` 或 `INVITE_ONLY` | OWNER；更新策略 |
| DELETE | `/api/teams/{teamId}/members/me` | — | MEMBER；退出，204；OWNER 须先转移 |
| DELETE | `/api/teams/{teamId}/members/{userId}` | — | OWNER；移除普通成员，204 |
| PUT | `/api/teams/{teamId}/owner` | userId | OWNER；转移给有效成员，204 |

本人团队列表及团队详情的 `role` 表示当前用户在团队内的角色（`OWNER` 或 `MEMBER`）；公开发现列表不提供用户角色。元数据编辑响应包含更新后的团队及当前用户角色。

| 方法 | 加入申请路径 | 行为 |
| --- | --- | --- |
| POST | `/api/teams/{teamId}/join-requests` | 本人提交，201 |
| GET | `/api/teams/join-requests/me` | 本人待处理申请 |
| DELETE | `/api/teams/{teamId}/join-requests/me` | 本人撤回，204 |
| GET | `/api/teams/{teamId}/join-requests` | OWNER 待审批列表 |
| POST | `/api/teams/{teamId}/join-requests/{requestId}/approve` | OWNER 批准，204 |
| POST | `/api/teams/{teamId}/join-requests/{requestId}/reject` | OWNER 拒绝，204 |

| 方法 | 站内邀请路径 | 行为 |
| --- | --- | --- |
| GET | `/api/teams/{teamId}/invitees/lookup?identifier=...` | OWNER 按用户名/邮箱查找注册账号 |
| POST | `/api/teams/{teamId}/invitations` | OWNER 提交已确认 userId，201 |
| GET | `/api/teams/{teamId}/invitations` | OWNER 查看邀请记录 |
| DELETE | `/api/teams/{teamId}/invitations/{invitationId}` | OWNER 撤销，204 |
| GET | `/api/teams/invitations/me` | 本人有效邀请 |
| POST | `/api/teams/invitations/{invitationId}/accept` | 目标账号接受并返回团队 |
| POST | `/api/teams/invitations/{invitationId}/reject` | 目标账号拒绝，204 |

邀请不发送邮件。查不到账号返回 USER_NOT_FOUND 且不创建邀请；默认 7 天有效，过期、撤销、重复处理或非目标账号处理统一失效。申请批准或接受邀请前不能访问团队项目。

## 项目与协作票据

所有有效团队成员对项目同权。以下项目路径前缀统一为 `/api/teams/{teamId}/projects`。

| 方法 | 相对路径 | 正文/行为 |
| --- | --- | --- |
| POST | 空 | name、可选 description/template/entry；vanilla 模板初始化，HTTP 201 + ETag |
| GET | 空 | page/size；可见项目列表，不含 INITIALIZING |
| GET | `/{projectId}` | 项目详情 + collaboration 描述 + ETag |
| PUT | `/{projectId}` | name、可选 description/template；强 If-Match，返回新 ETag |
| DELETE | `/{projectId}` | 强 If-Match；durable fence 后软删除，204 |
| POST | `/{projectId}/initialize` | 重试同一保留 ID；ACTIVE 时幂等返回 |
| POST | `/{projectId}/copy` | name；先 flush 再复制权威 Y.Doc，HTTP 201 + ETag |

示例创建正文：

```json
{ "name": "协作示例", "template": "vanilla", "entry": "/index.html" }
```

元数据 ETag 形如 `"project-42-3"`，由项目 ID 和 stateVersion 组成。PUT/DELETE 缺少 If-Match 返回 428，无效/陈旧条件返回 409 PROJECT_STATE_CONFLICT；客户端重载，不自动覆盖。generation 不能代替 stateVersion。文件入口切换通过 Y.Doc 命令，不能通过元数据 PUT 修改 entry。

详情 collaboration 包含 collaborationMode=`YJS`、epoch、generation、contentHash、size、contentType；不含 files、objectKey 或旧 version。初始化失败返回 COLLAB_INITIALIZATION_FAILED，响应头 X-Initializing-Project 提供可重试 ID。

项目文件上传由浏览器读取 UTF-8 文本，通过现有 Yjs WebSocket 协作命令加入文档；没有 multipart REST 上传接口或浏览器直传 MinIO 的 URL。路径冲突、编码及容量错误由文件栏显示，持久化状态沿用协作消息。支持类型与交互见[文件管理交互](file-explorer.md)。

`POST /api/projects/{id}/collab-ticket` 是旧项目路径下唯一开放的业务路由：Bearer 签发约 60 秒有效的单次票据，data 包含 ticket/expiresAt/projectId/epoch。浏览器通过精确 `/collaboration` 的认证消息发送票据，房间名为 `project:{id}:epoch:{epoch}`；重新连接申请新票据，不放 URL、日志或持久存储。

## 健康与错误

`GET /api/health` 仅证明进程可响应；`GET /api/health/readiness` 检查 MySQL 连接，失败返回 503。readiness 不证明 Redis、MinIO 或协作全链路正常。

| HTTP | 常见情况 |
| --- | --- |
| 400 | 字段、格式、路径或正文校验失败 |
| 401 | AUTHENTICATION_REQUIRED；会话失效，清理凭据并重新登录 |
| 403 | ACCESS_DENIED 或授权失败；禁止旧项目/快照/历史链路 |
| 404 | 不存在或无权查看的资源 |
| 409 | 元数据、generation、epoch 或业务状态冲突 |
| 410 | 邀请/申请处理已失效 |
| 413 | 超过正文或文档硬上限 |
| 428 | 缺少强 If-Match |
| 429 | AUTH_RATE_LIMITED 等限流 |
| 503 | Redis、初始化、持久化或 durable fence 暂不可用 |

旧 `/api/projects`、详情、snapshot、revisions 和 restore 路由在安全链拒绝；旧匿名项目不能认领。内部 describe/load/persist、票据消费、授权续租、flush/fence/control、metrics 和 maintenance 使用独立 HMAC，不能用普通 JWT 访问或由浏览器代理开放。内部运维路径详见 [运维说明](step10-operations.md)。
