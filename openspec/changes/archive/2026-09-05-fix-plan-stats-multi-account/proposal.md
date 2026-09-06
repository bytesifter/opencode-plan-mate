## Why

`add-plan-stats` 已实现 `plan_stats` 工具（spawn `arkcli usage plan` 取官方 coding-plan quota），但实施中实测发现一个硬约束：**arkcli 0.1.16+ 是单身份模型**——一个 arkcli 配置（`$HOME/.arkcli`）同一时间只能 SSO 登录一个火山账号，登录另一个账号会清空现有 profile。因此原设计 `planStats.profiles: string[]`（所有 profile 共用一个 arkcli 登录态）在"多个独立火山账号"场景下会退化为**所有行查到同一份 plan**。需要把配置形态改为**每账号一套隔离的 arkcli 配置**（独立 HOME），才能真正聚合多个独立账号的官方 quota。

## What Changes

- **配置形态变更**：`planStats.profiles: string[]` → `planStats.accounts: { <显示名>: <arkcli-home 目录> }`（每账号一个独立 arkcli 登录态目录）
- **取数方式变更**：adapter 按账号 spawn 时注入 `HOME=<账号home>` 环境变量，执行 `arkcli usage plan --product coding-plan --format json`（用该 HOME 的默认 profile，不再传 `--profile`）
- **文档补充**：README/配置说明给出每账号一次性 setup（独立 HOME 下 `config init` + `auth login --no-browser` 两段式 SSO，避开 `redirect_uri` 报错）
- 渲染/PlanQuota 模型/错误降级语义不变

## Capabilities

### New Capabilities
- （无）

### Modified Capabilities
- `plan-quota-stats`: 配置与取数机制变更——从"共享 arkcli 登录态 + `--profile`"改为"每账号隔离 arkcli HOME + 默认 profile"；`planStats` 配置键从 `profiles` 改为 `accounts` 映射

## Impact

- `src/types.ts`：`ParsedOptions.planStats` 从 `{ profiles: string[] }` 改为 `{ accounts: Record<string, string> }`
- `src/config.ts`：`parsePlanStats` 解析 `accounts` 映射（显示名 → HOME 目录），过滤非法项
- `src/quota.ts`：`volcArkcliAdapter.fetch` 改为带 `HOME` env spawn（去掉 `--profile` 参数）；`SpawnExecutor` 的 env 已支持自定义（现仅注入 caller 归因 env，需合并 HOME）
- `src/index.ts`：`plan_stats` execute 读取 `accounts` 映射，行名为显示名
- 测试：适配器/编排/配置测试按新形态更新（HOME env 断言、accounts 解析、去掉 --profile）
- 配置示例/README：新增每账号隔离 HOME 的 SSO setup 步骤
