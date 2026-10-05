# Proposal

## Why

`fix-usage-tracking-v2` 使用量统计恢复记录后，端到端验证发现两个新缺陷，导致统计被虚增数倍：

1. **历史 durable 事件回放污染**：opencode 服务（standalone 或 GUI 重启后）会从 `opencode.db` 回放持久化的 `session.step.ended` 事件——实测回放事件被投递 **6 次**，且包含历史会话（含其他项目、其他 run 的会话）的 usage，被错误地重新计入当天统计。
2. **事件 id 去重失效**：实测同一 `eventID` 被投递 6 次时，`recordUsage` 每次都 `committed:true`（`seenEvents.has()` 恒为 false），`event.id` 去重在多路投递/多处理路径下拦不住重复。

同时，`fix-usage-tracking-v2` 实现过程中遗留了 TEMP-DEBUG 探针（`PM-SETUP` 日志、`events.jsonl`/`commit.jsonl`/`record-raw.jsonl` 写入、`setupSeq` 计数等）与临时测试配置改动（全局 `opencode.jsonc` 指向 worktree 插件路径），需要在修复落地时一并清理还原。

## What Changes

- **回放过滤（治本）**：插件在 setup 时记录启动时刻 `startTime`，事件处理层忽略 `event.created < startTime` 的 `session.step.ended` / `session.step.failed`。历史 durable 事件（回放）一律不进入统计；历史 usage 已由 JSONL 落盘，过滤不丢数据。实时新事件不受影响。
- **去重加固（双保险）**：去重 key 从 `event.id` 改为 durable 事件稳定身份 `durable.aggregateID + ":" + durable.seq`（`session.step.ended`/`failed` 均携带），`event.id` 保留为辅助去重。即使回放过滤有漏网，同一 step 也只计一次。
- **探针清理**：移除 `src/index.ts` / `src/stats.ts` 中全部 TEMP-DEBUG 调试代码（setup 计数、事件/commit/record-raw JSONL 写入、`writeFileSync`/`appendFileSync` 探针导入、`setupSeq` 等），恢复发布形态。
- **测试与配置还原**：清理 `itest-usage` 临时测试目录；全局 `C:\Users\nixgn\.config\opencode\opencode.jsonc` 还原为指向 master 插件路径与原始 `logDir`（Downloads）/无 `statsDir` 覆盖。

## Capabilities

### New Capabilities

- （无。不引入全新行为能力，均为对既有能力的加固与清理。）

### Modified Capabilities

- `usage-tracking`：去重语义从「按 `event.id` 去重」扩展为「按 durable 事件身份（`aggregateID:seq`）去重 + `event.id` 辅助」；新增「忽略回放的历史 durable 事件」要求（`event.created < 插件启动时刻` 的事件不累计）。

## Impact

- **代码**：`src/stats.ts`（`StatsCollector` 去重 key 与有界集合逻辑）、`src/event-adapter.ts`（`StepUsage` 增加 durable 身份与 `created`；`resolveStepUsage` 输出）、`src/index.ts`（`handleEvent` 回放过滤 + 去重参数传递 + 清理探针）。
- **测试**：`tests/stats.test.ts`、`tests/events.test.ts` 适配 durable 去重与回放过滤场景。
- **文档**：`docs/user-guide/plan-mate-stats.md` 机制描述补充「回放事件过滤 + durable 去重」。
- **配置**：全局 `opencode.jsonc` 还原（指向 master 插件路径、原始 logDir/statsDir）；`itest-usage` 临时测试目录删除。
- **spec**：`openspec/specs/usage-tracking/spec.md` 增量更新。
- **连带**：`fix-usage-tracking-v2` 的 5.1 集成验证需按本 change 的修复重新执行；两个 change 完成后一并归档。
