# 步骤 11：发布、部署、回滚与最终 E2E

> 前置：步骤 01–10 全部 PASS，安全/性能/DR 报告齐全。  
> 目标：把身份、团队 ACL、协作网关、编辑器和运营门禁以可回滚（V9 后 fail-closed）的方式上线。

## 1. 版本与制品

发布矩阵固定记录：Spring API、Flyway V3–V12、前端静态制品、协作网关、配置/密钥 keyId、feature flags、MinIO schema。每个制品标明支持的 DB schema 和最小/最大网关协议版本。

CI 必须通过后端单元/真实 MySQL+MinIO 集成、前端 lint/test/build/Playwright、网关 typecheck/test、SCA/SBOM、migration dry-run、压测 smoke、故障/DR smoke。禁止 Docker；根 .env 只由安全脚本注入，凭据不进日志/制品。

## 2. 发布前检查

- V6–V8 报告、V9 cutover 条件、V10 回填、V11 ticket/nonce、V12 operation/outbox 均已校验；
- 所有活动项目 team/creator/revision/pointer/object/collab_document 完整；
- 至少两个网关实例、内部双向 HMAC current/next、Origin allowlist、MinIO/MySQL 连接和 readiness 通过；
- bootstrap 管理员可登录，注册模式 INVITE_ONLY，旧匿名端点不存在；
- 备份成功且恢复演练/DR epoch bump 报告通过；
- 回滚制品认识 V3–V12 且 V9 后强制认证，维护页和 drain 工具可用；
- 变更审批、负责人、窗口、通知和审计 requestId 已登记。

## 3. 分阶段执行

1. 入口切维护页，停止新流量，等待 in-flight 请求和写入 drain；
2. 停止旧 API、旧网关、定时任务和后台 worker，核对进程清单；
3. 备份 MySQL/MinIO并校验；
4. 部署新 API，以 Flyway target/版本门禁按顺序执行；V9 只在步骤04 UI制品可用时执行；
5. 启动新网关（协作仍按项目白名单），验证 internal 路由不公网暴露；
6. 部署未公开的前端静态制品；
7. 先以管理员和双浏览器 context 做内部冒烟：登录、建团队、邀请、项目 revision1、EDITOR/VIEWER、协作、checkpoint、restore、撤权；
8. 检查 pointer/hash、generation、audit、Outbox 和指标；
9. 原子切换入口到新前端+API+网关，逐步扩大项目白名单；
10. 观察 SLO、错误、Outbox lag、房间/队列和对象增长，达到窗口阈值立即停止扩大。

## 4. 回滚与中止

V9 前失败：保持维护页，停止新制品，修复或回退 V6–V8/应用迁移；Flyway 不删除已执行版本，使用兼容制品和受控 repair。V9 后失败：不得关闭认证、不得恢复匿名或旧前端；只能切换到认识 V3–V12 的强制认证兼容制品，协作项目保持只读/关闭并由 operation/outbox/DR runbook 收敛。

中止条件：迁移报告非零、readiness 503、管理员/邀请失败、任何未授权/匿名成功、CAS/epoch 错误增长、旧实例仍写、对象/hash不一致、E2E失败、P95超过阈值或秘密泄露。中止动作写审计并保留 requestId/operationId。

## 5. 最终双用户 E2E

使用独立 E2E schema/Bucket、随机 runId 和两个 browser context：

1. bootstrap 管理员登录并创建团队/邀请；
2. 新用户通过 fragment 注册，显式登录并接受邀请；
3. OWNER 创建项目，确认 revision1、team/project capability；
4. Editor 与 Viewer 同房：文本、重命名、文件树、Presence、Sandpack preview；
5. Viewer 的 update、checkpoint、成员修改均被服务端拒绝；
6. Editor 离线编辑、刷新恢复、重连和重复 update；
7. OWNER checkpoint，另一连接观察 durable generation；
8. restore 同 hash 仍产生新 revision/epoch，旧房只读并重新 bootstrap；
9. 删除关闭连接、保留历史；撤权关闭用户连接并使旧 ticket 失败；
10. 恢复 E2E 失败时验证 epoch bump 后旧 IndexedDB queue 不回写。

测试完成停止进程，仅删除精确 runId schema/Bucket；Maven IT 资源独立保留。缺隔离配置、目标疑似开发库或 Docker 迹象立即 fail fast。

## 6. 上线验收

验收签字必须包含：安全扫描、迁移报告、E2E 视频/日志（脱敏）、性能 SLO、故障/DR 报告、备份校验、回滚演练、审计与对象一致性报告、值班人与 runbook 链接。任何一项缺失都不宣布完成。

## 7. 交付后

开启周期巡检、Outbox/孤儿/指针报告、依赖和密钥轮换；每次 schema/网关协议/前端编辑器变更都重新执行兼容矩阵和关键双用户 E2E。生产问题按 operation/epoch/generation/requestId 关联定位，禁止直接手工改对象或数据库指针。
