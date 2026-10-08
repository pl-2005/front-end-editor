# 步骤 10：安全、可观测性与当前文件恢复

> 文档定位：已完成步骤的设计与实施记录。阶段限制和测试数量按当时情况保留；最终行为见 [V2 交付索引](../README.md)、[开发指南](../development.md)和 [API](../api.md)。

> 前置：步骤 09 的删除 fence 与撤权链路。状态：已实现并完成自动检查及本机功能验收（2026-10-06）。

## 实现记录

追加 V13 `collab_recovery`，建立独立 HMAC/audience 的运维权限过滤器、关闭公共写开关的维护模式，以及可跨重启对账的 PREPARED/FAILED/COMMITTED 恢复。校验当前对象后由受信编码服务重建同项目的新 epoch/generation=1；新对象上传回读验证后，与 COMMITTED 同事务切换指针。幂等重试返回原回执；缺对象、损坏及上传/数据库错误保留原指针和持续项目 fence。清理保护恢复源/目标对象和有效备份，备份保留期不可因重复登记缩短。

Spring/网关提供有界、脱敏的受控指标，包括认证/授权/票据、握手、房间/连接、Update 拒绝、pending/durable/generation、CAS、persist、Outbox lag、清理、恢复和 Redis 可用性。容量参数校验、可配置 pending 硬上限及未认证队列限制已接入。错误日志移除异常消息/堆栈，只记录稳定码和 requestId；内部响应错误码经过格式白名单。预览 iframe 使用 sandbox 和 no-referrer，维护/项目 fence 时前端暂停编辑并保留缓存。

新增命令行联合备份/当前文件恢复工具，使用根 `.env` 和本机 mysqldump；验证并导出当前 Y.Doc 对象、登记保护引用后导出 MySQL，最后生成含 hash/size 的完成 manifest。包括软删除最后对象但不恢复已删除项目。具体配置、指标、告警建议、恢复前停写、刷新命名空间/JWT 密钥轮换及失败对账见 [Step10 运维说明](../step10-operations.md)。不自动导入 SQL、不进行在线多实例维护，不增加用户历史版本 API。

验证：后端 59 项测试及打包、协作模块 25 项测试及 TypeScript 构建、前端 82 项测试/lint/类型检查/生产构建通过。新增覆盖恢复幂等、源对象损坏、上传和事务失败、持续 fence/旧 epoch 拒绝、运维独立 HMAC 和 nonce 重放、日志秘密保护、指标权限与持久化水位、维护暂停及动态 iframe 隔离；命令行拒绝远程地址、敏感错误、缺项目 manifest 并支持提交后重试。本机根 `.env` 的 MySQL/MinIO/Redis 流程及真实浏览器预览通过，无签名 MinIO 对象读取返回 403；V13 已执行。最终联合备份导出 46 个当前引用对象和 MySQL dump，并通过 dump 后指针/操作复核，临时进程及验收标签页均已关闭，验收账号/项目/备份保留本机 `.codex-build`。生产协作开关未打开，下一步为 Step11。

## 安全边界

复核 JWT Bearer 签名与声明、Redis 刷新凭据轮换、成员关系实时授权、WebSocket Origin、短期票据单用和内部双向 HMAC。项目文件、Yjs binary、密码、JWT、刷新凭据、票据和 MinIO 凭据不得进入日志。预览 iframe 与父页面凭据隔离；文件路径、大小、Y.Doc schema 和 Update 在网关广播前校验。MinIO 私有对象按当前指针读取，损坏或超限时安全失败。

没有项目版本列表、revision 写入、历史恢复、checkpoint 或版本比较 API；V1 历史对象保留但不向 V2 用户暴露。安全检查覆盖旧匿名项目与旧 API 旁路、跨团队读取、恶意 Update、旧 epoch 重放、撤权后旧票据及跨用户 IndexedDB。

## 指标与容量

至少记录脱敏的认证失败、成员授权拒绝、票据/握手、房间数与连接数、Update 拒绝、pending/durable 差距、当前 generation、CAS 冲突、persist 延迟/失败、Outbox lag、对象清理和 Redis 可用性。界面状态与这些指标一致，不能把“WebSocket 已同步”误称为“文件已持久化”。

为房间、连接、Update 速率、单文件、文档大小、pending 队列、网关内存和对象保留期设置硬上限。超限时拒绝或暂停写入，不无界排队。首期单网关容量为设计前提；扩展到多网关前另行设计房间路由和跨实例同步。

## 当前文件故障恢复

MySQL 与 MinIO 备份必须一起覆盖当前 `collab_document` 指针及其 Y.Doc 对象。恢复时关闭票据和写入口，校验每个活动项目当前对象的 hash/size；用受信 Y.Doc 编码模块将**当前内容**重建到新 epoch 的 generation 1 对象，验证上传后再原子切换 `collab_document` 指针。这样旧票据、旧房间和旧本地队列不能进入新 epoch，网关也能从新对象加载。旧对象按备份窗口保留，不能仅修改 epoch 数值而让指针仍指向旧 epoch 对象。缺对象项目进入维护状态，不用 V1 revision 自动回退，也不假装存在用户可选历史版本。

Redis 刷新凭据丢失时要求重新登录；切换恢复环境应隔离旧刷新命名空间并轮换 JWT 密钥，防止旧凭据与回退的数据库状态混用。孤儿清理只删除确认无当前指针、无上传或操作租约、且不受有效备份引用的 `collab/` 对象；旧 `projects/` 数据按旧保留规则处理。

## 功能验收

确认故障时 pending 不静默丢弃、网关重启从当前指针恢复、MinIO/MySQL 错误不覆盖有效对象、对象清理不碰当前文件、撤权与删除关房生效、日志不泄露秘密。按功能流程检查即可；开发检查和故障演练可按需进行，不作为 V2 完成门禁。运行应用使用根 `.env` 的本机服务，禁止 Docker。

后续更新（2026-10-08）：本文保留步骤完成时的历史行为。浏览器 Cookie 会话恢复改造及实际验收见 [会话方案](../../auth-session/README.md) 和 [验收记录](../../auth-session/verification.md)。
