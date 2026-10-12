# V3 多 agent 技术评审

日期：2026-10-12。结论：**有条件通过源码驱动路线，须先关闭 P0 技术门禁**。这是实施前技术评审，不代表功能开发、运行验收或安全验证通过。

后续范围补充：用户要求 Bootstrap 作为组件栏依赖，方案见[Bootstrap 依赖方案](bootstrap-dependency.md)。该补充由主 agent 更新，未声称已由此前三个子 agent 重新复核；固定 CSS/许可分发、并发引入引用、全页级联影响及资源预算均加入 P0，FR-18/AC-25 待实施验证。D-01/D-02 保持已确认状态。

## 评审范围与证据

依据本目录需求、技术约束、验收矩阵及需求评审记录，核对当前工作树的前端、网关、离线缓存和历史实现。代码基点为 `c140530`；本轮开始时 `docs/README.md` 已修改、`docs/V__3/` 未跟踪，未将这些既有内容视为本轮代码改动。

三个子 agent 独立只读评审，主 agent 交叉核对并汇总：

| 子 agent | 方向 | 结论 |
| --- | --- | --- |
| source_transactions | 源码映射、补丁、多文件事务、共享撤销 | 需要受限确定性计划执行器，以及真实/scratch 一致的历史与依赖保护 |
| canvas_security | 静态投影、隔离、桥接、资源、拖拽、性能 | 设计 iframe 独立实现；运行 iframe 的隔离配置不能直接复制 |
| collaboration_acceptance | 结构并发、schema、离线、持久化、验收 | 文本收敛不等于移动语义正确；恢复范围已由用户确认；关键验证前移 |

汇总稿已由三个子 agent 按各自方向复核，均未发现必须修正项。主 agent 检查本目录相对链接、空白和证据脚本语法，并重新运行两个反例，结果通过风险复现断言。

本轮未读取 `.env`、未启动应用或本机服务、未使用 Docker、未访问网络，也未修改应用代码。执行了安装依赖中的 Yjs 13.6.27 纯内存反例，脚本见 [yjs-risk-probe.mjs](evidence/yjs-risk-probe.mjs)。仓库根运行：

```powershell
node docs/V__3/evidence/yjs-risk-probe.mjs
```

脚本断言当前基础机制的两个风险可以复现；退出码 0 表示反例复现成功，**不是 V3 修复或验收通过**。脚本不调用应用，不需要服务或配置。后续应用验证仍必须读取仓库根 `.env` 并连接本机服务，禁止输出凭据。

## 必须关闭的问题

### TR-01：合法 HTML 中也会发生移动语义冲突

同一初始子树被两客户端分别移动到不同位置，交换更新后得到：

```html
<main><aside>B</aside><section>A</section><footer>C</footer><section>A</section></main>
```

两端 Y.Text 一致，但原本唯一的 section 出现两份。子 agent 另复现：甲移动 `<p>A</p>`，尚未送达的乙在其内部新增文字，合并后新增文字留在原容器、没有跟随 p。两例 HTML 均可合法解析。因此，不能只靠重新解析或文件 hash 判断结构操作成功。

现网关 [Room.accept](../../collaboration/src/room.ts) 约第 43–63 行校验 Update、schema、容量并应用更新；[normalizeConflicts](../../collaboration/src/document.ts) 第 20 行只处理文件路径冲突。它们没有子树语义验证。

建议先验证本地操作收据：记录操作前片段、来源/目标相对锚点、父子上下文、涉及文件和观察到的版本/结构身份；监听后续相关事务，关联来源及目标，而非只检查结果是否合法。必须覆盖双移动、移动/删除、移动期间迟到文字、嵌套父子移动，以及两种更新到达顺序。

该算法尚未证明可以检测要求范围内的冲突。**本地收据只是候选机制，不能承诺发现所有合法但错误的合并。** 若 P0 不能证明 AC-13 的检测与内容可恢复要求，必须重新评审协议和范围后才能进入结构功能实施，不得把静默失败改称正常 CRDT 合并。

只锁设计命令不足以提供强保证：Monaco 和已存在的离线 Update 也修改同一份 Y.Text。强语义方案必须约束涉及文件的全部写入口，并规定旧客户端、离线日志、租约与重连处理；节点模型改造则涉及 schema/缓存/导出的更大变更，本轮不推荐。

### TR-02：撤销新增文件会隐藏远端贡献

纯内存实验证明：甲创建 CSS 文件，乙追加 `REMOTE`，甲合并后撤销创建，正文从 `localREMOTE` 变为文件不存在，fileOrder 同时为空。即使 scope 已包含 files/fileOrder，远端正文仍随父 Y.Map 项被隐藏；schema 可以继续有效。

[MonacoWorkspace.tsx](../../frontend/src/editor/v2/MonacoWorkspace.tsx) 第 52 行仅创建 files scope、跟踪 MonacoBinding；[session.undo](../../frontend/src/collaboration/session.ts) 第 585 行同样硬编码 files scope。两处必须一起改变，不能只更新真实管理器。

首版采用需求已允许的策略：**创建文件存在后续贡献或新增引用时，拒绝整组撤销并解释，保留内容、文件身份和历史栈。** 不自动做部分补偿。依赖检查应在 undo/redo 的 scratch 和 live 行为之前完成；不能只用最终字符串相等证明没有远端贡献，还要保留事务/版本证据。未知引用不能证明安全时保守拒绝。

会话级 HistoryController 统一创建真实和 scratch 管理器，至少使用 files/fileOrder scope 与相同的影响撤销结果的配置；涉及目录/meta 时一起扩展。仅跟踪本地 MonacoBinding 与 VISUAL_ORIGIN，不默认纳入所有 STRUCTURE_ORIGIN。离散命令前后切断 capture，连续属性编辑定义字段/焦点/目标切换边界，代码输入不得意外合组。撤权时销毁历史与依赖元数据，不能继续引用已被替换的旧 doc。

依赖保护仍不能识别尚未收到的远端贡献；这一并发情况必须进入 TR-01 的恢复与门禁测试，不能宣传为撤销永不影响任何未见更新。

### TR-03：双执行 action 的约定需要落成执行接口

[session.mutate](../../frontend/src/collaboration/session.ts) 第 533–550 行先执行 scratch action、校验，再执行 live action。[fileCommands.create](../../frontend/src/collaboration/document.ts) 第 279 行在执行中生成随机 ID，删除命令内部也取时间。已有单文件调用不能直接充当 V3 多文件确定性计划接口。

建议新增受限 `PatchPlan`，含身份/epoch/fileId/代次/requestId、预生成 ID/class/时间、文件创建和引用、全部 expected 片段/关系与无重叠补丁。`applyPlan(doc)` 先解析并校验所有相关对象，全部检查完成后才写入；同文件补丁按偏移倒序，一次外层事务提交所有文件。scratch 使用相同事务结构，执行器同步、无网络或 UI 副作用，不捕获 live Y.Text。

Yjs 事务不提供业务异常回滚；不能在写完 HTML 后再检查 CSS 路径或容量。用失败注入断言正文、文件集合、fileOrder 和历史栈零变化。稳定文件 ID/初始内容能力下沉到文件创建接口，不需要为本轮把所有已有命令重写为通用事务系统。

### TR-04：并发首次创建 CSS 会让文件和引用脱节

双方从无组件 CSS 的状态同时新建同路径文件，各自插入同名 href；网关重命名其中一个文件，但不会改 HTML href。两份 CSS 存在且路径唯一，仍可能出现两个 link 指向同一份 CSS、另一实例失去样式。

首次创建采用预生成随机后缀的独立路径与 fileId，HTML 引用绑定这一已确定路径；重开后依据可识别的受控源码格式复用已有样式，不能只看文件名推断归属。源码注释/生成规则用于重建归属，不新增共享文件字段，也不把临时画布标记写入源码。无法证明归属时选择新路径，不覆盖用户文件。

这属于工程选择，不需要额外产品审批；具体归属协议与路径碰撞拒绝策略在 P0 固定。AC-10/12 增加同时首次拖入、路径归一化、刷新后复用和两个实例样式断言。

### TR-05：设计画布的安全和资源投影不是既有能力

[SandpackBridge.tsx](../../frontend/src/editor/v2/SandpackBridge.tsx) 第 18–25 行的运行边界依赖远程 origin，允许 scripts/same-origin/forms。该配置不能复制到同源 srcdoc 设计页。

建议独立 `srcdoc` 设计 iframe，sandbox 仅允许 scripts，不开放 same-origin/forms/top-navigation；CSP 在用户内容之前生成，按每代 nonce 仅授权工具脚本，资源按策略允许。HTML 解析后生成受控副本，处理 script、事件、危险 URL、srcdoc、meta refresh、base、导航/表单、嵌入以及 SVG/MathML 执行入口。原始 Y.Text 保持原样。投影允许重序列化，补丁禁止反向使用投影序列化结果。

opaque origin 不能用 `null` 认证。握手验证 source 窗口、当前代次和一次性 capability，转为 MessageChannel；代次/项目/epoch/模式变化关闭旧端口。工具闭包中的节点注册表提供身份，不信任用户同名 DOM 属性。画布只报告命中、几何和选择意图，父层生成可信命令；不向画布提供访问令牌、协作票据或任意文件写能力。

[projection.ts](../../frontend/src/editor/v2/projection.ts) 第 5 行是 Sandpack 运行投影，没有静态资源 resolver。新增 resolver 以 HTML 路径解析 link、以每份 CSS 自身路径解析 import/url，使用 CSS tokenizer/AST、循环检测和总量预算。不要让虚拟路径请求宿主 API，不让用户 base 改变解析基准；对象 URL 按代次释放。

项目 CSS 必须正确投影。外部 CSS/字体、跨域加载与离线资源可用性先做 P0 验证并冻结允许策略；不得静默丢失已有 CSS。若最终需要限制产品正常渲染范围，再给用户具体影响和选项。图片沿用 URL/已有地址，不新增 MinIO 公共素材存储。

### TR-06：拖拽和性能必须有真实浏览器证据

推荐父层 Pointer Events capture + 透明拖拽覆盖层，子页执行 elementFromPoint 并回复候选命中。坐标统一 CSS 像素，明确 iframe 边框、显示缩放及父子视口转换；最终 drop 重新核验最新命中和源码。Esc、pointercancel、失焦、重载、超时和权限变化统一取消，零源码写入。

新 worker 的 job 绑定项目/epoch/fileId/解析版本/画布代次，只保留在运行及最新待处理任务，丢弃迟到结果。解析位置使用 UTF-16，容量按 UTF-8；自动补节点、重复属性、容错重排等无法证明区间安全的节点限制编辑，并提供原因及源码定位。

200 KiB HTML 不能限制 CSS 总量、节点密度、图片及布局成本。P0 实测冻结节点数、CSS/import、资源、消息和 worker 时间预算，超出时明确降级；任何改变原验收范围的调整另行决策。1 秒指标从合法操作提交完成测至目标代次画布 ready、布局与选框可操作，包括调度/防抖/worker 等时间；首次外部资源加载单独记录。记录设备、浏览器、次数、p95 与最大值，不能把现有 Sandpack 最长 1 秒触发更新视为渲染完成证据。

## 用户已确认决策

2026-10-12，用户明确选择以下两项推荐方案，作为 V3 实施基线。其余原生组件、URL 图片、200 KiB/1 秒等沿用需求稿建议基线，本次答复不代表逐条批准其他建议。

| 决策 | 已选方案 | 未选方案与影响 | 状态 |
| --- | --- | --- | --- |
| D-01 恢复范围 | 发起者本机持久保留未解决收据，刷新后可恢复；保留现有离线编辑；授权/epoch 变化沿现有规则清理 | 团队跨设备可恢复，需要服务端记录、权限和清理协议；留待后续 | 用户已确认，待实现验证 |
| D-02 并发语义 | 接受检测冲突、暂停相关设计操作和人工恢复；先验证该机制能满足 AC-13 | 自动保证移动归属与唯一性，需要统一约束源码/离线/设计写入，可能调整离线能力 | 用户已确认，待实现验证 |

本机方案的技术要求：扩展 [OfflineLog](../../frontend/src/collaboration/offline.ts) 的有界侧车记录，按 user/project/epoch 隔离，不新增 Y.Doc 根字段。收据必须覆盖操作前文本、上下文和待解决状态；“已持久化”确认不能清除未解决材料。提交前验证恢复容量与写入能力，收据和更新设计崩溃一致的保存顺序；Quota/写失败停止结构写入，不承诺仅存内存也可刷新恢复。收据预算单独明确且不得绕过既有缓存总量规则。清缓存或换设备无法保证恢复，要在产品中说明边界。

D-01/D-02 已确认，TR-01 的证明责任仍不消失。用户接受人工恢复不等于接受无法检测的静默遗漏；未证明安全时停止相关结构功能推进。若验证表明必须调整已确认的离线或恢复范围，再提交具体影响让用户决策。

## 修订后的实施顺序

| 阶段 | 工作 | 放行证据 |
| --- | --- | --- |
| P0 技术门禁 | 并发结构与恢复候选、确定性计划、共享历史、并发 CSS 引用、安全 iframe、真实跨 iframe 拖入及资源/性能预算 | 针对反例有可执行验证；恢复决策明确；未通过项有方案和重审结果 |
| P1 最小闭环 | 按钮插入、映射、选择源码、取消；直接使用正式命令/历史/画布接口 | 局部保真、一次提交、双会话和 durable 持久化闭环 |
| P2 组件与属性 | 完整模板、实例 CSS、文本/属性/样式、多 HTML | CSS 归属及引用协议已固定；多文件原子性和实例隔离 |
| P3 结构功能 | 移动、排序、复制、删除、跨文件历史 UI | 使用已通过 P0 的并发/恢复策略；禁止目标和注释归属验证 |
| P4 完整交付 | 离线/权限/容量/导出/性能/键盘及运行回归 | FR/NFR/AC 全部有证据，不在此阶段首次决定核心架构 |

建议模块：`visual/sourceRegistry` 与 parser worker、`templates`、`planCommands/applyPatchPlan`、`designProjection/resourceResolver`、`designBridge/dragController`、`conflictRecovery`，以及会话级 `collaboration/history`。这是职责划分建议，尚未创建应用模块。

## 验收补充与本轮结果

| fixture/检查 | 关联验收 | 必须新增的断言 | 本轮状态 |
| --- | --- | --- | --- |
| double-move / move-late-text / move-delete | AC-12/13/14 | 两种到达顺序；合法但重复/漏搬被检测；恢复材料可查找；不全量回滚 | 已复现风险；V3 策略待实现验证 |
| undo-remote-css | AC-11 | 同一新文件被乙编辑/新增引用后，整组拒绝且栈不丢；redo 同样保护 | 已复现基础机制风险；保护未实现 |
| css-first-create-race | AC-10/12 | 并发初次创建后，每个实例 href 和样式仍正确，重开复用 | 静态发现；待执行 |
| atomic-budget | AC-10/20 | 缺文件、路径冲突、超限和预检失败均无任何文件/历史变化 | 待执行 |
| recovery-reload-revoke | AC-13/14/21 | 发起者本机刷新保留未解决收据，durable 不清除；离线可恢复；写失败拒绝；撤权/epoch 清理 | 决策已确认，待实现及执行 |
| design-security / bridge-reject | AC-16/18/19 | 真实脚本/导航隔离，错误 source/旧端口/代次/重复或巨大消息零写入 | 待真实 Chrome/Edge 执行 |
| pointer-coordinates / source-fidelity | AC-02/05/15/17/24 | 滚动/缩放/重载取消；UTF-16、实体、CRLF、容错节点不误写 | 待执行 |
| performance-boundary | AC-23 | 提交到 ready 全链路；CSS/节点预算；重复销毁后无资源泄漏 | 待冻结配置并执行 |

受控 Update 队列用于并发单元验证，不依赖计时竞争；浏览器双会话另测真实网关、持久化重开和导出。已有 Vitest/jsdom 与 mock Sandpack 不能代替安全、跨 iframe 指针或 Chrome/Edge 证据。本轮没有运行全量应用回归；变更为评审文档与纯内存证据脚本。

结论：两项用户决策已确认，可以按本机持久恢复与人工冲突处理基线准备 P0 技术验证；完整实施仍以上述门禁证据为前提。需求评审完成、技术评审有条件通过、功能开发完成、验收通过和部署状态分别记录。
