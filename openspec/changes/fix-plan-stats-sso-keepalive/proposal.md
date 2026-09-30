# Proposal

## Why

`plan_stats` 依赖每个账号隔离 HOME 下的 arkcli SSO 登录态，但 refresh_token 寿命约 48 小时（实测 9/25→9/27、9/27→9/30 两轮全量过期），导致每 2 天 6 个账号一起失效、`plan_stats` 全红，只能逐账号浏览器重登（每轮 6 次授权）。已实测机制：STS 有效期极短（5–15 分钟）、refresh_token 不轮换、`auth status` 在 STS 过期时会自动用 refresh_token 刷新（`reason=identity_sts_refreshed`）。需要为账号 SSO 登录态提供保活（定期刷新）与过期友好提示，减少手动重登频率与"查了才知道过期"的体验。

## What Changes

- **新增 SSO 保活**：插件后台定时（默认每 12 小时，可配 `ssoKeepaliveMs`）对 `planStats.accounts` 每个账号的隔离 HOME 执行 `arkcli auth status --format json`——STS 已过期时自动触发 refresh_token 续期（轻量，不拉配额数据）；命令报错（refresh_token invalid）则标记该账号过期。定时器只在首个插件实例注册（模块级单例，多 location 不重复）。
- **plan_stats 前置探活**：`plan_stats` 调用前对每个账号执行一次 `auth status`——成功则继续取配额；失败则该行直接标注"SSO 已过期"，并给出重登指引（`bun scripts/login-arkcli-accounts.ts`），避免先失败再等取数超时。
- **过期提示优化**：SSO 失效的账号行从当前一行长错误改为明确分类文案：未登录 / token 过期（含重登指引）/ arkcli 不可用。
- **`plan_stats` 按需语义澄清**：工具本身仍按需触发、不缓存配额；后台 `auth status` 属 SSO 保活而非套餐配额查询，不受"按需"条约束（原条文中"SHALL NOT 在后台轮询或定时查询"仅指配额查询）。

## Capabilities

### New Capabilities

- （无。不引入全新行为能力，为既有 `plan-quota-stats` 能力内新增保活子行为。）

### Modified Capabilities

- `plan-quota-stats`：
  - 修改「plan_stats 工具注册与按需触发」：明确后台 SSO 保活（`auth status`）不属于套餐配额查询，不受"按需/不缓存"约束；原配额查询按需语义保持不变。
  - 新增「SSO 登录态保活」：后台定时对每账号隔离 HOME 执行 `auth status` 保鲜，失败标记过期；`plan_stats` 前置探活并在过期时给出明确重登提示。

## Impact

- **代码**：`src/quota.ts`（新增保活/探活执行逻辑，复用现有 adapter 与 spawn 机制）、`src/index.ts`（setup 注册 12h 保活定时器 + plan_stats 前置探活）、`src/config.ts`（新增 `ssoKeepaliveMs` 可选项，默认 12h）、`src/types.ts`（保活状态类型）。
- **配置**：插件 options 新增可选 `ssoKeepaliveMs`（毫秒，默认 43200000=12h）；不新增必填项。
- **文档**：`docs/user-guide/plan-stats.md` 补保活机制与过期提示说明。
- **测试**：`tests/quota.test.ts` 新增保活/探活单测（fake exec 验证 status 调用、刷新判定、过期分类）；`tests/config.test.ts` 补 `ssoKeepaliveMs` 解析。
- **行为边界**：保活调用 `auth status` 每 12h/账号（每天 12 次控制面调用），远低于 429 频率限制；若服务端为绝对 48h 有效期（刷新不续期，sliding 未知），保活退化为"提前探活"，提示仍有效，不白跑。
