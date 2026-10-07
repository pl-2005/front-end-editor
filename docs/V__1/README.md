# V1 历史资料

本目录归档单人编辑器的设计与实现记录。V1 使用 Sandpack 编辑、JSON/GZIP 快照、revision 历史和按项目保存的 IndexedDB 草稿；这些说明不代表当前 V2 功能或部署方式。

| 文档 | 历史主题 |
| --- | --- |
| [开发方案](development-plan.md) | V1 范围和实施里程碑 |
| [架构](架构v-1.md) | V1 模块与存储设计 |
| [数据流](data-flow.md) | 快照保存、草稿与版本恢复 |
| [API](api.md) | 旧项目、snapshot 和 revision 接口 |
| [部署](deployment.md) | V1 环境与发布记录 |

当前版本请从 [V2 索引](../V__2/README.md)开始。V2 保留旧表和对象以兼容迁移，隔离旧匿名项目，关闭旧快照写入和历史接口；认证不能通过配置或回滚关闭。当前本地运行使用根 `.env` 与本机 MySQL、MinIO、Redis，不使用 Docker。
