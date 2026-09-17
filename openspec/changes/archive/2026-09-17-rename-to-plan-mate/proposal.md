## Why

当前项目名 `opencode-round-robin` 只描述了「随机轮询」这一个实现机制，但项目实际能力已扩展为「多账号 Coding Plan 的用量统计 + 官方配额查看 + 一键登录」的助手插件。名字低估了产品，且绑定了平台无关的轮询机制。新名 `opencode-plan-mate` 以「Coding Plan 助手」为身份锚点——`opencode` 固定不变，不绑定火山等具体平台。

## What Changes

- **BREAKING**: package name `opencode-round-robin` → `opencode-plan-mate`
- **BREAKING**: plugin `id` `opencode-round-robin` → `opencode-plan-mate`
- **BREAKING**: LLM 工具 `roundrobin_stats` → `plan_mate_stats`（LLM 靠 description 引导调用，习惯不受影响）
- **BREAKING**: 默认统计目录 `round-robin-stats/` → `plan-mate-stats/`；日志文件名前缀 `round-robin-*.log` → `plan-mate-*.log`
- 错误信息前缀 `opencode-round-robin:` → `opencode-plan-mate:`
- 图表标题 `round-robin 近 N 天…` → `plan-mate 近 N 天…`
- 文档（README 与 docs/）同步新名与工具名
- `dist/` 重建、`bun.lock` 刷新

**明确不做**（存量兼容）：
- `openspec/specs/`、`openspec/changes/archive/`、`articles/` 保持旧名（历史档案）
- 磁盘上旧 `round-robin-stats/` 与 `round-robin-*.log` 数据不迁移，留在原地

## Capabilities

### New Capabilities

（无——本 change 为改名重构，不引入新行为 spec）

### Modified Capabilities

（无——按决策 `skip_specs: true`，本 change 不修改任何既有 spec。已知取舍：spec 中记录的 `roundrobin_stats` 工具名将短期与代码不一致，留待后续单独处理）

## Impact

- 代码：`src/index.ts`（id/statsDir/工具名/描述）、`src/config.ts`（错误前缀 ×7）、`src/logger.ts`（日志前缀）、`src/chart.ts`（标题）
- 测试：`tests/logger.test.ts`（日志文件名断言 ×3）
- 配置：`package.json` name、`bun.lock`
- 构建产物：`dist/index.js` 重建
- 文档：`README.md`、`docs/getting-started/installation.md`、`docs/user-guide/round-robin.md`（文件改名）、`docs/user-guide/plan-stats.md`、`docs/technical/plan-stats/README.md`
- 仓库外部（本 change 范围外）：GitHub repo 名 `bytesifter/opencode-round-robin`、本地目录名、用户 `opencode.jsonc` 的 `file:///` 路径
