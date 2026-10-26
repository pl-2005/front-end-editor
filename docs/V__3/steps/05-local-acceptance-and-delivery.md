# 步骤 5：本机验收、证据与交付

状态：待执行。对应 R1–R8 和 A1–A10。前置：[步骤 4](04-integration-and-boundaries.md)完成；本页是待执行流程，不是通过记录。

## 5.1 准备环境和测试数据

1. 检查根 `.env` 存在，使用其本机 MySQL、MinIO、Redis；不覆盖已有配置，不打印配置值，不使用 Docker / Docker Compose。
2. 确认 Node.js 24+、JDK 21、Maven 3.9+ 及已有依赖/缓存可用；安装/更新依赖使用各模块 lockfile。Maven 离线构建缺依赖时按现有开发指南准备，不把依赖缺失记作功能通过。
3. 选择完整本机启动器或分进程开发中的一种。先确认同端口没有另一组应用；完整启动器和 Step11 验收不能并行运行。
4. 准备普通单页、嵌套容器、多 HTML/直接 CSS、异常 HTML 四类项目；含中文、emoji、实体、CRLF、注释、重复 id/class 和未知属性。
5. 准备两个不同已授权用户会话。完整单入口可使用独立浏览器配置/Chrome 与 Edge；同一浏览器配置的同端口标签会共享登录，不算两个不同用户。
6. 若使用 Vite 5173/5174 双实例，按 [V2 开发指南](../../V__2/development.md)确保根 `.env` Origin 白名单和当前代理 Cookie 隔离；不要把 localhost/127.0.0.1 混为同一 Origin。另用同用户多标签验证恢复存储并发预算。
7. 同用户多标签预算竞争必须使用相同浏览器配置和相同 Origin，确认实际共享同一 IndexedDB；5173/5174 是不同 Origin，不能用它们证明共享预算原子性。跨用户协作和同用户缓存竞争分别记录。

## 5.2 自动检查与启动命令

下列入口已存在，命令从仓库根执行。每组失败应停止排查，不把后一个命令成功当作前一个通过：

```powershell
Push-Location frontend
npm test
if ($LASTEXITCODE -ne 0) { throw '前端测试失败' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw '前端 lint 失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
Pop-Location
```

完整本机包使用已有构建与启动流程；运行前阅读 [交付启动说明](../../V__2/step11-release.md)：

```powershell
./collaboration/scripts/build-step11.ps1
if ($LASTEXITCODE -ne 0) { throw '完整构建失败' }
Push-Location collaboration
npm run start:local
Pop-Location
```

启动器自行读取根 `.env`，连接本机服务；入口为 `http://127.0.0.1:15175`。正常 Ctrl+C 停止会先 flush 网关。开发热更新按 [V2 分进程流程](../../V__2/development.md)启动 Spring、初始化服务、网关、Vite，无须在此重复环境加载脚本。

现有 V2 回归脚本可用下列命令执行，先停止 start:local，使用构建脚本生成的产物：

```powershell
Push-Location collaboration
node scripts/verify-step11-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'V2 本机回归失败' }
# 已连接浏览器 CDP proxy 时另行执行：
# node scripts/verify-step11-local.mjs --browser
Pop-Location
```

它验证既有交付流程，不能替代 V3 A1–A10。Step 01 已新增可检出的只读浏览器命令 `node scripts/verify-runtime-step01.mjs`（仓库根执行，默认本机 Vite 5173、web-access proxy 3456），结果输出 ignored `.codex-build/runtime-step01-results.json`，实际范围见[加固证据](../evidence/step01-runtime-hardening.md)。旧 `.codex-build/verify-runtime-inspector.mjs` 保留为历史记录。当前仍没有 V3 完整写入验收命令；开发时可参考现有脚本新增 `collaboration/scripts/verify-v3-local.mjs`，实现并实际验证后再登记命令、参数、端口和证据目录，不能预称该脚本已存在。

## 5.3 按十项验收逐组执行

以下是执行顺序和证据要求，完整判断仍以[验收表](../acceptance.md)为准。每组记录未执行/失败/通过；安全、权限、数据丢失或部分写入失败必须修复后复测。

| 顺序 | 验收项 | 操作与源码/存储证据 |
| --- | --- | --- |
| 1 | A9 安全和资源 | 在真实浏览器保留原用户脚本/CSS，验证检查点击/按压/提交被拦截、切回恢复交互、原 sandbox/父页导航限制不变；HTTP/meta CSP 不可用只禁检查。错误桥接拒绝、动态及歧义节点不获写权限，正文与导出无工具材料 |
| 2 | A1 基本闭环 | 七模板拖拽及按钮插入，内部/前后关系和父级定位；保存两会话同一 HTML 的结果及实际插入顺序 |
| 3 | A2 源码保真 | 用特殊字符/异常结构样例；对未修改区间做逐字断言，不只比 DOM 或截图；手写修复后恢复设计 |
| 4 | A3 取消和过期 | Esc/画布外/失焦/切换/删目标/撤权/旧消息/重复请求；记录拒绝原因、正文 diff 为零和未新增历史 |
| 5 | A4 属性和删除 | 所有属性/style/Flex、卡片子元素；断言其他实例、未知声明和外部注释保留，utility 遮盖有提示 |
| 6 | A5 历史 | 代码输入、两次设计、属性提交按序 undo/redo，切换后保留；准备不捕获；拒绝时历史栈不消耗，远端正文不覆盖 |
| 7 | A6 Bootstrap | 首次/重复/多页/双会话准备和容量拒绝；记录 CSS/许可/目录/link 全成功或零变化、相对路径及资源内容一致 |
| 8 | A7 并发与恢复 | 同属性、删除与迟到文字、代码与插入，两种更新顺序；本地插入/改/删后刷新，prepared 重开、durable、确认后迟到更新；核对每类材料可找回 |
| 9 | A8 离线与门禁 | 已初始化后离线写、离线刷新与重连；注入恢复失败/预算边界，记录零部分写入；撤权和 epoch 后无旧材料/请求重放 |
| 10 | A10 交付回归 | 等 durable 后关闭重开，复制/两个导出入口、ZIP 资源；Chrome/Edge 布局、缩放/键盘、200 KiB、1 秒目标和重复切换；原 V2 功能回归 |

并发验收应可控地安排先后更新，而非只靠两人同时点击。记录会话 A/B 的初始源码、各自操作、更新到达顺序、最终正文及检查提示；证明 Yjs 收敛和人工检查触发分别满足要求，不把收敛作为语义正确证据。

同时执行验收表 2026-10-25 增补子场景：记录 U/R/Q/P、候选与实际 Update 字节、100 次小修改的材料开销、跨标签竞争、崩溃预留核对及远端合并副本未落盘提示。记录采样摘要，不输出账号凭据、Cookie 或能力令牌。

失败注入只作用验收项目/测试存储与受控工具，不清用户真实数据库、MinIO bucket 或本机缓存。权限/epoch 场景通过现有授权及维护流程或明确测试夹具执行，不手工修改生产指针。

## 5.4 证明持久化、重开、复制和导出

1. 完成页面修改，等待原 session `isDurable` 条件成立：已同步、本地 hash 与 accepted/durable hash 一致，durableSequence 不落后。单独 WebSocket 已同步不够。
2. 保存 fileId/路径/正文与 Bootstrap CSS/许可内容断言，正常关闭页面后重开，核对从服务加载的项目文件；另用无该项目缓存的授权会话重开，避免只证明本地缓存存在。
3. 按现有本机脚本方式核对 MySQL 当前指针与 MinIO 对象可读、内容一致；不直接绕过服务写指针或泄漏账号/对象凭据。记录非敏感校验结论和摘要。
4. 项目复制后核对 HTML、资源、许可及相对引用；不要求复制用户设备上的设计恢复侧车。复制与原项目分别改动不得互相影响。
5. 从工作区和项目列表分别导出 ZIP，解压核对全部项目源码与资源；Bootstrap 许可存在，工具标记/脚本、nonce/capability 和通信数据不存在。
6. 既有被删文件恢复导出目录继续按旧规则处理；V3 设计恢复材料使用面板复制/局部修复，不混入普通项目 ZIP。不要误删正常用户脚本或因导出扫描改变源码。

## 5.5 记录证据和更新交付文档

建议受限本机证据存放 `.codex-build/v3-acceptance/<运行编号>/`；不要默认将该目录提交 Git。需要共享时提取脱敏文字报告，截图不能独立证明源码/持久化。

每次运行记录日期、代码版本/未提交状态、浏览器/设备、HTML/CSS 字节数、实际命令及工作目录、退出码、A 编号、源码/资源断言、耗时、证据路径和剩余问题。日志不含根 `.env`、访问令牌、Cookie、内部密钥或真实验收凭据。

实施完成后更新：

- `docs/V__3/acceptance.md`：每项真实状态与证据链接，未执行项保持未执行。
- `docs/V__3/README.md`、`development-plan.md`：功能及五步状态，与真实结果一致。
- `docs/README.md` 与必要的根 README：V3 入口、实际运行及已知限制，不把公网部署写成已完成。
- 新增实施记录：实际修改文件、命令、结果、失败修复和复测，不复制 V2 历史测试数量当作本轮结果。

## 完成条件

A1–A10 全通过，前端 test/lint/build 通过，真实双会话/离线重开/本机持久化/复制/ZIP 有证据，Chrome 与 Edge 验证完成，状态和运行说明已更新。任何未执行或未修复项都不能把首版标记完成；本机交付不包含尚未授权和验证的公网部署。
