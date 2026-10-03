# Tasks

## 1. 保活/探活执行函数（src/quota.ts）

- [x] 1.1 新增 `authStatus(account, home, exec)`：以隔离 HOME（`HOME`/`USERPROFILE`）与归因 env 执行 `arkcli auth status --format json`，返回 `{ok, reason, stsExpiresAtMs}` 或错误分类（过期/未登录/arkcli 不可用）；复用 `buildSpawn` 跨平台执行；`tests/quota.test.ts` 用 fake exec 覆盖成功（`identity_sts_refreshed`）、refresh_token invalid、未登录、ENOENT 四类并全部通过
- [x] 1.2 新增 `collectAuthStatus(accounts, exec)`：并发对每账号执行 `authStatus`，单账号失败隔离（返回该账号错误分类），供定时器与 plan_stats 前置共用；`tests/quota.test.ts` 覆盖多账号并发与单失败隔离并通过

## 2. 保活定时器与 plan_stats 前置探活（src/index.ts）

- [x] 2.1 setup 中按模块级单例注册 12h 保活定时器（仅首个实例；读取 `opts.ssoKeepaliveMs` 默认 43200000），对 `planStats.accounts` 逐账号执行 `authStatus`，失败仅标记不中断；cleanup 时 clearInterval；`bun x tsc --noEmit` 通过
- [x] 2.2 `plan_stats` execute 前置：先 `collectAuthStatus` 探活，过期/未登录账号行直接标注"SSO 已过期（运行 bun scripts/login-arkcli-accounts.ts 重登）"等分类提示，健康账号走 `collectPlanQuotas`；未配置 `planStats` 时仍返回原配置提示；`bun test` 通过

## 3. 配置项与类型（src/config.ts / src/types.ts）

- [x] 3.1 `ParsedOptions` 新增可选 `ssoKeepaliveMs?: number`；`parseOptions` 解析 `options.ssoKeepaliveMs`（缺省 43200000）；`tests/config.test.ts` 覆盖默认值、自定义值与非法值回退并通过
- [x] 3.2 `types.ts` 新增保活状态类型（`{ok, reason?, stsExpiresAtMs?, error?}` 或等价），供 quota/index 复用；`bun x tsc --noEmit` 通过

## 4. 文档

- [x] 4.1 `docs/user-guide/plan-stats.md` 补「SSO 保活」小节：12h 默认频率、`ssoKeepaliveMs` 可配、过期提示与重登指引、机制说明（STS 短命 + auth status 自动续期）；验证文档与实现一致

## 5. 集成验证与观察

- [x] 5.1 全量校验：`bun test`、`bun x tsc --noEmit`、`bun run build` 通过；`openspec validate fix-plan-stats-sso-keepalive` 通过
- [ ] 5.2 GUI 重启后验证：保活定时器生效（日志/行为无重复注册）、`plan_stats` 过期账号显示友好提示而非长错误、健康账号正常取数
- [ ] 5.3 被动观察（sliding vs 绝对）：以 9/30 重登为 baseline，记录后续每次成功 `plan_stats` 查询时刻；若账号在保活下超过 48h 仍存活 → sliding 成立（保鲜有效）；若仍 48h 整死 → 绝对（保活退化为探活，方案不变）。观察结论记录到本 change 的 design.md 备注
