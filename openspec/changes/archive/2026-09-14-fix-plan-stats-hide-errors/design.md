## Context

`renderPlanChart`（src/quota.ts）当前在「没有任何账号返回 periods」时提前返回"暂无统计数据"，导致所有 ⚠ 错误行（未登录 / SSO 失效 / arkcli 缺失）不可见。见 proposal.md - Why 的动机；渲染现状见 spec「ASCII 表 + percent 柱渲染」。循环体本身已具备错误行与未订阅行的渲染能力（113-116、125-127 行），问题只在第 104-107 行的早退守卫。

**运行时链路**：插件通过 `file://` 加载，`package.json` 的 `main` 指向 `./dist/index.js`；`src/` 的修复不会自动进入运行时。实测 `dist/index.js` 仍含修复前的早退守卫，因此源码修复在运行时完全未生效。本设计除修复渲染守卫外，必须补上「重新构建 + 构建产物校验」这一步。

## Goals / Non-Goals

**Goals:**
- 只要存在带 `error` 的账号，就渲染表头 + 每账号错误行（含未订阅行），错误不丢失
- 保持「全部未订阅且无错误」与「空账号列表」返回"暂无统计数据"不变
- 最小 diff：仅调整渲染守卫，复用既有行渲染逻辑
- 修复在运行时真实生效：重新构建 `dist/index.js`，且构建产物与 `src/quota.ts` 语义一致

**Non-Goals:**
- 不改变错误分类/截断逻辑（`classifyError`、`errQuota` 保持现状）
- 不把「全部未订阅」改为渲染表格（保持"暂无统计数据"语义）
- 不加重试 / 自动重登等新行为
- 不在本 change 引入 CI / pre-push 强制构建钩子（仅做一次性重建 + 校验，见 D3 备选讨论）

## Decisions

### D1: 错误优先守卫 —— 早退条件从「无 periods」改为「无 periods 且无 error」

`renderPlanChart` 的早退守卫改为同时检查 periods 与 error：

- 有 periods 或 有 error → 进入渲染循环（错误行由既有分支输出）
- 无 periods 且 无 error → 返回"暂无统计数据"（覆盖全未订阅 / 空数组）

备选：无条件渲染所有行、仅空数组返回"暂无统计数据"。否决原因：改变「全部未订阅」的输出形态，blaster radius 更大，且 spec 保留该语义。当前方案只修复真正的问题（错误被吞）。

### D2: 纯错误场景仍渲染表头

即使没有任何数据行，也渲染 `coding-plan 官方配额 (plan_stats)` 表头与列名，再输出错误行。备选：错误场景只输出裸错误列表（不加表头）。否决原因：保持输出结构与正常场景一致，错误行在表格上下文中更易读。

### D3: 本 change 内重建 `dist/index.js` 并校验产物一致，但不引入强制构建机制

运行时按 `main: ./dist/index.js` 加载，故修复必须在 `dist` 中体现。方案：实现完成后运行 `bun run build` 重新生成 `dist/index.js`，并校验 `dist` 内 `renderPlanChart` 已使用 `hasData || hasError` 守卫、不再含旧早退；随后实测 `plan_stats` 输出错误行。

备选 A：在 `bun test` / pre-push / CI 中加「dist 是否 stale」校验。否决原因：超出本 bugfix 范围，且仓库当前无 CI；单列一个 change 处理流程性一致性问题更合适（见下方 Out of Scope）。

备选 B：改插件加载方式直接消费 `src/`（或用 `bun` 运行时加载 TS），从根本上消除构建产物不同步。否决原因：改变插件分发/加载契约，blast radius 大，需单独评估。

**Out of Scope（建议后续独立 change）**：建立「源码→产物」一致性保障（构建校验钩子或加载策略改造），防止任何 change 忘构建时修复静默失效。

## Risks / Trade-offs

- 「暂无统计数据」的触发面收窄 → 只影响原本会被错误行替代的场景；对正常「有数据」「全未订阅」路径无影响。Mitigation：更新 spec 场景与单测覆盖新语义。
- 纯错误表格的 session/weekly/monthly 列无内容 → 视觉上呈现「有表头、全错误行」，语义清晰，可接受。
- **构建产物未同步（本 change 实际踩中）** → 源码已修但 `dist` 停留在旧版，运行时仍吞错误，`bun test` 全绿造成「已修复」的假象。Mitigation：把 `bun run build` 作为本 change 收尾必做项，并显式校验 `dist` 内容 + 运行时实测，而非只依赖单测。
- 这是插件内部渲染行为变更，无外部 API / 数据迁移 → 重新构建 + 加载插件即生效，无需滚动方案。
