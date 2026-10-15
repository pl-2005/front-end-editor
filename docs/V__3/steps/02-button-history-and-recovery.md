# 步骤 2：Bootstrap、按钮写入、共享历史与恢复

状态：待实施。对应 R2/R5/R7/R8，重点验证 A5–A8。前置：[步骤 1](01-source-and-safe-canvas.md)完成；只用一个按钮模板证明整个写入闭环。

## 目标与改动位置

先通过“准备 Bootstrap → 按钮插入 → 删除 → 撤销/重做 → 双会话/离线检查 → 刷新找回材料”，再扩展模板。按钮先走点击插入，无需等拖拽 UI。

| 位置 | 本步任务 |
| --- | --- |
| `frontend/src/collaboration/document.ts` | 提供固定 ID 的文件创建；预生成资源目录、文件 ID 和正文 |
| `frontend/src/collaboration/session.ts` | 候选历史预检、同步/异步门禁接入、远端文件事件与缓存初始化顺序 |
| `frontend/src/collaboration/editorHistory.ts`（建议新增） | 工作区/会话级 UndoManager，统一代码、可视化、快捷键和工具栏 |
| `frontend/src/collaboration/visualRecovery.ts`（建议新增）、`offline.ts` | 有界恢复存储、材料状态、预算、清理与重开 |
| `frontend/src/editor/v2/MonacoWorkspace.tsx` | 使用共享历史，提交等待时同文件输入受控，不再随 Monaco 卸载销毁历史 |
| `frontend/src/editor/visual/source/`、`templates/` | 单 HTML 补丁、按钮、Bootstrap 资源准备计划 |
| `frontend/src/editor/visual/RecoveryPanel.tsx`（建议新增） | 复制材料、人工检查、确认和显式清理 |

## 开发顺序

### 2.1 统一正文历史，拆出可复用预检

1. 将 UndoManager 生命周期移到持有 session 的工作区或 session 服务；保持原 files 作用域，统一跟踪 MonacoBinding 与 VISUAL_ORIGIN。BOOTSTRAP_ORIGIN 和 STRUCTURE_ORIGIN 不作为正文历史来源。
2. 当前 session.undo 的 scratch 管理器使用默认配置；调整为与 live 完全相同的 scope、trackedOrigins、captureTimeout 及必要配置。保留现有 redone 元数据处理，验证多次 undo/redo，不简单替换为全页文本。
3. 拆出无 live 写入的历史候选预检，返回受影响 fileId、before/after、预算结果和历史栈身份/版本。当前 preview 复制栈行为也须验证没有提前改变 live 栈项。
4. 工具栏和快捷键调用同一历史入口。空栈不写恢复记录；拒绝操作不 pop 栈，异步等待期间若栈或文件变化，取消并提示。
5. 每个可视化命令前后 stopCapturing；代码输入保留既有合理分组。Bootstrap 准备前后也断组，但不清空历史。模式切换、源码区收起不销毁历史。

### 2.2 实现局部补丁和确定性创建

1. 单 HTML 命令包含项目/epoch/fileId、解析代次/nodeId、完整基准源码或等价版本检查、目标/上下文和补丁列表 `{start,end,expected,replacement}`。
2. 校验普通容器、插入关系、源码片段、范围和不重叠；预先验证全部补丁，再倒序应用到传入 doc 的 Y.Text。不得在写到一半时才检查后续片段。
3. action 只使用传入 doc；所有 ID、时间及随机目录名在 action 外生成，不访问异步存储、不发通知。session.mutate 会分别执行 scratch 和 live，两个结果必须一致。
4. 为已有文件创建逻辑提供受校验的固定 ID 参数或窄范围创建方法，保留原调用兼容；检查 ID/路径占用、目录、fileOrder、language 和 deletedAt，不绕过现有 readDocument。
5. 失败依靠预检零写入，不能依赖 Yjs 事务抛异常回滚。测试 scratch/live 的 ID、路径、正文与返回值一致。

### 2.3 准备 Bootstrap 独立资源

1. 固定 Bootstrap 5.3.8 和 lockfile，在构建内置官方 min.css 与 LICENSE；不引入 JS/Popper、不在宿主导入全局 CSS、不请求 CDN。
2. 内容/许可均匹配时复用已有项目资源；否则预生成唯一 `/vendor/bootstrap-5.3.8-<随机后缀>/` 及两个 fileId。目录沿用现有虚拟协议。
3. 相对当前 HTML 计算 link；识别重复引用和路径冲突。无安全显式 head 时拒绝并提示源码处理，不补整页。
4. 展示首次引入可能影响整个页面样式的提示；取消不创建目录/文件/link/历史/恢复写意图。
5. 完整计划包含 CSS、许可、目录和 head 补丁；权限、路径、所有协议和离线预算预检后，一次 BOOTSTRAP_ORIGIN 事务提交。
6. HTML link 的修改同样先保留 before/after 恢复材料；准备不进入正文 UndoManager。组件撤销只能移除组件，资源/link 留在项目里。
7. 双会话同时首次准备可生成两份唯一资源，各自引用有效；不自动去重。资源缺失/内容改变时准备状态失效，用户重新准备，不覆盖用户文件。

### 2.4 实现恢复存储和容量协调

1. 按 userId/projectId/epoch/fileId 隔离记录，至少保存基线、最近本地意图、最新合并正文、未清理破坏性操作前正文/片段。操作携带唯一 ID、顺序和 prepared/committed 状态。
2. 基线在第一次设计写入前落盘；每次设计和可能移除内容的历史操作先保存 before/after 及必要的保留内容。后续意图不能覆盖之前未清理的材料。
3. 落盘成功指 IndexedDB transaction complete，不是发出 put 请求。先写 prepared，live 写入成功后改 committed；崩溃留下 prepared 时重开提示检查，不自动重放。
4. 恢复累计上限暂定 5 MiB，并与现有 CACHE_LIMIT 联合计量。保留 OFFLINE_LIMIT 独立门禁：即使恢复存储有空间，也不能绕过原离线更新容量。
5. 同用户多标签并发追加必须在事务内计量并合并，避免覆盖材料或重复透支预算。选择存入现有 custom 或独立侧车数据库前，验证与 y-indexeddb schema、压缩及清理兼容。
6. 若用独立数据库，显式接入 clearOtherEpochs、purgeUserCaches、purgeProjectCaches 和活动连接关闭；不能直接采用会被 clearOtherEpochs 误删的命名方式。数据库枚举不支持时也要清理已知活动记录。
7. durable 可压缩既有更新日志，但不清设计材料；用户确认检查也保留检查基线。只由显式清理或既有撤权/epoch 规则清理，普通导航关闭连接但保留材料。
8. 写失败、超限或 committed 标记失败时保留已落盘材料并停止相关设计/历史操作。live 已提交时如实提示，不尝试整页回滚；重开依 prepared 材料人工检查。

### 2.5 连接统一写入和并发检查

统一命令流程：

```text
读取本代目标与当前源码
→ 检查会话/身份/目标/检查状态
→ 建候选补丁或历史结果，预检预算
→ 串行化同文件本地提交，持久写入 prepared 材料
→ 重新检查源码/代次/权限/历史栈/容量
→ session.mutate 或经保护的 live undo/redo
→ 标记 committed，重建画布，更新本地意图
```

1. 恢复落盘期间阻止同文件新的本地写入，包括 Monaco、设计、Bootstrap 和会影响目标的文件操作；UI 只读与命令级检查一起接入。期间远端更新仍可到达，落盘后复核失败就取消，不能锁住或回滚远端事务。
2. 需要检查/存储失败只暂停相关文件设计及受影响历史；代码编辑仍走原会话门禁。临时提交锁与持续“需要检查”状态区分，避免永久锁死代码编辑。
3. 已有未解决或已确认但保留基线的设计记录时，非本地事务涉及正文、删除或路径变化即标记需要检查。沿用 session 已注册 origin 分类，缓存加载、远端更新和本地历史来源不能混淆。
4. 缓存初始化先恢复材料再启用设计写入，并在接收/合并远端后核对。设计检查状态不能被新 durable 或新的画布渲染自动解除。
5. 受影响历史可能涉及多个文件，预检必须给出全体 fileId；其中任一需要检查就拒绝整体历史操作，不消耗栈。不按当前选中文件猜测受影响文件。
6. 恢复面板展示基线、最近意图、当前合并正文和保留内容；支持复制、源码人工局部修改后确认、显式清理。禁止一键整页覆盖，确认后迟到更新再次提示。

## 最小验证矩阵

| 用例 | 必须观察的结果 |
| --- | --- |
| 准备 → 插入按钮 → 撤销 → 重做 | 组件按一次操作变化；资源/link 始终保留；代码/运行与设计一致 |
| 原有代码历史 → 准备 → 按钮 → 模式切换 | 旧历史保留且顺序正确，准备不被捕获，收起源码仍可撤销 |
| 取消准备、容量不足、无 head、同路径用户文件 | 取消/拒绝零项目写入，不覆盖用户资源、不产生正文历史 |
| 本地插入 → 修改 → 删除 → 刷新 | 基线/意图/删除前内容仍可找回，不被 durable 或后续意图覆盖 |
| prepared 崩溃、落盘期间源码/远端/栈变化 | 重开提示；旧命令取消，栈未被消耗 |
| 同属性、删除与迟到文字、代码与插入，两种顺序 | 两个真实会话均收敛；存在记录的受影响会话提示检查，不宣称语义自动合并 |
| 已初始化后离线写入 → 重开/重连 | 使用已内置资源；材料保留，迟到更新触发检查 |
| 恢复写失败/总缓存满/离线日志满 | 设计和受影响历史拒绝；无部分源码写入、无自动清理未解决材料 |
| 确认 → 后续迟到更新 | 重新提示检查；复制/局部修复可用 |
| 撤权/epoch 变化 | 材料和旧通道按规则清理，旧请求不重放 |

扩展现有 document/session/session.offline/offline 测试，补历史分组和真实源码断言；双会话、离线重开和 IndexedDB 崩溃恢复须有真实浏览器证据。

## 完成条件

全部最小用例通过后才允许扩展模板。共享历史、独立资源准备、先落盘写入和保守远端检查必须同时完成；仅展示按钮不算本步完成。下一步：[步骤 3](03-templates-properties-and-insertion.md)。
