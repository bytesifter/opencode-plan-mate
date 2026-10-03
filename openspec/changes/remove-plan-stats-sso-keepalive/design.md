# Design

## Context

保活方向已实测失败（详见 proposal.md - Why）：refresh_token 服务端绝对 48h（实测约 46h 失效）、sliding 不成立、AK/SK 通道关闭且 CodingPlan 配额接口不认。当前代码里保活实现横跨 `src/quota.ts`（执行函数）、`src/index.ts`（定时器 + 前置探活）、`src/config.ts`（配置项）、`src/types.ts`（类型），并有对应测试。主 spec `plan-quota-stats` 无保活 Requirement（保活仅存在于未归档 change `fix-plan-stats-sso-keepalive` 的 delta spec 中）。docs 有两处误导性"SSO/AK-SK"表述需修正。

## Goals / Non-Goals

**Goals:**
- 彻底移除保活代码、配置、类型与测试，`plan_stats` 回到按需查询原始形态
- 规范新增「禁止保活」条并写死两个死因，阻止未来 LLM 重新尝试
- 修正 docs 中"SSO/AK-SK 均可"的误导表述，堵住诱导未来重试 AK/SK 的源头
- 归档旧 change `fix-plan-stats-sso-keepalive` 并补 5.3 观察结论，闭环历史

**Non-Goals:**
- 不改变 `plan_stats` 按需查询、adapter 框架、隔离 HOME、percent-only 渲染等既有取数逻辑
- 不引入替代的登录态维持机制（结论是"按需查询 + 错误分类"为最终方案）
- 不改登录脚本行为（重登仍是手动全量，属既有能力）

## Decisions

### D1: 保活代码整体移除，保留错误分类能力

删除 `authStatus` / `collectAuthStatus` / `classifyAuthError` 及 `keepaliveTimer` 单例、定时器注册/清理、`plan_stats` 前置探活。`plan_stats` 直接走 `collectPlanQuotas`，SSO 过期由现有 `classifyError` 分类（其已含 sso/not logged 分支，返回「未登录（需 arkcli auth login volc-sso）」）。**备选**：保留前置探活换取更友好的「SSO 已过期」提示——否决，因残留的 `authStatus` 及其"保活"注释语境会成为未来 LLM 重新尝试保活的火种，且 `classifyError` 已能给出可用的过期分类。

### D2: spec 用「新增禁止条」而非「删除保活条」

主 spec 无保活 Requirement（保活只在旧 change delta 中），故 spec delta 为 ADDED「SSO 保活已失败，禁止实现」，写死死因而非只写"禁止"。**死因写法**：refresh_token 绝对 48h（实测 46h）+ CodingPlan 配额仅 SSO STS + AK/SK 不可行，让未来 LLM 读到"为什么不能再试"而非仅"不许做"。

### D3: docs 修正"SSO/AK-SK"误导表述

`docs/technical/plan-stats/README.md` 两处（L13 "仅接受 SSO/AK-SK 签名"、L67 "控制面只认 SSO/AK-SK"）改为"仅接受 SSO STS，长效 AK/SK 不可行"，并附一句死因。`docs/user-guide/plan-stats.md` 删「SSO 保活」节，FAQ 补失败原因（保留"过期后账号一起失效需重登"这一事实描述）。

### D4: 旧 change 归档 + 补观察结论

`fix-plan-stats-sso-keepalive` 移入 `openspec/changes/archive/`，其 delta spec 不并入主 spec（保活已弃）。design.md 补 5.3 观察结论：sliding 不成立，绝对 48h（实测约 46h 即失效），保活退化为探活、已随本 change 移除。

## Risks / Trade-offs

- [删除前置探活后过期提示友好度下降] → `classifyError` 已含 sso/not logged 分支可给出「未登录（需重登）」分类；接受的体验回退换取彻底斩草除根。
- [docs 中其他位置仍有"AK/SK"字样残留] → 已全量 grep，仅技术方案 README 两处需改；如归档 change 内出现属历史记录，不改。
- [用户配置中已有 `ssoKeepaliveMs` 字段] → 移除后该字段被忽略，无破坏性；文档注明不再支持。
