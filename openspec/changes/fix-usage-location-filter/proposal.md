# Proposal

## Why

`fix-usage-tracking-v2` + `fix-usage-dedupe-replay` 落地并 GUI 重启后实测：`plan_mate_stats` 已能出数据（原「暂无统计数据」bug 已修复），**但统计仍虚增 3~6 倍**。根因确认：GUI 重启时为多个「位置」各加载一份插件实例（启动日志实测同一插件 7ms 内 `loading plugin` 6 次），每个实例都从**全局事件流**收到所有会话的 `session.step.ended`，各自独立累计、各自 flush 到同一 JSONL，导致同一增量记录写多份（实测 JSONL 完全相同行出现 3~6 次）。实例内部的 durable 去重救不了**跨实例**的重复。

## What Changes

- **位置过滤（治本）**：`handleEvent` 在处理前过滤 `event.location.directory` 与插件实例所在位置 `ctx.location.directory` 不匹配的事件。每个插件实例只处理自己位置（目录）的会话事件——GUI 多位置各加载一份实例时，各实例各管各的位置，同一事件只被一个实例累计，天然消除跨实例重复。
- **保留实例内兜底**：`fix-usage-dedupe-replay` 的 durable 身份去重与回放过滤（`event.created < startTime`）保留，作为实例内重复/重放的第二道防线。
- **单测补充**：位置过滤的分支覆盖（位置匹配处理 / 不匹配忽略 / 缺 location 时的策略）。

## Capabilities

### New Capabilities

- （无。）

### Modified Capabilities

- `usage-tracking`：新增「按位置过滤事件」要求——插件 SHALL 只处理 `event.location.directory` 等于插件加载位置的 `session.step.ended` / `session.step.failed` 事件，其他位置的事件 SHALL 忽略。

## Impact

- **代码**：`src/index.ts`（`handleEvent` 增加位置过滤，setup 传入 `ctx.location.directory`）；`src/event-adapter.ts`（`StepUsage` 增加 `locationDirectory` 或过滤判定辅助函数，便于单测）。
- **测试**：`tests/events.test.ts` 新增位置过滤场景。
- **文档**：`docs/user-guide/plan-mate-stats.md` 机制描述补「按位置过滤（多位置实例互不干扰）」。
- **spec**：`openspec/specs/usage-tracking/spec.md` 增量更新。
- **连带**：`fix-usage-dedupe-replay` 的 durable 去重 + 回放过滤保留为兜底；本 change 完成后两个既有 change（`fix-usage-tracking-v2`、`fix-usage-dedupe-replay`）与本次一并归档。
