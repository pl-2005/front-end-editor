# 元素选择方案评审与 V3 优化

日期：2026-10-26。范围：三个子 agent 分别审查源码映射、运行桥与文档/验收一致性，主 agent 汇总并核对关联对话。本次只修改方案文档，不实现功能、不新增验收通过记录。

关联对话：[查找浏览器元素选中功能实现](thread://01a17710-0bd9-7971-99ee-647a08f03710?hostId=local)。当前环境未提供 `read_thread`，实际读取该 threadId 对应的本地会话 JSONL 中用户/助手消息；不是通过标题推断内容，也不代表已获取之后新增的实时消息。

## 结论与方案取舍

继续使用现有 `Y.Text → 本代源码注册表 → 运行 DOM 临时映射 → 本地选择状态 → 父层覆盖框`。写入方向为 `显式命令 → 最新源码校验/恢复保护 → Y.Text 局部补丁 → Sandpack 更新`。关联对话的选择层和覆盖层思路适合 V3，但其中组件 JSON 模型、稳定 ID 和自动选最近标记祖先的示例不能原样套用。

| 对话中的建议 | V3 的判断与采用方式 |
| --- | --- |
| 页面内命中测试、自建选取层 | 保留。当前桥已使用浏览器事件的 `event.target`；后续跨 iframe 拖拽用子页 `elementFromPoint`，无须为普通点击另造命中算法。 |
| 独立覆盖层、hover/selection 分离 | 已实现主链路。继续补运行时布局更新、失效及模式消息顺序测试。 |
| 稳定 `data-editor-id` | 改为 `(fileId, generation, nodeId)` 的本代临时身份；文件身份沿用现有 fileId。工具标记不能进入 Y.Text，不增加持久组件 ID 或跨代重放旧命令。 |
| `composedPath()` 取最近标记祖先 | 不自动采用。动态子节点保持自身只读；只有用户显式选择父级才改变目标。Shadow DOM 内部继续不在首版范围。 |
| 修改模型再渲染 | 采用原则，模型是现有 Y.Text。不能由 DOM 序列化整页覆盖，不能另建页面 JSON 作为第二权威。 |
| 引入 html-element-picker | 暂不引入。它提供页面元素悬停高亮/选取，V3 已有相应链路；接入后仍需自有源码映射、iframe 协议和失效保护。[项目说明](https://github.com/AlienKevin/html-element-picker)。 |
| 引入 @medv/finder | 暂不引入。它生成当前页面的 CSS selector；selector 可作诊断线索，不能证明源码区间、代次或写权限。[项目说明](https://github.com/antonmedv/finder)。 |
| 扩展/CDP 原生检查 | 不作为产品依赖。Chrome debugger 需要扩展权限和调试连接；可用于本机验收，不接入普通网页主线。[Chrome 官方接口](https://developer.chrome.com/docs/extensions/reference/api/debugger)。 |
| GrapesJS | 不作为本版替换方案。它是完整搭建框架；本项目若迁移，需另外验证其组件模型与源码保真、Yjs 历史和恢复的兼容性，不能当作选择器替换。[官方介绍](https://grapesjs.com/docs/)。 |

以上开源/API 能力于本日核对一手说明；是否采用是结合本仓库约束的工程判断，不是这些项目缺少能力的结论。

## 当前实现证据与优先问题

以下是本次评审时的历史发现。随后 Step 01 的投影、来源状态、CSP、几何、模式顺序及消息热路径已实施并验证，见[运行检查加固证据](evidence/step01-runtime-hardening.md)；字段/结构写权限与恢复保护仍在步骤 2C/3 实施，不把下表中的写入条件视为已完成。

| 优先级 | 代码证据 / 问题 | 处理及退出条件 |
| --- | --- | --- |
| P1 | `canvas/runtimeProjection.ts` 在开始标签末尾 `/>` 的斜线前插入 marker。`<img src=/assets/x/>` 的原属性值包含末尾 `/`；插入后会变为 `/assets/x`。 | 修正投影插入位置/分词处理，验证无引号属性、void、自闭合写法和 `>` 的语义不变；原 Y.Text 未变不能单独证明运行页保真。 |
| P1 | `runtimeProjection.ts` 在 DOMContentLoaded 才收集 marker。静态推导：此前脚本 replaceWith(cloneNode(true)) 可让克隆继承唯一 marker（待浏览器复现）；去重不足以证明原生节点身份。 | 将 marker 映射视为候选来源关联。认领前的克隆/替换和身份歧义不能获得写权限；若无法可靠证明，保留检查/候选定位并禁用相关可视化写入，明确原因，不承诺对任意用户 JS 的可信识别。 |
| P1 | WeakMap 命中后 JS 仍可修改文本、属性或父级；源码版本相同并不意味着可见对象仍对应原结构。 | 来源关联、运行时偏离、按操作的写能力分开。编辑字段与静态值不符、结构关系变化或证明不足时禁用相应写入；父层源码校验始终必须执行，DOM 报告只可降低能力。具体门槛见实施约定第 0 节。 |
| P1 | 工具脚本优先插入 head 开头，可能先于用户 meta CSP；运行桥与用户脚本处于同一执行环境。 | 区分 HTTP CSP 与 meta CSP。不得通过调整脚本顺序、放宽策略或自动加授权绕过用户限制；无法合规注入时只禁用检查。capability 不代表同页用户脚本不可伪造或可信写入授权。 |
| P2 | `runtimeProjection.ts` 只观察根 ResizeObserver、DOM 变更、滚动/resize；纯 CSS transform/动画可能移动目标却不触发上述事件。 | 检查激活且有目标时按帧采样至多 hover/selection 两目标，几何不变不发消息；停用/失效停止。补动画、字体/图片加载、目标删除和静止页面消息量验证。 |
| P2 | `RuntimeInspector.tsx` 和 runtimeBridge 的 mode/mode-ready 没有开关序号。 | 补会话内单调 mode revision 并忽略旧回执；快速设计→运行→设计及排队消息只服从最后一次状态。此处是加固建议，尚非已复现回归。 |
| P2 | 当前检查父级走 DOM parentElement，而旧步骤按源码注册表父级；文件树 activeId 与运行页 fileId 也可能不同。 | 显示实际检查文件；DOM 父级用于检查，源码父级用于补丁关系。代码 B/运行 A 时操作明确归属 A，导航后旧 A 意图作废。 |

代码路径相对 `frontend/src/editor/visual/`，对应[运行投影](../../frontend/src/editor/visual/canvas/runtimeProjection.ts)与[检查器](../../frontend/src/editor/visual/canvas/RuntimeInspector.tsx)。以上包含静态审查发现和最小解析复现，不等于完整应用验收失败记录；待修复项不能写成已解决。

## 实施顺序与范围

1. 步骤 1 增量：先完成投影保真、来源关联边界、CSP/模式顺序、布局框刷新和运行页导航检查。既有步骤 1 验证保持历史事实，新增边界均待验证。
2. 保留步骤 2A 历史 → 2B 同库预算/恢复 → 2C Bootstrap/按钮 → 2D 协作的顺序。不得通过删恢复或容量保护换取更快开放写入。读检查退出条件通过前不开放可视化写入，独立的历史/存储工作可并行推进。
3. 步骤 3 继续七模板、属性和拖拽。先按钮闭环，再扩展命中/落点；首次拖动不引入自由坐标、组件整体自动选择或 DOM 回写。
4. 后续将源码定位类型移出旧 `DesignCanvas` 到中立 source/types 模块；旧静态画布冻结，不要求两条渲染路径同时扩展。删除旧实现另行检查调用关系。
5. 将只读浏览器验收的脱敏脚本纳入受版本管理的 `scripts/` 或 `collaboration/scripts/`，输出继续放 ignored 证据目录。当前 `.codex-build/verify-runtime-inspector.mjs` 仍是本机历史入口，不是可检出的 V3 完整验收命令。

需求、技术方案、实施约定及步骤正文同步采用当前运行检查边界；历史静态画布事实仍保存在 evidence。验收增补沿用 A1–A10，不新增另一套“完成”标准。

## 本次文档校验

本次用 frontend 已安装的 parse5 对上述斜线插点做最小解析复现，结果为 `originalSrc=/assets/x/`、`projectedSrc=/assets/x`、`semanticChange=true`；这是确定的投影语义反例，不是完整浏览器回归。克隆、CSP、动画及模式竞态仅完成静态评审，仍待实际验证。

本次只改文档，未启动应用、未改运行代码或服务配置，未执行前端完整 test/lint/build；未读取根 .env 的值。对文档执行 diff 空白检查和本地相对链接存在性检查。应用验证继续按本机服务约定执行，不使用 Docker。
