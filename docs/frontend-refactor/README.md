# 前端页面拆分与组件复用方案

日期：2026-10-08。状态：已实施并完成前端检查与本机浏览器验收。实际交付、验证结果及保留事项见[实施记录](implementation.md)。

## 1. 目标与范围

将 `V2App.tsx` 收敛为应用装配入口，按页面和业务职责拆分代码；对已有重复的界面及操作流程建立适度复用。保持当前 URL、认证行为、权限边界、页面交互和协作编辑语义。

优先处理 V2 页面，不同时改造后端、接口协议、协作存储或 V1 编辑器。暂不引入状态管理、请求缓存或新路由依赖。浏览器登录会话恢复仍按[独立方案](../auth-session/README.md)推进，本次仅为路由认证边界提供明确落点。

## 2. 重构前代码与问题

以下调查基于重构前工作区源码，行号为初始调查时的位置；当前实现与验证见实施记录。

| 位置                            | 当前职责                                        | 拆分方向                          |
| ------------------------------- | ----------------------------------------------- | --------------------------------- |
| `frontend/src/V2App.tsx:65–118` | `message` 错误文案、`useTask` 异步操作包装      | 共享错误格式化函数与操作 Hook     |
| `V2App.tsx:120–237`             | 登录、注册，已有 `mode` 复用                    | 独立 `AuthPage`，继续共享表单     |
| `V2App.tsx:239–360`             | Shell、导航、退出、顶部栏折叠、面包屑           | 应用布局与导航组件                |
| `V2App.tsx:362–787`             | 我的团队、发现团队、我的邀请                    | 三个独立页面及各自数据 Hook       |
| `V2App.tsx:789–810`             | 旧邀请入口提示与 hash 清理                      | 独立兼容页面                      |
| `V2App.tsx:812–1471`            | 团队详情、成员、入队策略、审批、邀请、项目 CRUD | 团队页面容器、管理面板和业务 Hook |
| `V2App.tsx:1473–1647`           | 项目元数据、操作、工作区加载与导出挂载点        | 项目页面、头部、业务 Hook         |
| `V2App.tsx:1649–1713`           | 路由 key、认证分流、主题与 BrowserRouter        | 独立路由模块，入口仅保留装配      |

`V2App.tsx` 共 1713 行，`styles.css` 共 1894 行。主要问题是多页面与多类副作用共享一个文件，团队详情又混合了多个业务区域。仅将整段 `TeamPage` 搬到另一个文件仍会保留维护负担。

已有封装应继续使用：

- `api/auth.ts`、`api/client.ts`、`api/teams.ts` 负责认证、请求与业务接口。
- `ui/AppTheme.tsx`、`useNotice.ts`、`useDialogs.tsx`、`ProjectEditDialog.tsx` 已承担主题、全局通知与对话框。
- `editor/v2/ProjectWorkspace.tsx`、`MonacoWorkspace.tsx`、`SandpackBridge.tsx`、`WorkspaceFileExplorer.tsx`、`WorkspacePanels.tsx` 已拆分编辑器职责。
- `collaboration/` 已封装协作会话、文档、离线缓存及导出。页面不得重新实现这些逻辑。

## 3. 建议目录

沿用当前 `api/`、`types/`、`ui/`、`editor/` 和 `collaboration/`。新增应用装配层与业务目录，避免为了统一形式移动所有已有模块。

```text
frontend/src/
  App.tsx                          # 保留现有应用入口
  V2App.tsx                        # AppTheme + BrowserRouter + AppRoutes
  app/
    AppRoutes.tsx                  # 路由声明、公开/受保护页面分流
    RequireAuth.tsx                # 集中认证守卫
    RouteEntries.tsx               # TeamRoute / ProjectRoute，保留 key
    AppShell.tsx                   # 公共布局、主导航、顶部栏折叠、退出
    RouteBreadcrumb.tsx
  features/
    auth/pages/
      AuthPage.tsx
      LegacyInvitePage.tsx
    teams/
      pages/TeamListPage.tsx
      pages/DiscoverPage.tsx
      pages/TeamPage.tsx
      hooks/useMyTeams.ts
      hooks/useDiscoverTeams.ts
      hooks/useTeamDetails.ts
      hooks/useInviteeSearch.ts
      components/TeamHeader.tsx
      components/TeamMembersPanel.tsx
      components/TeamJoinRequestsPanel.tsx
      components/TeamInvitationsPanel.tsx
      components/TeamProjectsPanel.tsx
    invitations/
      pages/InvitationsPage.tsx
      hooks/useMyInvitations.ts
    projects/
      pages/ProjectPage.tsx
      hooks/useProjectDetails.ts
      hooks/useProjectActions.ts
      components/ProjectHeader.tsx
      components/ProjectActionButtons.tsx
      components/ProjectInitializationRetry.tsx
  hooks/
    useTask.ts
    useAuthUser.ts
  ui/
    errorMessage.ts
    MetadataFields.tsx
    MetadataDialog.tsx
    # 保留 AppTheme、useNotice、useDialogs 等
  styles/
    base.css
    auth.css
    app-shell.css
    teams.css
    projects.css
    workspace.css
  styles.css                       # 分组样式导入入口
```

上表为目标落点，不要求一次创建所有文件。仅在对应阶段有实际实现时建立目录；组件测试就近存放。`ProjectEditDialog` 在迁移期可以保留兼容包装，完成调用方迁移后再移除。

依赖方向：应用装配层引用业务页面；页面引用业务 Hook、组件及共享 UI；Hook 引用 API 和类型；业务组件通过 props 接收数据与事件。共享模块不反向引用页面，项目操作模块不引用团队页面。业务目录内部优先直接导入，避免大范围 barrel 导出造成循环依赖或加载重型编辑器。

## 4. 页面与状态边界

### 4.1 应用入口与路由

- `V2App` 只保留主题、路由容器和路由挂载，不定义业务页面、表格列、API 操作或业务状态。
- `AppRoutes` 保留 `/login`、`/register`、`/invite`、`/teams`、`/discover`、`/invitations`、`/teams/:teamId`、`/teams/:teamId/projects/:projectId` 与兜底跳转。
- `RequireAuth` 集中未登录跳转；登录/注册在已有身份时仍跳 `/teams`，注册成功仍跳登录页。不要在本次增加自动恢复会话或回跳策略。
- `useAuthUser` 只包装既有 `useSyncExternalStore(subscribeAuth, getAuthUser)`，不创建第二份身份状态或复制令牌。
- 保留 `TeamRoute` 的 `teamId` key、`ProjectRoute` 的 `teamId:projectId` key 和登录/注册的不同 key，防止切换资源或表单时沿用旧状态。
- 第一阶段继续由页面挂载 `AppShell`，维持当前页面切换时顶部栏折叠状态重置的行为。改为持久嵌套布局会改变状态生命周期，应作为另一次明确的体验改动。

### 4.2 团队与邀请页面

| 页面/Hook                               | 持有状态与行为                                                     | 子组件职责                        |
| --------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| TeamListPage / useMyTeams               | 列表加载、错误、创建/编辑成功后的更新                              | 页面展示；元数据对话框收集输入    |
| DiscoverPage / useDiscoverTeams         | 输入与已提交搜索词、300ms 防抖、分页、待处理申请、申请/撤回        | 搜索与团队表格；保留服务端分页    |
| InvitationsPage / useMyInvitations      | 收件邀请、接受/拒绝、接受后导航                                    | 邀请列表与事件绑定                |
| TeamPage / useTeamDetails               | 团队、成员、项目、审批与邀请快照、reload、所有者判断、权限失效处理 | 页面组合管理面板                  |
| TeamInvitationsPanel / useInviteeSearch | 搜索输入、候选项、搜索状态、请求版本                               | 邀请候选及记录展示、发出/撤销事件 |

团队详情基础加载保留并行 `getTeam`、`listMembers`、`listTeamProjects`；确认当前用户为所有者后才读取审批和邀请。失去所有者身份时清空管理数据。成员面板仍对普通成员可见，所有者操作仍按权限展示。

`useTeamDetails` 保持团队页面数据的一份权威快照，面板不各自重复加载成员或团队详情。表单输入与展开状态由使用它的组件持有；跨面板会用到的数据及重载由页面 Hook 持有。事件使用具名参数与业务类型，避免把整个 Hook 返回对象透传到每个面板。

保留 `runTeam` 的特定权限策略：操作遇到 403，或非 `USER_NOT_FOUND` 的 404 时清空团队数据并回团队列表；查找用户失败不能被当作团队不可访问。该策略属于团队业务，不塞入通用 `useTask`。

### 4.3 项目页面

- `useProjectDetails` 持有详情、加载错误和元数据更新；`ProjectPage` 组合面包屑、头部、对话框、懒加载工作区。
- `ProjectHeader` 接收项目数据与事件，管理操作按钮布局和工作区导出的 DOM 挂载点，不负责创建协作会话。
- 更新名称/描述继续将 `TeamProjectSummary` 合并到现有详情，保留 `collaboration` 元数据。
- 保留 `ProjectWorkspace` 的懒加载、Suspense 提示和 `${user.id}:${project.id}:${project.collaboration.epoch}` key。元数据更新不重建工作区；用户、项目或 epoch 变化才切换协作实例。
- 详情页操作遇到 403/404 时清除详情并返回 `/teams`；删除成功返回所属团队。这两类跳转不混用。

## 5. 值得复用的内容与限制

### 5.1 异步操作与错误提示

将现有 `message` 原样提取为 `errorMessage`，保留 API 文案优先、业务码、409/429/403/410 及通用错误兜底。`api/responseMessage.ts` 负责解析响应文本，与面向用户的错误格式化职责不同，不合并为同一函数。

将 `useTask` 提取为共享 Hook，仍使用 `useNotice`；页面加载错误继续使用 `useFeedback`，避免同一失败同时由两条路径重复提示。初次迁移保留 `busy/run/setError` 调用契约和一次操作对整页按钮的锁定范围，不顺带改成逐行独立并发。

加载 Hook 必须清理 AbortController、防抖定时器，忽略被取消或过期的结果；请求代次至少区分资源 ID、搜索参数和当前用户身份。取消本身不展示业务错误。发现页继续保留查询/页码/页大小对应的已加载标记，候选用户搜索继续保留版本保护，不用一个通用 loading 布尔值取代这些语义。

同一资源的多次加载也必须区分先后。`useTeamDetails` 内所有 `reload` 共用递增请求序号和取消管理，包括初次加载及操作成功后的刷新；调用方不传 signal 时也受保护。每次加载捕获当前序号、团队 ID 和用户身份，基础数据、所有者管理数据、错误及加载完成状态写入前都校验该次请求仍有效。新 reload 开始、身份/资源切换或卸载时使旧请求失效，并取消可取消的请求；即使底层未响应取消，迟到结果也不能提交。旧的所有者管理响应不得恢复已清空的审批或邀请数据。

这项保护补齐当前 reload 仅检查可选 signal 的缺口，属于阶段 2 中单独验证的竞态修复，不作为阶段 1 原样搬迁已具备的能力。验收应让初次加载晚于操作后的刷新返回，确认旧成员、项目及管理数据不覆盖新快照；同时覆盖旧请求失败晚到和卸载后完成，不产生过期提示。

此处保留共享机制与业务策略的边界：错误展示与 busy 可以共享，权限清理、导航和初始化恢复由业务 Hook 决定。不要创建同时承担查询、缓存、权限、分页和变更的万能请求 Hook。

### 5.2 元数据表单与对话框

`ProjectEditDialog` 已同时编辑团队和项目，但类型名与 prop 名仍绑定项目；创建团队和创建项目也重复了名称与描述字段。

建议先提取无 API 依赖的 `MetadataFields`，再演进为 `MetadataDialog`。输入类型使用局部 `MetadataValues { name: string; description: string | null }`，不要继续依赖 `TeamProjectSummary` 的 Pick。对话框接收 kind、模式、初值、busy、onSubmit、onCancel；接口差异由调用方适配。

- 保留名称 100 字、描述 500 字、非空白名称校验、编辑时未变更直接关闭、提交中禁止重复提交等行为。
- 创建团队当前输入与 API 空描述行为不同于项目创建，不在抽取时统一修改；先记录并通过调用方适配保留，后续统一体验再单独决定。
- 表单 DOM id 使用实例唯一值，避免团队/项目多个对话框的 submit 关联冲突。
- 按打开实例/资源重置表单；保存失败保留输入。不要靠 props 变化的 effect 每次覆盖用户正在编辑的草稿。
- 名称、描述表单仅复用实际一致的输入与生命周期，不扩展为任意字段配置系统。

### 5.3 项目操作

团队项目表格和项目详情都包含编辑、复制、删除、初始化重试，提取 `useProjectActions` 及 `ProjectActionButtons`。Hook 负责调用既有项目 API、名称输入/删除确认、初始化失败 ID 与错误交接；页面通过 `onCopied`、`onDeleted`、`onUpdated` 等具名回调决定导航或更新列表。

任务状态与执行器契约：

- 每个业务页面只持有一份用于页面业务操作的 `useTask` 状态。团队页的项目操作与成员、审批、邀请及策略变更共用这份 busy；项目详情页的编辑、复制、删除和初始化重试共用另一份。`AppShell` 的退出任务仍保持现有独立状态。
- `useProjectActions` 接收页面提供的 `busy` 和 `execute(operation, success?)`；团队页注入 `runTeam`，详情页注入 `runProject`。Hook 不创建第二份 `useTask`，不另行包装通知。执行器完成权限清理后继续抛错给外层 `task.run`，由它统一展示一次失败并释放 busy。
- 操作 Hook 仅在需要记录 `initializingProjectId` 时捕获 API 错误，记录后重新抛出；成功回调及所需 reload 在同一次 execute 内 await，保持整个业务流程的锁定和错误交接。不得在 API 完成后提前释放 busy，再另起刷新任务。
- 复制名称输入、删除确认沿用现有发生在 execute 前的时序；取消不进入任务、不调用 API。Hook 可调用 `useDialogs`，但其 holder 必须由页面挂载，保持在 `AppTheme` 下。对话框实例与编辑表单草稿的生命周期不因任务状态抽取而改变。

阶段 3 需验证：项目操作等待期间团队页其他业务按钮仍禁用；团队页/详情页的权限错误分别进入原业务清理路径；初始化失败记录预留 ID 后只显示一次错误；成功后的刷新完成前 busy 不解除。

| 操作       | 团队项目列表                              | 项目详情                                        | 复用边界                                 |
| ---------- | ----------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| 编辑       | 更新列表中的项目                          | 合并详情，保留协作数据                          | 表单和更新调用，页面更新策略不同         |
| 复制       | 成功后 reload，留在列表                   | 成功后进入副本                                  | 输入/请求共享，成功回调不同              |
| 删除       | 成功后 reload                             | 成功后离开工作区，回团队                        | 确认/请求共享，清理和导航由页面处理      |
| 初始化重试 | 使用失败返回的预留项目 ID，成功后进入项目 | 对失败副本 ID 重试，成功后进入副本              | 保留 initializingProjectId，不能重新创建 |
| 导出       | 懒加载 exportTeamProject，按 userId 导出  | 工作区将当前会话导出入口 portal 到 exportTarget | 两种数据来源保持独立                     |

`ProjectActionButtons` 是操作展示组件，传入具名 handler 和导出 ReactNode 插槽。展示尺寸由样式/有限的展示参数控制，不引入大量业务布尔开关。团队表格继续阻止操作区域冒泡，保留 Enter/空格行导航及可访问标签。

继续调用 `api/teams.ts` 中现有删除、退队和移除成员等封装，不绕开其中的离线缓存清理。团队列表导出继续动态导入，不因共享组件静态加载协作、Monaco 或 Sandpack 模块。

### 5.4 样式及其他组件

样式拆分放到页面拆分之后。按基础、认证、公共壳、团队、项目、工作区分组，保留现有选择器、优先级与导入顺序；先梳理重叠规则再移动，不同时改设计或全量切换 CSS Modules。

面包屑适合共享；团队成员、审批、邀请适合成为业务面板。各类 Table 使用 Ant Design 本身的能力，先保留业务列定义；只有确认重复的行交互才提取小型工具。不新建通用 CRUD 页面、全局表单引擎或通用管理面板。

## 6. 分阶段实施与交付

| 阶段              | 实施内容                                                                                                              | 完成条件                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0：建立基线       | 检查工作区差异，记录现有前端 lint/test/build 结果，梳理现有失败                                                       | 区分原有问题与重构回归，确认无需接口变更                                                      |
| 1：入口与页面搬迁 | 提取错误函数、useTask、useAuthUser、AppShell、面包屑、路由和七个页面；建立可观察工作区 props 与挂载生命周期的测试替身 | V2App 只做装配；原路由行为测试通过；资源/身份切换与元数据更新的工作区生命周期断言通过         |
| 2：团队页面深化   | 拆管理面板、useTeamDetails、useInviteeSearch；拆列表、发现、收件邀请数据 Hook；补齐同一资源 reload 的竞态保护         | TeamPage 不再内联大型管理区域；初次加载与操作后刷新乱序、旧管理响应及旧错误晚到的回归测试通过 |
| 3：项目复用       | 提取项目详情 Hook、操作 Hook、按钮、重试入口、元数据字段与对话框；接入页面唯一任务状态和业务执行器                    | 页面锁定范围、权限清理与单次错误提示保持一致；摘要合并、工作区不重连及导出挂载点测试通过      |
| 4：样式与测试整理 | 分组 CSS，按业务搬迁测试，补必要行为回归，更新架构文档                                                                | 样式与布局一致，无循环依赖和重复实现，完整前端检查通过                                        |

每阶段可独立检查和回退，先搬迁再深化，不在单次提交中同时改变结构和业务行为。每提取一项同步迁移调用方，不长期保留两份实现。同步更新 [V2 架构](../V__2/architecture.md)、[数据流](../V__2/data-flow.md)和本方案状态；路由落点变化时更新登录会话恢复方案的代码位置。

目标是职责清晰：入口只做装配，页面负责组合与导航，面板负责展示及局部输入，Hook 负责数据与操作。行数作为复查信号，不作为机械验收指标；避免将 TeamPage 的复杂度整体搬进一个同样庞大的 Hook。

## 7. 验证与验收

现有 `V2App.test.tsx` 已覆盖直接进入子页后的返回、表格操作冒泡、初始化重试、名称描述更新、注册与跨页通知、旧邀请 hash 清理、邀请处理、搜索防抖/过期结果、发现分页及成员权限。先保留这些用户行为测试，不因搬文件而删除或降低断言。

`App.test.tsx` 同时包含 V2 登录落点和旧编辑器测试，应明确保留各自测试对象。稳定后将页面行为测试迁到业务目录，V2App 测试保留路由与跨模块集成。已有 `api/teams.offline.test.ts` 和协作/工作区测试继续覆盖底层行为，无需为每个纯展示组件新增仅镜像实现的测试。

重构前 `V2App.test.tsx` 的工作区 mock 只返回空 section，不读取 props；它无法证明 collaboration 保留、工作区不重挂载或导出 portal 的有效性。元数据更新测试中的 PUT 响应还包含 collaboration，不能覆盖真实摘要响应缺少该字段时的合并行为。补齐以下验证，按阶段同步完成，不延后到阶段 4：

- 阶段 1：使用可记录 project、userId、teamId、exportTarget 及挂载/卸载的工作区替身。名称/描述变化只更新 props、不产生额外挂载；切换用户、项目或 epoch 后旧实例卸载、新实例挂载。StrictMode 下以稳定后的基线比较变化，不依赖首次挂载的绝对次数。
- 阶段 2：用可控制完成顺序的 Promise 覆盖同一团队的初次加载与操作后 reload；基础数据和管理数据分别乱序，旧错误晚到及卸载后完成均不污染当前页面。
- 阶段 3：让更新 API 仅返回 `TeamProjectSummary`，不返回 collaboration；断言工作区收到原有 collaboration 和更新后的 stateVersion，连续编辑/删除使用最新 If-Match。沿用阶段 1 的生命周期断言，确认抽取 Header、操作 Hook 和对话框后仍不重挂载。
- 阶段 3：测试替身向 exportTarget 渲染带实例标识的 portal，确认挂载点连接到当前 DOM，元数据更新后入口仍有效，切换项目后旧入口消失且新入口只出现一次。替身验证页面与挂载点的集成；真实工作区的会话创建/销毁及当前文档导出仍通过既有协作测试和本机验收验证。

这些断言验证实际传参与生命周期；不以空 section 仍在页面、标题已更新或组件 key 的静态文本作为验收依据。阶段 4 只整理测试位置并做完整回归，不承担前面阶段尚未补齐的关键验证。

需要重点复查或补齐的行为：

1. 直接进入团队/项目链接、登录跳转、注册后回登录、未知路径兜底行为不变；公共通知跨页仍保留。
2. 普通成员不读取或展示所有者管理数据；权限丢失后清理旧页面；查不到用户不误跳团队列表。
3. 快速切换团队、项目、搜索词、页大小以及卸载时，旧请求不覆盖当前数据，防抖与取消正常；同一团队的初次加载与操作后 reload 乱序时，仅有效请求提交基础/管理数据与错误状态。
4. 元数据更新保留 collaboration，编辑器不因名称变化重连；用户/项目/epoch 变化按原 key 建立新工作区。
5. 复制/创建失败重试使用预留项目 ID；删除确认取消不发请求；删除、退队、撤权仍执行既有离线缓存清理。
6. 列表导出走独立流程，详情导出当前协作文档；详情挂载点可用，切换项目后无旧会话导出入口。
7. 表格按钮不触发行导航，键盘、aria 标签、顶部栏折叠、响应式布局及模态框提交状态保持一致；项目操作与同页其他业务操作共用 busy，权限错误按页面策略清理，失败只提示一次。

每阶段在 `frontend` 执行针对受影响行为的测试、`npm run lint` 和 `npm run build`；最终执行完整 `npm test`。格式遵循现有 Prettier 配置，检查和格式化仅针对本次文件，避免无关全仓变动。

真实应用验收按照 [V2 本地开发指南](../V__2/development.md)启动，使用仓库根 `.env` 与本机 MySQL、MinIO，以及既有 Redis、Spring、初始化服务和协作网关。禁止使用 Docker/Docker Compose，不打印或提交凭据。单元测试使用已有 mock，不通过直接调用 API 绕过本机验收要求。

实施已完成：入口与页面拆分、团队管理面板与加载竞态保护、项目操作及元数据表单复用、按原级联顺序分组样式。最终 lint/build、24 个测试文件的 152 项测试及本机浏览器验收通过；具体证据、与方案的落地差异及原有构建提示见[实施记录](implementation.md)。
