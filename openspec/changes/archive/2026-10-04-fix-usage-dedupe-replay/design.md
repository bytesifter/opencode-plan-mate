# Design

## Context

`fix-usage-tracking-v2` 恢复用量记录后，standalone 端到端验证（V2 CLI `opencode-cli.exe run --standalone`）暴露两个缺陷，详见 proposal.md - Why：

- 事件流对**历史 durable 事件回放 6 次**（实测同一 `session.step.ended` 被投递 6 次，含其他 run/其他项目的会话），回放事件 `event.created` 均早于插件启动时刻；
- `event.id` 去重失效（`record-raw` 探针：同一 eventID 连续 6 次 `recordUsage` 的 `has()` 恒 false、`size` 组内恒定，每次均 `committed:true`）。

关键事实（实证）：**实时新事件只投递 1 次**（run12/16 的「本次 run 新会话」step.ended 均 1×）；回放的历史事件才多路投递。

## Goals / Non-Goals

**Goals:**
- 历史 durable 事件回放不进入统计（治本）。
- 去重对多路投递/重发健壮（双保险）。
- 清理 `fix-usage-tracking-v2` 实现阶段遗留的 TEMP-DEBUG 探针与临时测试配置。

**Non-Goals:**
- 不改变 JSONL 落盘格式与聚合逻辑（`usage-tracking` 既有存储/图表设计不变）。
- 不做历史数据迁移。
- 不探究 6 路投递的确切内部机制——两项防护无论根因是「多实例各自去重集合」还是「事件流广播」均能兜住。

## Decisions

### D1: 回放过滤用「事件创建时刻早于插件启动时刻」判定

插件 setup 时记录 `startTime = Date.now()`；`handleEvent` 在解析前检查 `event.created`，`created < startTime` 直接丢弃。

- 依据（实证）：回放事件 `created` 早于插件启动；实时事件 `created ≥ startTime`（同一服务时钟，无跨机偏移）。历史 usage 已由 JSONL 落盘，丢弃回放不丢数据。
- 备选 A：按会话过滤（仅处理当前位置会话）——回放事件含其他位置会话，需维护活跃会话清单，且回放可能早于会话创建完成，复杂且不全。弃用。
- 备选 B：按 `durable.seq` 单调性判断（新事件 seq 更大）——seq 是 per-session 的，重启后归 1，无法全局判断新旧。弃用。

### D2: 去重主键改为 durable 事件身份（`aggregateID:seq`），`event.id` 作辅助

`resolveStepUsage` 输出 `durableKey = durable.aggregateID + ":" + durable.seq`（缺 durable 时退回 `event.id`，两者皆缺不去重）。`StatsCollector` 的去重集合以 durableKey 为 key（有界 Map + 过期裁剪逻辑不变）。

- 依据（实证）：回放/重发时同一 step 的 durable 身份稳定；`event.id` 去重在多路投递下已证失效。
- 备选：内容哈希（sessionID+messageID+tokens）——需处理 token 部分更新等边界，脆弱。弃用。

### D3: 探针与临时配置清理

- `src/index.ts`：移除 `PM-SETUP`/`setupSeq`、`events.jsonl`/`commit.jsonl` 写入、`writeFileSync`/`appendFileSync` 探针导入。
- `src/stats.ts`：移除 `record-raw.jsonl` 探针（recordUsage 内的调试块）。
- 全局 `C:\Users\nixgn\.config\opencode\opencode.jsonc`：还原 `package` 为 `file:///D:/code/opencode-plan-mate`、`logDir` 为 `C:/Users/nixgn/Downloads`、删除测试 `statsDir`。
- 删除 `C:\Users\nixgn\Downloads\cache\Temp\opencode\itest-usage\`（含 `.opencode` 测试配置与 run 产物）。

### D4: 单元测试适配

- `tests/events.test.ts`：`resolveStepUsage` 新增 `durableKey`/`created` 输出断言；`handleEvent` 回放过滤场景（created 早/晚于 startTime）。
- `tests/stats.test.ts`：去重用例从 `event.id` 改为 durableKey；补「durable 缺失 fallback event.id」「两者皆缺失不去重」。

## Risks / Trade-offs

- [`created` 字段缺失或与 startTime 时钟不一致] → 实测事件均带 `created` 且同服务时钟；缺失时按「不早于 startTime」视为实时（保守累计）或按 spec 边界处理；真实风险低。
- [durable 身份跨会话复用（同 sessionID 重启后 seq 重计）] → `aggregateID` 即会话 ID，会话唯一；同一会话重启后 seq 归 1，可能与历史去重集合残留冲突 → 有界集合 10 分钟过期裁剪兜底，且回放过滤已先行丢弃历史事件。
- [回放过滤丢弃「恰好跨启动时刻的进行中 step」] → 边界仅毫秒级，且该 step 的重发/后续事件仍可能落入实时窗口；可接受。

## Migration Plan

1. 在 `fix-usage-tracking-v2` worktree 分支上实现（两个 change 共享同一分支/实现现场，先合并本 change 的代码改动）。
2. 单测全绿 + `bun x tsc --noEmit` + `bun run build` 通过；`openspec validate fix-usage-dedupe-replay` 通过。
3. 还原全局配置、清理 itest-usage。
4. 用还原后的配置重跑一次 standalone 验证：usage 日志无重复、`plan_mate_stats` 非空且 per-provider 归因正确。
5. 回滚：还原为探针清理前版本（git 分支即可）。

## Open Questions

（无。回放过滤 + durable 去重两项措施已覆盖两种根因假设，无需待定项。）
