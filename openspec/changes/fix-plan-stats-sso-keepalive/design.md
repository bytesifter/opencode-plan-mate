# Design

## Context

`plan_stats` 依赖各账号隔离 HOME（`~/.arkcli-accounts/<账号>/.arkcli`）的 SSO 登录态，但 refresh_token 寿命约 48h，实测两轮全量过期（9/25→9/27、9/27→9/30），每次需逐账号浏览器重登。已实测的 token 机制（见 proposal.md - Why 后的探索记录）：

- STS 有效期极短（刷新后 expires_at 与当前差约 5 分钟，id_token `expires_in=900` 秒级）
- refresh_token 不轮换（连续实验哈希不变，同一 token 反复签发 STS）
- STS 有效期内调用控制面不刷新（连续 4 次 `usage plan` 全不变）
- STS 过期后 `auth status` 会刷新（实测 `reason=identity_sts_refreshed`，轻量、不拉配额）

目标：用保活减少手动重登频率，并让"过期"可被提前探知、提示友好。sliding（刷新续期）与绝对 48h 两种服务端策略**尚未定论**，保活方案需对两种结局都有价值。

## Goals / Non-Goals

**Goals:**
- 后台定期（默认 12h）对每账号隔离 HOME 执行 `auth status`，STS 过期时自动续期，维持登录态
- `plan_stats` 前置探活：过期账号直接给友好提示 + 重登指引，不白跑配额查询
- 保活调用轻量（status 而非 usage plan），频率远低于控制面 429 限流阈值
- 多加载位置只注册一个保活定时器（模块级单例）

**Non-Goals:**
- 不自动完成浏览器重登（OAuth 安全模型要求真人授权，无法无头自动化）
- 不修改登录脚本行为（仍是手动全量重登工具；保活只是降低重登频率）
- 不引入新配置必填项；`ssoKeepaliveMs` 可选，默认 12h

## Decisions

### D1: 保活触发器用 `arkcli auth status` 而非 `usage plan`

`auth status --format json` 在 STS 过期时会自动刷新（实测 `reason=identity_sts_refreshed`），且返回 `control_plane_auth.status/reason/sts_expires_at_ms` 直接可判健康度；相比 `usage plan`（拉全量配额数据）更轻量、无配额解析负担。`usage plan` 仍只用于 `plan_stats` 取数。

**备选**：`usage plan` 保活——确定触发刷新但重（每次拉全量配额），且与取数职责耦合。**否决**。

### D2: 保活频率默认 12h，可配 `ssoKeepaliveMs`

依据（全部实测/实证）：STS 有效期 5–15 分钟 → 12h 间隔必然触发刷新；refresh_token 寿命约 48h → 12h 远小于安全窗口；每天 6 账号 × 2 次 = 12 次控制面调用，远低于 429 限流阈值（9/27 全天 2781 次请求仅 3 次 429）。

**备选**：用户曾提议 1h——机制上 1h 也能触发刷新（> STS 5-15min），但每日调用量 ×12，且对保活无额外收益。**采纳 12h 默认**，`ssoKeepaliveMs` 可调。

### D3: 保活状态判定与过期分类

读 `auth status` 的 `control_plane_auth`：
- `status=ok`（含 `reason=identity_sts_refreshed`）→ 健康
- 命令报错 → 分类：`refresh_token invalid` → 「SSO 已过期」；`not logged in` → 「未登录」；`ENOENT` → 「arkcli 不可用」（复用 quota.ts 现有 `classifyError/classifyStartupError` 逻辑）

### D4: 保活定时器模块级单例 + plan_stats 前置探活组合

- setup 内 `if (!keepaliveTimer && accounts)` 创建 12h 定时器（复用现有 hooksRegistered 单例模式），cleanup 时 clearInterval
- `plan_stats` execute 前置：先 `collectStatus(accounts)` 探活，过期账号直接标注提示，健康账号走 `collectPlanQuotas`
- 定时器与前置探活共用同一 `authStatus(account, home, exec)` 执行函数（注入隔离 HOME 与归因 env，复用 buildSpawn 跨平台执行）

### D5: sliding 与绝对 48h 双结局兼容

- **sliding 成立**（刷新续期）→ 12h 保活 = 永续保鲜（治本）
- **绝对 48h**（刷新不续期）→ 保活退化为"提前探活"：每 12h 探一次，过期第一时间被标记并提示重登（治标），不白跑
- 两种结局下方案均成立，无需预先站队；被动观察实验（9/30 登录为 baseline）持续验证 sliding 是否成立

## Risks / Trade-offs

- [保活调用可能自身触发 429] → 频率 12h/账号、每天 12 次控制面调用，远低于实测 429 阈值（2781 请求仅 3 次）；若未来 429 增多可调大 `ssoKeepaliveMs`。
- [多加载位置重复定时器] → 模块级单例标志只注册一次；cleanup 清理定时器。
- [若服务端绝对 48h，保活无法延长寿命] → 方案退化为"探活+提示"，仍有价值；不承诺"永不重登"。
- [`auth status` 刷新行为依赖 arkcli 版本] → 已在当前 2.0.x 实测；spike 任务里加"升版本后回归验证"。
