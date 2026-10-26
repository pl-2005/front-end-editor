# 步骤 1 悬停检查增量证据

日期：2026-10-26（Asia/Shanghai）。代码为本地未提交修改。本文补充 [2026-10-14 基础版证据](step01.md)，只覆盖步骤 1 的只读设计功能；步骤 2–5 和十项完整 V3 验收仍待执行。

## 实现

- iframe 工具桥分别维护 hovered 和 selected；`hover`、`clear-hover`、`select` 按当前 fileId、代次、节点和有限矩形验证。悬停不改变锁定目标，“选择父级”和“打开源码并定位”只使用锁定目标。
- pointermove 经 requestAnimationFrame 合并，每帧报告最新命中，相同节点和矩形不重复发送悬停消息。滚动、resize 和 ResizeObserver 刷新矩形；覆盖层不拦截指针，全部使用 iframe 内 CSS 像素，不乘 devicePixelRatio。
- 检查框显示标签、尺寸和只读原因，使用橙色虚线；锁定框使用蓝色实线。
- Monaco 使用独立 decoration，通过 getPositionAt 转换 UTF-16 原文范围；只在范围不可见时滚动，不调用 focus 或 setSelection。模型内容变化立即清除装饰。收起源码时不应用装饰；点击画布保持源码收起，明确点击“打开源码并定位”才展开。
- 移出 iframe、Esc 和失焦清除临时检查，保留锁定。清除同时取消排队动画帧；pagehide 关闭子端口，父层卸载、重载、超时、文件/代次/模式切换沿用端口清理并清除源码装饰。父层握手监听在 layout effect 安装。
- 无新增依赖、Y.Text 写入口、后端协议或历史逻辑，沿用基础版清洗、CSS 投影、CSP、opaque sandbox 和一次性 capability 握手。

## 自动验证

工作目录：仓库 `frontend`。

| 阶段 | 实际命令 | 结果 |
| --- | --- | --- |
| 修改前基线 | `npm test -- --maxWorkers=2` | 29 文件；214/215 通过，已有 V2App 项目管理用例 60 秒超时 |
| 修改前基线 | `npm run lint` | 通过 |
| 首次构建 | `npm run build` | sandbox 拒绝写 tsbuildinfo；获得工具批准后重跑通过 |
| 最终全量 | `npm test -- --maxWorkers=2` | 30 文件、217 项全部通过；基线超时未复现 |
| 最终静态检查 | `npm run lint` | 通过 |
| 最终生产构建 | `npm run build` | 通过；保留已有大 chunk 提示 |
| 最后补充断言 | `npm test -- src/editor/visual` | 3 文件、14 项通过；补充 Esc 捕获阶段、失焦和 clear-hover 严格校验 |

新增 `bridge.test.ts` 在 node:vm 中执行实际生成的工具脚本，使用真实 DOM/EventTarget 和受控动画帧：30 次指针事件只报告最后节点，重复命中不报告，清除取消排队回调，父级操作仍针对锁定目标，pagehide 关闭端口。React 测试覆盖独立锁定/检查状态、几何刷新不重复定位、移出/Esc/失焦保留锁定、旧代次拒绝及卸载清理。原解析、资源、恶意内容及握手测试继续通过。

## 本机 Chrome 验证

使用仓库根 `.env` 和其中的本机 MySQL、MinIO、Redis，未使用 Docker，未输出或提交凭据。使用独立 frontend 15675、backend 18698、gateway 18699、initializer 18700；后端为已有本机验收 JAR、协作服务为已有 dist，本步未修改后端。

创建隔离测试账号、团队和项目，通过真实 API 和第二个 CollaborationSession 设置包含中文、emoji、实体、CRLF、嵌套元素、长页面、用户脚本、事件、链接和表单的 HTML。真实工作区连接同一项目，采用 Chrome CDP 和原生 MessageChannel 验证。

| 场景 | 实际观察 |
| --- | --- |
| 指针与源码 | CDP 真实鼠标移动产生检查框和标签/尺寸；Monaco 插入点、selection、文本焦点保持不变；装饰所指原文包含 `中文😀 &amp;` |
| 锁定与清除 | 点击 A 后悬停 B，锁定信息和蓝框保留 A；Esc 清除检查框与源码装饰，保留锁定 |
| 源码收起 | 悬停不展开源码；显式按钮可展开并定位 |
| 滚动 | 子文档滚动 20 CSS 像素后，锁定框 top 与元素 getBoundingClientRect 一致，包括负坐标 |
| 布局与缩放 | CDP 调整视口为 1440 × 1000、deviceScaleFactor 1.5、pageScaleFactor 1.25 后，锁定框尺寸仍与子文档 CSS 矩形一致；覆盖层 pointer-events 为 none |
| 安全 | 父层 contentDocument 为 null，sandbox 仅 allow-scripts；用户脚本/事件未执行；副本链接无 href、表单无 action、按钮为 button；点击不改变父层项目路由 |
| 正文 | 检查和锁定操作后，Y.Text 与测试输入逐字一致 |
| 第二会话更新 | 工作区收到第二会话插入的源码注释后，旧检查框、锁定框与 Monaco 悬停 decoration 全部清除；源版本及过期消息的同步拒绝另由自动测试覆盖 |

真实浏览器发现 Monaco 会阻止 Esc 冒泡，初次检查失败；已将父层监听改为捕获阶段，复测通过并增加回归断言。验收脚本也曾因负坐标拼接为减减表达式失败，已修正；该失败属于脚本而非画布。开发热更新会使一次性桥接失效，验收在切换运行/设计、重建 iframe 后进行。

浏览器脚本和运行日志位于被忽略的 `.codex-build`；`verify-v3-hover.mjs` 用于本次验收。首轮交互使用真实 CDP 鼠标/键盘；后续几何复验也使用独立 iframe 进程中的 DOM 事件，避免后台标签的指针投递差异。这里的缩放为 CDP 页面缩放和像素比例模拟，不代替跨浏览器完整验收。

以上浏览器结果按分场景观察记录，并非声称整段自动化脚本一次运行全部通过：最后一轮在等待后台页面 requestAnimationFrame 时触发 CDP Runtime.evaluate 超时；随后通过既有浏览器连接直接复核，remoteSourceReceived、hoverCleared、lockCleared、sourceDecorationCleared 四项均为 true。自动测试对排队回调和代次失效提供确定性断言。

收尾：本次测试项目 144 已通过带最新 If-Match 的 API 删除，测试会话已销毁，本次创建的浏览器标签已关闭，独立验收服务已停止。隔离测试账号及团队保留在本机测试服务中；没有删除用户既有数据。

## 范围

本步仍是只读设计。Bootstrap、组件插入/修改/删除、共享历史迁移、恢复预算及离线写入双客户端闭环属于步骤 2–5。基础版的多 HTML、CSS 清洗、撤权和 CSP 纵深场景见历史证据；本次自动测试保持这些覆盖，没有将旧记录冒充新增交互验证。
