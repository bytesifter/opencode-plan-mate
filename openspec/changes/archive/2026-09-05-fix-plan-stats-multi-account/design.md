## Context

`add-plan-stats` 已实现 `plan_stats`（见 proposal.md 动机与既有实现），但实施期实测发现硬约束：arkcli 0.1.16+ 单身份模型，一个 `$HOME/.arkcli` 同时只能 SSO 登录一个火山账号。原设计 `planStats.profiles: string[]` + `--profile <p>` 依赖共享登录态，在"多个独立火山账号"下所有行会退化为同一账号的同一份 plan。

实测确认的关键事实：

- arkcli 配置固定在 `$HOME/.arkcli/`，**每账号独立 HOME 即独立登录态**——这是多账号隔离的唯一机制
- `--no-browser` 跨设备流（client_id=`cross-device`，redirect_uri=signin URL）**无本地端口回调**，可避开 `volc-sso` 浏览器流的 `redirect_uri` 报错
- 隔离 HOME 内登录后，`arkcli usage plan --product coding-plan --format json` 直接用默认 profile 即可，**无需 `--profile`**

## Goals / Non-Goals

**Goals:**
- `plan_stats` 支持多个独立火山账号，每账号各查各的官方 quota
- 每账号一套隔离的 arkcli HOME（`$HOME` 注入子进程），互不干扰
- 配置形态改为 `planStats.accounts: { 显示名: home目录 }`
- 复用现有 adapter/渲染/错误降级框架，改动最小

**Non-Goals:**
- 不做多账号同时登录单个 arkcli 配置的支持（受单身份模型限制，不实现）
- 不改渲染/PlanQuota 模型/错误分类语义
- 不做登录自动化（SSO 需真人浏览器授权，文档给出一次性 setup 步骤）

## Decisions

### D1: 配置形态 `profiles: string[]` → `accounts: { 显示名: home }`

`planStats` 从 profile 名列表改为"显示名 → arkcli HOME 目录"映射。行名 = 显示名（用户可读），HOME 目录决定用哪个账号的登录态。

```
planStats: {
  "accounts": {
    "volxc9208": "~/.arkcli-accounts/volxc9208",
    "volhwy2410": "~/.arkcli-accounts/volhwy2410"
  }
}
```

- 备选：`{ 显示名: { home, profile } }` 显式指定 HOME 内 profile——隔离 HOME 登录后默认 profile 即可，无需显式 profile，形态从简
- 备选：保留 profiles 列表 + 全局共享登录态——多账号下退化，已证实不可行
- 决定：accounts 映射。HOME 支持 `~` 展开（复用 homedir 解析）

### D2: spawn 注入 `HOME`，去掉 `--profile`

adapter 按账号构造子进程时，把该账号的 HOME 目录合并进 env（叠加既有 caller 归因 env），执行 `arkcli usage plan --product coding-plan --format json`（不传 `--profile`）。

```
env = { ...process.env, HOME: <账号home>, ARKCLI_CALLER_TYPE, ARKCLI_CALLER_NAME, ARKCLI_SKILL_NAME }
cmd = arkcli usage plan --product coding-plan --format json
```

- 现有 `SpawnExecutor` 已支持 `opts.env`，只需在 adapter 构造时把 HOME 与归因 env 一起传入
- 归因 env 仍需覆盖 HOME（`...process.env` 在前，显式 HOME 在后保证覆盖）

### D3: 每账号一次性 SSO setup（文档/README）

每个账号在独立 HOME 下初始化并两段式登录（`--no-browser` 避开 `redirect_uri` 报错）：

```bash
mkdir -p ~/.arkcli-accounts/<acct>
HOME=~/.arkcli-accounts/<acct> arkcli config init --profile default --region cn-beijing --set-default
HOME=~/.arkcli-accounts/<acct> arkcli auth login --no-browser        # Phase 1 → 浏览器授权
HOME=~/.arkcli-accounts/<acct> arkcli auth login --no-browser --code <码>  # Phase 2
# 验证
HOME=~/.arkcli-accounts/<acct> arkcli usage plan --product coding-plan --format json
```

写入配置文档/README，作为 `plan_stats` 使用前置。

## Risks / Trade-offs

- [每账号维护一份独立 arkcli 配置（N 份 SSO 登录态）] → 一次性成本，文档化 setup 步骤；账号数通常个位数
- [HOME 覆盖影响子进程其他行为（缓存等）] → 只作用于 plan_stats 的短暂子进程，不污染主进程环境
- [`~` 展开与路径解析不一致] → 统一复用 `homedir()` 展开，测试覆盖相对/绝对路径
- [默认 profile 不在隔离 HOME 中（未登录/仅 platform）] → 未登录行内标注，行为同现有降级

## Migration Plan

- 纯配置形态调整，向后兼容性有限：`planStats.profiles` 旧配置将不再生效（`accounts` 未配置时 `plan_stats` 返回配置提示）
- 回滚：保留 `profiles` 解析分支即可（如需要），但多账号场景无实际用途

## Open Questions

- 无（隔离机制、登录路径、配置形态均经实测确认）
