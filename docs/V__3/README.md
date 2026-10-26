# V3 可视化编辑：简单实现方案

日期：2026-10-26 更新。状态：步骤 1 已补齐悬停检查、点击锁定与无焦点源码高亮，自动检查和本机 Chrome 增量验证见[实施证据](evidence/step01-hover.md)。步骤 2–5 与完整 V3 验收待执行。

本日后续按用户确认调整为[当前运行页检查](runtime-inspection.md)：设计/运行共用同一个 Sandpack iframe，切换只开关检查工具，保留样式、脚本、输入值和滚动位置。该约定取代独立静态设计副本要求；旧静态画布证据不代表当前运行检查边界。

在现有多人 HTML/CSS/JS 编辑器的运行页上增加检查模式；后续支持对源码位置明确的静态 HTML 拖入 Bootstrap 组件、修改文本/属性/基础样式。继续使用 Y.Doc/Y.Text、现有协作会话和 Sandpack，不引入页面 JSON 或新的后端协议。


| 文档 | 用途 |
| --- | --- |
| [需求](requirements.md) | 首版功能和明确限制 |
| [技术方案](technical-design.md) | 现有接入点及最小实现方式 |
| [详细开发步骤与总计划](development-plan.md) | 当前代码基线、改动位置、五步任务、验证与完成条件 |
| [实施约定](implementation-contracts.md) | 同库预算预留、可逆恢复记录、历史候选接口、合法插入矩阵和步骤 2A–2D 门槛 |
| [验收](acceptance.md) | 十项检查，全部待执行 |
| [Bootstrap](bootstrap-dependency.md) | 项目内资源及准备动作 |

## 逐步实施入口

1. [源码映射、安全画布与选择](steps/01-source-and-safe-canvas.md)
2. [Bootstrap、按钮写入、共享历史与恢复](steps/02-button-history-and-recovery.md)
3. [七类模板、属性与插入交互](steps/03-templates-properties-and-insertion.md)
4. [多文件集成、边界与回归](steps/04-integration-and-boundaries.md)
5. [本机验收、证据与交付](steps/05-local-acceptance-and-delivery.md)

步骤文档根据 2026-10-14 的代码基线整理，2026-10-16 增补设计画布悬停检查、源码无焦点高亮及点击锁定计划。步骤 1 基础版见[历史实施证据](evidence/step01.md)，2026-10-26 的新增交互见[增量证据](evidence/step01-hover.md)；其余步骤待实施。已存在和待新增模块以总计划中的 2026-10-25 静态核对结果为准。

2026-10-25 对照当前代码修正总计划基线，并明确步骤 2 的技术选择：恢复记录固定放现有 custom store，按基线加可逆补丁保存，与日志原子计量及预留；先完成历史和存储保护，再接 Bootstrap/按钮。七模板的结构插入使用明确容器白名单，并在提交前重新解析候选源码验证关系。

保留既有明确决定：Bootstrap 组件依赖；现有离线编辑；未解决恢复材料在发起者本机持久保存；并发变化提示并由用户人工处理。首版不做跨容器移动、复制或多文件整体撤销，Bootstrap 准备与组件编辑分开提交。

本机运行和验收使用仓库根 `.env` 与其中配置的本机 MySQL、MinIO、Redis；禁止 Docker / Docker Compose，禁止输出或提交凭据。原方案已完成两个 agent 的评审并修正恢复材料遗漏；步骤 1 已实施，其余功能开发与完整应用验收仍待执行。
