# Design

## Context

`fix-usage-dedupe-replay` 的实例内去重无法解决跨实例重复。GUI 重启实测：同一插件 7ms 内被加载 6 次（6 个「位置」各一份实例），每实例从全局事件流收到所有会话事件、各自累计、各自 flush 到同一 JSONL → 同一增量写多份（JSONL 完全相同行出现 3~6 次）。详见 proposal.md - Why。

关键事实（实证）：
- `ctx.event.subscribe` 是**全局事件流**，每个位置实例都会收到所有事件。
- 事件带 `location` 字段（shape 探针：`keys:["id","created","type","location","data"]`），`LocationRef.directory` 可比较。
- 插件 setup 已有 `ctx.location.directory`（`loadProviderConfig` 已在用）。
- 实例内的 durable 去重 + 回放过滤保留为兜底（不冲突）。

## Goals / Non-Goals

**Goals:**
- 每个插件实例只累计自己位置（目录）会话的用量，消除多位置实例的跨实例重复。
- 保持 durable 去重 + 回放过滤为实例内兜底。

**Non-Goals:**
- 不改变 JSONL 格式与聚合逻辑。
- 不处理「同一目录被多个独立 opencode 进程同时打开」的极端重复（非 GUI 多位置场景，且需磁盘级幂等，超出范围）。

## Decisions

### D1: 位置过滤用 `event.location.directory === ctx.location.directory`

`handleEvent` 在 `resolveStepUsage` 前（或解析后、回放过滤前）比较位置目录，不匹配直接返回。

- 依据：事件 `location.directory` 与 `ctx.location.directory` 同为绝对路径（Windows 下大小写敏感需一致）；GUI 每个位置目录唯一，各实例只处理自己的。
- 备选 A：按会话归属过滤（维护本位置会话集合）——需订阅 `session.created` 维护状态，复杂；位置过滤直接用事件自带字段，零状态。弃用。
- 备选 B：磁盘级幂等（JSONL 写前查重）——改存储格式、跨进程锁复杂度高；位置过滤从源头消除重复。弃用。

### D2: 位置过滤的实现位置与可测性

- `src/event-adapter.ts` 增加纯函数 `isLocationMatch(eventLocation, pluginDirectory)`（或 `StepUsage` 增加 `locationDirectory`，由 `resolveStepUsage` 从 `event.location.directory` 解析），便于单测覆盖匹配/不匹配/缺 location 三分支。
- `src/index.ts#handleEvent` 用 `isLocationMatch` 过滤，setup 传 `ctx.location.directory`。

### D3: 兜底保留

durable 身份去重（`aggregateID:seq`）+ 回放过滤（`created < startTime`）保留不动——它们解决「同一实例内的事件重复/历史回放」，位置过滤解决「跨实例的同一事件多次处理」，三者正交。

## Risks / Trade-offs

- [Windows 路径大小写/分隔符不一致导致误过滤] → `location.directory` 与 `ctx.location.directory` 都来自同一服务解析的绝对路径，格式一致；实测可先验证。
- [缺 location 的事件被保守丢弃] → 事件 schema 均带 location（实证），丢弃仅影响异常事件，安全侧优先。
- [同一目录多进程打开的极端场景仍有重复] → 超出本 change 范围，记录为已知限制。

## Migration Plan

1. 在 `fix-usage-tracking-v2` worktree 分支实现（与既有 change 同现场），单测 + tsc + build + validate 全绿。
2. GUI 重启加载新插件，跑真实对话验证：`plan_mate_stats` 各 provider req 与真实 step 数一致（不再 3~6 倍虚增）、JSONL 无完全相同重复行。
3. 回滚：分支还原即可。

## Open Questions

（无。位置过滤方向已由实证支撑，实现细节无待定项。）
