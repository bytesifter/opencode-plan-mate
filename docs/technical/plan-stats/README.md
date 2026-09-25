# plan_stats 技术方案

## 背景与动机

插件核心是「多账号 API key 随机轮询 + 实际用量统计」（`plan_mate_stats`）。但实际用量看不到各账号**官方套餐配额桶**（用了几成、几号刷新）。需求：一次拉齐多个独立火山账号的 Coding Plan 官方 quota，统一视图，且框架与插件「多服务商」定位一致、可扩展。

本方案通过 `add-plan-stats` 与 `fix-plan-stats-multi-account` 两个 OpenSpec change 落地（详见 [openspec/changes](../../../openspec/changes/)，含 proposal/specs/design/tasks）。

## 关键决策

### 决策一：官方 quota 必须依赖 arkcli（不能直连控制面）

实测验证：`GetCodingPlanUsage` 等控制面接口走 OpenTOP 网关（`open.volcengineapi.com`），仅接受该账号的 SSO/AK-SK 签名；Coding Plan API key（`ark-...`）是数据面凭证，直连被拒（`InvalidAuthorization`），arkcli 亦拒绝用 `--api-key` 查控制面。

- 备选：插件内直连 OpenTOP（需 sigv4 签名 + STS）——重实现且不可行
- 决定：插件通过子进程运行 `arkcli usage plan`，复用 arkcli 的登录态与取数逻辑

### 决策二：每账号独立 arkcli HOME（单身份模型的必然推论）

arkcli 0.1.16+ 为**单身份模型**：一个 `$HOME/.arkcli` 同时只能登录一个火山账号，登录另一账号会清空现有 profile。因此多独立账号必须每账号一套隔离配置（独立 HOME）。

```
~/.arkcli-accounts/<账号>/.arkcli/   ← 每个火山账号自己的登录态 + profile
```

插件按账号 spawn 时注入 `HOME=<账号目录>`，执行 `arkcli usage plan --product coding-plan --format json`（用该 HOME 的默认 profile，无需 `--profile`）。

### 决策三：配置形态 `planStats.accounts`（显示名 → HOME 目录）

```jsonc
"planStats": { "accounts": { "账号A": "~/.arkcli-accounts/a", "账号B": "~/.arkcli-accounts/b" } }
```

行名 = 显示名；HOME 决定取哪个账号的登录态。比「共享登录态 + profile 名列表」更符合多账号现实（后者会退化为所有行同一份 plan）。

### 决策四：数据边界 percent-only

CodingPlan 后端只返回 `session / weekly / monthly` 三个窗口的 `percent` + `reset_at`，无绝对 used/total。渲染只展示百分比柱 + 重置时间，不编造绝对值。

## 架构

```
plan_stats 工具（仅显式调用,经 ctx.tool.transform 注册,入参为空 JSON Schema）
    │  读取 opts.planStats.accounts(ctx.options 传入 setup)
    ▼
collectPlanQuotas(accounts, exec, registry)   ← 并发、单账号失败隔离
    │  对每个账号: adapters.find(supports) → fetch(account, home, exec)
    ▼
volcArkcliAdapter.fetch(account, home, exec)
    │  spawn("arkcli", ["usage","plan","--product","coding-plan","--format","json"],
    │        { env: { ...CALLER_ENV, HOME: home }, timeoutMs: 30s })
    ▼
parseUsagePlan(stdout)   ← items[] → PlanQuota{provider, kind, subscribed, periods, error}
    │  错误分类: 未登录 / profile 不存在 / arkcli 不可用(ENOENT) / 畸形输出
    ▼
renderPlanChart(PlanQuota[])   ← ASCII 表 + percent 柱 + 重置时间
```

> **v2 迁移说明**（`fix-plan-mate-v2-migration`）：`plan_stats` 工具在 v2 下经 `ctx.tool.transform` 注册（入参为 JSON Schema），options 经 `ctx.options` 传入；取数编排、隔离 HOME、percent-only 渲染逻辑不变。用量统计（`plan_mate_stats`）的事件源随 `fix-usage-tracking-v2` 迁移为 v2 `session.step.ended` / `session.step.failed` 事件（见 [用户指南](../../user-guide/plan-mate-stats.md)）。

扩展性：取数机制封装在 `QuotaAdapter` 内（`src/quota.ts` 注册表），编排/渲染不感知具体 provider。新增 provider = 新增 adapter 并注册进数组，不改编排/渲染。

## 备选方案与取舍

| 备选 | 放弃原因 |
|------|---------|
| 插件直连 `GetCodingPlanUsage`（HTTP + bearer） | 控制面只认 SSO/AK-SK，coding key 直连被拒 |
| 共享 arkcli 登录态 + `--profile` 列表 | 单身份模型下所有 profile 同一账号，退化为同一份 plan |
| 用插件自记录实际用量替代官方 quota | 非官方数据，不满足「看额度」需求（`plan_mate_stats` 已覆盖实际用量视角） |
| 登录时每账号重登（不隔离） | 每次查询需真人授权，不可自动化；隔离 HOME 为一次性成本 |

## 关联文档

- 用户指南：[套餐配额统计](../../user-guide/plan-stats.md)
- 安装配置：[安装与配置](../../getting-started/installation.md)
- 实现细节：[add-plan-stats](../../../openspec/changes/add-plan-stats/)、[fix-plan-stats-multi-account](../../../openspec/changes/fix-plan-stats-multi-account/)、[fix-plan-mate-v2-migration](../../../openspec/changes/fix-plan-mate-v2-migration/)（opencode v2 迁移）、[fix-usage-tracking-v2](../../../openspec/changes/fix-usage-tracking-v2/)（用量统计 v2 事件契约修复）
