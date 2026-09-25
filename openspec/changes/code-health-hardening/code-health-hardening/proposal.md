# Proposal

## Why

代码审计（2026-09-25）发现三类问题：行为不变的代码卫生问题（工具函数重复、死代码、O(n) 线性扫描、请求体全量读取）、事件处理链错误路径的健壮性缺陷（订阅循环无异常隔离、`startTimes` 内存泄漏、spawn 超时与 ENOENT 错误分类混淆），以及 provider 归因粒度的文档缺口（池账号名与 fallback providerID 混用是 `fix-usage-tracking-v2` D3 的有意设计，**不改行为**，仅需文档说明）。本次一次性收敛，**不改变正常业务逻辑**——优化与修复都以「正常路径可观察行为不变」为前提。

## What Changes

- **公共工具函数收敛**：`num()`（`stats.ts` / `event-adapter.ts` / `quota.ts` 三处重复）、`todayLocal()`（`stats.ts` / `logger.ts` 两处重复）抽取到公共模块
- **死代码清理**：删除 `EventContext` 未使用字段（`modelID` / `agent` / `mode` / `durationMs`）及 `logger.ts` 对应分支、简化 `quota.ts` 渲染双重 pad。`StatsCollector.getStore()` 保留（测试依赖其校验内存累计，非死代码）
- **性能优化（行为不变）**：`ProviderPool` 的 `findBaseURL` / `entryByKey` / `keyIndex` / `accountName` 线性扫描改 Map 索引；`extractModel` 在「同接入点内所有条目模型集一致」时跳过请求体读取
- **健壮性（仅错误路径）**：事件订阅循环每事件错误隔离，单事件处理抛错不再中断整个统计流；`startTimes` 泄漏条目清理；spawn 超时（kill）与 ENOENT 错误分类区分
- **文档**：`plan_mate_stats` 用户指南补充 provider 键粒度说明（corrMap 账号名 vs fallback providerID），不改变归因逻辑

## Capabilities

### New Capabilities

（无——其余改动均为行为不变的重构/清理/性能/文档）

### Modified Capabilities

- `usage-tracking`: 新增「事件处理异常隔离」需求——单事件处理抛错 SHALL NOT 中断订阅循环（当前实现中 `handleEvent` 抛错会终止 `for await` 循环，导致后续所有统计静默失效）

## Impact

- 代码：`src/pool.ts`、`src/http-hooks.ts`、`src/stats.ts`、`src/logger.ts`、`src/quota.ts`、`src/event-adapter.ts`、`src/types.ts`、`src/index.ts`，新增公共工具模块（`src/fs-util.ts` 或新建 `src/util.ts`）
- 测试：`tests/` 各对应文件需回归（行为不变部分）；新增事件错误隔离测试
- 无依赖变更；JSONL 格式、日志格式、图表输出均不变；无数据迁移
