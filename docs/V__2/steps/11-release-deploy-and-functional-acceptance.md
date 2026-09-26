# 步骤 11：发布、部署、回滚与功能验收

> 前置：步骤 01–10 的功能要求已完成。  
> 目标：在步骤 04 已完成身份与团队 ACL 联合切换的基础上，发布协作网关、编辑器和运维门禁，并以 V9 后 fail-closed 的方式回滚。

## 1. 版本与制品

发布矩阵固定记录：Spring API、Flyway V3–V12、JWT 签名算法/`kid`/公私钥兼容窗口、Redis 刷新凭据命名空间/格式、前端静态制品、协作网关、配置/密钥 keyId、feature flags、MinIO schema。每个制品标明支持的 DB schema 和最小/最大网关协议版本。

发布验收以功能流程可用为准；不要求本机 MySQL/MinIO/Redis 专用集成验证、Playwright 双浏览器 E2E、压测或故障演练报告。运行应用时使用根 `.env` 配置的本机服务，不使用 Docker，凭据不进日志或制品。

## 2. 发布前检查

- V6–V8 报告和步骤 04 的 V9 cutover 已确认，V10 回填、V11 ticket/nonce、V12 operation/outbox 均已校验；
- 所有非旧匿名活动项目 team/creator/revision/pointer/object/collab_document 完整，旧匿名项目保持隔离；
- 首期单网关实例、内部双向 HMAC current/next、Origin allowlist、JWT 验签密钥、MinIO/MySQL/Redis 连接和 readiness 通过；刷新凭据轮换与 Redis TTL 已核验；
- 开放注册、登录、团队创建、申请加入审批和邀请加入冒烟通过，旧匿名项目对新用户不可见；
- 发布前完成 MySQL/MinIO 备份并确认恢复步骤可用；
- 回滚制品认识 V3–V12、兼容当前 JWT 签名密钥/`kid` 与 Redis 刷新凭据格式，且 V9 后强制认证；维护页和 drain 工具可用；
- 变更审批、负责人、窗口、通知和发布 requestId 已登记。

## 3. 分阶段执行

1. 入口切维护页，停止新流量，等待 in-flight 请求和写入 drain；
2. 停止当前 API、网关、定时任务和后台 worker，核对进程清单；
3. 备份 MySQL/MinIO并校验；
4. 确认 V9 cutover 已提交且认证仍强制开启，部署兼容 V3–V12 的新 API，按 Flyway target/版本门禁执行尚未部署的迁移；
5. 启动新网关（协作仍按项目白名单），验证 internal 路由不公网暴露；
6. 部署未公开的前端静态制品；
7. 按第 5 节完成身份、团队、权限和协作功能检查；
8. 检查 pointer/hash、generation、Outbox、Redis 刷新凭据轮换/重放与 JWT 401 指标；
9. 原子切换入口到新前端+API+网关，逐步扩大项目白名单；
10. 观察错误、Outbox lag、房间/队列和对象增长，出现功能异常或数据不一致时停止扩大。

## 4. 回滚与中止

步骤 11 已处于 V9 后：失败时不得关闭认证、不得恢复匿名或旧前端；只能切换到认识 V3–V12 的强制认证兼容制品，协作项目保持只读/关闭并由 operation/outbox/DR runbook 收敛。Flyway 不删除已执行版本；迁移失败时按实际 schema/history 对账，再使用兼容制品和受控 repair。

中止条件：新项目完整性报告非零、旧匿名项目隔离失败、readiness 503、注册/登录/邀请失败、任何未授权/匿名成功、CAS/epoch 错误增长、旧实例仍写、对象/hash 不一致、功能验收失败或秘密泄露。中止动作写发布变更记录并保留 requestId/operationId。

## 5. 最终功能验收

按功能流程检查以下能力；可在应用界面及必要的 API 调用中完成，不要求双浏览器自动化或独占测试资源：

1. 用户 A 自助注册并显式登录，创建团队一成为 OWNER；
2. 用户 B 自助注册并显式登录，验证访问 JWT Bearer、刷新凭据轮换、无认证 Cookie，整页刷新后重新登录；向团队一申请加入，由 OWNER 审批，审批前无法访问项目；用户 A 再创建团队二并发出 fragment 邀请，用户 B 接受邀请，分别验证两条加入路径；
3. OWNER 创建项目，确认 revision1、team/project capability；
4. Editor 完成文本、重命名和文件树编辑，确认 Presence 与 Sandpack preview 正常；Viewer 只读；
5. Viewer 的 update、checkpoint、成员修改均被服务端拒绝；
6. Editor 离线编辑、整页刷新后重新登录、Yjs 本地更新恢复、重连和重复 update；
7. OWNER 创建 checkpoint，确认 revision 和 durable generation 正确推进；
8. restore 同 hash 仍产生新 revision/epoch，旧房只读并重新 bootstrap；
9. 删除关闭连接、保留历史；撤权关闭用户连接并使旧 ticket 失败；
10. 恢复操作后确认 epoch bump，不会让旧 IndexedDB queue 回写。

功能检查使用的账号和项目按正常业务流程管理；不创建或清理专用测试 schema/Bucket/Redis 命名空间。

## 6. 上线验收

第 5 节功能流程及旧匿名项目隔离、权限拒绝、数据指针一致性均通过，即完成 V2 功能验收。记录验收结果与已知限制；安全扫描、E2E 视频、性能 SLO、故障/DR 报告和回滚演练不作为完成条件。

## 7. 交付后

开启周期巡检、Outbox/孤儿/指针报告、依赖和密钥轮换；每次 schema/网关协议/前端编辑器变更都确认兼容矩阵和关键功能流程。生产问题按 operation/epoch/generation/requestId 关联定位，禁止直接手工改对象或数据库指针。
