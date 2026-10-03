# Proposal

## Why

`plan_stats` 的 SSO 保活（后台定时 `arkcli auth status` 续期 refresh_token）经实测**失败**：refresh_token 为服务端绝对 48h 有效期（实测约 46h 即失效），刷新不轮换、不续期（sliding 不成立），保活只能提前探活、无法延长登录态。同时验证了替代通道也不可行：CodingPlan 配额接口 `GetCodingPlanUsage` 仅接受 SSO STS（apikey 实测被拒 `requires Volcengine Ark SSO STS`），长效 AK/SK 亦不可行（arkcli AK/SK 登录通道已关，且接口契约不认）。继续保留保活代码会误导未来 LLM 重复尝试已失败的方向，需要彻底移除保活能力并把死因固化进规范与文档。

## What Changes

- **BREAKING** 移除 SSO 保活能力：删除后台 12h 保活定时器（`keepaliveTimer`）、`authStatus` / `collectAuthStatus` 执行函数、`plan_stats` 前置探活、`ssoKeepaliveMs` 配置项、`AuthStatus` 类型及对应测试。
- **BREAKING** 移除 `ssoKeepaliveMs` 配置项（不再接受该选项；用户配置中的该字段将被忽略）。
- **规范固化死因**：`plan-quota-stats` 主 spec 新增「SSO 保活已尝试失败，禁止实现」Requirement，写死两个死因（refresh_token 绝对 48h / CodingPlan 配额仅 SSO STS、AK/SK 不可行），阻止未来重新引入。注：主 spec 当前并无保活 Requirement（保活内容仅存在于未归档 change `fix-plan-stats-sso-keepalive` 的 delta spec 中，随其归档移除，不并入主 spec）。
- **文档修正**：`docs/technical/plan-stats/README.md` 修正"控制面只认 SSO/AK-SK"的误导性表述为"仅接受 SSO STS，长效 AK/SK 不可行"；`docs/user-guide/plan-stats.md` 删除「SSO 保活」节并在 FAQ 补充失败原因。
- **归档旧 change**：`fix-plan-stats-sso-keepalive` 移入 `openspec/changes/archive/`，并补 5.3 观察结论（sliding 不成立，绝对 48h 实测约 46h 即失效）。

## Capabilities

### New Capabilities

- （无。不引入全新行为能力，为既有 `plan-quota-stats` 能力内的保活子行为移除 + 禁止性约束。）

### Modified Capabilities

- `plan-quota-stats`：新增「SSO 保活已失败，禁止实现」Requirement——写死两个死因（refresh_token 服务端绝对 48h 有效期，实测约 46h 即失效，刷新不轮换不续期；CodingPlan 配额接口 `GetCodingPlanUsage` 仅接受 SSO STS，apikey 与长效 AK/SK 均不可行），明确后续不得重新引入 SSO 保活，`plan_stats` 保持按需查询 + 错误分类的原始形态。

## Impact

- **代码**：`src/quota.ts`（删 `authStatus` / `collectAuthStatus` / `classifyAuthError`）、`src/index.ts`（删 `keepaliveTimer` 单例、定时器注册/清理、`plan_stats` 前置探活）、`src/config.ts`（删 `ssoKeepaliveMs` 解析）、`src/types.ts`（删 `ssoKeepaliveMs?`、`AuthStatus` 类型，顺带清理 `agent-plan` 扩展注释）。
- **配置**：插件 options 移除 `ssoKeepaliveMs`（不再支持，忽略该字段）。
- **测试**：`tests/quota.test.ts`（删 authStatus/collectAuthStatus 测试块）、`tests/config.test.ts`（删 ssoKeepaliveMs 测试块）。
- **规范**：`openspec/specs/plan-quota-stats/spec.md` 增删对应 Requirement 与场景。
- **文档**：`docs/technical/plan-stats/README.md`（修正 AK/SK 表述）、`docs/user-guide/plan-stats.md`（删保活节、FAQ 补死因）。
- **归档**：`openspec/changes/fix-plan-stats-sso-keepalive/` 移入 `archive/` 并补观察结论。
- **行为边界**：`plan_stats` 回到"按需查询，失败由 `classifyError` 分类"的原始形态；SSO 过期时返回分类错误（未登录/SSO 已过期），不再有后台保活调用。
