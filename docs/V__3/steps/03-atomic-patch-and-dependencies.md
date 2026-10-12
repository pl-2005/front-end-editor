# 步骤 03：确定性原子补丁与项目依赖

日期：2026-10-12。状态：待实施；文档审查见[审查记录](../development-review.md)。阶段：P1 基础。前置：[02](02-source-parser-and-registry.md) 定位接口及 01 的事务/路径/Bootstrap 证明。

## 目标与接入

将所有视觉写入统一成可预检的 PatchPlan；首次按钮闭环即包含正式 Bootstrap CSS、许可和实例样式，不能先做画布暗注入再补导出。主要接入 `session.mutate`、`collaboration/document.ts`；新增建议职责 `planCommands/applyPatchPlan/bootstrapDependencies`，不改变共享 schema。

## 实施任务

1. PatchPlan 包含 requestId、身份/epoch、设计 fileId、源码版本/画布代次、可信模板版本、预生成实例 class/文件 ID/目录路径/时间、expected 片段/属性/上下文、文件创建/更新及无重叠补丁。所有随机值和时间在计划生成时确定；过期/重复请求拒绝或唯一重验，不重复提交。
2. `applyPlan(doc)` 从参数 doc 重新取 Y.Map/Y.Text，先验证全部对象存在性、路径/文件类型/父子关系、expected 值、区间和创建冲突，再同步写入；不捕获 live 对象，不在 action 内解析网络资源或通知 UI。单文件补丁按偏移倒序；移动的删除/插入从同一未修改快照计算。计划不得接受 iframe 任意路径或补丁。
3. 修正 scratch/live 事务结构一致性：scratch 也在相同 origin 的单次外层事务内执行计划，随后 schema/容量/Update/离线预算完整预检；live 提交前重核会话状态及所有目标。同步执行期间禁止异步等待，所有可预见异常发生在写入前；Yjs transaction 不保证业务异常回滚。用户通知、业务成功日志和选择更新只在提交成功后发生；恢复侧车准备记录按 04 在结构提交前持久保存，不放入双执行 action。
4. 文件创建接口支持外部指定稳定 ID、初始正文和预定时间；创建完整合法记录并同时更新 fileOrder，所需 directories 纳入计划。不要求重写全部既有文件命令，不将 STRUCTURE_ORIGIN 自动混入视觉历史。一次计划的所有写入可由 04 精确跟踪。
5. 前端精确声明 `bootstrap: 5.3.8` 与 lockfile，构建读取官方编译 CSS/许可；固定资源内容/hash 和模板版本。首次合法投放同时创建 `/vendor/bootstrap-5.3.8-<预生成后缀>/bootstrap.min.css` 与 `LICENSE.txt`、安全 head 内相对 link、组件 HTML 和按需实例 CSS，不能在拖动开始时写入任何依赖。不生成 Bootstrap JS/Popper 或 data-bs 交互。
6. 实例 CSS 位于设计 HTML 目录：可证明归属的受控文件增量复用，否则使用 `visual-components-<唯一后缀>.css`，不覆盖同名用户文件。归属协议遵循 01 冻结格式；Bootstrap 依内容/hash/许可核验，不能只信文件名或标记。当前 HTML 不重复 link，其他 HTML 复用资源但分别按自身路径计算 href。缺安全 head 或无法证明 CSS 插入位置时拒绝并定位源码。
7. 新资源的 fileId 和唯一后缀路径预先绑定 link，并发首次引入可保留多份合法副本，不自动清理。路径发生用户改名或网关归一化时，重新解析并提示引用失效；不自动改写所有用户引用。新页按 Bootstrap→实例 CSS；旧页保留已有用户样式相对顺序，首次 Reboot 影响提示由 06 呈现。
8. 复用 100 文件（含逻辑删除）、100 directories、1 MiB/文件、10 MiB 总正文、12 MiB Y.Doc、2 MiB Update、现有 1.5 MiB 待确认日志及缓存总预算。CSS/许可和撤销残留均计入；04 的收据占用也参与总预算。资源准备和校验不足完整拒绝，不能先生成无样式 HTML。

## 检查与交付物

交付纯计划生成器、执行器、稳定文件创建能力、Bootstrap 本地资源与归属协议。提供实际字段定义及拒绝原因；06～08 的插入/属性/结构命令只调用这一入口，04 的历史 preview 复用同一容量和 schema 规则。

| 场景 | 必须断言 |
| --- | --- |
| 同计划 scratch/live、含目录和初始正文 | ID/class/路径/内容一致，单次外层提交，无外部副作用 |
| 缺失/删除文件、错旧值、重叠补丁、路径冲突 | 正文/文件集合/顺序/目录/meta/历史零变化 |
| 文件数、各字节上限及离线预算不足 | 包含 CSS/许可后的完整预检，零半成品 |
| 用户同名文件、重复投放、多 HTML、刷新后复用 | 不覆盖，不重复 link，正确相对引用和实例 class |
| 两端同时首次引入 | 两端实际 href 均指对应已存在文件，实例样式一致；验证网关合并后的最终路径 |
| 取消/非法目标/无安全 head | 不创建资源、不改 HTML、不产生空历史 |
| 未触及区间 | 注释、脚本、引号、换行逐字不变，新片段继承邻近缩进 |

覆盖 FR-03/06/09/11/13/18、NFR-02/04/06、AC-05/10/12/20/25。并发路径纯内存验证需在 06/09 追加真实网关证据。

## 退出与后续

双执行确定性、多文件完整拒绝、容量和并发引用 fixture 通过；依赖确实进入项目权威文件，宿主 CSS 无全局 Bootstrap import。将计划影响集合、创建文件/目录身份、前后片段及本地 origin 交给[04](04-shared-history-and-recovery.md)建立历史和恢复；在 04 完成前不向产品开放结构写入。应用验证使用根 `.env` 和本机服务，禁止 Docker 和凭据输出。
