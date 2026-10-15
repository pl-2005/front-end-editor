# 步骤 1：源码映射、安全画布与选择

状态：已实施（2026-10-14）。自动检查及 Chrome 只读基础场景通过，详见[实施证据](../evidence/step01.md)。对应 R1/R3/R6，先覆盖 A2/A3/A9 的只读场景。前置：[总计划](../development-plan.md)和当前 V2 工作区。

## 目标与改动位置

本步交付独立静态 iframe，能够显示普通 HTML、选择元素并定位当前源码；暂不开放插入、属性、删除。先建立可信的源码范围和通信边界。

| 位置 | 本步任务 |
| --- | --- |
| `frontend/src/editor/v2/ProjectWorkspace.tsx` | 设计/运行模式、当前设计 HTML、只读提示，保留 session/文件树/成员/持久化状态 |
| `frontend/src/editor/v2/WorkspacePanels.tsx` | 容纳设计画布，保持源码区可收起 |
| `frontend/src/editor/v2/MonacoWorkspace.tsx` | 提供当前 fileId 的定位入口，以 model.getPositionAt 将 UTF-16 范围转换为行列 |
| `frontend/src/editor/visual/source/`（新增） | 解析、代次注册表、节点可编辑能力及只读原因 |
| `frontend/src/editor/visual/canvas/`（新增） | 清洗投影、直接 CSS、srcdoc 生命周期、握手与选择通信 |
| `frontend/package.json` 与 lockfile | 位置解析、白名单清洗和 CSS 解析所需依赖 |

## 开发顺序

### 1.1 记录基线，增加模式入口

1. 在 frontend 执行已有 test/lint/build，记录实际结果；若当前失败，先区分既有问题和本步变更，不虚构通过。
2. ConnectedWorkspace 持有 `mode` 和设计文件选择。可选用当前 activeId 作为设计文件，但文件树选择与 `meta.entryFileId` 必须分开。
3. 非 HTML、超 200 KiB、文档未初始化或授权失效时，不创建可编辑设计页面；解释原因，保留已有代码/运行入口。
4. 切换设计/运行不重建 CollaborationSession；普通模式切换不销毁 Monaco 模型和历史，后续步骤 2 再统一历史归属。

### 1.2 建立带位置的解析和本代注册表

1. 使用支持 sourceCodeLocation 的解析器，建议 parse5；记录文本、元素、开始标签、结束标签及属性的原文范围，不以 DOM outerHTML 作为源码。
2. 为每次解析生成新代次和 nodeId。本代映射包含 fileId、路径/源码版本、元素范围、父子关系、允许的操作、只读原因。
3. 字节预算按 UTF-8；位置按 UTF-16。中文、emoji、实体和 CRLF 必须对应 Monaco 的正确范围。
4. 缺位置、隐式补全、解析重排或无法唯一映射的节点设为只读；重复 id/class 不作为身份。head、脚本、列表、表格、SVG/MathML 等特殊结构不接受首版结构操作。
5. 区分“整个页面不可安全编辑”和“单节点只读”。临时语法错误只暂停相关能力，不通过序列化修复用户正文。
6. 防抖重建注册表。收到源码变化时立即失效旧选择/旧命令，不能在新解析完成前继续使用旧偏移；本步无需稳定跨代节点身份。

### 1.3 构建设计副本和 CSS 投影

1. 原文仅用于解析和生成本地副本，不写回 Y.Text。用户标签/属性通过可靠白名单清洗，显式处理事件属性、危险 URL、meta refresh、base、嵌入页面、表单行为及 SVG/MathML。
2. 工具脚本由应用生成，每代单独 nonce；CSP 在用户内容之前设置，脚本仅授权该 nonce。iframe 使用只含 allow-scripts 的 sandbox，禁止 allow-same-origin、表单和顶层导航，并设置无 referrer 泄漏策略。
3. 副本内节点使用工具标记映射本代 nodeId；标记只存在投影，处理用户同名属性碰撞，不能进入正文或导出。
4. 按当前 HTML 的虚拟路径解析项目内直接 stylesheet link，校验目标存在、语言和路径，按原引用顺序加载。禁止把项目绝对虚拟路径当作宿主服务器路径。
5. 使用 CSS 解析器处理 `@import`、外部字体和不允许的资源 URL；明确显示未支持或缺失资源，不偷偷请求外部 CSS。过滤内联 style 和 style 标签中的资源能力同样受限。
6. 通过安全 DOM/样式接口装入 CSS，严禁将未经处理的用户 CSS 拼入 `<style>...</style>` 字符串。以含 `</style><script>` 的样例核验无逃逸。
7. 图片只允许明确支持的安全 URL/已有地址，禁止 javascript 等危险协议；链接点击、表单操作不得导航或提交。设定 CSS 总量/重复引用预算并提示，不静默截断成错误样式。

### 1.4 建立一次性握手及选择通信

1. 父层保存 iframe.contentWindow、本代随机 capability 与代次；校验这些信息后才将 MessageChannel 转移给子页。opaque origin 的 `null` 不作为认证依据。
2. 选择消息只传 nodeId、矩形及必要的选择信息。校验类型、字段、大小、数值有限性、当前 fileId/代次和 nodeId 存在；未知命令拒绝。
3. 父层负责选择状态及选中框。矩形坐标约定 iframe 内 CSS 像素，父层根据 iframe 边界转换；滚动、缩放、窗口变化后刷新，禁止混用 devicePixelRatio。
4. 选择源码调用 Monaco 定位接口；源码区已收起时提供打开并定位动作，仍重新验证文件和代次。
5. 文件/项目/模式切换、iframe reload、授权失效关闭旧端口和监听，清选择。旧握手、重复握手及旧消息不能重新激活本代。

## 验证与失败处理

| 场景 | 必须断言 |
| --- | --- |
| 普通、嵌套、多 HTML | 切换只影响设计文件；运行入口未改变；选择对应当前源码 |
| 中文/emoji/CRLF/实体/重复标签 | 映射范围与原文一致，投影不改变一个源码字符 |
| 隐式节点、错标签、特殊结构 | 能解释只读原因；不猜测偏移、不自动格式化 |
| 原文变化后旧选择/旧消息 | 立即失效，重新选择后恢复定位 |
| 项目 CSS、相对路径、缺资源、@import | 支持部分显示正确；受限部分有提示 |
| 用户脚本、事件、危险 URL、CSS 逃逸、表单 | 真实浏览器中无用户脚本执行、无提交/父页导航；原文保留 |
| 错 source/capability/代次、超大消息 | 拒绝且无选择/正文变化 |
| 反复切换与授权失效 | 旧通道关闭，无重复监听、无旧选择 |

纯解析/投影/协议校验用 Vitest 验证，工作区入口与定位用现有 React 测试方式验证；sandbox、CSP、导航和 MessageChannel 必须在真实浏览器验证。新增脚本后才登记真实命令。

失败时只暂停设计页面或对应能力；显示原因，不改用户源码，不影响原有会话保存状态。解析/资源/桥接异常不能退回到允许同源或运行用户 JS 的 iframe。

## 完成条件

- 普通页面能展示、选择、选择父级并定位当前 HTML；原文与入口未被改变。
- 旧代次、异常节点和危险内容按上述规则拒绝；真实浏览器安全基础场景有证据。
- 相关测试通过，既有文件树/Monaco/Sandpack 无新增回归。
- 本步仍为只读设计；接下来进入[步骤 2](02-button-history-and-recovery.md)。
