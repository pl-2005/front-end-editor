# 步骤 04：前端身份、团队与权限壳

> 前置：步骤 03 后端、V6–V8、target=8 已验收。  
> 目标：交付可发布的认证/团队 UI，并与 V9 和强制认证后端原子切换。

## 1. 路由与启动状态机

使用 React Router，canonical 项目详情为 `/teams/:teamId/projects/:projectId`。`/projects/:projectId` 只作为兼容 loader：读取授权后的详情 teamId，立即 replace 到 canonical URL，不维护第二份页面状态。

公共路由：`/login`、`/invite#token=...`；认证路由：团队、项目、个人设置；管理路由：成员、邀请、审计、平台用户。

`AuthProvider` 状态为 `bootstrapping / anonymous / authenticated / accountUnavailable(reason)`。启动流程：

1. GET CSRF；
2. GET /auth/me，标记为 `expectedAnonymous`；
3. 该请求的预期 401 只切换 anonymous，不走全局“清 CSRF”拦截器；其他 401 仍清身份/token；
4. 若实现无法隔离，则 401 后立即再取 CSRF；
5. authenticated 后才加载团队，禁止 App 抢跑项目列表。

测试必须证明首次匿名打开后的 login POST 携带有效 token。returnTo 只接受解码后以单个 `/` 开头、非 `//`、非反斜杠、无 scheme/host 的站内路径。

## 2. 邀请状态机

统一 InviteProvider：

~~~text
读取 fragment -> history.replaceState 清 URL -> token 仅存 Provider 内存
├─ authenticated -> POST /api/invitations/accept
└─ anonymous
   ├─ 已有账号：导航登录 -> 登录成功 -> accept
   └─ 新账号：INVITE_ONLY register -> 显式 login -> 已加入团队
~~~

Provider 位于登录/注册路由之上以跨导航保留 token，但刷新即丢失并提示重新打开邀请链接；禁止 LocalStorage、sessionStorage、URL query、analytics 或通用查询缓存。分享链接只在创建弹窗内存显示，关闭即丢弃。

## 3. 页面与数据层

- 登录：统一失败文案；429 从 `Retry-After` 秒数倒计时；
- 团队/项目：团队范围分页，移除旧全局列表、自动打开首项目和旧 POST /api/projects；
- 团队设置：成员、邀请、OWNER 转移、归档、团队审计；
- 项目成员与版本历史；
- 平台页：消费 `/auth/me.globalCapabilities`，不直接以 platformRole 复制授权逻辑；
- 个人设置：改密后的 Session/CSRF 轮换。

步骤 02 契约同步为：429 必须带整数秒 `Retry-After`，跨源时暴露该响应头；`/auth/me` 增加 `globalCapabilities: string[]`，至少可含 USER_MANAGE/PLATFORM_ACCESS。后端仍是权威。

选用 TanStack Query 管理服务端缓存。键分层：session 无资源键；teams=[userId]；team=[userId,teamId]；project=[userId,teamId,projectId]。logout、身份变化、移出团队、401/423 时取消在途请求并清相关缓存。403/404 最多重取一次，随后进入错误页，禁止循环。

## 4. 旧 IndexedDB 草稿隔离

本步骤立即升级当前 draft store，不能推迟到步骤 08：

- 新 store 主键至少为 `[userId, projectId]`，记录 schemaVersion；
- 只有当前登录 userId 且仍有 PROJECT_EDIT 才自动读写；
- 旧 `web-editor/drafts` 无主草稿绝不自动认领或加载；
- 提供显式“导出旧草稿”工具，导入需用户确认且再过项目权限/大小校验；
- logout 停止 writer 并清内存，不删除其他用户记录。

步骤 08 再迁移到 `userId/projectId/epoch` 的 Yjs 缓存。空项目不再由浏览器 DEFAULT_FILES 权威初始化；服务端 revision1 缺失视为数据错误，DEFAULT_FILES 仅可用于错误占位展示。

## 5. 能力到现有编辑器的逐项门控

前端只消费后端 project/global capabilities：

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
| TEAM_AUDIT_READ | 团队审计 |
| USER_MANAGE / PLATFORM_ACCESS | 平台路由 |

VIEWER 可预览但编辑与结构操作只读。自动保存继续使用 expectedVersion，并消费响应 stateVersion；元数据更新/删除使用 If-Match。409 显示重载/导出本地内容，不自动覆盖。

## 6. 代码拆分

`App.tsx` 拆为 Router、AuthenticatedLayout、TeamLayout、ProjectWorkspace。步骤 07 前仍使用 SandpackCodeEditor，不引 Yjs/Monaco。API client 固定 credentials=include；GET/HEAD 无 body 不设 Content-Type；Session Cookie 不进 JS，CSRF 仅内存。

## 7. 自动化测试

组件/集成测试覆盖：

- 启动 expected-anonymous CSRF、所有认证/错误分流；
- InviteProvider 两条路径、跨导航、刷新丢失和无持久化；
- VIEWER/EDITOR/MANAGER 每项 UI 与副作用门控，并构造 PROJECT_MANAGE 与 PROJECT_MEMBER_MANAGE 正反独立组合，禁止隐式角色推断；
- IndexedDB 用户隔离、旧草稿不自动认领；
- canonical route、缓存键、取消请求、403/404 单次重取；
- StrictMode 最终一个有效订阅且无重复变更；
- ETag/stateVersion 和无 DEFAULT_FILES 权威写入。

引入 Playwright，新增 `playwright.config.ts` 与 `npm run test:e2e`。E2E 使用独立 `E2E_DB_ADMIN_URL/E2E_DB_SCHEMA_PREFIX/E2E_DB_USERNAME/E2E_DB_PASSWORD`，从已验证不等于开发库和 IT 库的测试基址创建 `${prefix}_${runId}` schema；MinIO 使用 `E2E_MINIO_BUCKET_PREFIX + runId` 独占且预检为空的 Bucket。缺任一隔离配置、前缀不安全或目标与开发库/IT_DB_URL相同立即失败。空 schema 通过测试专用内存秘密 bootstrap 管理员且不打印凭据。两个 browser context 验证管理员邀请、新用户注册后显式登录、revision1、EDITOR/VIEWER 和 OWNER 转移。finally 先停止进程，再精确校验并删除本次 runId schema/Bucket；不新增生产 cleanup API。Maven integration 始终使用并保留独立的 IT_DB_URL，两套门禁互不删除资源。

门禁命令：`npm run lint`、`npm run test`、`npm run build`、`npm run test:e2e`、`mvn -Pintegration verify`。

## 8. 生产联合发布

1. 入口切维护页并停止新流量，drain 在途请求；
2. 停止并核对全部旧 API 实例、后台任务和进程；
3. 部署新前端静态制品到未公开槽位；
4. 兼容新后端以 target=9 执行 V9，并以 `AUTH_ENFORCEMENT_ENABLED=true` 启动；
5. 内网 readiness、管理员登录、团队项目冒烟；
6. 原子切换入口到新前端+新后端。

任一检查在 V9 前失败可回退；V9 后只能回滚到认识 V3–V9 且强制认证的兼容制品，不得关闭认证或恢复旧前端。

## 9. 验收与后续

无登录死路或跨用户草稿泄露；邀请两条流程可用；VIEWER 不产生写副作用；V9 后旧匿名客户端失败；双用户 E2E 全绿。步骤 05 可依赖稳定 user/team/project/capabilities 上下文；步骤 07 只替换 ProjectWorkspace 编辑器；步骤 08 将隔离草稿迁移为 epoch 级 Yjs 缓存。




