# Design

## Context

v1→v2 迁移（`fix-plan-mate-v2-migration`）只迁移了订阅机制（`ctx.event.subscribe()`），事件解析层仍按 v1 契约（`message.updated` + `properties.info`）编写，而 v2 事件流中消息/用量事件已改为 `session.step.ended` / `session.step.failed` / `session.usage.recorded` / `session.usage.updated`，数据位于 `data` 而非 `properties.info`。实证：插件日志只有 `fetch` 行、`plan_mate_stats` 返回「暂无统计数据」、统计目录无 JSONL。`handleEvent` 层零单元测试，迁移时未暴露。详见 proposal.md - Why。

当前代码基线：
- `src/index.ts#handleEvent`：按 `e.type === "message.updated"` + `e.properties?.info` 过滤，v2 下永远提前返回。
- `src/stats.ts#StatsCollector.recordUsage`：按 `info.id` + token 快照 diff 去重（为 v1 累积快照流设计）。
- `src/http-hooks.ts`：已用 v2 `event.sessionID` 建立 corrMap，工作正常（fetch 日志在写）。

## Goals / Non-Goals

**Goals:**
- 在 v2 事件流下恢复 `plan_mate_stats` 的按天累计与 JSONL 落盘。
- 每次 `session.step.ended` / `session.step.failed`（含 tokens）计为一次请求，per-provider 归因保持。
- 填补事件映射层测试盲区，防止契约漂移再次漏网。
- 同步修正 spec/docs 中的 v1 事件表述。

**Non-Goals:**
- 不改变 `plan_stats`（官方配额）行为。
- 不做历史数据迁移（JSONL 结构不变，沿用 `usage-tracking` 既有落盘/聚合/图表设计）。
- 不计入 title/compaction 用量（见 Open Questions，用户暂定为「先不定」，默认只计 step 事件）。

## Decisions

### D1: 事件源用 `session.step.ended` + `session.step.failed`

每次 step 结束各发一次 `session.step.ended`（含 `data.{sessionID, assistantMessageID, finish, tokens, cost}`），step 出错发 `session.step.failed`。两者与「一次模型请求 step」天然 1:1，`req` 直接 +1。

- 备选 A：`session.usage.recorded` / `session.usage.updated` —— 会话级聚合快照，无 step 粒度，无法映射每次轮询旋转后的实际 provider，且 `usage.recorded` 仅覆盖 title/compaction。弃用为统计源，保留为未来 title/compaction 计入的扩展点（Open Question）。
- 备选 B：`session.text.ended` / `session.reasoning.ended` —— 只含内容，不含 tokens/cost。弃用。

### D2: 退役 token 快照 diff，改为按事件去重

v1 的快照 diff 是为 `message.updated` 同一 `info.id` 多次推送累积快照设计的；v2 `step.ended` 每个 step 只发一次，快照 diff 失去意义且引入多余状态。改为对最近处理过的事件 id 做有界去重（如 `Map<event.id, time>` + 容量上限/过期裁剪），防止 durable 事件（带 `aggregateID/seq`）在事件流重连重放时重复累计。

- 备选：按 `(sessionID, assistantMessageID)` 去重 —— 需自行判断重复语义（重试/重放），不如事件 id 直接。弃用。

### D3: provider 归因主路径 corrMap，fallback 改为会话当前 provider

`http.request` 钩子已在 `event.sessionID` 上建立 `sessionID → account` 映射（`src/http-hooks.ts` 现状），主路径沿用。v2 step 事件不含 `providerID`，fallback 改为：`ctx.session.get({sessionID})` 取会话当前 model 的 `providerID`（`data.sessionID` 与其匹配时），仍不可得归入 `unknown`。事件处理循环改为异步以支持 `ctx.session.get` 查询。

- 备选：仅 fallback 到 `unknown` —— 丢失会话当前 provider 信息，图表中 passthrough 场景显示失真。弃用。
- 说明：corrMap 仍是「会话内最后一次 http.request 选中的 provider」，与 v1 行为一致（step.ended 紧随其 step 的请求到达，归因窗口正确）。

### D4: corrMap 清理时机适配 step 终态

`session.step.ended` 的 `finish` 为 `stop`/`error`/`unknown` 或收到 `session.step.failed` 时清理该 sessionID 关联，`tool-calls` 等中间态保留。与 v1「终态 finish 清理」语义一致。

### D5: 移除 `X-Session-Id` 头逻辑

v2 `http.request` 钩子事件已携带 `event.sessionID`，不再需要 v1 fetch-patch 里「读 `X-Session-Id` 头 + 删除头」的两步。该逻辑在 v2 适配层中本就未实现（`src/http-hooks.ts` 直接用 `event.sessionID`），spec 中残留的 v1 表述随本次修正。

### D6: 事件解析抽成可测纯函数

将「v2 事件 → 归一化 UsageInput + provider 归因」抽为独立函数（如 `src/event-adapter.ts#resolveStepUsage(event)`），返回 `{usage | null, provider}`。`handleEvent` 只做订阅编排。这样测试可直接喂 v2 形态事件对象，堵住本次「事件层零测试」的盲区，也让 v2 契约变更先在测试层显性化。

## Risks / Trade-offs

- [corrMap 会话内多 provider 旋转的「最后一次请求赢」歧义] → 与 v1 行为一致，step.ended 紧邻其 step 请求到达，归因窗口正确；接受该近似。
- [durable 事件重放导致重复累计] → D2 事件 id 有界去重兜底。
- [`ctx.session.get` 异步查询引入事件循环延迟] → 仅在 corrMap miss 时查询（正常路径零开销）；查询失败静默降级 `unknown`。
- [「每 step 计一次 req」与旧 JSONL 的 per-provider 图表口径有细微差（如重试 step）] → 图表只聚合 disk JSONL，语义仍为「真实完成/失败的模型调用数」，与 v1 目的一致。

## Migration Plan

1. 在 worktree（从 `master` 拉 `fix-usage-tracking-v2` 分支）实现代码与测试，`bun test` + `bun x tsc --noEmit` + `bun run build` 全绿。
2. `openspec validate fix-usage-tracking-v2` 通过。
3. 重启 opencode GUI 后台服务，真实跑一轮多步对话，验证：`plan-mate-YYYY-MM-DD.log` 出现 `usage` 行、统计目录出现当天 JSONL、`plan_mate_stats` 返回非空图表且 per-provider 归因正确。
4. 回滚：切回 master 分支 + 重构建 `dist/` 即可（插件经 `file:///` 指向仓库目录，无独立部署）。

## Open Questions

- **title/compaction 用量是否计入按天统计**：用户暂定「先不定」。当前设计默认只计 `session.step.ended` / `session.step.failed`；如需计入，后续以 `session.usage.recorded`（`source: "title" | "compaction"`）为扩展点新增计数，不影响本 change 的 spec/任务结构。
