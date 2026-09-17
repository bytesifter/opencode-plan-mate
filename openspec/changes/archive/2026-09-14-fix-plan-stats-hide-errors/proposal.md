## Why

`plan_stats` 的渲染函数 `renderPlanChart` 在「没有任何账号返回 periods」时直接返回"暂无统计数据"，把每个账号的 ⚠ 错误行（未登录 / SSO 过期 / arkcli 缺失）全部吞掉。实测中 6 个账号 SSO 全部失效时，工具只显示"暂无统计数据"，无法区分「账号真没订阅」与「查询全坏了」，导致用户误判。

**补充（运行时未生效）**：`renderPlanChart` 的错误优先修复只落在 `src/quota.ts`，但插件经 `file://` 加载时按 `package.json` 的 `main: ./dist/index.js` 执行，而 `dist/index.js` 仍是修复前的旧产物（早退守卫 `if (quotas.filter(q => q.periods.length > 0).length === 0) return "暂无统计数据"`）。实测 6 账号 SSO 全部失效时，运行时仍复现同一 bug，源码修复形同虚设——根因是「改源码」与「重新构建」之间没有绑定，change 缺少构建验收步骤。

## What Changes

- `renderPlanChart` 改为「错误优先」渲染：只要存在带 `error` 的账号，就渲染表头 + 每账号错误行（未订阅行一并显示），不再早退返回"暂无统计数据"
- "暂无统计数据"仅在真正无数据时返回：所有账号均未订阅且无错误，或账号列表为空
- 同步更新 spec 语义与渲染测试，使「失败需显示错误」成为明确要求
- 重新构建 `dist/index.js` 使源码修复在运行时生效，并将「构建产物与源码一致」纳入本 change 的验收

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `plan-quota-stats`: 「无数据提示」要求发生变化——查询失败（error）时 SHALL 显示各账号错误行，不再归并进"暂无统计数据"；仅「全部未订阅且无错误」或「空账号列表」返回"暂无统计数据"

## Impact

- `src/quota.ts`：`renderPlanChart` 渲染逻辑（新增错误优先分支）
- `tests/quota.test.ts`：`全失败/全未订阅返回暂无统计数据` 用例拆分为「全失败显示错误行」与「全未订阅无错误返回暂无统计数据」
- `dist/index.js`：重新构建，使 `renderPlanChart` 与源码一致（插件运行时的真实入口）
- `openspec/specs/plan-quota-stats/spec.md`：Requirement「ASCII 表 + percent 柱渲染」的无数据场景语义修订
