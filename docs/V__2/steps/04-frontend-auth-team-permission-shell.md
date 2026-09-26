# 步骤 04：前端身份、团队与权限壳

> 前置：步骤 03 后端、V6–V8、target=8 已验收。  
> 目标：交付可发布的认证/团队 UI，并与 V9 和强制认证后端原子切换。

## 1. 路由与启动状态机

使用 React Router，canonical 项目详情为 `/teams/:teamId/projects/:projectId`。`/projects/:projectId` 只作为兼容 loader：读取授权后的详情 teamId，立即 replace 到 canonical URL，不维护第二份页面状态。

公共路由：`/login`、`/register`、`/teams/discover`、`/invite#token=...`；认证路由：团队、项目、个人设置；团队管理路由：成员、加入申请、邀请。

`AuthProvider` 状态为 `anonymous / authenticated / accountUnavailable(reason)`。凭据只存页面内存，启动流程：

1. 整页加载时没有内存凭据，直接进入 anonymous，不发送无 Bearer 的 `/api/auth/me`；
2. 登录成功后保存访问 JWT 和刷新凭据至内存，带 Bearer 请求 `/api/auth/me`；
3. authenticated 后才加载团队，禁止 App 抢跑项目列表；访问 JWT 临近过期时单飞刷新，失败则清空凭据和用户缓存。

功能验收确认首次匿名打开后可以直接提交 login POST，所有受保护请求携带 Bearer，整页刷新和新标签页要求重新登录。returnTo 只接受解码后以单个 `/` 开头、非 `//`、非反斜杠、无 scheme/host 的站内路径。

## 2. 注册、团队发现与加入状态机

注册和团队加入提供以下路径：

~~~text
匿名用户 -> /register -> 自助注册 -> 显式登录
├─ 创建团队 -> 当前用户成为 OWNER
├─ 团队发现 -> 查看公开基本资料 -> 提交加入申请 -> 等待审批
│  └─ 被批准后成为 MEMBER，重新加载团队列表
└─ 接受团队邀请
   ├─ 已登录 -> POST /api/invitations/accept
   └─ 匿名 -> 保存 fragment token 于 InviteProvider 内存 -> 登录/注册 -> 登录后 accept
~~~

InviteProvider 位于登录/注册路由之上以跨导航保留 token，但刷新即丢失并提示重新打开邀请链接；禁止 LocalStorage、sessionStorage、URL query、analytics 或通用查询缓存。分享链接只在创建弹窗内存显示，关闭即丢弃。加入申请只保存申请状态和用户输入的简短说明，不在客户端乐观添加 team membership；只有服务端批准后才显示团队及其资源。

## 3. 页面与数据层

- 登录：统一失败文案；429 从 `Retry-After` 秒数倒计时；
- 注册：公开可达的自助注册表单；注册成功提示显式登录，冲突和限流显示安全、可操作的消息；
- 团队/项目：团队范围分页，移除旧全局列表、自动打开首项目和旧 POST /api/projects；
- 团队发现：分页搜索可申请加入的团队，只展示公开基本资料；申请、撤回、待审批/已处理状态清晰可见；
- 团队设置：成员、加入申请审批、邀请、OWNER 转移、加入策略、归档；
- 创建团队：任何已登录用户可创建团队，成功后自动进入该团队并显示 OWNER 管理能力；
- 项目成员与版本历史；
- 个人设置：改密成功后清除内存凭据并返回登录页。

步骤 02 契约同步为：429 必须带整数秒 `Retry-After`；`/api/auth/me` 只返回安全用户资料，不返回平台角色或全局管理员能力。团队与项目能力由各自资源接口返回，后端仍是权威。

选用 TanStack Query 管理服务端缓存。键分层：currentUser 无资源键；teams=[userId]；team=[userId,teamId]；project=[userId,teamId,projectId]。logout、身份变化、移出团队或 401 时取消在途请求并清相关缓存。刷新凭据由独立内存模块持有，不进入 TanStack Query。403/404 最多重取一次，随后进入错误页，禁止循环。

## 4. 旧 IndexedDB 草稿隔离

本步骤立即升级当前 draft store，不能推迟到步骤 08：

- 新 store 主键至少为 `[userId, projectId]`，记录 schemaVersion；
- 只有当前登录 userId 且仍有 PROJECT_EDIT 才自动读写；
- 旧 `web-editor/drafts` 无主草稿绝不自动认领或加载；
- 提供显式“导出旧草稿”工具，导入需用户确认且再过项目权限/大小校验；
- logout 停止 writer 并清内存，不删除其他用户记录。

步骤 08 再迁移到 `userId/projectId/epoch` 的 Yjs 缓存。空项目不再由浏览器 DEFAULT_FILES 权威初始化；服务端 revision1 缺失视为数据错误，DEFAULT_FILES 仅可用于错误占位展示。

## 5. 能力到现有编辑器的逐项门控

前端只消费后端团队/项目 capabilities：

| 能力 | UI/副作用 |
| --- | --- |
| PROJECT_CREATE | 显示团队内新建项目 |
| PROJECT_READ | 进入项目 |
| PROJECT_EDIT | Sandpack 编辑器只读切换；文件新建/重命名/删除全部禁用 |
| CHECKPOINT_CREATE | 启停 useProjectSave，隐藏保存入口；无能力绝不发写请求 |
| REVISION_READ | 显示历史 |
| REVISION_RESTORE | 显示并允许恢复 |
| PROJECT_MANAGE | 名称、描述、模板等项目元数据入口 |
| PROJECT_MEMBER_MANAGE | 成员列表、授权和撤销入口 |
| PROJECT_DELETE | 删除入口 |
| TEAM_CREATE | 新建团队 |
| TEAM_READ | 团队页面 |
| TEAM_SETTINGS_MANAGE | 团队设置 |
| TEAM_ARCHIVE | 团队归档 |
| TEAM_MEMBER_MANAGE | 成员与 OWNER 转移 |
| TEAM_INVITATION_MANAGE | 邀请管理 |

VIEWER 可预览但编辑与结构操作只读。自动保存继续使用 expectedVersion，并消费响应 stateVersion；元数据更新/删除使用 If-Match。409 显示重载/导出本地内容，不自动覆盖。

## 6. 代码拆分

`App.tsx` 拆为 Router、AuthenticatedLayout、TeamLayout、ProjectWorkspace。步骤 07 前仍使用 SandpackCodeEditor，不引 Yjs/Monaco。API client 固定 `credentials=omit`，受保护请求加 `Authorization: Bearer`；GET/HEAD 无 body 不设 Content-Type；访问 JWT 与刷新凭据只在内存中，不写浏览器持久层。

## 7. 自动化测试

功能检查覆盖：

- 启动匿名、Bearer 附加、单飞刷新、整页刷新后重新登录及所有认证/错误分流；
- 开放注册、显式登录和限流；InviteProvider 跨导航、刷新丢失和无持久化；邀请加入与申请加入两条团队流程；
- VIEWER/EDITOR/MANAGER 每项 UI 与副作用门控，并构造 PROJECT_MANAGE 与 PROJECT_MEMBER_MANAGE 正反独立组合，禁止隐式角色推断；
- IndexedDB 用户隔离、旧草稿不自动认领；
- canonical route、缓存键、取消请求、403/404 单次重取；
- StrictMode 最终一个有效订阅且无重复变更；
- ETag/stateVersion 和无 DEFAULT_FILES 权威写入。

功能验收确认：新用户可自助注册并显式登录，JWT Bearer 与刷新凭据轮换可用，整页刷新后重新登录；可创建团队成为 OWNER，申请加入须经审批后才能访问项目，邀请加入能生效；新项目有 revision1，EDITOR/VIEWER 权限与 OWNER 转移符合规则。通过页面和 API 的功能检查即可，不要求 Playwright、双浏览器 context、独占 E2E schema/Bucket/Redis 命名空间。

开发时可按需运行 `npm run lint`、`npm run test`、`npm run build`；功能验收不以自动化命令通过为前提。

## 8. 生产联合发布

1. 入口切维护页并停止新流量，drain 在途请求；
2. 停止并核对全部旧 API 实例、后台任务和进程；
3. 部署新前端静态制品到未公开槽位；
4. 兼容新后端以 target=9 按顺序执行 V6–V9，并以 `AUTH_ENFORCEMENT_ENABLED=true` 启动；
5. 内网 readiness、自助注册/登录、团队项目冒烟；
6. 原子切换入口到新前端+新后端。

任一检查在 V9 前失败可回退；V9 后只能回滚到认识 V3–V9 且强制认证的兼容制品，不得关闭认证或恢复旧前端。

## 9. 验收与后续

无登录死路或跨用户草稿泄露；自由注册、团队创建、邀请加入和申请审批加入流程可用；未获批申请人无法读取团队/项目；VIEWER 不产生写副作用；V9 后旧匿名客户端失败。步骤 05 可依赖稳定 user/team/project/capabilities 上下文；步骤 07 只替换 ProjectWorkspace 编辑器；步骤 08 将隔离草稿迁移为 epoch 级 Yjs 缓存。




