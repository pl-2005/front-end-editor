# Step11 发布、回滚与验收操作

本说明适用于完整 V2，单 Spring API、单 Hocuspocus 网关和受信初始化服务。所有 V2 制品从启动起强制 Bearer 认证。生产入口切换是部署操作，不是数据库状态迁移。不能回滚至 V1 匿名服务。

## 制品与兼容矩阵

| 组件 | 当前约定 | 发布/回滚要求 |
| --- | --- | --- |
| 前端 | V2 登录壳、团队路由、Monaco/Yjs/Sandpack | 与 API/网关作为一组部署，静态资源使用不可变发布目录 |
| Spring API | Java 21、Spring Boot 3.5.6、JWT Bearer | 无认证关闭选项，实时按团队成员授权，旧项目/快照 API 拒绝 |
| Flyway | V1–V13，JPA validate | 校验已执行迁移 checksum；只追加迁移，不能降级 schema 或修改旧迁移 |
| JWT | HS256，issuer/audience/sub/token_version；授权实时读取数据库 authz_version | 密钥独立，保留 issuer/audience/TTL 策略；恢复环境轮换密钥 |
| Redis 刷新 | opaque 凭据摘要、轮换 family、空闲和最大期限 | 正常制品回滚保留格式与 namespace；数据库恢复时隔离 namespace、重新登录 |
| 协作网关 | Hocuspocus 4.7.0、Yjs 13.6.27、Node >=24、单实例 | `/collaboration` 精确 WS 路径，Origin 精确白名单，票据单用 |
| 内部 HMAC | 六行签名、独立 audience、30 秒时差、持久 nonce | storage/gateway/initializer/maintenance 密钥独立；持久 nonce/fence 文件在发布目录外 |
| MinIO | 私有 bucket，Y.Doc schemaVersion=1 | 指针的 projectId/epoch/generation/hash/size 与对象一致；不使用 V1 revision |
| feature flag | creation/ticket/gateway 默认 false，maintenance 默认 false | 仅受控验证及发布时开放三项公共开关；维护时全关，认证始终开启 |

确切依赖版本以 lockfile 为准。`release.json` 记录迁移 checksum、协作依赖及所有制品文件 SHA-256；不保存密钥、`.env`、数据库或源码对象。manifest 的兼容声明只是审核依据，必须结合目标数据库和受控功能验收，不能据此自动批准任意旧制品。

## 构建与打包

在仓库根运行，构建输出与备份不提交 Git：

本机 Windows 推荐 `./collaboration/scripts/build-step11.ps1`，逐项检查退出码，把前端及 TypeScript 缓存输出到 `.codex-build`，避免改写已有 node_modules 缓存目录。该脚本执行以下等价检查并生成新的不可变发布目录；任一步失败即停止。

```powershell
Push-Location backend
mvn -o package "-Deditor.build.directory=E:/labStudy/DEMOS/front-end-editor/.codex-build/step11-backend"
Pop-Location
Push-Location frontend
npm test
npm run lint
npm run build
Pop-Location
Push-Location collaboration
npm test
node scripts/release.mjs pack ../.codex-build/release-YYYYMMDD-ID
node scripts/release.mjs verify ../.codex-build/release-YYYYMMDD-ID
Pop-Location
```

发布目录必须不存在。`verify` 检查文件集合和 hash，拒绝缺失、增加或修改文件。转移制品时使用可信传输和独立保存的 manifest 摘要；hash 不能代替发布者身份验证。在目标环境的 `collaboration` 目录使用 `npm ci --omit=dev` 安装 lockfile 固定的依赖，再根据原始 manifest 校验制品（安装新增的 node_modules 应在制品校验后，或使用独立依赖目录）。

## 发布前数据与备份

1. 限制外部入口，停止旧写请求与新协作握手，通知已有连接结束编辑。网关正常 stop 必须成功 flush；pending 未清空时保持停写，不能强制退出以掩盖失败。
2. 停止旧 API/网关，确认没有其他写实例。按 Step09 解决 PREPARED 删除、按 Step10 解决 PREPARED/FAILED 恢复，不能手改状态、对象或指针。
3. 校验已有 Flyway history 和待执行迁移，使用新 API 在受控 loopback 运行全部增量迁移。V2 现有最新迁移为 V13，Step11 不新增认证切换或 revision 迁移。迁移前保留配套数据库和对象备份；旧环境无法使用 V2 备份工具时由运维在停写状态导出数据库和私有对象，不能只备份其中一个。
4. 按 [Step10 运维说明](./step10-operations.md) 进入维护模式并执行联合备份。备份分页覆盖全部当前指针，包括软删除保留对象，验证 hash/size/schema 后导出 SQL，再复核指针稳定，生成 manifest。缺对象、损坏或未解决 operation 均阻止发布。
5. 数据核查应同时确认：ACTIVE V2 项目都有 team_id 和唯一可加载 collab_document；INITIALIZING 不对用户显示；旧匿名项目仍隔离；V2 current_version=0/current_object_key=NULL，无新增 project_revision。不能为旧匿名项目猜测归属。

## 同源路由与进程配置

使用 [nginx 模板](../../deploy/nginx-v2.conf)：HTTPS 页面、`/api/` 和精确 `/collaboration` 同源；`/internal`、`/internal/`、点文件和旧 `/collab` 均阻断。网关、Spring、初始化服务监听 loopback，内部端口不穿透防火墙。替换域名、TLS 文件和不可变 release root 后执行 `nginx -t`；目标 nginx 配置检查失败不得 reload。模板关闭访问日志，不能另行启用含 Authorization、query、正文的日志。

根 `.env` 按受限权限配置，不能复制到静态目录或发布包。Spring 不自动导入 dotenv；由受限进程管理器把配置注入环境，再启动 `java -jar RELEASE/backend/backend.jar --server.address=127.0.0.1 --server.port=8080`。初始化/网关脚本从各自 release 的两级父目录读取 `.env`，部署时由运维将受限外置配置链接到 release 根目录的 `.env`，绝不放到 frontend/dist，也不把链接纳入发布包。源码/本机验收始终使用仓库根 `.env`。

配置 Spring 的 initializer URL=loopback:8091/internal/initialize、gateway internal URL=loopback:8092；网关 Spring URL=loopback:8080；Origin 为实际 HTTPS 域名（不得 `*`）。所有 HMAC 密钥至少 32 字节且互异，maintenance secret 独立；nonce 路径为跨升级保留的绝对路径，不能落在临时发布目录。启动初始化服务、API、网关，受控环境设置 creation/ticket/gateway=true、maintenance=false。仅停止功能入口的开关不代表全局只读：已有连接需 drain/flush 并停止网关；所有 REST 写入需由边界路由阻断或按 Step10 启用维护模式。

## 受控验收与原子切换

使用构建后的前端、实际 API 和单网关完成 Step11 七项流程。可重复本机验收：

```powershell
Push-Location collaboration
node scripts/verify-step11-local.mjs --browser
Pop-Location
```

脚本读取根 `.env`，连接本机 MySQL/MinIO/Redis，使用临时 loopback 端口 18098/18099/18100/15175 和内存临时 HMAC 密钥。Redis 使用每次验收独立的 namespace，保留真实刷新与限流规则，避免重跑污染正常用户的限流计数。默认前端目录 `.codex-build/step11-frontend`（由推荐构建脚本生成）；可通过 `STEP11_FRONTEND_DIR` 指定 `frontend/dist`。本机代理验证实际静态制品的同源路由，不能代替目标 nginx 的 `nginx -t` 和 TLS 验证。仅 `--browser` 使用 web-access CDP proxy，不操作用户已有标签页；结束关闭自己的进程和标签页。生成受限本机验收结果、联合备份和发布包，不打印账号密码/凭据。邀请过期仅修改本次新建邀请的过期时间；HTML/CSS/JS 补全、诊断和 checkJs 使用真实生产 worker 检查；CAS 冲突由已有协作测试覆盖，不要求双浏览器自动化或压测。

受控验证通过后，把同一个 nginx server 配置的静态 root、API 和 WS 上游作为一个配置变更审核并 reload；不得分别切换三个入口。API/网关仍保持仅 loopback 监听，外部访问由新边界统一开放。检查 HTTPS 首页及 SPA 深链接、匿名 REST 拒绝、有效登录及协作、内部路径拒绝和 Origin 拒绝。记录发布 ID、manifest 摘要、迁移水位、备份 ID、验收结果、时间、操作者及外部路由状态。生产目标未提供时只能记录本机验收完成，不能声称已切换生产。

## 回滚和故障降级

回滚候选必须同时满足：强制 Bearer 认证、兼容所有已执行迁移和现存 Y.Doc、刷新/HMAC 协议兼容、旧匿名项目不可见、V1 快照/历史 API 拒绝。完成候选制品 hash 检查和受控功能验收后才能回滚，不把旧 V1 制品列为候选。首个 V2 发布没有历史合格候选时，明确记录“无合格回滚版本”；保持外部停写并修复制品。

回滚顺序：关闭外部写请求/票据/新握手 → flush/drain 旧网关 → 停止旧进程 → 受控启动合格候选（数据库迁移不降级，nonce/fence 保留） → 核对当前对象指针和认证/旧 API 隔离 → 同一配置原子切换静态/API/WS → 恢复入口。不能清理 fence 或更改 epoch 来让旧客户端接入。

协作故障时关闭握手和票据，阻断 REST 写路由，成功 flush 后停网关，使项目只读。公共开关不能当作取消认证或解决 pending 的手段。对象指针对账完成后才恢复写入。必须恢复数据库时使用 Step10 的匹配数据库/对象备份，隔离旧环境和 Redis namespace、轮换 JWT、重建当前内容至新 epoch/generation=1；此过程与制品回滚不同。

## 交付监控

受控 HMAC 采集 Spring/网关指标，监控当前 pointer/hash/generation、pending/durable、paused/fenced、房间/连接、persist failure 和 Outbox lag。Outbox 超过 5 秒、pending 超过 5 秒未持久化、Redis 不可用、恢复失败应调查。按 projectId/epoch/generation/requestId 定位；孤儿清理与密钥轮换按 Step10 操作，不能手改对象或指针。记录实际生产部署与本机验收的独立状态。

## 本机运行

本次交付按用户要求只运行本机，不做公网发布。构建和验收完成后，在 `collaboration` 执行 `npm run start:local`，打开 `http://127.0.0.1:15175`。后端/网关/初始化分别监听 loopback 18098/18099/18100，前端为实际构建静态文件，同源转发 `/api/` 与 `/collaboration`，阻断内部路径。

启动器读取仓库根 `.env` 的本机 MySQL/MinIO/Redis、JWT 和 HMAC 配置，仅本次进程开启创建/票据/网关并关闭维护模式；不改写 `.env` 或默认关闭策略。初始化服务只收到 initializer 密钥，网关只收到 storage/gateway 密钥。nonce/fence 保存在 `.codex-build/local-*-nonces.sqlite` 并跨重启保留。正常 Ctrl+C 停止时先 flush 网关，失败则保持依赖进程并重试；成功后关闭本机入口和自己启动的子进程。不要在运行期间同时执行本机验收（两者使用同一组端口）。备份、验收账号/项目保留本机；用户可自行注册使用，不在文档中保存账号凭据。
