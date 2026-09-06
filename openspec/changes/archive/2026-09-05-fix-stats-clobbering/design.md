## Context

现状（详见 proposal.md - Why）：`StatsCollector` 启动时把整个 `round-robin-stats.json` 读入各自内存，每 60 秒将各自全量内存快照整体覆盖写回同一文件（read-modify-write + last-writer-wins）。多个并发 opencode 进程互相覆盖，旧进程把新进程的统计抹掉；`roundrobin_stats` 工具又只读本进程内存，看到的是局部过期数据。

约束：
- 零 npm 依赖（`bun build` 内联分发，README 声明自包含）
- 运行环境为 bun 运行时（opencode 内置），`bun:sqlite` 可用但引入新存储范式
- 现有 `StatsStore` / `ProviderStats` 类型、`chart.ts`、`recordUsage` 去重逻辑均有效，尽量复用

## Goals / Non-Goals

**Goals:**
- 多进程并发追加统计不互相覆盖（消除 read-modify-write 竞争）
- `roundrobin_stats` 工具展示跨进程聚合后的完整数据
- 保持零依赖、最小改动面（不动去重、不动图表渲染、不动 Provider 轮询）
- 崩溃最多丢 60 秒增量（与现状一致）

**Non-Goals:**
- 不实现 opencode 配置热重载（用户明确排除）
- 不迁移旧的 `round-robin-stats.json` 历史数据（已被并发覆盖，无价值）
- 不做按 provider 的日志/统计联动，不加版本化 schema 校验
- 不解决"旧 opencode 进程池不含新 provider"的问题（那是配置快照语义，属另一问题）

## Decisions

### D1: 追加式按日 JSONL（方案 B）而非其它持久化方案

在并发进程共享同一存储时，从"覆盖整个快照"改为"追加增量"。每次 `appendFileSync`（O_APPEND + 单次 write）对文件偏移是原子的，多进程追加天然不交错、不覆盖，无需锁、无 read-modify-write 竞争。

**备选方案及否决理由：**
- **单 JSON + 文件锁 + 增量合并**：正确性依赖自研锁 + 陈旧锁恢复，最容易埋死锁/竞态 bug，复杂度不成比例。
- **bun:sqlite**：UPSERT 语句级原子、WAL 并发，最稳；但产物变二进制、工具改 SQL、迁移旧数据，改动面远超"修统计"的诉求。
- **每进程独立 JSON + 工具 glob 求和**：需处理死进程残留文件的清理与保留策略，留尾账。

### D2: `pending` 增量追踪，复用 `StatsStore` 类型

`recordUsage` 去重逻辑不动；提交时把增量同时累加进：
- `store`（本进程内存视图，测试/即时用）
- `pending`（自上次 flush 以来的增量）

`pending` 与 `store` 同型（`StatsStore`），复用 `newProviderStats()` 工厂。`flush()` 遍历 `pending`，每 `(day, provider)` 序列化一行 `{day, provider, ...ProviderStats}` 追加到 `stats/<day>.jsonl`，然后清空 `pending`。增量记录结构与 `ProviderStats` 完全同形，只是语义从"累计值"变为"增量"——聚合就是逐字段求和，不需要新数据结构。

### D3: 每条记录 = flush 窗口内 (day, provider) 的合并增量（req 可 >1）

而非逐事件一行。行数更少、IO 更小；逐事件信息与现有结构化日志高度重复，价值低。

### D4: 工具数据源改为磁盘聚合，先 flush 再读

`roundrobin_stats` 执行体改为：`globalStats.flush()`（先落盘本进程最新增量）→ `aggregateStats(statsDir, days)`（读取最近 N 天文件、求和为 `StatsStore`）→ `renderChart(store, days)`。`chart.ts` 与现有渲染逻辑零改动。这直接修复"工具看不到其它进程/新 provider 数据"的问题。

### D5: `statsPath` → `statsDir`（目录语义）

单文件 JSON 不再存在，配置项从文件路径改为目录。默认 `~/.local/share/opencode/round-robin-stats/`，文件名 `YYYY-MM-DD.jsonl`（与日志按日轮转命名一致）。

### D6: 旧 JSON 不迁移

旧 `round-robin-stats.json` 历史数据已因并发覆盖而不完整，直接不读取、不迁移。首次升级后统计从空开始，保留旧文件由用户自行处理。

## Risks / Trade-offs

- **[崩溃丢失 ≤60 秒未落盘增量]** → 与现状一致（README 已声明）；`beforeExit` 兜底，工具调用前先 `flush()` 缩小窗口。
- **[单日 JSONL 文件无限增长]** → 按日轮转已天然限制单文件大小；后续可加保留天数清理（非本期）。
- **[格式变更破坏向后兼容]** → 已标记 **BREAKING**；旧配置 `statsPath` 会被忽略，需改配 `statsDir`。
- **[读取聚合时并发追加]** → 聚合读文件时可能有进程在追加；追加是行级原子，读到半行则跳过（容错），最多少计一条即将落盘的增量，可接受。
- **[跨进程重复计数]** → 每个进程各自按 (id, token 快照) 去重后才计入 `pending`，不同进程的 session 不相交，聚合求和不会重复计同一请求。
