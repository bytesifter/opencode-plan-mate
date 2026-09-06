## Context

当前项目文档结构不符合 AGENTS-docs.md 规范（见 proposal.md 动机）：README 内联全部明细、无 `docs/` 目录、根 `AGENTS.md` 缺失。现有内容（轮询规则、配置表、工具用法、套餐配额统计、日志示例、开发说明）均已写好，本 change 只做**结构重组**与**内容迁移**，不新增技术内容（plan_stats 技术方案的决策摘要来自既有 openspec change 的 design.md）。

## Goals / Non-Goals

**Goals:**
- README 瘦身为入口文档（简介/特性/快速开始/安装链接）
- 按规范建 `docs/getting-started/` + `docs/user-guide/` + `docs/technical/plan-stats/`
- 补根 `AGENTS.md` 指针式文档
- 文档内容与已实现代码/配置完全一致

**Non-Goals:**
- 不新增/删除插件功能
- 不改 `articles/opencode-plugin-dev-guide.md`（宣传文章保留）
- 不改变 openspec change 已归档内容
- 不做文档美化（非规范要求）

## Decisions

### D1: README 入口化，明细下沉 docs/

README 只保留：标题/简介/特性（每项链接对应 docs 明细）/快速开始（3 步）/安装链接/工具速查（两个工具一句话 + 链接）/文档导航/贡献/许可证。原「配置」「配置示例」「工具用法」「套餐配额统计」「日志示例」章节分别迁入 docs/ 对应文件。

### D2: docs/ 三层职责

| 文件 | 职责 | 内容来源 |
|---|---|---|
| `docs/getting-started/installation.md` | 安装 + 完整配置表 + 轮询规则 | README「安装/配置/配置示例/规则」 |
| `docs/user-guide/round-robin.md` | 轮询机制 + roundrobin_stats + 日志 | README「工具用法/日志示例」+ 功能项 |
| `docs/user-guide/plan-stats.md` | 套餐配额 + SSO setup + FAQ | README「套餐配额统计」+ 实测 FAQ |
| `docs/technical/plan-stats/README.md` | 技术方案（决策+架构+引用上游） | openspec design.md 提炼 |

### D3: AGENTS.md 指针式

内容复用 `AGENTS.md.bak`：声明本项目遵循用户级规范体系（`/home/xin-cheng/code/myagents.md/AGENTS.md`），并指向项目权威源（`openspec/` 与 `docs/`）。删 `.bak`。

### D4: 格式合规

所有文档：中文、无 `---` 分割线、标题层级严格递增、代码块标注语言、列表用 `-`。交叉引用用相对链接。

## Risks / Trade-offs

- [README 内容迁出后用户找不到] → README 顶部加"文档导航"，每节留链接
- [docs/technical 技术方案与 change design.md 重复] → 技术方案只写决策摘要 + 架构，细节点名引用 openspec change，不复制全文
- [链接失效] → 相对路径链接，迁移时逐个核对

## Migration Plan

- 一次性结构重组：先建 docs/ 新文件，再重写 README，最后删 AGENTS.md.bak
- 回滚：git 历史可整体回退；无代码/配置变更

## Open Questions

- 无
