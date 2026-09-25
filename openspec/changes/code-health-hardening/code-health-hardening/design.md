# Design

## Context

见 `proposal.md - Why`。基线要点（影响本设计的现状）：

- `src/stats.ts` 导出 `todayLocal()` 且 `tests/stats.test.ts` 从 `../src/stats` 直接 import 它（消重时需保持 re-export 兼容）
- `StatsCollector.getStore()` 虽在 `src/` 内无人调用，但 `tests/stats.test.ts` 广泛依赖它校验内存累计——**不是死代码，保留**
- `ProviderPool` 已有 `byBaseURL` 索引（`src/pool.ts:19`），缺 key 级索引
- `http-hooks.ts` 的 `startTimes` 只在响应到达且 key 匹配时删除（`:100-103`）
- 事件订阅循环（`src/index.ts:125-137`）`for await` 内 `await handleEvent(...)` 无 try/catch

## Goals / Non-Goals

**Goals:**
- 全部改动保持「正常路径可观察行为不变」：JSONL 结构、日志格式、图表输出、轮询/熔断语义均不变
- 收敛重复工具函数、清理死代码、消除热路径 O(n) 扫描与请求体全量读取
- 错误路径健壮性：事件循环不死、`startTimes` 不泄漏、spawn 错误分类准确

**Non-Goals:**
- 不改 provider 归因逻辑（H1：corrMap 账号名 vs fallback providerID 是 D3 有意设计，本次只补文档说明）
- 不做异步 I/O 改造（`appendFileSync` 热路径权衡留给未来，涉及崩溃丢数据窗口决策）
- 不引入新依赖

## Decisions

### D1: 公共工具函数收敛到 `src/util.ts`,`stats.ts` 保留 re-export

`num()`（`stats.ts:185` / `event-adapter.ts:172` / `quota.ts:249` 三处）与 `todayLocal()`（`stats.ts:190` / `logger.ts:134` 两处）迁入新建 `src/util.ts`。`stats.ts` 对 `todayLocal` 保留 `export { todayLocal } from "./util"` 式 re-export，保证 `tests/stats.test.ts:2` 的既有 import 不断。`logger.ts` 改用 util 版本后删除本地定义。

- 备选：迁入 `src/fs-util.ts` —— 语义不符（fs-util 只管目录幂等）。弃用。
- 备选：只消重不抽模块（互相 import）—— 会在 stats/logger 间制造循环依赖风险。弃用。

### D2: 死代码清理（仅 3 项）

- `types.ts:86-94` 的 `EventContext.modelID / agent / mode / durationMs` 从未被填充（`index.ts:170-173` 只设 `sessionID` / `providerID`），删除字段；`logger.ts:94-98` 对应条件分支一并删除
- `quota.ts:139,144` 的 `col(pad(q.provider, COL_W))` —— `pad` 已保证宽度 `COL_W`，外层 `col` 是 no-op，简化为 `pad(q.provider, COL_W)` 直接拼接
- `getStore()` 保留（测试依赖）

### D3: `ProviderPool` 增加 key 级索引,消除 O(n) 扫描

构造时在既有 `byBaseURL` 之外建立三个 Map：

```
byKeyIndex   Map<key, number>          // entries 数组序,替代 keyIndex() 线性 findIndex
byKeyEntry   Map<key, ProviderEntry>   // 替代 entryByKey() 线性 find
byKeyAccount Map<key, string>          // 替代 accountName() 线性 find
```

`findBaseURL(url)` 改为遍历 `byBaseURL` 的键（Map 保持插入序 == entries 序，首个 `url.startsWith(baseURL)` 与现行为一致），复杂度从 O(entries) 降到 O(唯一 baseURL 数)。`keyIndex` 对未知 key 返回 -1 的语义不变（Map `get` miss 返回 undefined → 显式 `?? -1`）。

- 备选：`findBaseURL` 也建前缀树 —— 账号数少时过度设计。弃用。

### D4: `extractModel` 加"模型集一致"守卫,跳过请求体读取

pool 构造时对每个 baseURL 组计算模型指纹（`models` 排序后 join）；同组内**所有**条目的指纹一致时标记 `needsModel=false`。`handleHttpRequest` 在 `pool.next(model, baseURL)` 前先查 `pool.hasModelVariance(baseURL)`：无差异时直接 `pool.next(undefined, baseURL)`，跳过 `extractModel` 的 clone+读全文+JSON.parse。

行为等价性：现逻辑中「model 无匹配时退化为同接入点全池」（`pool.ts:55-58`），而模型集一致时过滤结果恒等于全池，跳过 body 读取不改变选池结果。

- 备选：仅读 body 前缀/流式解析 —— 实现复杂且收益相近。弃用。

### D5: 事件订阅循环逐事件错误隔离

`src/index.ts:134-135` 的 `await handleEvent(...)` 包 try/catch：单事件处理抛错时捕获并跳过，循环继续。错误可选记一行到 stderr（不写业务日志文件，避免错误风暴污染旋转日志）。实现为在 `for await` 循环体内：

```
try { await handleEvent(...) } catch { /* 跳过,循环继续 */ }
```

与 `specs/usage-tracking` 新增需求「事件处理异常隔离」对应。

### D6: `startTimes` 泄漏修复

两处配合：
- 响应路径**无条件清理**：`handleHttpResponse` 中把 `startTimes.delete(startKey)` 提到 key 匹配检查之前执行（即使 `entryByKey` miss / 无 key，只要 sessionID:kind 可构造就删），消除"响应到达但未清理"路径
- **TTL 上限**：`startTimes.set` 时顺带清理超过阈值（如 10 分钟）的旧条目，兜底"请求被 abort、永远等不到 response"的泄漏路径，保证 Map 有界

### D7: spawn 超时与 ENOENT 错误分类区分

`SpawnResult` 增加可选字段 `timedOut?: boolean`（`types.ts:130-135`，加字段向后兼容）。`defaultSpawn` 超时 `child.kill()` 后在 close 回调中置 `timedOut: true`（`quota.ts:52`）。`volcArkcliAdapter.fetch` 先判 `res.timedOut` → 报「arkcli 查询超时」，再判 `exitCode === null` → 现有 ENOENT 分类。正常路径无感知。

- 备选：用特殊 exitCode 编码 —— 魔法值侵入既有契约。弃用。

### D8: provider 归因粒度文档说明（不改逻辑）

`docs/user-guide/plan-mate-stats.md` 用量统计小节补充说明：`provider` 键在 corrMap 命中时记**池账号名**，fallback（全熔断 passthrough / 池外 provider）时记**会话 model 的 providerID**；在文档化配置（provider 键即 provider id，如 `account-a`）下两者同串不产生混合列，仅在池外 provider 场景出现额外厂商粒度列。

## Risks / Trade-offs

- [D4 指纹计算与真实 models 集合漂移] → 指纹在构造时基于配置快照计算，与 `pool.next` 的 `models.includes` 过滤使用同一数据源，一致性有保证
- [D3 Map 索引与 entries 顺序耦合] → `keyIndex` 的"列表序号"语义依赖构造顺序，索引构建复用同一循环，顺序天然一致
- [D5 错误被静默吞掉] → 单事件错误不可见性增加；以 stderr 记录换取订阅存活，符合 spec 的隔离要求
- [D6 TTL 阈值误删慢请求] → 10 分钟阈值远大于正常请求时长，仅影响"响应永远不来"的异常路径
- [D7 `timedOut` 字段触及 SpawnResult 契约] → 加字段是向后兼容增量，`quota.test.ts` 注入的 fake 执行器不受影响

## Migration Plan

1. 在 worktree 实现代码与测试,`bun test` + `bunx tsc --noEmit` + `bun run build` 全绿
2. `openspec validate code-health-hardening` 通过
3. 重启 opencode GUI 后台服务,跑一轮真实多步对话,核对:图表输出与改动前一致(账号列、数量级相同)、日志格式不变、无回归
4. 回滚:切回 master + 重构建 `dist/`(插件经 `file:///` 指向仓库目录,无独立部署)

## Open Questions

（无——所有影响 spec/方案/任务拆分的问题均已在本设计中定案）
