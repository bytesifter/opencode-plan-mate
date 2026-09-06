## 1. 类型与配置

- [x] 1.1 `src/types.ts`:新增 `StatsRecord` 接口（`day`、`provider`、`req`、`in`、`out`、`reasoning`、`cacheRead`、`cacheWrite`、`cost`）
- [x] 1.2 `src/types.ts`:`ParsedOptions` 将 `statsPath?: string` 改为 `statsDir?: string`
- [x] 1.3 `src/config.ts`:`parseOptions` 解析 `statsDir`（对应 D5）

## 2. StatsCollector 改造（src/stats.ts）

- [x] 2.1 构造函数改为接收 stats 目录，`mkdirSync(dir, { recursive: true })`，删除 `load()` 调用；构造签名/参数同步更新调用方
- [x] 2.2 新增 `private pending: StatsStore = {}`；将 `commitToStore` 中的累加逻辑抽成 `addTo(store, day, provider, info)` 辅助函数，同时累加到 `store` 与 `pending`（对应 D2）
- [x] 2.3 重写 `flush()`:遍历 `pending`，每 `(day, provider)` 用 `appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify({day, provider, ...stats}) + "\n")` 追加一行，随后清空 `pending`；空 `pending` 时不写文件（对应 D1/D3）
- [x] 2.4 删除 `load()` 与 `isCompatibleFormat`（无单文件可读）；`getStore()` 保留返回本进程内存视图
- [x] 2.5 新增 `aggregateStats(dir: string, days: number): StatsStore`:读取最近 N 天的 `YYYY-MM-DD.jsonl`，逐行解析，按 `(day, provider)` 逐字段求和，无法解析的行跳过（对应 D4）

## 3. 插件入口（src/index.ts）

- [x] 3.1 统计路径默认值从 `round-robin-stats.json` 改为 `round-robin-stats/` 目录（`defaultPath` 语义调整）
- [x] 3.2 `roundrobin_stats` 工具执行体改为:先 `globalStats!.flush()`，再 `aggregateStats(statsDir, days)`，最后 `renderChart(store, days)`（对应 D4）

## 4. 测试

- [x] 4.1 `tests/stats.test.ts`:更新"flush 写入并重新加载"测试——改为验证 flush 后 `stats/<day>.jsonl` 出现增量行、`aggregateStats` 读回正确值
- [x] 4.2 `tests/stats.test.ts`:删除"旧格式文件丢弃"测试（不再有单文件 load）
- [x] 4.3 `tests/stats.test.ts`:新增多进程模拟测试——两个 collector 追加到同一目录，`aggregateStats` 求和等于两者之和
- [x] 4.4 `tests/stats.test.ts`:新增"重复 flush 不重复追加"测试（无新增量时不写行）
- [x] 4.5 `tests/stats.test.ts`:新增"损坏行跳过"测试（`aggregateStats` 遇非法 JSON 行不中断）
- [x] 4.6 `tests/chart.test.ts`:如测试直接构造 `StatsStore` 调用 `renderChart`，确认无需改动；否则适配

## 5. 构建与校验

- [x] 5.1 运行 `bun run typecheck` 通过
- [x] 5.2 运行 `bun test` 全部通过
- [x] 5.3 运行 `bun run build` 成功产出 `dist/index.js`
- [x] 5.4 更新 `README.md`:统计配置 `statsPath` → `statsDir`，说明按日 JSONL 存储与多进程聚合
