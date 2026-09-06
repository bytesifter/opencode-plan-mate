## Why

项目已按 AGENTS-docs.md 规范加载（单一 TypeScript 程序项目），但当前文档结构不合规：根目录缺 `AGENTS.md`（只有 `.bak`）、无 `docs/` 目录（`docs/getting-started/` 为规范无条件必建）、升级类 change（`add-plan-stats` / `fix-plan-stats-multi-account`）缺 `docs/technical/` 技术方案文档、新增用户功能缺 `docs/user-guide/`。README 内联了全部明细，不符合"入口文档"定位。需要按规范对齐文档体系。

## What Changes

- **新建根 `AGENTS.md`**：指针式文档，指向用户级规范（`/home/xin-cheng/code/myagents.md/AGENTS.md`）与项目权威源；删除 `AGENTS.md.bak`
- **新建 `docs/` 三层结构**：
  - `docs/getting-started/installation.md`：安装 + 完整配置表（含 `planStats.accounts`）+ 轮询规则
  - `docs/user-guide/round-robin.md`：轮询机制 + `roundrobin_stats` 用法 + 日志说明
  - `docs/user-guide/plan-stats.md`：套餐配额统计 + 每账号独立 HOME SSO setup + FAQ/排障
  - `docs/technical/plan-stats/README.md`：plan_stats 技术方案（决策摘要 + 架构 + 引用上游 openspec change）
- **重写 `README.md` 为入口文档**：简介/特性/快速开始/安装链接/工具速查/文档导航，明细章节下沉到 `docs/`
- 格式合规：无 `---` 分割线、标题层级严格递增、代码块标注语言、中文撰写

## Capabilities

### New Capabilities
- （无，纯文档变更，`skip_specs: true`）

### Modified Capabilities
- （无。插件行为不变）

## Impact

- `README.md`：重写为入口文档（保留 License 徽章、贡献、许可证）
- 新增：`AGENTS.md`、`docs/getting-started/installation.md`、`docs/user-guide/round-robin.md`、`docs/user-guide/plan-stats.md`、`docs/technical/plan-stats/README.md`
- 删除：`AGENTS.md.bak`
- 无代码变更；`articles/opencode-plugin-dev-guide.md` 保留不动
