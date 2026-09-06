## Why

多个并发的 opencode 进程共享同一个 `round-robin-stats.json`。`StatsCollector` 在启动时把整个文件读入各自内存，每 60 秒又把**各自的全量内存快照整体覆盖写回**同一文件（read-modify-write + last-writer-wins）。旧进程（配置变更前启动）每次落盘就把新进程的统计抹掉——实测 `volhwy2410` 明明在被使用，统计文件却反复被"只剩 3 个旧 provider"的版本覆盖。`roundrobin_stats` 工具又只读**本进程内存**，所以看到的始终是局部、过期的数据。

## What Changes

- **BREAKING** 统计落盘从"单文件整体覆盖 JSON"改为**追加式按日 JSONL**：每个进程每 60 秒只把自上次 flush 以来的**增量**追加到 `stats/<YYYY-MM-DD>.jsonl`，追加（O_APPEND 单次 write）天然原子，多进程并发不互相覆盖
- **BREAKING** `statsPath` 配置项改为 `statsDir`（目录），默认 `~/.local/share/opencode/round-robin-stats/`；旧 `round-robin-stats.json` 不再读取（历史数据已被覆盖、无迁移价值，不迁移）
- 新增 `pending` 增量追踪：`recordUsage` 去重逻辑不变，仅把提交的增量同时累加到内存视图与 `pending`；`flush()` 改为追加 `pending` 并清空
- `roundrobin_stats` 工具改为**现读磁盘聚合**（`aggregateStats`）：先触发本进程 `flush()`，再聚合最近 N 天的 JSONL 文件，跨进程数据完整可见
- 新增 `StatsRecord` 类型（一行增量记录），聚合时逐字段求和回到现有 `StatsStore` 形状，`chart.ts` 无需改动

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `usage-tracking`: 统计持久化模型从"单文件整体 JSON 覆盖"改为"追加式按日 JSONL 增量"，新增跨进程并发正确的聚合读取；`roundrobin_stats` 工具数据源从本进程内存改为磁盘聚合

## Impact

- `src/types.ts`: `ParsedOptions.statsPath` → `statsDir`；新增 `StatsRecord`
- `src/stats.ts`: `StatsCollector` 增加 `pending`、`flush()` 改为追加 JSONL、移除 `load()`（无单文件可读）、新增 `aggregateStats()`
- `src/index.ts`: 工具执行体改为 `flush()` + `aggregateStats()`；默认统计目录
- `src/config.ts`: 解析 `statsDir`
- `src/chart.ts`: 不改（入参仍是 `StatsStore`）
- `tests/stats.test.ts`: 更新 flush/reload 与旧格式测试，新增多进程追加求和、增量不重复、损坏行容错测试
