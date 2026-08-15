## Why

当前用量统计只有日维度汇总（请求数 + token 总量），无法看到每个 provider（账号）各自的请求分布与 token 消耗。此外，多步对话（工具调用）场景下 `recordUsage` 存在 bug：第一步 `finish="tool-calls"` 即触发提交并标记 committed，导致后续步骤的 token 被丢弃，统计数据偏低。

## What Changes

- **BREAKING** 统计数据模型从 `Record<date, DayStats>` 改为 `Record<date, Record<provider, ProviderStats>>`，日维度通过遍历 provider 求和获得，不再单独存储
- **BREAKING** `round-robin-stats.json` 格式变更，旧格式文件不兼容（加载时按空统计处理）
- fetch-patch 读取 opencode 已注入的 `X-Session-Id` 请求头，建立 `sessionID -> provider` 关联映射（corrMap），用于将 event 层的 token 数据归因到实际服务的 provider
- 修复多步 token 丢失 bug：以 token 快照变化检测替代 `committed` Set 去重，每次 token 变化（即新 step）都累加，相同 token 的重复事件（如 cleanup re-emission）跳过
- passthrough（全熔断）时 corrMap 无记录，fallback 到 `info.providerID` 归因
- 图表工具改为 per-provider 视图（每个 provider 一列请求数与 token），保留 `days` 参数

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `usage-tracking`: 数据模型改为 per-provider 维度；去重逻辑从 committed-set 改为 token-snapshot 比较（修复多步丢失）；新增 fetch-patch 层的 sessionID-provider 关联机制；图表工具改为 per-provider 展示

## Impact

- `src/types.ts`: `StatsStore` / `DayStats` 类型重构为 per-provider 结构
- `src/stats.ts`: `StatsCollector` 去重逻辑重写（删除 committed/buffer，新增 lastTokens Map），`commitToStore` 改为按 provider 累加
- `src/fetch-patch.ts`: 读取 `X-Session-Id` 头，通过回调暴露 sessionID，strip 该头不发给 API
- `src/index.ts`: 新增 corrMap，event hook 查 corrMap 获取 provider，传给 `recordUsage`
- `src/chart.ts`: 重写为 per-provider 柱状图
- `tests/stats.test.ts`: 更新测试覆盖多步累加 + per-provider 归因
- `tests/chart.test.ts`: 更新图表测试
- `tests/fetch-patch.test.ts`: 新增 X-Session-Id 读取测试
