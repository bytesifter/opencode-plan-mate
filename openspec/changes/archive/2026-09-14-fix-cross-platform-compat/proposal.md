## Why

插件按 Linux 假设实现（目录创建幂等、账号隔离只设 `HOME`、`~` 只按 POSIX 展开），在 Windows + opencode（Bun 运行时）下暴露两个真实故障：

1. **插件加载失败**：`server()` 构造 `Logger` 时用 `mkdirSync(dir, { recursive: true })` 准备 `logDir`，当该目录已存在时 opencode 运行时抛 `EEXIST`，导致 `failed to load plugin`，`roundrobin_stats` / `plan_stats` 全部不可用。实测链路：`StatsCollector` 把不存在的新目录建成功 → `Logger` 对已存在的 `logDir` 抛 `EEXIST` → 插件整体加载失败。
2. **账号隔离失效**：`planStats.accounts` 的每账号 home 只通过子进程 `HOME` 环境变量传递；但 Windows 的 arkcli（Go 二进制）只认 `USERPROFILE`，忽略 `HOME`。实测 `HOME=temp` 仍写全局 `~/.arkcli`，`USERPROFILE=temp` 才写入 `temp/.arkcli`。故 Windows 下所有账号会共用同一登录态，`plan_stats` 无法按账号区分。

需在**不改变 Linux 行为**的前提下让插件兼容 Windows。

## What Changes

- **目录准备幂等**：`Logger` / `StatsCollector` 的目录创建改为幂等（目录已存在时不抛错），使插件在 `logDir` / `statsDir` 已存在时仍能成功加载。
- **账号隔离跨平台**：spawn arkcli 时同时注入 `HOME`（POSIX 生效）与 `USERPROFILE`（Windows 生效），使每个账号的隔离 home 在两个平台都真正生效；配置 schema 不变。
- **路径展开兼容**：`~` 前缀展开同时接受 `~/` 与 `~\`（Windows 习惯写法）。
- **文档补齐 Windows 说明**：安装/登录步骤区分平台（`arkcli profile create` 取代已废弃的 `config init`；Windows 用 `$env:USERPROFILE`），并说明 `logDir` 可指向已存在目录。
- **重建 `dist/index.js`**：使源码修复在 opencode 运行时（`main: ./dist/index.js`）真实生效。

## Capabilities

### New Capabilities

- `cross-platform-runtime`: 目录准备幂等——`logDir` / `statsDir` 已存在时不阻断插件加载（Windows 下 `mkdirSync` 抛 `EEXIST` 导致加载失败的场景）。

### Modified Capabilities

- `plan-quota-stats`：「通过 arkcli 子进程取数（每账号隔离 HOME）」要求改为跨平台隔离——子进程环境 SHALL 同时在 POSIX 设 `HOME`、在 Windows 设 `USERPROFILE`；并新增「账号 home 路径展开（跨平台）」要求，`~` 前缀兼容 `~/` 与 `~\` 写法。

## Impact

- `src/logger.ts`：`Logger` 构造的目录创建改为幂等
- `src/stats.ts`：`StatsCollector` 构造的目录创建改为幂等
- `src/quota.ts`：`volcArkcliAdapter.fetch` 注入的 env 增加 `USERPROFILE`
- `src/config.ts`：`expandHome` 兼容 `~\`
- `docs/getting-started/installation.md`、`docs/user-guide/plan-stats.md`：Windows 说明
- `tests/`：目录幂等、env 注入、路径展开的用例
- `dist/index.js`：重建，运行时入口与源码一致
