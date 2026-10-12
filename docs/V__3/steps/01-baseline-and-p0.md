# 步骤 01：基线核对与 P0 技术门禁

日期：2026-10-12。状态：待实施；文档审查见[审查记录](../development-review.md)。阶段：P0。前置：[开发总计划](../development-plan.md)及全部 V3 基线文档。

## 目标与输入

在正式 P1 开发前证明核心机制可用，并冻结后续接口与资源预算。输入为 FR-01～18、NFR-01～08、AC-01～25，以及技术评审 TR-01～06、D-01/D-02 和 Bootstrap 方案。原型通过不能标记功能完成。

核对 `ProjectWorkspace.tsx`、`MonacoWorkspace.tsx`、`session.ts`、前后端 `document.ts`、`offline.ts`、`projection.ts`、`SandpackBridge.tsx`、网关 `room.ts` 和 document-rules。登记当前提交与工作树，保留已有修改；核对真实 mutate/undo、origin、文件创建、缓存清理和 Cookie 会话恢复，避免照抄旧认证说明。

## 实施任务

1. 建立可复现 fixture：单/多 HTML、嵌套 Flex/Grid、混合文本、emoji/实体/CRLF、重复属性/id、隐式 tbody、相邻注释、执行入口和接近容量边界。明确原始源码、操作意图、到达顺序及预期断言。
2. TR-03 原型：受限 PatchPlan 预生成 ID/class/时间/路径，在传入 doc 上解析全部目标后应用。证明 scratch/live 同内容与身份；缺文件、路径冲突、权限/容量失败时 HTML、CSS、文件集合、fileOrder、directories/meta、历史栈均零变化。禁止用事务自动回滚假设替代预检。
3. TR-02 原型：同配置 HistoryController，scope 至少 files/fileOrder，必要时 directories/meta；本地代码与画布按顺序分组。甲建 CSS/vendor/许可，乙编辑或引用后甲 undo/redo 整组拒绝且栈保留。纳入尚未收到远端贡献的撤销场景，不能仅检查最终正文相等。
4. TR-01 原型：复现 double-move、move-delete、move-late-text、嵌套父子移动和同属性修改；每类控制两种更新到达顺序。候选收据记录操作前片段、来源/目标锚点、上下文和观测版本，验证合法 HTML 的重复/漏搬也能被检测、相关设计范围暂停、被修改文本可查找并人工恢复、不全量回滚。普通手写更新必须参与检测，不能只观察视觉 origin。
5. 证明 D-01 存储契约：OfflineLog 有界侧车按 user/project/epoch 隔离，操作前材料先持久成功再结构写入，准备/提交/中断状态可区分。模拟准备后崩溃、live 提交后本地 update 落盘前崩溃、durable 后刷新、断网重开、Quota/写失败、撤权与 epoch 切换。未解决材料保留；授权失效按既有规则清理。记录单收据、累计收据及缓存总预算，不能扩大既有总量上限。
6. TR-04 与 Bootstrap 原型：固定 5.3.8 CSS/许可来源、精确依赖与 hash 方案；实例 CSS 和 vendor 均采用预生成唯一后缀路径。并发首次引入的两份资源及各自 href 正确，重开可验证归属后复用，同名用户文件不覆盖，逻辑删除文件仍计入 100 文件。缺安全 head、任何资源缺失/容量超限完整拒绝；首次 Reboot 影响提示可见。
7. TR-05 原型：独立 srcdoc iframe，受限 sandbox/CSP、nonce 工具脚本、受控资源 resolver、窗口/capability 握手和每代 MessageChannel。真实浏览器验证 script、事件、SVG/MathML、危险 URL、base/meta refresh、导航/表单/嵌入、伪标记和旧端口均不能绕过；原源码保持不变。冻结外部 CSS/字体/图片的允许策略与离线可用性说明，项目 CSS 不得静默丢失。
8. TR-06 原型：真实 Chrome/Edge 跨 iframe 指针、父子滚动、边框与缩放转换，取消/重载零写入。验证 parse5 新依赖的浏览器 worker 构建、UTF-16 源码位置和容错边界。测量 200 KiB HTML、密集节点、Bootstrap CSS/import/资源的成本，冻结节点/资源/消息/worker 有界预算；提交完成至目标代次 ready、布局及选框可操作的 1 秒指标包含调度与解析，记录次数、p95、最大值和首次外部加载。

原型采用后续 02～05 的职责边界；能晋升则复用，必须替换时记录原因并重跑对应证明。本步可以新增小范围验证代码，但正式产品功能仍受 P0 放行约束。

## 交付物与退出检查

- P0 门禁台账逐项包含风险、fixture、命令、源码/状态断言、结果、设备/版本、证据路径、失败处理及复核结论；不能仅写“已验证”。已有 `evidence/yjs-risk-probe.mjs` 只证明原机制风险，不是修复证据。
- 冻结 SourceRegistry、PatchPlan、HistoryController、RecoveryStore、DesignBridge 的输入输出与失效规则；记录 Bootstrap 归属/引用和资源预算决策，交给 02～05。RecoveryStore 交接明确收据/检测保留窗口、成功材料的安全清理判据与 unresolved 的显式处理规则；durable 不能单独作为晚到更新安全水位或清理依据。
- 冲突必须能覆盖规定反例且保留恢复文本。收据法不能通过时，停止相关产品实施，提出统一覆盖 Monaco/离线/旧客户端的协议替代并重新评审；不以“人工恢复已接受”免除检测要求。
- 每类 P0 门禁都有通过证据，或已执行必要范围/协议决策并同步全部相关文档，才进入[步骤 02](02-source-parser-and-registry.md)。没有“带未通过 P0 继续 P1”的默认放行。

## 验证约束与覆盖

覆盖 TR-01～06、D-01/D-02、FR-09/12/14/15/18、NFR-02～08，前置验证 AC-02/05/10～20/23/25 的关键反例，其余完整功能留给对应步骤。算法测试使用受控 Update 队列，不靠随机延迟碰运气；浏览器安全/指针及真实双会话持久化另留实际证据。

运行应用时使用根 `.env` 和本机 MySQL/MinIO/Redis；不使用 Docker，不输出凭据。本步的安全与性能实测必须有真实浏览器，mock/jsdom 结果不能代替。P0 未执行期间，台账结果均为待执行。
