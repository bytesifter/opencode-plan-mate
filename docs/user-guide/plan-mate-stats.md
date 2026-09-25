# 轮询与用量统计

## 轮询机制

插件对多个账号的 API key 做**随机轮询**：每次请求随机选一个 provider，替换 Authorization 头。按**接入点（baseURL）+ 模型**分组轮询，同接入点内随机，不跨接入点（同接入点 baseURL 不变，URL 不变，仅换 key）。

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
该接入点下、支持该模型（解析请求 body 的 model）的 provider 中随机选一个
    │
    ▼
替换 Authorization 头（URL 不变），记录 sessionID-provider 关联
    │
    ▼
ctx.session.hook("http.response") 钩子：检查 429/402，触发熔断
```

## 429/402 熔断

- **请求太快 429**：默认熔断 1 分钟（`cooldownMs`，可配），key 暂时停用
- **配额耗尽 429**：默认熔断 1 小时（`quotaCooldownMs`，可配），key 长时间停用
- **余额不足 402**（Insufficient Balance）：按配额耗尽熔断 1 小时
- 全部熔断时 passthrough 回退到 opencode 原生请求，不跨接入点兜底

## 用量统计（plan_mate_stats）

插件通过 `ctx.event.subscribe()` 订阅 v2 事件 `session.step.ended` / `session.step.failed`（每次模型 step 结束/失败各发一次，数据在 `data` 字段），按天累计请求数与 token 消耗（input/output/reasoning/cache），内存累积 60 秒把增量**追加式**写入按日 JSONL（多进程并发不互相覆盖）。`plan_mate_stats` 工具聚合所有进程的数据。

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
