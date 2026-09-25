# Proposal

## Why

v2 迁移（`fix-plan-mate-v2-migration`）后 `plan_mate_stats` 用量统计完全失效：`plan_mate_stats` 始终返回「暂无统计数据」，统计目录无任何 JSONL，插件日志只有 `fetch` 行、无一条 `usage` 行。根因是事件订阅层仍按 v1 事件契约解析——v2 事件流中不存在 `message.updated`，消息/用量事件改为 `session.step.ended` / `session.step.failed` / `session.usage.recorded` / `session.usage.updated`，数据从 `properties.info` 移到 `data`，且 step 事件不再携带 `providerID` 字段。迁移时 `handleEvent` 无单元测试、GUI 验证未核验统计实际增长，导致该缺陷漏网。

## What Changes

- **事件源迁移**：用量统计从订阅 v1 `message.updated`（`properties.info` 形态）改为订阅 v2 `session.step.ended`（主）与 `session.step.failed`（辅），从 `event.data` 读取 `sessionID` / `tokens` / `cost` / `finish`。
- **去重逻辑退役**：v1 的「token 快照变化检测」是为 `message.updated` 累积快照流设计的；v2 `step.ended` 每个 step 独立发一次事件，`req` 直接 +1。需处理 durable 事件重放（按事件去重，避免重复累计）。
- **归因 fallback 重构**：v2 step 事件不再有 `providerID`，v1 的 `info.providerID` fallback 失效；`sessionID → provider` 关联映射（`http.request` 钩子 `event.sessionID` 建立）保留为主路径，fallback 改为会话当前 provider（经 `ctx.session.get`）或 `unknown`。
- **关联映射清理适配**：清理时机从 `message.updated` 终态 `finish` 改为 `session.step.ended` 终态 `finish`（`stop`/`error`/`unknown`）与 `session.step.failed`；`X-Session-Id` 请求头相关逻辑移除（v2 钩子直接携带 `event.sessionID`）。
- **测试补齐**：为事件映射层（v1/v2 契约适配）新增单元测试，覆盖 `session.step.ended` / `session.step.failed` 解析、归因、去重、清理，堵住本次缺陷漏网的测试盲区。
- **spec/docs 同步**：`usage-tracking` spec 与 `docs/user-guide/plan-mate-stats.md`、`docs/technical/plan-stats/README.md` 中「订阅 `message.updated` / `info.providerID` / `X-Session-Id`」的 v1 表述改为 v2 事件契约。

## Capabilities

### New Capabilities

- （无。修复不引入全新行为能力，均为对既有能力的修改。）

### Modified Capabilities

- `usage-tracking`：事件源与数据契约从 v1 `message.updated`（`properties.info`）迁移为 v2 `session.step.ended` / `session.step.failed`（`data` 形态）；去重语义从「token 快照变化检测」改为「每 step 一次 + durable 事件重放去重」；provider 归因 fallback 从 `info.providerID` 改为会话当前 provider / `unknown`；关联映射清理时机与 `X-Session-Id` 头逻辑同步适配 v2。

## Impact

- **代码**：`src/index.ts`（`handleEvent` 事件解析与归因）、`src/stats.ts`（`recordUsage` 去重语义调整或新增 step 记录入口）、`src/http-hooks.ts`（移除 `X-Session-Id` 相关逻辑，若存在）。
- **测试**：`tests/stats.test.ts` 适配去重语义；新增事件映射层测试（如 `tests/events.test.ts`）。
- **文档**：`docs/user-guide/plan-mate-stats.md`、`docs/technical/plan-stats/README.md`、`docs/getting-started/installation.md`（如涉及事件机制描述）。
- **spec**：`openspec/specs/usage-tracking/spec.md` 增量更新。
- **连带**：`fix-plan-mate-v2-migration` change 尚未归档；本 change 完成并验证后，建议一并归档并修正其 8.1/9.3 中「message.updated 以 v1 兼容形态送达」的错误验证结论。
