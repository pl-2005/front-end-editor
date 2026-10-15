# V3 简单技术方案

日期：2026-10-14。状态：实现建议，待开发。优先复用现有会话，只增加静态设计需要的代码。

## 接入现有实现

| 当前代码 | 改动方向 |
| --- | --- |
| [ProjectWorkspace.tsx](../../frontend/src/editor/v2/ProjectWorkspace.tsx) | 增加设计模式和三块 UI，沿用当前 session、文件选择和状态提示。 |
| [MonacoWorkspace.tsx](../../frontend/src/editor/v2/MonacoWorkspace.tsx) | 暴露源码选择/定位入口，将 UndoManager 生命周期移到会话/工作区，注册可视化 origin；模式切换不丢历史。 |
| [session.ts](../../frontend/src/collaboration/session.ts) | 复用 mutate 的 scratch 校验、可写状态和预算；历史预检与真实管理器保持相同 scope/origin 配置。 |
| [document.ts](../../frontend/src/collaboration/document.ts) | Bootstrap 准备时提供固定 fileId 创建能力，避免 scratch/live 两次生成不同随机标识。 |
| [offline.ts](../../frontend/src/collaboration/offline.ts) | 增加本机恢复侧车记录，沿用用户/项目/epoch 隔离和撤权清理。 |
| [SandpackBridge.tsx](../../frontend/src/editor/v2/SandpackBridge.tsx) | 继续负责运行预览；设计 iframe 独立，不读取 Sandpack DOM。 |

建议新增 `frontend/src/editor/visual/`，按 UI、source（解析/补丁）、canvas（投影/通信）、templates（模板/资源）组织。恢复存储留在 collaboration 下；不为每个概念创建通用框架。

## 源码映射和补丁

使用带源码位置的 HTML 解析器（建议 parse5），解析结果只存本地。第一版每次正文变化重建注册表，nodeId 只在本次渲染有效，不实现跨版本稳定节点身份。位置统一为 JavaScript/Monaco 的 UTF-16 索引。

命令携带 projectId、epoch、fileId、解析代次及目标 nodeId；父层取最新源码核验。旧版本取消，禁止靠旧偏移猜测。仅有明确起止位置、无浏览器补全歧义的节点可写；head、脚本、特殊结构和隐式节点禁用结构操作。源码临时错误时暂停受影响设计编辑，不能自动修复原文。

组件编辑只改一个 HTML Y.Text。生成一个小补丁列表 `{start, end, expected, replacement}`，预先检查目标、上下文、编码和补丁不重叠，再在一次 `session.mutate` 内倒序应用。action 仅使用传入 doc，无随机数、异步或外部副作用；标识在调用前生成。不能依赖 Yjs 事务回滚异常，所有业务检查必须在第一次写入前完成。

文本/属性按各自上下文编码。style 只增改指定声明，保留其余原文；不解析成功或存在无法消歧的重复声明时拒绝该字段并提示源码编辑。删除仅移除元素起止范围，保留外部注释及兄弟。未知属性和未触及片段逐字保留，不格式化整页。

先用防抖解析和 200 KiB 上限；测量后若仍阻塞再放入 worker，不先建设多层任务系统。普通演示页面编辑提交后以 1 秒内画布更新为验收目标，记录 HTML/CSS 大小和测试设备。

## 设计画布

独立 srcdoc iframe，sandbox 只允许工具脚本执行，禁止 same-origin、表单和顶层导航。CSP 在用户内容之前设置，仅以本代 nonce 授权工具脚本；禁止用户脚本、事件属性、危险 URL、meta refresh、base、嵌入页面和 SVG/MathML 执行入口。采用可靠的白名单清洗生成设计副本，不能仅移除 script。原始源码保持不变。

直接引用的项目 CSS 按 HTML 路径解析并内联到设计副本，使用 CSS 解析工具去掉 `@import` 和不允许的资源 URL，显示受限资源提示。通过安全 DOM/样式接口插入资源，不能直接拼接含 `</style>` 的用户 CSS 到 HTML 字符串。外部 CSS/字体不加载；错误路径提示。对 CSS 总量和重复引用设预算，准备好的 Bootstrap 也计入成本。

工具脚本只报告选择、矩形和投放意图，父层生成补丁。每代握手验证 iframe 窗口和一次性随机 capability，再使用 MessageChannel；opaque origin 的 `null` 不是身份。消息做类型、大小、代次及 nodeId 校验，不提供凭据或任意文件写能力。切换项目/文件/模式、撤权和重载关闭旧通道。

组件拖拽由父层 Pointer Events capture 管理，向子页请求 elementFromPoint 命中；只支持普通流容器及前/后插入。统一 iframe 内外 CSS 像素坐标。Esc、pointercancel、失焦、重载、失权和超时都取消。按钮插入使用同一命令，不另造一套流程。

## 历史和 Bootstrap

代码与可视化共用一个本地 UndoManager，跟踪 MonacoBinding 和 VISUAL_ORIGIN。组件命令前后 stopCapturing，属性在失焦/确认时提交一次。撤销/重做仍调用 session 的预检，工具栏和快捷键共用入口。

Bootstrap 准备是单独的资源安装动作，不进入正文撤销历史。资源 CSS、许可和当前 HTML link 一次预检、一事务提交；普通组件编辑只改已准备 HTML，不新增文件。资源保留在项目里，不自动垃圾回收。具体见[依赖方案](bootstrap-dependency.md)。无需跨文件整组撤销或远端依赖补偿系统。

## 保守协作检查和恢复

不识别复杂移动语义，因为首版不提供移动。对于插入、删除、属性和历史操作，采用文件级保守检查，而不是宣称能精确识别所有冲突。

第一次设计修改前持久保存原 HTML；每次修改前先保存本次 before/after 文本，带 prepared/committed 状态，落盘期间阻止同文件新的本地写入，落盘后再次核验版本。删除、属性替换及撤销/重做等可能移除内容的操作，必须保留本次操作前正文或移除片段，不能用下一次意图覆盖尚未显式清理的材料。历史操作复用已有 scratch 预检得到候选结果，落盘并复核后才执行 live 历史操作。若期间收到远端变化取消命令，保留材料供检查。崩溃留下 prepared 记录时重开提示，不假定操作已经提交。

每个文件保留基线、最近本地意图、最新合并文本及未清理的破坏性操作前内容；即使元素在本地插入后又删除，也能找回被删内容。累计记录暂定 5 MiB 上限，计入本机缓存总预算，不挤占或绕过原离线门禁；写失败或预算不足停止相关设计/历史写入，不自动淘汰未清理内容。源码手写更新也要使本地检查状态失效。

存在未解决设计记录时，任何远端事务涉及该文件（含删除、重命名、撤销及迟到文字），均标记“需要检查”，不要求证明存在语义错误。重新连接先恢复记录，再接收和核对远端内容；暂停该文件设计及其历史写入，代码编辑仍遵守既有会话门禁。提示展示基线、本地意图和合并结果，用户复制材料并人工局部修复，再点击确认。

确认后也不因 durable 自动删除材料：在本机预算内保留检查基线，后续迟到远端更新仍触发重新检查；只有用户显式清理或撤权/epoch 变化才清除。主动清理时说明后续不能追溯此前设计操作。切换模式不清除记录，不向 Y.Doc 增加恢复字段。不自动应用整页快照，不提供跨设备恢复。

该策略宁可多提示，也不以“HTML 合法/Yjs 收敛”当作操作语义正确的证明。双客户端删除与迟到文字、并发同属性及离线合并必须实际验证。
