# V3 详细开发步骤与实施总计划

日期：2026-10-14。状态：步骤 1 已实施并验证，见[实施证据](evidence/step01.md)；步骤 2–5 待实施。以下代码基线保留实施前核对记录。

本文作为实施入口；功能范围以[需求](requirements.md)为准，实现边界以[技术方案](technical-design.md)为准，交付判断以[验收](acceptance.md)为准。保留现有五步顺序，不恢复旧版十一阶段及跨文件整体撤销方案。

## 当前代码基线

| 已核对的代码 | 当前实现 | V3 必须补上的部分 |
| --- | --- | --- |
| [ProjectWorkspace.tsx](../../frontend/src/editor/v2/ProjectWorkspace.tsx) | 创建用户/项目/epoch 隔离的 session，提供文件树、Monaco、Sandpack、在线成员、同步与持久化状态；选择文件不改变入口 | 设计文件、设计/运行切换、组件/属性/恢复 UI；切换后保留 session 和历史 |
| [WorkspacePanels.tsx](../../frontend/src/editor/v2/WorkspacePanels.tsx) | Ant Design Splitter、断点布局、文件和源码面板收起 | 容纳设计工具及窄窗口入口，避免布局变化销毁历史 |
| [MonacoWorkspace.tsx](../../frontend/src/editor/v2/MonacoWorkspace.tsx) | MonacoBinding 直接绑定 Y.Text；UndoManager 在组件内创建/销毁，只跟踪 MonacoBinding；快捷键调用 session.undo | 把历史移到工作区/会话生命周期，添加可视化 origin；定位源码；支持异步历史保护和提交期间输入门禁 |
| [session.ts](../../frontend/src/collaboration/session.ts) | mutate 在 scratch 上执行并验证，再执行 live；undo 克隆文档和历史栈做预检；按已注册 origin 统计本地更新 | 历史预检配置一致、候选正文可供恢复存储使用；设计记录初始化、远端检查及统一写入口 |
| [document.ts](../../frontend/src/collaboration/document.ts) | files/fileOrder/meta/directories 协议、文件路径与容量校验；create 在 action 内 randomUUID | Bootstrap 创建支持预生成固定 ID，保持 scratch/live 一致；不改变协议 |
| [offline.ts](../../frontend/src/collaboration/offline.ts) | 有界 IndexedDB 更新日志及 custom 存储；durable 时压缩待确认日志；按用户/项目/epoch 清理 | 独立设计恢复材料、先落盘后写入、总预算协调、prepared 重开及撤权清理 |
| [SandpackBridge.tsx](../../frontend/src/editor/v2/SandpackBridge.tsx)、[projection.ts](../../frontend/src/editor/v2/projection.ts) | 投影项目源码到 Sandpack，补充仅用于运行的工具依赖 | 原运行流程继续复用；另建安全静态设计投影，不能依赖 Sandpack DOM |
| [projectArchive.ts](../../frontend/src/collaboration/projectArchive.ts)、[exportTeamProject.ts](../../frontend/src/collaboration/exportTeamProject.ts) | 从项目文件生成 ZIP；已有被删文件恢复内容可进入专用恢复目录 | 验证真实 Bootstrap 资源保留；设计侧车及工具通信不进入普通项目文件和 ZIP |
| [frontend/package.json](../../frontend/package.json) | test/lint/build 已有入口；尚未声明 Bootstrap、parse5 和设计清洗/CSS 解析依赖 | 在步骤 1/2 确定必要包及固定版本，更新 lockfile；当前没有 V3 设计模块 |

当前恢复提示主要针对远端删除的文件，不等同于 V3 的基线、本地意图、破坏性操作前材料和整文件并发检查。已有 undo 预检也不能直接视为满足 V3 历史保护。

## 固定约束和预算

- Y.Text 是唯一源码权威；新增解析、nodeId、选择、能力令牌和恢复状态只存本地，不加入 Y.Doc schema。
- 不新增后端表、REST API、网关协议或页面 JSON。后台继续自动持久化现有文档；离线能力沿用现有 session。
- 只支持单个已有 HTML 的正文补丁。Bootstrap 准备可同时增加 CSS/许可/目录和 HTML link，但独立提交、不进入正文历史。
- 协议预算来自 [document-rules.ts](../../collaboration/src/document-rules.ts)：100 文件（含现有校验计入的逻辑删除项）、100 显式目录、1 MiB/文件、10 MiB 正文、12 MiB Y.Doc、2 MiB Update。不能只数可见文件或字符串长度。
- 现有离线待确认预算为 1536 KiB，`CACHE_LIMIT = 12 MiB + 1536 KiB`。设计材料暂定最多 5 MiB，同时计入共享本机缓存预算；不能把 5 MiB 当作额外豁免。具体计量/原子预留在步骤 2 落实，预算不足拒绝设计写入，不自动清未解决记录。
- 设计 HTML 上限 200 KiB，以 UTF-8 字节计量；位置/补丁偏移使用 UTF-16。CSS 投影总量、重复引用、通信大小/超时另设明确可测试的常量，记录实测后选定值，不修改协议预算。
- 应用运行和验收使用根 `.env` 以及本机 MySQL、MinIO、Redis；不使用 Docker / Docker Compose，不输出或提交凭据。

## 实施顺序

| 步骤 | 实现内容 | 完成条件 |
| --- | --- | --- |
| 1 源码与安全画布 | 工作区切换；位置解析、临时节点映射、只读限制；独立静态 iframe；项目直接 CSS；选择定位；过期命令拒绝。 | 普通页面正确显示，源码变化使旧命令失效，用户脚本/导航不执行，原文不被投影改写；基础真实浏览器检查通过。 |
| 2 按钮闭环与保护 | Bootstrap 独立准备；单 HTML 补丁；按钮插入/删除；共享正文历史；本机恢复落盘和文件级远端检查。 | 一次插入可撤销，资源不被撤销；取消/超限/准备失败零写入；两个会话与离线迟到更新触发检查；刷新能看到材料。 |
| 3 七类模板与属性 | 补全七模板，文本/属性编码、基础内联样式、简单 Flex；普通容器投放和前后插入，父元素选择；按钮/键盘入口。 | 每个模板正常插入；样式只改实例；混合文本/特殊结构明确限制；不误删相邻内容。 |
| 4 集成与边界 | 多 HTML、资源复用、重命名/删除提示、可写与预算统一门禁、重连/撤权/epoch、iframe 生命周期、性能与窄窗口。 | 所有写入口使用同一校验；恢复超限/失败停止设计写入；旧桥接不可写；代码、运行、已有文件操作不回归。 |
| 5 本机验收与交付 | 执行十项验收，真实双会话、MySQL/MinIO 持久化重开、导出/复制、Chrome/Edge；补充实际运行说明。 | 全部检查有真实结果，失败项修复；功能状态与文档一致，无凭据或工具信息进入 ZIP。 |

每步详细任务如下，按序执行；步骤 1 已完成，其余步骤待实施：

| 顺序 | 详细步骤 | 前置产物 | 本步交付 |
| --- | --- | --- | --- |
| 1 | [源码映射、安全画布与选择](steps/01-source-and-safe-canvas.md) | 当前 V2 工作区与现有检查基线 | 可切换、可选择、可定位的只读设计画布 |
| 2 | [Bootstrap、按钮写入、共享历史与恢复](steps/02-button-history-and-recovery.md) | 步骤 1 的解析代次、目标映射和安全桥接 | 有落盘保护、可撤销、可离线及并发提示的按钮闭环 |
| 3 | [七类模板、属性与插入交互](steps/03-templates-properties-and-insertion.md) | 步骤 2 的统一写命令、历史和门禁 | 首版完整的组件、属性、删除与拖拽交互 |
| 4 | [多文件集成、边界与回归](steps/04-integration-and-boundaries.md) | 步骤 3 的功能闭环 | 所有入口、资源、生命周期、预算和布局检查通过 |
| 5 | [本机验收、证据与交付](steps/05-local-acceptance-and-delivery.md) | 步骤 4 的可交付构建 | A1–A10 真实结果及可复现启动/交付记录 |

步骤 2 将历史、恢复和并发验证放进第一个按钮闭环，不能等 UI 全部完成才发现方案不可行。每步只完成当前具体用例，需要新抽象时再增加。

步骤 1 不开放正文写入。步骤 2 完成前不扩展七类模板或拖拽 UI；尤其先证明共享历史不捕获 Bootstrap、远端检查不消耗历史栈、刷新可找回被删除内容，再进入步骤 3。步骤 4 是全入口收口，不是首次实现离线/恢复/安全；这些保护必须随第一个写用例交付。

## 建议代码组织

以下为建议新增位置，尚未存在；允许合并小文件，不要求逐项建立抽象。

```text
frontend/src/editor/visual/
  VisualWorkspace.tsx             # 组合组件栏、画布、属性和状态
  ComponentPalette.tsx
  PropertiesPanel.tsx
  RecoveryPanel.tsx
  source/                        # 位置解析、注册表、编码、局部补丁
  canvas/                        # 清洗投影、CSS 资源、桥接、选择和拖拽
  templates/                     # 七类模板、Bootstrap 内置资源和准备计划
frontend/src/collaboration/
  visualRecovery.ts              # 有界本机材料；集成已有清理规则
  editorHistory.ts               # 或等价工作区级历史实现
```

不要求重构文件树全部命令，不引入通用 PatchPlan 平台。仅在具体用例需要处添加小接口：固定 ID 创建、历史候选预检、统一设计命令及恢复预算协调。第三方包具体版本与导入方式在实施时核验官方说明；本轮不安装依赖。

## 每步实施与提交约定

1. 阅读该步的前置条件与对应需求，确认上一步完成条件已满足。
2. 先落实纯源码/预检/保护逻辑，再接 UI；涉及安全、历史、恢复的失败路径必须与成功路径一起实现。
3. 运行相关现有及新增测试；浏览器事实使用真实浏览器核验，不用 jsdom 代替 sandbox、Pointer Events 或服务持久化。
4. 逐项核对源码 diff、Y.Doc 和恢复存储，记录结果；失败即修复或写明阻塞，不把未验证功能标为完成。
5. 建议每步一个可独立审阅的提交；步骤 2 可按固定 ID/历史、资源准备、恢复/按钮三个连续提交拆分，但整个闭环通过后才能进入步骤 3。

当前工作区的 V3 文档已有未提交改动及旧步骤删除；本计划以当前磁盘内容为准。实施时保留这些改动，不恢复旧文件或覆盖用户工作。

## 开发约束

- 不改 Y.Doc schema，不新建页面 JSON，不重写网关，不新增后端表或 API。若发现核心需求无法复用现有会话，记录具体原因再调整方案。
- 正文操作只改一个已有 HTML；Bootstrap 准备是唯一新增多文件动作，计划预生成 ID，scratch/live 一致。不要把现有所有文件命令改造成通用 PatchPlan。
- 历史统一作用域/origin；不捕获 Bootstrap 安装 origin，不做资源删除补偿。模式切换、收起源码区都不销毁正文历史。
- 并发采用整文件保守检查；不承诺精确节点合并，不做移动，不全量回滚。已确认的离线与本机持久恢复必须完成。
- 每步补必要的源码结果/失败路径测试；不要只写重复实现逻辑的测试，也不要把截图当作源码/持久化证据。

## 检查与记录

前端已有命令：在 `frontend` 运行 `npm test`、`npm run lint`、`npm run build`，按实际改动先运行相关测试，交付前完成这三项。新增浏览器脚本存在后再记录准确命令，不能编造已执行结果。

当前已存在、可用于增量回归的测试入口如下，命令工作目录均为 `frontend`；新增 visual 测试在实际建立文件后加入对应组：

| 检查重点 | 现有增量命令 |
| --- | --- |
| 工作区/面板/运行桥接 | `npm test -- src/editor/v2/WorkspacePanels.test.tsx src/editor/v2/SandpackBridge.test.tsx src/editor/v2/WorkspaceFileExplorer.test.tsx` |
| 文档/历史/离线会话 | `npm test -- src/collaboration/document.test.ts src/collaboration/session.test.ts src/collaboration/session.offline.test.ts src/collaboration/offline.test.ts` |
| 导出与项目入口 | `npm test -- src/collaboration/projectArchive.test.ts src/collaboration/exportTeamProject.test.ts src/features/projects/pages/ProjectPage.test.tsx` |

这些测试只证明已有覆盖的行为，不能单独证明 V3 功能或真实服务通过。步骤 1 最终全量测试已包含这些测试文件；实际命令和浏览器验证见[实施证据](evidence/step01.md)。

应用验证读取根 `.env`，连接本机 MySQL、MinIO、Redis，不用 Docker，不输出凭据。沿用[V2 本地运行指南](../V__2/development.md)和[交付启动说明](../V__2/step11-release.md)，避免同时启动占用相同端口的程序。

实施记录至少包含下列字段；建议在实施后新增 `implementation-log.md` 并在本索引挂链接，当前不预填通过结果：

| 字段 | 记录内容 |
| --- | --- |
| 步骤/日期/代码状态 | 五步编号、执行时间、commit 或未提交状态 |
| 修改文件与行为 | 实际文件、用户可观察变化、对应 R/A 编号 |
| 命令与工作目录 | 实际执行命令，不记录凭据或带秘密的环境值 |
| 自动检查结果 | 退出码、测试结果；未跑/失败/通过分别记录 |
| 浏览器与服务结果 | 浏览器版本、设备、双会话/离线/重开/本机服务证据 |
| 证据位置 | 受限本机目录或脱敏报告；截图配套源码断言 |
| 剩余问题 | 影响、复现步骤、修复后复测结果 |

步骤 1 已完成构建、自动测试及 Chrome 基础验证，见[实施证据](evidence/step01.md)；这不代表完整 V3 开发完成。既有 V2 通过记录只作为历史基线。
