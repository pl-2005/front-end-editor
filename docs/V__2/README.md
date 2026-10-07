# V2 交付与文档索引

整理日期：2026-10-07。V2 步骤 01–11 已开发完成，既有自动检查和本机功能验收记录保留在各步骤中。当前仅本机运行，完整入口为 `http://127.0.0.1:15175`；公网入口切换、目标 nginx/TLS 验证与历史候选回滚未执行。开发完成不代表已部署生产。

V2 提供身份、团队成员授权、Yjs 多人编辑与当前文件自动持久化。所有有效团队成员对项目同权，OWNER 仅管理成员。V2 不提供用户版本列表、检查点、历史恢复、版本比较或回退；旧 V1 数据保留且隔离。

## 当前版本文档

| 文档 | 用途 |
| --- | --- |
| [整体方案](00-overall-plan.md) | 范围、业务决策、设计基线与实施依赖 |
| [架构](architecture.md) | 当前模块、数据归属、迁移和安全边界 |
| [数据流](data-flow.md) | 初始化、连接、编辑、自动保存、离线、删除与恢复 |
| [REST API](api.md) | 当前身份、团队、项目、票据与错误约定 |
| [开发指南](development.md) | 根 .env 配置、分进程开发、构建、检查和验收 |
| [协作模块](../../collaboration/README.md) | Y.Doc、网关、内部 HMAC 与阶段验收命令 |
| [运维说明](step10-operations.md) | 指标、停写、对象清理、联合备份和当前文件恢复 |
| [发布说明](step11-release.md) | 制品、兼容矩阵、发布/回滚与完整本机运行 |

项目快速入口见 [根 README](../../README.md)，跨版本导航见 [全部文档](../README.md)，旧版资料见 [V1 历史索引](../V__1/README.md)。

## 已完成步骤

以下是交付状态，不再作为待执行开发清单。各文档保留当时前置依赖与检查数量，最终行为以本目录专题说明和步骤 11 为准。

| 步骤 | 状态 | 交付与记录 |
| --- | --- | --- |
| 01 | 已完成 | [并发、旧存储护栏](steps/01-baseline-guardrails.md)：锁版本、固定锁顺序、对象隔离 |
| 02 | 已完成 | [身份与 JWT](steps/02-identity-jwt.md)：注册、登录、刷新、改密与撤销水位 |
| 03 | 已完成 | [团队与授权](steps/03-team-invite-project-acl.md)：申请、邀请、成员管理、旧匿名项目隔离 |
| 04 | 已完成 | [身份与团队 UI](steps/04-frontend-auth-team-permission-shell.md)：登录壳、团队和项目路由 |
| 05 | 已完成 | [Y.Doc 存储基础](steps/05-collaboration-state-storage-foundation.md)：原子初始化、复制、当前指针与 CAS |
| 06 | 已完成 | [网关与票据](steps/06-collaboration-gateway-and-ticket.md)：握手、同步、校验与自动持久化 |
| 07 | 已完成 | [编辑与预览桥](steps/07-yjs-monaco-sandpack-bridge.md)：Monaco、语言服务、Yjs、Sandpack |
| 08 | 已完成 | [离线与 Presence](steps/08-offline-presence-and-structure-ops.md)：有界日志、重连、光标和结构冲突 |
| 09 | 已完成 | [删除与撤权](steps/09-persistence-delete-revocation.md)：durable fence、Outbox 和故障对账 |
| 10 | 已完成 | [安全与恢复](steps/10-security-observability-performance-recovery.md)：指标、清理、联合备份和新 epoch 恢复 |
| 11 | 已完成 | [发布与最终验收](steps/11-release-deploy-and-functional-acceptance.md)：同源入口、制品校验、回滚约束和本机启动 |

## 验收与运行状态

既有 Step11 交付记录：后端 59、协作模块 25、前端 82 项测试，以及 lint、类型检查和构建通过；本机验证身份/团队、双用户协作、生产语言 worker、预览、离线刷新合并、撤权、软删除、联合备份和制品重启。详见 [步骤 11](steps/11-release-deploy-and-functional-acceptance.md)。本次文档整理核对代码、命令和链接，未重新执行应用验收。

完整本机启动先构建，再在 collaboration 执行 `npm run start:local`。启动器读取仓库根 `.env`，连接本机 MySQL、MinIO、Redis；不使用 Docker，不改根配置，只在子进程内开启协作，默认生产开关仍关闭。启动器和 Step11 验收不能同时运行。备份、验收结果、账号/项目及截图保留本机，不提交凭据或备份。

## 实施约束与后续维护

实施时按步骤依赖先完成对应功能检查，不逐步公开不完整 V2。当前所有依赖已交付；后续变更继续遵守强制认证、成员实时授权、失败时拒绝写入和迁移只追加规则。回滚候选须兼容全部迁移、当前 Y.Doc 和内部协议，且不能重新开放匿名项目、V1 快照或历史 API。首次 V2 没有历史合格回滚版本时保持停写并修复制品。

功能验收运行应用时使用根 `.env` 的本机服务，禁止 Docker 与秘密输出。专用三服务集成环境、双浏览器自动化和压测报告不作为既定完成门禁。

数据库迁移水位：V3 锁版本 → V4/V5 身份水位 → V6/V7 团队归属 → V8/V9 站内邀请 → V10 当前文档、幂等回执和对象保护 → V11 票据与 nonce → V12 删除/维护 operation 与 Outbox → V13 当前内容恢复。步骤 11 无新增认证切换或 revision 迁移；后续不改写已发布脚本。
