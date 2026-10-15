# V3 可视化编辑：简单实现方案

日期：2026-10-14。状态：步骤 1 已实施并通过自动检查及 Chrome 基础验证；步骤 2–5 与完整 V3 验收待执行。

在现有多人 HTML/CSS/JS 编辑器中增加静态 HTML 设计模式：拖入 Bootstrap 组件，选中元素修改文本、属性和基础样式，结果直接更新项目源码。继续使用 Y.Doc/Y.Text、现有协作会话和 Sandpack，不引入页面 JSON 或新的后端协议。


| 文档 | 用途 |
| --- | --- |
| [需求](requirements.md) | 首版功能和明确限制 |
| [技术方案](technical-design.md) | 现有接入点及最小实现方式 |
| [详细开发步骤与总计划](development-plan.md) | 当前代码基线、改动位置、五步任务、验证与完成条件 |
| [验收](acceptance.md) | 十项检查，全部待执行 |
| [Bootstrap](bootstrap-dependency.md) | 项目内资源及准备动作 |

## 逐步实施入口

1. [源码映射、安全画布与选择](steps/01-source-and-safe-canvas.md)
2. [Bootstrap、按钮写入、共享历史与恢复](steps/02-button-history-and-recovery.md)
3. [七类模板、属性与插入交互](steps/03-templates-properties-and-insertion.md)
4. [多文件集成、边界与回归](steps/04-integration-and-boundaries.md)
5. [本机验收、证据与交付](steps/05-local-acceptance-and-delivery.md)

步骤文档根据 2026-10-14 当前代码核对整理，步骤 1 的实际实现和验证见[实施证据](evidence/step01.md)，其余步骤待实施。建议新增代码位置已标明，不代表对应模块已经存在。

保留既有明确决定：Bootstrap 组件依赖；现有离线编辑；未解决恢复材料在发起者本机持久保存；并发变化提示并由用户人工处理。首版不做跨容器移动、复制或多文件整体撤销，Bootstrap 准备与组件编辑分开提交。

本机运行和验收使用仓库根 `.env` 与其中配置的本机 MySQL、MinIO、Redis；禁止 Docker / Docker Compose，禁止输出或提交凭据。方案已完成两个 agent 的评审并修正恢复材料遗漏；步骤 1 已实施；其余功能开发与完整应用验收仍待执行。
