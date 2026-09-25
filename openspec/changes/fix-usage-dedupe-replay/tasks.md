# Tasks

## 1. 事件解析层：durable 身份与回放过滤

- [x] 1.1 `src/event-adapter.ts`：`StepUsage` 增加 `created`（`event.created`，非 number 取 0）与 `durableKey`（`durable.aggregateID:durable.seq`，缺 durable 时 fallback 到 `event.id`，两者皆缺为空串）；`resolveStepUsage` 输出；`bun x tsc --noEmit` 通过
- [x] 1.2 `src/index.ts#handleEvent`：解析前先做回放过滤——`usage.created < startTime`（startTime 为 setup 记录的 `Date.now()`）直接返回；`recordUsage` 传 `durableKey` 作为去重身份；`bun x tsc --noEmit` 通过
- [x] 1.3 `tests/events.test.ts`：新增 `durableKey` 输出断言（durable 存在 / 缺 durable fallback event.id / 两者皆缺空串）与回放过滤场景（created 早于 startTime 丢弃、晚于 startTime 保留、等于 startTime 保留），全部通过

## 2. 去重加固：按 durable 身份去重

- [x] 2.1 `src/stats.ts#StatsCollector`：`recordUsage` 去重参数从 `eventID` 语义改为「去重身份 key」（`durableKey`，空串不去重），有界 Map + 过期裁剪逻辑复用；`bun x tsc --noEmit` 通过
- [x] 2.2 `tests/stats.test.ts`：去重用例改为按 durable 身份（同 key 重复只计一次、不同 key 各自累计、空 key 不去重），全部通过

## 3. 探针与临时代码清理

- [x] 3.1 `src/index.ts`：移除 TEMP-DEBUG 全部内容（`PM-SETUP`/`setupSeq`、`events.jsonl`/`commit.jsonl` 写入、`writeFileSync`/`appendFileSync` 探针导入、`setupSeq` 声明），`bun x tsc --noEmit` + `bun test` 通过
- [x] 3.2 `src/stats.ts`：移除 `record-raw.jsonl` 探针（`recordUsage` 内调试块），`bun x tsc --noEmit` + `bun test` 通过

## 4. 配置与测试环境还原

- [x] 4.1 全局 `C:\Users\nixgn\.config\opencode\opencode.jsonc` 还原：`package` 改回 `file:///D:/code/opencode-plan-mate`、`logDir` 改回 `C:/Users/nixgn/Downloads`、删除测试 `statsDir`；用 `openspec` 无关的 JSONC 校验（如 GUI 重启后插件按 master 路径加载）
- [x] 4.2 删除 `C:\Users\nixgn\Downloads\cache\Temp\opencode\itest-usage\` 临时测试目录（`.opencode` 测试配置、run 产物、日志）

## 5. 集成验证

- [ ] 5.1 还原配置后重跑 standalone 验证（`opencode-cli.exe run --standalone`）：usage 日志每条 step 只记 1 次、无历史会话重复记录、`plan_mate_stats` 返回非空且 per-provider 归因与轮询日志一致
- [ ] 5.2 全量校验：`bun test`、`bun x tsc --noEmit`、`bun run build` 通过；`openspec validate fix-usage-dedupe-replay` 与 `openspec validate fix-usage-tracking-v2` 均通过；提交两个 change（含 `fix-usage-tracking-v2` 的 5.1/5.2 收尾）
