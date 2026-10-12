# 步骤 05：隔离设计画布、资源投影与通信

日期：2026-10-12。状态：待实施；文档审查见[审查记录](../development-review.md)。阶段：P1 基础。前置：[04](04-shared-history-and-recovery.md) 的门禁/历史/恢复接口，01 的真实浏览器隔离与坐标验证。

## 目标与接入

建立独立静态设计 iframe，消费 02 的可信节点与 03 的项目文件。运行保留 `SandpackBridge.tsx` 和 `projection.ts`；不复制其允许 same-origin/forms 的 sandbox，也不直接读取 Sandpack 跨 origin DOM。建议职责为 designProjection、resourceResolver、designBridge、dragController。

## 实施任务

1. 从最新权威源码构建受控投影副本，可以序列化副本但不能把结果作为回写源码。剥离/禁用 script、事件属性、危险 URL、SVG/MathML 执行入口、srcdoc、base、meta refresh、表单导航及 iframe/object/embed。原文件中的内容、用户属性和未知代码保持原样，设计限制在面板说明。
2. srcdoc 采用 P0 已验证策略：sandbox 仅授权工具所需 scripts，不开放 same-origin/forms/top-navigation；CSP 位于用户内容前，工具脚本每代 nonce，用户 JS 与 Bootstrap 插件不得执行。不向画布传认证令牌、Cookie、协作票据或 MinIO 信息；不因 vendor 内容可信就给予额外执行权限。
3. 节点注册表在工具闭包/受控对象内关联实际 DOM 与 02 的映射；用户同名属性/id 不构成身份。临时标记仅在投影副本中，避免命名冲突；动态/替换/无源码节点不可编辑，设计脚本不制造伪源码身份。
4. resolver 以 HTML 所在路径解析 stylesheet link，以每份 CSS 自身路径解析 @import/url；使用 CSS tokenizer/AST，处理引号、转义、查询/片段、嵌套 import、循环和总量预算，不用简单正则替代解析。项目路径读取经过文件集合校验，缺文件/改名提示，不让虚拟路径或用户 base 请求宿主 API。
5. Bootstrap、实例 CSS 和用户项目 CSS 同样从项目权威文件投影；不隐式给当前 HTML 注入未提交的 Bootstrap。图片/外部 CSS/字体遵循 01 冻结的地址、跨域与资源允许策略，不能默默忽略用户 CSS；失败与离线不可用明确提示。对象 URL、资源缓存和 resolver 任务绑定 generation，替换/销毁即释放。
6. 桥接协议有 protocolVersion/channel、项目/epoch/设计 fileId 绑定、canvasGeneration、requestId、消息枚举及有界 payload。精确 origin 场景校验 origin 与 source；opaque-origin 不信 `null`，校验预期窗口、当前代次和不可复用一次性 capability 后转 MessageChannel。消息按类型校验、限流/去重/超时；关闭旧端口不接受旧握手重建。
7. 画布只报告 ready、选择、几何、命中和插入意图，父层根据可信模板/最新源码生成计划。不能接收任意文件路径、源码补丁或可执行代码。ready 要包括目标代次布局和选框可操作，不把脚本刚加载视为渲染完成。
8. 父层 Pointer Events capture 和透明覆盖层控制跨 iframe 拖动；画布用 elementFromPoint 回候选节点。协议统一 CSS 像素，明确父/子视口、iframe 边框、显示缩放和滚动转换；最终 drop 重新命中和语义校验。拖动期间只更新派生几何，不修改正文；边缘滚动有边界和节流。
9. Esc、pointercancel、失焦、超时、重载、权限变更、项目/epoch/设计文件/模式切换统一取消；清除悬停/选择/待请求、旧 capability/端口、worker 结果、计时器/监听/对象 URL。重命名保留 fileId 但重建资源投影。仅当前可写范围允许编辑意图，暂停/冲突原因可见。

## 检查与交付物

交付静态投影、resolver、受控工具脚本/闭包节点身份、通信 schema、坐标协议和生命周期 API。06 消费这些接口，不另写一套拖拽或凭据通信。

| 场景 | 必须断言 |
| --- | --- |
| script/内联事件/URL/SVG/MathML/嵌入/导航 | 真实 Chrome/Edge 用户代码零执行，父页 DOM/存储/凭据不可访问，原源码不变 |
| 错 source/origin/channel、旧代次/端口、重复/巨大消息 | 拒绝且零写入，不能提交任意补丁；opaque origin 不认证 |
| 嵌套目录 HTML/CSS/import/url、循环、资源失败 | 解析基准正确，有界运行/明确提示，不请求宿主 API |
| 用户伪工具属性、自动补节点、动态节点 | 无法伪造源码身份或触发可信命令 |
| 跨 iframe、父子滚动/缩放/窄窗口/重载 | 命中/选框正确，取消零正文和历史变化 |
| 反复换代/销毁 | 旧通道不复活，监听/任务/URL 清理，预算不持续增长 |

覆盖 FR-03/04/10/11/12/15/18、NFR-05～08、AC-03/04/08/14～19/23/25。安全、指针和资源必须有真实浏览器证据；mock/jsdom 仅作协议与生命周期辅助检查。Bootstrap 宿主隔离、CSS/import 和消息预算也重验 P0 结论。

## 退出与后续

安全拒绝、资源解析、旧结果失效和真实坐标 fixture 全通过；从提交至 ready 的基础性能在冻结预算内。提供当前代次、命中候选、可靠源码身份及取消 API 给[06](06-workspace-and-button-loop.md)。应用验证读取根 `.env` 连接本机服务，禁止 Docker 和凭据输出。
