# Bootstrap 组件栏依赖方案

日期：2026-10-12。状态：用户明确要求将 Bootstrap 引入 V3，作为组件栏依赖；以下为待实施的技术方案，未安装依赖、修改应用代码或执行应用验收。

## 来源与定位

本次用户指令为引入依据。用户同时引用了 Codex 聊天“设计可视化组件拖拽编辑方案”（hostId `local`，threadId `01a12580-e396-7772-b092-085b6c29bb1e`）；当前会话未提供 `read_thread` 工具，未读取或依赖该聊天内容。本文依据当前指令、仓库 V3 需求和 Bootstrap 官方文档形成，不声称已核对引用聊天。

组件栏提供 **Bootstrap 原生 HTML 模板**，拖入后输出 HTML 标签、Bootstrap class 与实例 class，由 Y.Text 保存。Bootstrap 是模板样式依赖，不负责源码映射、拖拽命中、协作或历史。宿主工作区继续使用 React/Ant Design；Bootstrap CSS 仅加载在隔离的模板预览及项目画布中，不全局导入宿主页面。

本方案采用固定版本 **5.3.8**，模板版本和依赖版本一起登记在本地模板注册表。官方提供编译后的 CSS 和可选 JS，可通过 npm 获取；实施时精确固定 package.json 与 lockfile，不使用浮动版本或 latest。[官方安装文档](https://getbootstrap.com/docs/5.3/getting-started/download/)

## 组件范围与输出

| 必交付组件 | 模板输出建议 | 可编辑内容 |
| --- | --- | --- |
| 标题 | h1–h6，按模板选择 display 等排版 class | 文本、标题级别、字号/颜色 |
| 段落 | p，按模板选择 lead 等排版 class | 指定文本节点、排版 |
| 按钮 | button，btn + 单一变体 + 实例 class | 文本、type、变体、尺寸 |
| 链接 | a，明确链接样式及实例 class | 文本、href |
| 图片 | img，img-fluid 等 class | src、alt、宽高 |
| 容器 | div，container/container-fluid；嵌套 row/col 结构按模板约束 | 容器宽度、基础布局、间距 |
| 卡片 | card/card-body/card-title 等静态 HTML | 子文本、图片、背景、边框 |

这些模板满足原 FR-02 的七类基础组件，不新增任意 React/Vue 源码转换。响应式 class 只影响样式，拖拽仍表示 DOM 顺序和合法容器；Bootstrap row/col 不等于任意坐标定位，也不等于 CSS Grid。图片沿用 URL 或已有地址，不新增素材上传。

首版基础组件以 CSS 为必需依赖，不默认生成 Bootstrap JS、Popper 或 data-bs 交互。Modal、Dropdown、Tooltip、Carousel 等需要 JS 的完整交互列为扩展范围；后续若纳入，需定义运行依赖、设计态静态表示和销毁规则，不能在设计页直接执行库的 DOM 行为。官方说明 JS 插件是可选项，部分依赖 Popper，并提示与 React 等共同修改 DOM 的冲突风险。[官方 JS 文档](https://getbootstrap.com/docs/5.3/getting-started/javascript/)

## 依赖分发与项目文件归属

实施时在前端精确声明 `bootstrap: 5.3.8`，构建阶段读取官方编译 CSS 为模板资源。模板缩略图通过隔离预览加载它；正式设计页依据项目权威文件解析 CSS。不能仅给设计投影暗中加 Bootstrap，而让运行和 ZIP 缺少样式。

默认采用**项目内本地 CSS**，首个需要 Bootstrap 的合法投放将以下内容纳入同一 PatchPlan：

1. 项目根 `/vendor/bootstrap-5.3.8-<预生成唯一后缀>/bootstrap.min.css`，正文为固定版本官方资源；目录身份、fileId 和路径在 scratch/live 执行之前确定。
2. 同目录 `LICENSE.txt`，保留上游许可内容；CSS 原有许可头保持不变。[官方许可说明](https://getbootstrap.com/docs/5.3/about/license/)
3. 当前设计 HTML head 中指向该项目文件的相对 stylesheet link；缺少可安全插入的 head 时给出原因与源码定位，不猜测位置。
4. 组件 HTML 与按需创建/更新的实例 CSS。组件自定义声明继续使用专用 visual-components CSS，不改 vendor 正文。

CSS/许可/实例文件均使用既有文本文件协议，目录变更纳入确定性计划和撤销 scope。它们计入文件数、单文件/总正文、Y.Doc、Update 和离线预算；预检不足则完整拒绝，不先插入无样式组件。100 文件的限制包含逻辑删除文件，撤销后的重复引入也不能绕过限制。

新建 vendor 路径使用独立后缀，避免两客户端首次投放同时创建同路径后，网关重命名却使 href 脱节。合并后允许多份相同依赖共存；以后投放优先复用已验证的同版本资源，不自动清理任何成员仍引用的副本。文件归属依靠固定版本资源内容/hash 与许可核验，不仅依靠文件名、class 或用户可伪造的标记。

相同 HTML 再次投放不重复 link；其他 HTML 复用项目已有资源，但按各自路径建立引用。重命名后重新解析和提示引用失效，继承现有“不自动改全部用户引用”的边界。默认不使用 CDN，因此初始化完成且本地资源可用时无需网络也能设计、运行及导出。

## 已有页面与级联样式

Bootstrap Reboot 包含全局元素样式，引入后可能改变该 HTML 中已有手写元素的外观。组件栏展示“首次使用将为当前页面引入 Bootstrap，可能影响现有样式”的提示，并可预览影响；取消拖拽不创建依赖或修改 HTML。未引用 Bootstrap 的其他 HTML 不自动注入依赖。iframe 隔离只保护宿主，不能保证项目内所有旧元素外观不变。[官方 Reboot 文档](https://getbootstrap.com/docs/5.3/content/reboot/)

新建页面按 Bootstrap → 实例 CSS 的顺序加载；已有页面只在可证明的插入位置加入依赖，保留用户样式的相对顺序并在面板展示实际级联。无法确定插入点时拒绝并定位源码，不全量重排 head。

属性面板区分 Bootstrap 变体/utility class、实例声明与计算值。按钮换变体仅替换该实例受支持的 class token，保留未知 class；不修改 `.btn`、`.card` 等共享规则。Bootstrap utilities 默认可能使用 `!important`，不能假设普通实例 CSS 一定覆盖它们；编辑受控 utility 字段时调整对应 token，遇到未知/响应式级联显示限制与源码入口，不静默删除用户 class。[官方 Utility API](https://getbootstrap.com/docs/5.3/utilities/api/)

删除最后一个可见组件也不自动删除 Bootstrap，其他 HTML、手写元素或 JS 可能依赖它。整体撤销首次引入前检查 vendor、许可、目录、link、实例 CSS 的后续贡献和引用；有依赖则按已定策略拒绝整组，不隐藏他人内容。未知依赖无法证明安全时保守拒绝。

## 设计投影、安全与预算

设计 resolver 从项目 CSS 创建受控投影，HTML 与嵌套 CSS 相对引用按各自路径解析。模板预览与设计画布不执行 Bootstrap JS，也不放宽用户脚本、导航或 iframe 桥接权限。官方 CSS 中的资源 URL 仍经既定允许策略处理；可信版本比对不使用户可修改的 vendor 文件自动获得执行权限。

200 KiB 门槛仍指设计 HTML，Bootstrap CSS 单独计入解析/资源/布局预算。P0 必须测量实际资源字节、节点数、Update 大小、首次引入和复用时延；不能忽略 CSS 成本，也不能为适配依赖降低既有容量或 1 秒验收要求。需调整基线时提交具体实测影响让用户决策。

设计、Sandpack 运行、第二客户端、持久化重开和 ZIP 均从同一份项目 Bootstrap 文件获得样式。官方 CSS/许可属于合法项目依赖，可以导出；通信 capability、临时节点标记和工具脚本仍禁止导出。

## 实施与验收门禁

将依赖准备、固定资源内容/许可、并发首次引入、CSS 级联和容量成本加入 P0；P1 按钮最小闭环即使用正式 Bootstrap 依赖计划；P2 完成七类模板及属性映射。仍执行既有共享历史、冲突恢复、离线和本机服务验收，不以组件外观替代源码证据。

新增 FR-18、AC-25，并补测 AC-10/11/12/16/21/22/23：

- 首次引入一次提交 CSS/许可/link/HTML/实例样式；取消、缺失或超限时零写入、无历史。
- 相同 HTML 重复投放、多 HTML、重开再次投放复用依赖；同名用户文件不覆盖；并发初次创建各自引用正确。
- 无远端依赖时一次撤销/重做完整恢复；乙编辑 vendor 或增加引用时整组拒绝并保留内容。
- 宿主界面样式不被污染；Reboot 对已有页面的影响可见；utility/实例属性修改只影响目标，不误改共享 CSS。
- 离线已初始化画布、运行预览、第二客户端、durable 重开和 ZIP 均有同版本样式与许可；不依赖编辑器专有 URL 或 CDN。
- 设计中用户 JS 与插件不执行，模板没有伪造源码节点；真实 Chrome/Edge 检验缩放、滚动、资源预算与更新时延。

本轮仅完成方案更新和文档校验；Bootstrap 尚未进入 package.json/lockfile，所有上述应用验收待执行。
