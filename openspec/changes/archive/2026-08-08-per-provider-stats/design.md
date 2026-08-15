## Context

当前统计只有日维度汇总，无 per-provider 拆分。根因是 fetch 层（知道实际选中的 provider）和 event 层（知道 token 用量）之间没有共享请求身份。探索中发现 opencode 在 `request.ts` 中已为非 opencode provider 注入 `X-Session-Id: <sessionID>` HTTP 头，该头通过 AI SDK → `globalThis.fetch` 传递到 fetch-patch 可读位置。同时发现 `recordUsage` 的 `committed` Set 去重导致多步对话（工具调用）只记录第一步 token，后续步骤被丢弃。

参见 proposal.md 了解动机。

## Goals / Non-Goals

**Goals:**

- 将 token 与请求数归因到实际服务的 provider（而非 opencode 配置的 provider）
- 修复多步对话 token 丢失 bug
- 数据模型改为 per-provider 维度，日维度通过聚合获得

**Non-Goals:**

- 不改 fetch-patch 的 URL 替换 / Authorization 替换 / 429 熔断逻辑（key-rotation 不变）
- 不实现旧格式数据迁移（旧文件丢弃处理）
- 不在 fetch 层解析 SSE 流获取 token（保持 event 层获取 token 的设计）
- 不改日志格式与轮转逻辑

## Decisions

### 决策 1: 用 X-Session-Id 关联，不用 chat.headers hook

**选择**: fetch-patch 直接从请求头读 opencode 已注入的 `X-Session-Id`，建立 `corrMap: Map<sessionID, account>`。

**理由**: opencode `request.ts` 第 197-198 行已为非 opencode provider 注入 `X-Session-Id` 和 `x-session-affinity`，round-robin 用的 OpenAI-compatible provider 全走此分支。无需新增 `chat.headers` hook。fetch-patch 已经 `new Headers(init.headers)` 读取 Authorization，读取 `X-Session-Id` 是同样的机制。

**替代方案**: 用 `chat.headers` hook 注入自定义关联头。更重，且 opencode 已有 `X-Session-Id`，重复注入。否决。

### 决策 2: token 快照变化检测替代 committed Set

**选择**: 删除 `committed: Set<string>` 和 `buffer: Map<string, UsageInput>`，改为 `lastTokens: Map<string, TokenSnapshot>`。每次 `message.updated` with tokens 到达时，与 `lastTokens` 中该 id 的上次快照比较：不同则累加 + req++ + 更新快照，相同则跳过。

**理由**: opencode 的 `processor.ts` 在每个 `step-finish` 时 `ctx.assistantMessage.tokens = usage.tokens`（覆盖非累加），然后调 `updateMessage` 触发 `message.updated`。`finish` 事件的 `totalUsage` 被忽略（`return`）。多步对话中每步的 token 是 per-step 的，需要逐次累加。cleanup 阶段会再次 `updateMessage`（相同 token），用快照比较跳过。

**时序验证**:
```
Step 1 fetch(a) -> corrMap[ses]=a
  step-finish: tokens={in:1000} -> message.updated #1
    lastTokens: none -> accumulate(in:1000) to a, req=1, lastTokens={in:1000}
Step 2 fetch(b) -> corrMap[ses]=b
  step-finish: tokens={in:3000} -> message.updated #2
    lastTokens: {in:1000} != {in:3000} -> accumulate(in:3000) to b, req=1, lastTokens={in:3000}
cleanup: tokens={in:3000} -> message.updated #3
    lastTokens: {in:3000} == {in:3000} -> skip
```

**替代方案**: 用 committed Set 只记一次。当前方案，丢失多步 token。否决。

### 决策 3: per-provider 数据模型，日维度聚合

**选择**: `StatsStore = Record<date, Record<provider, ProviderStats>>`。图表工具遍历当天所有 provider 求和获得日维度。

**理由**: 用户明确表示日维度不需要单独存储，per-provider 是主维度。聚合计算量极小（provider 数量通常 < 10）。

**替代方案**: 同时存储日维度总计和 per-provider。冗余，且两边可能不一致。否决。

### 决策 4: passthrough fallback 到 info.providerID

**选择**: event 层查 `corrMap.get(sessionID)`，无记录时用 `info.providerID`。

**理由**: 全熔断 passthrough 时，fetch-patch 不选 provider，corrMap 无写入。此时 opencode 用原始配置发请求，`info.providerID` 就是实际服务的 provider，fallback 是正确的。429 不产生 token，无需归因。

### 决策 5: 旧格式文件丢弃处理

**选择**: 加载时检测旧格式（日期下直接为 DayStats 而非 provider 嵌套），置空 store。

**理由**: 旧格式无 provider 维度，无法拆分。迁移需猜测 provider 归属，不可靠。用户可备份旧文件后重新累计。

### 决策 6: 关联映射在终态 finish 时清理

**选择**: `message.updated` 的 `info.finish` 为 `stop` 或 `error` 时，删除 corrMap 中该 sessionID 的条目。

**理由**: 避免内存无限增长。终态 finish 表示该消息处理结束，后续不会有新的 fetch 关联到该 session（除非新消息，新消息会覆盖 corrMap 条目）。用 `stop`/`error` 判断而非 `tool-calls`（中间态），确保多步对话期间映射保留。

## Risks / Trade-offs

- **[corrMap 同 session 并发]** 同一 session 理论上可能有并发 LLM 请求（如 opencode 未来改为并行）。 -> opencode 当前架构是顺序处理（一条消息处理完才处理下一条），并发风险极低。corrMap 用 last-write-wins，即使并发也只是最后写入的 provider 被归因，不会崩溃。

- **[旧数据丢失]** 升级后旧格式 stats 文件被丢弃。 -> 用户可备份。统计数据非关键数据，重新累计即可。

- **[token 快照相同但实为新 step]** 理论上两步 token 完全相同会被误判为 re-emission 跳过。 -> 极低概率，且即使跳过影响也小（少记一步）。可接受。

- **[X-Session-Id 格式变化]** 未来 opencode 版本可能改头名或不再注入。 -> fetch-patch 检查头存在性，不存在时不建关联，fallback 到 `info.providerID`，不影响核心功能。
