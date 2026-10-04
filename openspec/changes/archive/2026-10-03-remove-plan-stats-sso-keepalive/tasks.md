# Tasks

## 1. 保活执行函数移除（src/quota.ts）

- [x] 1.1 删除 `src/quota.ts` 中 `authStatus` / `collectAuthStatus` / `classifyAuthError` 三个函数及其相关注释（含 `AuthStatus` 相关 import）；确认删除后 `bun x tsc --noEmit` 通过
- [x] 1.2 删除 `tests/quota.test.ts` 中 authStatus/collectAuthStatus 测试块（`===== authStatus:SSO 保活/探活 =====` 起的全部相关 test）；确认 `bun test` 通过

## 2. 定时器与前置探活移除（src/index.ts）

- [x] 2.1 删除 `src/index.ts` 中 `keepaliveTimer` 单例变量、setup 内的 12h 保活定时器注册、cleanup 中的 clearInterval，以及 `plan_stats` execute 中的 `collectAuthStatus` 前置探活逻辑（`expiryRows` 合并逻辑一并删除，直接 `collectPlanQuotas` + `renderPlanChart`）；确认 `bun x tsc --noEmit` 与 `bun test` 通过
- [x] 2.2 删除 `src/index.ts` 顶部对 `collectAuthStatus` 的 import；确认无未使用 import 报错（`bun x tsc --noEmit` 通过）

## 3. 配置项与类型移除（src/config.ts / src/types.ts）

- [x] 3.1 删除 `src/config.ts` 中 `ssoKeepaliveMs` 解析逻辑与默认值常量注释；删除 `tests/config.test.ts` 中 `ssoKeepaliveMs` 测试块；确认 `bun test` 通过
- [x] 3.2 删除 `src/types.ts` 中 `ssoKeepaliveMs?: number` 字段、`AuthStatus` 类型及相关注释；顺带清理 `PlanQuota` 附近"未来可扩展 agent-plan / seat"的误导注释；确认 `bun x tsc --noEmit` 通过

## 4. 规范固化死因（openspec/specs/plan-quota-stats/spec.md）

- [x] 4.1 将 change delta 中「SSO 保活已尝试失败，禁止实现」Requirement（含两个 Scenario）并入 `openspec/specs/plan-quota-stats/spec.md`；确认 `openspec validate remove-plan-stats-sso-keepalive` 通过且 spec 结构完整（Requirement + Scenario 用 4 个 `####`）

## 5. 文档修正（docs/）

- [x] 5.1 修正 `docs/technical/plan-stats/README.md` 两处误导表述：L13「仅接受该账号的 SSO/AK-SK 签名」与 L67「控制面只认 SSO/AK-SK，coding key 直连被拒」改为「仅接受 SSO STS，长效 AK/SK 不可行（实测 CodingPlan 配额接口拒绝 apikey/AK-SK，仅 SSO STS）」；确认改动与实测证据一致
- [x] 5.2 更新 `docs/user-guide/plan-stats.md`：删除「SSO 保活」整节；FAQ 增加失败原因条目（refresh_token 绝对 48h、sliding 不成立、AK/SK 不可行）；保留"过期后账号一起失效需重登"事实描述；确认文档无残留保活/`ssoKeepaliveMs` 描述

## 6. 旧 change 归档

- [x] 6.1 将 `openspec/changes/fix-plan-stats-sso-keepalive/` 移入 `openspec/changes/archive/`（保留 proposal/design/tasks/specs 全套）；在归档后的 design.md 补 5.3 观察结论：sliding 不成立、refresh_token 绝对 48h（实测约 46h 失效）、保活退化为探活并已随本 change 移除；确认归档目录结构完整、`openspec list` 不再显示该 change 为 in-flight

## 7. 集成验证

- [x] 7.1 全量校验：`bun test`、`bun x tsc --noEmit`、`bun run build` 全部通过；`openspec validate remove-plan-stats-sso-keepalive` 通过
- [x] 7.2 全局 grep 确认无保活残留：`保活|keepalive|ssoKeepalive|authStatus|collectAuthStatus` 在 `src/`、`tests/`、`docs/`、`openspec/specs/` 中无匹配（归档 change 内历史记录除外）
