## 1. 数据模型重构

- [x] 1.1 `types.ts`: 新增 `ProviderStats` 接口（req/in/out/reasoning/cacheRead/cacheWrite/cost），`StatsStore` 改为 `Record<string, Record<string, ProviderStats>>`（date -> provider -> stats），删除旧 `DayStats`
- [x] 1.2 `stats.ts`: `newDayStats()` 改为返回 `Record<string, ProviderStats>`（空对象），`commitToStore` 改为按 provider 累加

## 2. 修复多步 token 丢失 bug

- [x] 2.1 `stats.ts`: 删除 `committed: Set<string>` 和 `buffer: Map<string, UsageInput>`，新增 `lastTokens: Map<string, TokenSnapshot>`
- [x] 2.2 `stats.ts`: `recordUsage` 重写--比较 token 快照，不同则累加 + req++，相同则跳过；返回是否累加
- [x] 2.3 `stats.ts`: `commitToStore` 接收 provider 参数，累加到 `store[day][provider]`
- [x] 2.4 `stats.ts`: `stop()` / `onBeforeExit` 中删除 `drainBuffer()`（buffer 已移除），保留 flush
- [x] 2.5 `stats.ts`: 新增终态 finish 时清理 `lastTokens` 条目的逻辑

## 3. fetch-patch 层 X-Session-Id 关联

- [x] 3.1 `fetch-patch.ts`: `FetchPatchCallbacks` 新增 `onCorrelate?: (sessionID: string, account: string) => void` 回调
- [x] 3.2 `fetch-patch.ts`: 在 `patchedFetch` 中，选中 entry 后读取 `headers.get("X-Session-Id")`，若存在则调 `onCorrelate(sessionID, entry.account)`，并 `headers.delete("X-Session-Id")`
- [x] 3.3 `fetch-patch.ts`: passthrough（全熔断 / URL 不匹配）时不调 `onCorrelate`

## 4. index.ts 编排 corrMap 与 event 归因

- [x] 4.1 `index.ts`: 新增模块级 `corrMap: Map<string, string>`（sessionID -> account）
- [x] 4.2 `index.ts`: `patchFetch` 调用中传入 `onCorrelate` 回调，写入 corrMap
- [x] 4.3 `index.ts`: event hook 中，`recordUsage` 调用时传入 provider：`corrMap.get(info.sessionID) ?? info.providerID`
- [x] 4.4 `index.ts`: event hook 中，`info.finish` 为 `stop` 或 `error` 时，`corrMap.delete(info.sessionID)` 和 `lastTokens` 清理

## 5. 图表工具重写

- [x] 5.1 `chart.ts`: `renderChart` 重写为 per-provider 视图——每行一个日期，按 provider 分列展示请求数与 token
- [x] 5.2 `chart.ts`: 日维度汇总通过遍历当天所有 provider 求和
- [x] 5.3 `chart.ts`: 保持 `days` 参数与"暂无统计数据"提示

## 6. 旧格式兼容

- [x] 6.1 `stats.ts`: `load()` 检测旧格式（日期值含 `req` 字段而非 provider 嵌套），置空 store

## 7. 测试更新

- [x] 7.1 `tests/stats.test.ts`: 更新多步对话场景——同 id 两步不同 token 均累加，req=2
- [x] 7.2 `tests/stats.test.ts`: 新增相同 token 快照 re-emission 跳过场景
- [x] 7.3 `tests/stats.test.ts`: 新增 per-provider 归因场景（不同 provider 分别累加）
- [x] 7.4 `tests/stats.test.ts`: 新增旧格式文件丢弃场景
- [x] 7.5 `tests/fetch-patch.test.ts`: 新增 X-Session-Id 读取 + 删除 + onCorrelate 回调场景
- [x] 7.6 `tests/fetch-patch.test.ts`: 新增无 X-Session-Id 头时不回调场景
- [x] 7.7 `tests/chart.test.ts`: 更新为 per-provider 图表格式

## 8. 构建与验证

- [x] 8.1 `bun x tsc --noEmit` 类型检查通过
- [x] 8.2 `bun test` 全部测试通过
- [x] 8.3 `bun run build` 构建成功
