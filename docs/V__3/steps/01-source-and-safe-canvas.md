# 步骤 1：源码映射、运行页检查与选择

状态：Step 01 只读运行检查及本轮增量已完成。新增实现、自动回归与真实 Chrome 结果见[运行检查加固证据](../evidence/step01-runtime-hardening.md)。静态基础版见[历史证据](../evidence/step01.md)，悬停增量见[增量证据](../evidence/step01-hover.md)，现行行为见[运行检查约定](../runtime-inspection.md)。对应 R1/R3/R6、A1/A2/A3/A9/A10 只读子场景；步骤 2–5 和写入门槛仍待实施。

## 目标与改动位置

设计/运行共用当前 Sandpack iframe，切换只开关检查，保留页面尺寸、脚本、输入和滚动状态。检查动态 DOM，但只为可确认的静态来源提供定位；本步不开放插入、属性或删除。旧独立静态副本与清洗要求不再作为现行开发任务。

| 位置 | 任务 |
| --- | --- |
| ProjectWorkspace / SandpackBridge | 保持单一运行 iframe、session 和运行入口；代码活动文件与实际检查文件分开 |
| MonacoWorkspace | UTF-16 源码定位、无焦点 hover decoration、显式打开源码入口 |
| visual/source/registry.ts | 位置解析、本代映射、能力/只读原因，禁止跨代旧偏移 |
| visual/canvas/runtimeProjection.ts | 预览副本临时标记、工具桥、命中与几何更新，不回写正文 |
| visual/canvas/RuntimeInspector.tsx | 握手/消息校验、父层覆盖框、hover/selection、本地状态失效 |

## 本轮增量任务清单

下表四项已实施并补充对应自动回归及真实 Chrome 检查，结果见本轮证据；复验按这些任务及原有悬停/锁定回归执行。

| 执行顺序 | 改动文件（相对 frontend/src/editor/visual） | 必须完成的工作 | 对应验证 |
| --- | --- | --- | --- |
| 1 | canvas/runtimeProjection.ts、runtimeProjection.test.ts | 根据解析位置安全插 marker，修复无引号属性 `/` 反例 | 比较投影前后标签/属性语义、正文不变；A2/A9 |
| 2 | source/registry.ts、canvas/runtimeProjection.ts、RuntimeInspector.tsx 及测试 | 来源关联与歧义明确分开，不以 marker 唯一性或 WeakMap 单独授权 | 初始化前克隆/替换/重建、重复标记、动态节点；A2/A9 |
| 3 | canvas/runtimeProjection.ts、RuntimeInspector.tsx 及测试 | 注入尊重 CSP，mode revision 贯穿开关/回执/检查状态，导航和源码变化失效 | HTTP/meta CSP、快速切换、排队消息、运行 A/代码 B；A3/A9/A10 |
| 4 | canvas/runtimeProjection.ts、RuntimeInspector.tsx 及测试 | 有目标且激活时采样两目标几何，去重；失效停止，记录消息处理成本 | CSS 动画、延迟图片/字体、目标删除、静止去重和停用；A10 |

在 frontend 执行现有相关检查：`npm test -- src/editor/visual src/editor/v2/SandpackBridge.test.tsx`；功能代码修改后补 lint/build。真实浏览器验证使用根 .env 与本机服务，记录实际命令，不用旧证据代替新增用例。结构/字段写权限在步骤 2C/3 接入，此处先提供来源状态和只读原因。

## 开发顺序与增量退出检查

### 1.1 保持运行页与文件身份

1. 模式切换不更改 provider key、预览文件、运行入口或 iframe；不重建 session/历史。源码编辑引发的 Sandpack 正常更新不属于“切换不刷新”保证。
2. 分别记录代码 activeId、项目 entryFileId 和当前有效桥接 fileId。文件树选择不跳运行页；检查其他 HTML 先在运行页导航。
3. 超 200 KiB、CSP 阻桥、未就绪或不支持页面时只禁用检查，继续代码/运行；不放宽隔离或自动换页面。
4. 当前与后续写入目标以有效运行页 fileId 为准；无有效目标不猜测。代码显示 B、运行 A 的场景必须覆盖。

### 1.2 源码解析与来源关联

1. 使用 parse5 的 sourceCodeLocation，记录原文/标签/属性范围、父子关系和只读原因。偏移按 UTF-16，200 KiB 按 UTF-8；覆盖中文、emoji、实体、CRLF 和重复 id/class。
2. 每次源码解析生成本代 nodeId；不新增持久组件 ID、页面 JSON 或包装节点。缺位置、隐式补全、重排及歧义节点不获得写能力。
3. 投影仅在副本加标记，必须保留原有标签/属性解析语义。先修复无引号属性末尾 `/` 的已知插点反例，再核对 void/自闭合写法；Y.Text 不变不是运行保真全部证明。
4. DOMContentLoaded 前 clone/replace/innerHTML 重建可能继承标记；认领必须处理歧义。初始化后 WeakMap 也只提供来源关联，不证明字段或结构未被 JS 改动。详见实施约定第 0 节及选择方案评审。
5. 用户 JS 与桥同环境，来源关联不构成抗恶意脚本认证。无法确认时只检查并说明原因；不自动取最近映射祖先，不按 DOM outerHTML 回写。

### 1.3 投影、CSP 与工具生命周期

1. 首次预览注入工具桥，按 fileId/路径/源码缓存；模式切换不重投影。标记转入 WeakMap 后移除，脚本执行后移除自身；正文、导出和持久化项目均无工具材料。
2. 保留原运行页 CSS、外部资源和用户脚本。检查不是冻结应用，也不承诺工具对所有用户 JS 不可观察；脚本可在初始化期间看到临时标记。
3. 保留 Sandpack 远端隔离、sandbox、父页导航限制和 no-referrer。HTTP CSP 由浏览器执行；含原 meta CSP 的页面保守不投影检查工具，即使策略允许脚本也不绕过此限制。不能靠工具放 meta 前或自动加授权规避；检查不可用时保留正常运行。
4. 旧 DesignCanvas/projection/css 冻结为历史实现。后续共享源码定位类型迁往中立模块，不要求两条渲染路径同步开发；删除旧实现需另核对引用。

### 1.4 握手与状态失效

1. 校验 iframe.contentWindow、capability、fileId 和代次后转移 MessageChannel；校验类型、字段、长度、有限矩形和已注册 nodeId。capability 仅隔离连接，不授权源码写入。
2. 模式开关保留有效通道，立即清 hover/selection/源码装饰；mode revision 和回执校验拒绝旧检查状态。快速设计→运行→设计后只能服从最终开关。后续写入步骤沿用此 revision 使未提交草稿、落点和命令失效，已提交结果保留。
3. 源码代次变化立即拒绝旧消息/草稿/命令并停旧桥，等待正常运行更新。真实导航、项目切换、重载、撤权/epoch 变化关闭旧通道，取消 capture、排队帧和异步回调；不能由旧消息恢复状态。
4. 消息处理按帧消费最新命中；避免高频消息每次遍历全项目/读取整页，提交源码操作时仍作完整核验。实际优化须有采样数据，不能降低失效校验。

### 1.5 悬停、锁定、父级和几何

1. 普通点击/悬停取实际命中元素本身；事件 target 已复用浏览器命中。跨 iframe 拖拽后续才用子页 elementFromPoint；不为点击强制引入 picker/finder。
2. hover 与 selection 分别保存，悬停 B 不改变锁定 A；父层覆盖层不占页面空间、不拦截命中。显式父级按钮查看实际 DOM 父级；后续源码写入关系由静态解析验证。
3. pointermove 按 rAF 合并，几何不变不重复发送。滚动/缩放/布局更新外，还须检查激活且有目标时按帧采样至多两个目标，以覆盖纯 CSS 动画、字体/图片加载；失效/停用时停止，不全树轮询。
4. 源码展开时用 decoration 高亮并在需要时滚动，不 focus/setSelection，不改插入点/历史/协作光标；收起时 hover 不展开。点击定位及显式“打开源码并定位”保留。
5. 移出、Esc/失焦清临时 hover，保留锁定；目标删除清对应框。代次/模式等失效同时清检查与装饰。无 hover 设备保留点击/按钮入口；运行模式不拦截检查操作。
6. 普通检查拦截对应点击/按压/提交；切回运行恢复。不得声称暂停脚本、计时器、所有键盘交互或程序化导航。步骤 3 拖拽期间暂停普通 hover，取消后恢复。

## 验证与完成条件

沿用 A1–A10；新增子场景见[验收表](../acceptance.md)的 2026-10-26 增补。解析/投影/协议用现有 Vitest，工作区定位用 React 测试；同 iframe 状态、CSP、运行导航、真实布局和事件边界必须在浏览器验证。使用根 `.env` 和本机服务，不使用 Docker，不记录凭据。

本次新增只读退出检查已通过：投影解析语义不变、初始化前克隆/替换只提供候选来源、歧义不提供确定定位、代码 B/运行 A 不混用文件、CSP 不绕过、模式竞态不恢复旧状态、CSS 动画及延迟资源后框更新、停用停止采样。本步没有开放任何字段或结构写入，所有候选均保持只读；差异展示和按操作授权由步骤 2C/3 接入。下一步为 2A/2B，只有历史、恢复预算和写入复核的全部前置条件通过后才开放 2C。
