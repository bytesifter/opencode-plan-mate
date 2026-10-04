# 轮询与用量统计

## 轮询机制

插件对多个账号的 API key 做**随机轮询**：每次请求随机选一个 provider，替换 Authorization 头。按**接入点（baseURL）+ 模型**分组轮询，同接入点内随机，不跨接入点（同接入点 baseURL 不变，URL 不变，仅换 key）。选池带**在途感知**：优先选当前在途请求数最少的非熔断 provider（同在途数时随机），降低多个会话并发时同账号瞬时重叠。

```
请求进入（opencode v2 会话）
    │
    ▼
ctx.session.hook("http.request") 钩子
    │
    ├─ URL 不匹配任何已配置 baseURL ──► passthrough（opencode 原生请求）
    │
    ▼
定位接入点（原始 baseURL）
    │
    ▼
该接入点下、支持该模型（解析请求 body 的 model）的 provider 中，选在途最少的非熔断 provider
    │
    ▼
替换 Authorization 头（URL 不变），打兜底标记，记录 sessionID-provider 关联，在途计数 +1
    │
    ▼
ctx.session.hook("http.response") 钩子：检查 429/402，触发熔断，在途计数 -1
```

## 兜底层（全局 fetch）—— 覆盖绕过 session 钩子的请求

opencode 的部分请求（如会话恢复/排空 drain 路径）走 core 层 `SessionRunner` → `FetchHttpClient`（全局 fetch），**不经过** `session.hook("http.request")` 钩子。若这些请求用会话原生绑定的单账号直发，会绕过 key 轮询与熔断，导致单账号被反复 429 限流。

插件默认安装**全局 fetch 兜底层**（patch `globalThis.fetch`，`fetchPatch` 选项可关，默认 true）：拦截走全局 fetch 但未被钩子处理的、URL 匹配池 baseURL 的请求，纳入与钩子路径相同的轮询与熔断。

```
绕过钩子的请求（drain/恢复路径）
    │
    ▼
globalThis.fetch（兜底层 patch）
    │
    ├─ URL 不匹配池 baseURL ──► 原样放行（opencode 内部请求不受影响）
    ├─ 已带兜底标记（钩子已处理）──► 放行，不重复轮询
    ├─ 全熔断 ──► 原样放行
    │
    ▼
选在途最少的非熔断 provider → 替换 Authorization → 原始 fetch 转发
    │
    ▼
响应：429/402 分类熔断 + 日志/统计（与钩子路径同一 pool，状态一致）
```

**双轨去重**：session 钩子处理的请求带标记头（`x-opencode-plan-mate-pooled`），兜底层见到标记即放行，两条路径不会重复轮询；熔断与统计共用同一 `ProviderPool`，任一路径标记的熔断另一路径立即感知。

## 429/402 熔断

- **请求太快 429**：默认熔断 1 分钟（`cooldownMs`，可配），key 暂时停用
- **配额耗尽 429**：默认熔断 1 小时（`quotaCooldownMs`，可配），key 长时间停用
- **余额不足 402**（Insufficient Balance）：按配额耗尽熔断 1 小时
- 全部熔断时 passthrough 回退到 opencode 原生请求，不跨接入点兜底

> 熔断与在途计数在钩子路径与兜底路径间共享：兜底路径（drain）收到 429 标记的 key，钩子路径的下一次 `next()` 同样跳过；在途计数同理，超时（10 分钟）自动清理防泄漏。

## 用量统计（plan_mate_stats）

插件通过 `ctx.event.subscribe()` 订阅 v2 事件 `session.step.ended` / `session.step.failed`（每次模型 step 结束/失败各发一次，数据在 `data` 字段），按天累计请求数与 token 消耗（input/output/reasoning/cache），内存累积 60 秒把增量**追加式**写入按日 JSONL（多进程并发不互相覆盖）。`plan_mate_stats` 工具聚合所有进程的数据。

**provider 归因粒度**：统计的 `provider` 键在两种来源下取值不同——请求经过轮询池（URL 匹配已配置 baseURL）时记**池账号名**（如 `account-a`）；请求未经过池（全熔断 passthrough、或会话使用池外 provider）时记**会话 model 的 providerID**。文档化配置中池账号名即 provider id（如 `account-a`），两种来源为同一字符串，不产生混合列；仅当会话使用池外 provider 时才可能出现额外的厂商粒度列（如 `volcengine`），该列语义为「池外/未接住的流量」。

插件按**位置（目录）过滤**事件：GUI 打开多个项目时，每个位置各加载一份插件实例，而事件流是全局的——各实例只处理 `event.location.directory` 等于自己加载目录的会话事件，其他位置的会话不累计，避免多实例重复计数。实例内另有 durable 事件身份去重（同一步只计一次）与回放过滤（忽略服务重启后回放的历史事件）。

对 LLM 说「看轮询统计」，LLM 会调用 `plan_mate_stats` 工具，返回近 7 天 ASCII 柱状图：

```
plan-mate 近 7 天统计
日期      请求                 token
07-25  ████████████·····    34   ████████████·····   19.7k
07-24  ████████·········    23   ██████············   15.3k
07-23  █████████████████    67   █████████████████   38.3k
...
```

可选参数 `days` 指定天数（如「看近 30 天统计」）。

统计文件位置：`~/.local/share/opencode/plan-mate-stats/YYYY-MM-DD.jsonl`（Windows：`%USERPROFILE%\.local\share\opencode\plan-mate-stats\YYYY-MM-DD.jsonl`；可用 `statsDir` 覆盖）。

### TPM 窗口观测（病 C 验证）

`plan_mate_stats` 在柱状图后追加**按账号 60s 窗口 token 分布**（p50 / p90 / max），数据来自今日日志的 usage 行（每次 step 的 token 总量，含 cache 读）：

```
plan-mate 每账号 60s 窗口 token 分布
provider                 p50         p90         max  n
volhwy2410           863,750   2,474,058   3,976,457  667
vollc5427            556,995   1,497,143   2,940,990  402
```

**观测方法**：火山 Coding Plan 的 "Requests are too frequent"（`AccountRateLimitExceeded`）是 **RPM/TPM 限流**（每分钟请求数 / token 数），不是单并发。实际触发与服务端的滑动窗口与突发判定有关，客户端无法精确建模。修复效果的验证口径是：**兜底层 + 在途感知落地后，同账号 60s 窗口 token 的 p90/max 是否下降、429 次数是否随同账号重叠减少**。对比方式：用 `plan_mate_stats` 的窗口表 + 日志中 `cooldown ... rate-limit` 事件的时刻，观察 429 是否还发生在窗口峰值附近。

## 结构化日志

日志按日轮转，文件名 `plan-mate-YYYY-MM-DD.log`（配置 `logPath` 可强制单文件模式，禁用轮转）。

```
2026-07-26 18:51:40.123 INFO  fetch provider=account-a key=#0(..2898) status=200 duration=342ms
2026-07-26 18:52:08.456 INFO  usage in=4556 out=2182 reasoning=0 cacheR=312384 cacheW=0 cost=0.0021 session=a3f2d9c1 provider=account-a
2026-07-26 18:53:00.789 WARN  cooldown provider=account-b key=#1(..2a5b) rate-limit 60000ms
2026-07-26 18:54:00.123 WARN  cooldown provider=account-c key=#2(..4819) quota-exhausted 3600000ms
2026-07-26 18:55:00.456 WARN  cooldown provider=account-d key=#3(..1a2c) quota-exhausted 3600000ms
```

- 第一行（fetch 层）：用了 account-a 账号的 key#0，HTTP 200，耗时 342ms
- 第二行（event 层）：本次 step 的 token 用量，含 sessionID（前 8 位）与实际服务的 provider（v2 step 事件不含 model/mode/agent/duration）
- 第三行（请求太快）：account-b 被限流，冷却 60 秒
- 第四行（配额耗尽）：account-c 配额用完，冷却 1 小时
- 第五行（余额不足）：account-d 收到 402 响应，按配额耗尽冷却 1 小时

key 脱敏：只记录序号与末 4 位。
