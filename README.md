# ProjectSync — M0 开发文档包

> 版本：1.0.0  
> 日期：2026-11-04  
> 目标：交给 Cursor / Claude Code / Codex 等 AI 编码代理，按阶段实施 Windows M0。

## 已确认产品决策

| 项目 | 决策 |
|---|---|
| 产品 | ProjectSync |
| 首发平台 | Windows 10/11 x64 |
| 桌面框架 | Tauri 2 |
| 前端 | React + TypeScript + Vite |
| 核心引擎 | Rust + Tokio |
| 本地状态库 | SQLite + SQLx |
| 文件摘要 | BLAKE3 |
| 文件监听 | notify |
| 远程协议 | WebDAV over HTTP(S) |
| 服务端 | 用户已有 `hacdias/webdav:latest` |
| 同步范围 | 每个项目独立配置 INCLUDE / EXCLUDE |
| 同步模式 | 双向同步 |
| 冲突策略 | KEEP_BOTH，禁止静默覆盖 |
| 服务端改造 | 不要求 ProjectSync 自建服务端 |

## 文档目录

| 文件 | 内容 |
|---|---|
| `docs/01_PRD.md` | 产品需求、用户场景、功能范围、非目标 |
| `docs/02_ARCHITECTURE.md` | 技术架构、模块边界、工程结构、运行模型 |
| `docs/03_SYNC_ALGORITHM.md` | 三方比较、同步矩阵、状态机、并发和删除保护 |
| `docs/04_DATABASE.md` | SQLite 数据模型、完整 DDL、迁移约束 |
| `docs/05_API_CONTRACTS.md` | Rust 模块接口、Tauri Commands、Events、TS DTO |
| `docs/06_UI_SPEC.md` | 页面结构、交互流程、状态展示 |
| `docs/07_HACDIAS_WEBDAV_PROFILE.md` | 针对 hacdias/webdav 的兼容性、配置和测试 |
| `docs/08_SECURITY_ERRORS_OPERATIONS.md` | 安全要求、错误码、日志、备份恢复 |
| `docs/09_TEST_PLAN.md` | 单元、集成、故障注入、双设备验收 |
| `docs/10_M0_SPRINTS_TASKS.md` | Sprint、任务拆分、验收标准 |
| `docs/11_AGENT_RULES.md` | 项目级 AI 编码规则 |
| `docs/12_AGENT_PROMPTS.md` | 总控提示词和分阶段提示词 |
| `docs/13_ADR.md` | 关键架构决策记录 |
| `sql/0001_initial.sql` | M0 初始数据库迁移 |
| `config/project.example.toml` | 项目同步配置示例 |
| `config/hacdias-webdav.example.yml` | hacdias/webdav 服务端配置参考 |
| `tests/M0_ACCEPTANCE.csv` | 可导入任务管理工具的验收清单 |

## 给 AI Agent 的启动顺序

1. 先完整阅读本 README 和 `docs/01` 至 `docs/13`。
2. 检查仓库当前状态；如果是空目录，先实施 Sprint 0。
3. 不允许一次性生成整个产品。
4. 每个 Sprint 完成后运行测试、更新文档并提交变更报告。
5. 同步安全规则优先于进度和性能。
6. 在实际连接 `hacdias/webdav:latest` 后执行 `docs/07` 的兼容性探测。不得凭 README 推断 ETag / If-Match / LOCK 的具体行为。

## 核心安全红线

- 不允许静默覆盖内容不同的文件。
- 不完整的本地或远程扫描不能推断删除。
- 不允许在上传/下载尚未验证成功时更新 Base。
- 远程替换和删除必须有已验证的并发保护能力；否则进入 `BLOCKED` / 人工处理。
- 任务先落 SQLite，再执行网络操作。
- 下载先写临时文件、校验后再替换。
- 密码不得写入 SQLite、日志或配置文件。
- `latest` 是可变标签；测试环境记录镜像 digest，稳定部署建议固定版本或 digest。

## 参考资料

- 官方仓库 README：<https://github.com/hacdias/webdav>
- 官方 Docker Hub 镜像：<https://hub.docker.com/r/hacdias/webdav>
- WebDAV v5 Go module：<https://pkg.go.dev/github.com/hacdias/webdav/v5>

本设计以官方仓库 README 当前公开说明为服务端能力基线；真正的兼容等级必须由 ProjectSync 对用户正在运行的 NAS 实例做运行时探测。
