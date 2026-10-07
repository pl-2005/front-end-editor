# V2 REST API

本文依据当前身份过滤器、AuthController、TeamController、TeamProjectController、CollabTicketController 和 SecurityConfig 整理。浏览器通过同源 `/api` 请求；内部 HMAC 协议见 [协作模块](../../collaboration/README.md)。

## 通用约定

除公开接口外，请求携带 `Authorization: Bearer <accessToken>`，JSON 正文使用 `Content-Type: application/json`。JWT 与刷新凭据只放内存；不使用 Cookie 或服务器 Session，不开放浏览器跨源 CORS。未知 JSON 字段拒绝，不能上传角色、创建人或存储指针。

一般 JSON 响应包含 `timestamp`、`status`、`code`、`message`、`data`；错误详情依错误类型位于 data，204 无正文。以 HTTP 状态码判断请求成功：当前项目创建/复制 HTTP 为 201，但其 `ApiResponse.ok` 正文仍为 status=200/code=OK。列表分页参数默认 page=0、size=20，size 上限 100。团队分页使用 Spring Page；项目列表 data 为 content/page/size/totalElements/totalPages。

## 身份

| 方法 | 路径 | 正文与行为 | 授权 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | username/email/password/displayName；201 用户资料，注册后显式登录 | 公开、限流 |
| POST | `/api/auth/login` | 仅 login/password；login 为用户名或邮箱 | 公开、限流 |
| POST | `/api/auth/refresh` | refreshToken；轮换刷新凭据 | 公开、限流 |
| GET | `/api/auth/me` | 当前用户资料 | Bearer |
| POST | `/api/auth/logout` | 无正文；撤销所有设备会话，204 | Bearer |
| PUT | `/api/auth/password` | currentPassword/newPassword；改密并撤销旧会话，204 | Bearer |

登录和刷新 data 为 user/accessToken/refreshToken/expiresIn，expiresIn 单位为秒，响应禁止缓存。user 包含 id/username/email/displayName/avatarColor。密码约束、规范化和错误码细节见 [身份步骤](steps/02-identity-jwt.md)。

## 团队与成员

| 方法 | 路径 | 正文或参数 | 授权/结果 |
| --- | --- | --- | --- |
| POST | `/api/teams` | name、可选 description | 已登录；201，新用户为 OWNER |
| GET | `/api/teams` | page/size | 已登录；本人团队分页 |
| GET | `/api/teams/discover` | query/page/size | 公开只读、限流；仅可申请团队 |
| GET | `/api/teams/{teamId}` | — | 有效成员；团队详情 |
| GET | `/api/teams/{teamId}/members` | — | 有效成员；成员列表 |
| PUT | `/api/teams/{teamId}/join-policy` | joinPolicy=`REQUEST` 或 `INVITE_ONLY` | OWNER；更新策略 |
| DELETE | `/api/teams/{teamId}/members/me` | — | MEMBER；退出，204；OWNER 须先转移 |
| DELETE | `/api/teams/{teamId}/members/{userId}` | — | OWNER；移除普通成员，204 |
| PUT | `/api/teams/{teamId}/owner` | userId | OWNER；转移给有效成员，204 |

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
