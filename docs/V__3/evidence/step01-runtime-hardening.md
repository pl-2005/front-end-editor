# 步骤 1 运行检查边界实施证据

日期：2026-10-26（Asia/Shanghai）。本轮代码为本地未提交修改；补充同日[运行选择评审](../selection-review.md)提出的 Step 01 增量，不替代步骤 2–5 或完整 A1–A10 验收。

## 实现范围

- 临时 marker 插入开始标签的名称之后，保留无引号属性末尾 `/`、void 和自闭合写法的解析语义；只改预览副本，不改 Y.Text。
- 运行节点显式报告候选来源、歧义或未映射。唯一标记转入 WeakMap 后仍只表示候选，不授予文本、属性或结构写权限；重复标记不提供确定源码定位。认领前的唯一克隆替换无法与原元素区分，保持候选只读。
- 含原始 meta CSP 的页面保守停用检查，包括允许脚本的策略；预览继续使用原文。HTTP CSP 由浏览器执行，不补 nonce、不放宽策略。此取舍避免工具先于 meta 策略执行。
- 模式开关带单调 revision，旧检查回执、命中与清除不能恢复或清除当前状态。普通切换保留 iframe 和连接；源码变化、导航及卸载使旧状态失效。
- 握手未 ready 的连接可由新页面的有效 hello 替换，5 秒无 ready 则关闭并显示不可用；完成 ready 的连接拒绝重复 hello 覆盖。检查界面只有收到当前模式回执后才显示就绪。
- 检查激活且存在 hover/selection 时，只采样这些目标的几何并去重；停用、目标移除和 pagehide 停止相应采样。CSS 变换无需依赖根元素尺寸改变。

## 验证记录

根 `.env` 配置的 API、初始化服务和网关已通过 `node scripts/wait-dev-ready.mjs 5` 就绪检查。既有 Vite 配置从根 `.env` 加载；本轮不启动 Docker，不输出凭据、不变更服务配置。

在 `frontend` 执行：

| 实际命令 | 结果 |
| --- | --- |
| `npm test -- --maxWorkers=2` | 最终 32 文件、234 项通过 |
| `npm run lint` | 通过 |
| `npm run build` | TypeScript 与 Vite 生产构建通过；保留已有大 chunk 提示 |
| `npx prettier --check src/editor/visual/canvas/RuntimeInspector.tsx src/editor/visual/canvas/RuntimeInspector.test.tsx src/editor/visual/canvas/runtimeProjection.ts src/editor/visual/canvas/runtimeProjection.test.ts` | 通过 |

首次构建的沙箱拒绝写入 `node_modules/.tmp` 的 tsbuildinfo；获工具批准后按原命令重跑通过。没有修改构建配置绕过检查。

父层性能回归使用 204746 字节 HTML：同帧 1000 条有效命中只消费最新矩形，排队一帧，命中处理阶段 `Y.Text.toString` 调用为 0；文档 update 仍重新读取并核验源码。此为确定性测试计数，不是浏览器吞吐量或跨设备耗时承诺。

## 真实 Chrome 检查

在仓库根执行 `node scripts/verify-runtime-step01.mjs`，最终 25 项检查全部通过。前置为已运行的本机 Vite（默认 `http://localhost:5173`，可用 `STEP01_VITE_URL` 指定）和 web-access CDP proxy（默认 `http://localhost:3456`）。脚本新建测试标签和临时本机 HTTP 服务，动态导入实际 RuntimeProjection、RuntimeInspector、React 与 Y.Doc；使用原生 iframe、MessageChannel 和真实布局，不依赖历史项目或标签 ID。结果输出到 ignored `.codex-build/runtime-step01-results.json`。

已验证的边界包括：无引号斜线属性、工具材料移除、唯一克隆替换/innerHTML 重建仅候选、重复标记歧义、动态节点不猜祖先、显式 DOM 父级、CSS transform、延迟图片固有尺寸及实际本地 FontFace 加载、静止去重、停用停止采样、目标删除、HTTP/meta CSP、真实父层覆盖框、运行 A/代码 B 定位、同 iframe 输入/滚动/脚本身份保留、导航及源码更新使旧连接失效。

浏览器脚本使用独立 Y.Doc 夹具，不创建或修改后端项目、数据库和对象存储；没有重跑历史完整 Sandpack/登录/持久化闭环，也不以此替代步骤 5 的双会话、导出和跨浏览器验收。Y.Text、meta、文件顺序的完整快照在检查、切换和导航后逐字/逐项不变。

复跑曾因验收标签隐藏使父层 rAF 暂停而等待覆盖框超时；诊断记录确认选取消息已收到，不将此归为产品选取丢失。脚本补充仅激活自建标签及 Page.bringToFront 后完成整段验证。静止测试先等待字体与帧稳定，只统计锁定目标几何，避免将正常 clear-hover 误报为重复几何；采样上界按实际帧数和两个目标槽判断，不依赖显示器刷新率。结果 JSON 同时记录实际采样耗时、帧数、rectReads；静止锁定几何消息为 0，停用后 250 ms 检查窗口新增 rectReads 为 0。测试结束关闭自建标签和临时 HTTP 服务，保留原有标签及开发服务。

## 后续门槛

鼠标形态增补：设计检查使用预览内临时 adopted stylesheet 固定默认指针，运行/退出时移除；不在用户 DOM 插入 style 节点或改写内联样式。新增真实 Chrome 的输入框、链接、按钮、内联 cursor 以及运行模式恢复两项断言，`node scripts/verify-runtime-step01.mjs` 扩展至 27 项通过；对应投影 8 项测试、lint、生产构建通过。此前 234 项全量结果是 Step 01 收口记录，本次增补未重复执行全量。

悬浮标签增补：tag/尺寸标签使用父页面独立固定浮层，在目标上/下/侧边自动避让，不截获指针。真实 Chrome 加入顶部、底部和占满预览高度目标的矩形不相交断言，脚本扩展至 30 项通过；对应检查器/Sandpack 回归 16 项、lint、生产构建通过。本轮未重复执行全量。

本步仅提供来源状态、只读原因和源码定位。字段差异比较、结构操作能力、恢复材料、历史与写入前复核仍由步骤 2C/3 实施。不能把本步候选来源当成写权限，不能把只读退出检查通过解释成可开放未受保护的写入。
