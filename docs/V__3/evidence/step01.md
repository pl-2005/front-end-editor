# Step01 实施与验证记录

日期：2026-10-14（Asia/Shanghai）。代码状态：本地未提交。仅覆盖步骤 1 的只读设计；步骤 2–5 尚未实施。

## 实现

- ProjectWorkspace 增加设计/运行切换，设计文件复用 activeId，运行仍使用 entryFileId；不重建 CollaborationSession。源码面板仍由现有 WorkspacePanels 承载，不需要修改其布局实现。
- Monaco 保留模型和现有 UndoManager；定位前核对 fileId、当前 Y.Text、模型原文和范围，再以 getPositionAt 转换 UTF-16 偏移。定位请求只消费一次，几何刷新不抢焦点。
- source/registry.ts 使用 parse5 记录元素、标签、属性、直接文本范围和父子关系。每次解析重新生成代次/节点 ID；隐式、错标签、范围交叉、重排、重复位置及特殊结构限制能力。
- canvas/ 生成只读副本；DOMPurify 白名单清洗，危险资源入口在 parse5 树中先移除。工具标记和通信材料只存在本地投影，没有 Y.Text 写入口。
- 项目内直接 CSS 按源码引用顺序加载，支持相对路径和绝对虚拟路径；PostCSS/value-parser 过滤 @import、字体和 CSS URL 等资源能力。CSS 通过工具脚本创建 style 并赋 textContent，脚本 JSON 转义所有 `<`。
- sandbox 只有 allow-scripts；CSP 在正文前设置，只有随机 nonce 的工具脚本可以运行，禁用连接、嵌入页面、表单和 base；referrerPolicy 为 no-referrer。
- 一次性 capability + iframe.contentWindow + fileId/代次验证握手，然后转移 MessageChannel。类型、键集合、节点、字符串长度、矩形有限性/大小均校验。源码变化立即使旧投影不可用；文件、模式、项目切换及撤权卸载时关闭端口和监听；重载关闭旧通道。
- 预算：HTML 200 KiB（UTF-8）；CSS 总量 1 MiB（含重复引用和内联样式）；直接 CSS 引用最多 32 次；重建防抖 180 ms；通信超时 5 秒。受限/缺失资源有提示，不静默截断。CSS 资源 URL 全部暂不加载；图片只支持明确的 HTTP(S) 地址。

## 自动检查

工作目录：仓库 frontend。

| 阶段 | 实际命令 | 结果 |
| --- | --- | --- |
| 修改前基线 | `npm test -- --run` | 26 文件，192/196 通过；4 个已有 UI 用例超时（ProjectPage、WorkspaceFileExplorer、V2App 两项） |
| 修改前基线 | `npm run lint` | 通过 |
| 修改前基线 | `npm run build` | sandbox 写入 tsbuildinfo 被拒绝；没有将此结果记为通过 |
| 新增覆盖 | `npm test -- src/editor/visual` | 2 文件、12 项通过：映射、预算、清洗、CSS 逃逸、协议、来源验证、一次握手、过期选择、通道清理及重载 |
| 最终全量 | `npm test -- --maxWorkers=2` | 28 文件、208 项全部通过，基线超时未复现 |
| 最终 lint | `npm run lint` | 通过 |
| 最终构建 | `npm run build` | 通过；保留 Vite 大 chunk 提示 |

仓库写入和构建因环境权限使用已获工具审核的提权执行。没有修改根 .env，没有输出或提交其中的凭据。

## 本机浏览器检查

Windows / Chrome 155.0.0.0。读取根 .env，使用本机 MySQL、MinIO、Redis。独立端口：frontend 15675、backend 18698、gateway 18699、initializer 18700；后端使用已有本机验收 JAR，协作服务使用已有 dist。未使用 Docker。

创建独立测试账号、团队、项目，通过真实 REST API 和 CollaborationSession 初始化 HTML/CSS；工作区与验证会话连接同一项目。主 HTML 607 UTF-8 字节，CSS 127 字节。临时启动脚本与服务日志位于被忽略的 .codex-build，不包含交付源码。验证主项目已删除，创建的后台浏览器 tab 与本次启动的服务进程已关闭；隔离测试账号、团队和前期失败的创建样例仍留在本机测试服务中。

| 检查 | 实际观察 |
| --- | --- |
| 真实工作区入口 | 模式按钮、文件树、Monaco、成员和保存状态保留 |
| 静态画布 | sandbox=allow-scripts；父层 contentDocument 为 null；握手成功 |
| 元素与父级定位 | p 与 main 的选中框显示；Monaco 选中原文包含中文/emoji/实体/嵌套标签，保留原始 onclick 文本 |
| 源码区收起 | 收起后打开并定位成功，Monaco model ID 相同 |
| 多 HTML / 非 HTML | second.html 显示“第二页”；styles.css 显示选择 HTML 的提示，切换清空选择；entryFileId 不变 |
| 项目 CSS | 计算颜色 rgb(10, 20, 30)；外部 stylesheet 与 @import 有提示；CSS 中的 HTML/脚本字符串仅成为样式数据 |
| 原文与导航 | 主 HTML 与测试输入逐字相同；链接及表单的导航属性已移除，父页路径保持测试项目路由 |
| 授权清理 | 删除临时验证项目后，真实工作区显示“项目授权已失效，文档已清除”，设计 iframe 已移除 |
| 纵深 CSP | 在独立测试 iframe 中额外注入无 nonce 的 postMessage 脚本；没有收到执行标记，收到 script-src-elem 违规事件 |

选择/父级/源码定位检查使用真实 iframe、DOM 事件与原生 MessageChannel；为在 opaque iframe 中触发精确节点事件，验证页临时添加了带工具 nonce 的测试触发脚本。该脚本只在测试页面存在，不是应用功能，也不写入项目文件。来源/capability/代次/超大消息/重复握手/旧通道拒绝由自动测试覆盖。

浏览器检查中发现 CSS 的 `</script>` 会截断工具脚本并导致握手超时；已修复 JSON 转义，并增加 emitted script 的 node:vm 语法编译断言，修复后握手和定位复测通过。

## 边界

本步没有插入、属性修改、删除、Bootstrap 安装或新历史/恢复逻辑。十项完整 V3 验收仍未完成；Edge、缩放/滚动组合、规模性能、导出/复制、离线恢复和可视化写入双客户端验收留待后续步骤。不得将本记录视为 R1–R8 全部交付。
