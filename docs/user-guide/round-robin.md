# 轮询与用量统计

## 轮询机制

插件对多个账号的 API key 做**随机轮询**：每次请求随机选一个 provider，替换 Authorization 头和请求 URL。按**接入点（baseURL）+ 模型**分组轮询，同接入点内随机，不跨接入点。

```
请求进入（opencode 原生）
    │
    ▼
fetch-patch 拦截
    │
    ├─ URL 不匹配任何已配置 baseURL ──► passthrough（opencode 原生请求）
    │
    ▼
定位接入点（原始 baseURL）
    │
    ▼
该接入点下、支持该模型（解析 body 的 model）的 provider 中随机选一个
    │
    ▼
替换 Authorization 头 + URL，发出请求
```

## 429/402 熔断

- **请求太快 429**：默认熔断 1 分钟（`cooldownMs`，可配），key 暂时停用
- **配额耗尽 429**：默认熔断 1 小时（`quotaCooldownMs`，可配），key 长时间停用
- **余额不足 402**（Insufficient Balance）：按配额耗尽熔断 1 小时
- 全部熔断时 passthrough 回退到 opencode 原生请求，不跨接入点兜底

## 用量统计（roundrobin_stats）

插件通过 `event` hook 按天累计请求数与 token 消耗（input/output/reasoning/cache），内存累积 60 秒把增量**追加式**写入按日 JSONL（多进程并发不互相覆盖）。`roundrobin_stats` 工具聚合所有进程的数据。

对 LLM 说「看轮询统计」，LLM 会调用 `roundrobin_stats` 工具，返回近 7 天 ASCII 柱状图：

```
round-robin 近 7 天统计
日期      请求                 token
07-25  ████████████·····    34   ████████████·····   19.7k
07-24  ████████·········    23   ██████············   15.3k
07-23  █████████████████    67   █████████████████   38.3k
...
```

可选参数 `days` 指定天数（如「看近 30 天统计」）。

统计文件位置：`~/.local/share/opencode/round-robin-stats/YYYY-MM-DD.jsonl`（可用 `statsDir` 覆盖）。

## 结构化日志

日志按日轮转，文件名 `round-robin-YYYY-MM-DD.log`（配置 `logPath` 可强制单文件模式，禁用轮转）。

```
2026-07-26 18:51:40.123 INFO  fetch provider=account-a key=#0(..2898) status=200 duration=342ms
2026-07-26 18:52:08.456 INFO  usage in=4556 out=2182 reasoning=0 cacheR=312384 cacheW=0 cost=0.0021 session=a3f2 model=glm-5.2 provider=account-a mode=code agent=opencode duration=1283ms
2026-07-26 18:53:00.789 WARN  cooldown provider=account-b key=#1(..2a5b) rate-limit 60000ms
2026-07-26 18:54:00.123 WARN  cooldown provider=account-c key=#2(..4819) quota-exhausted 3600000ms
2026-07-26 18:55:00.456 WARN  cooldown provider=account-d key=#3(..1a2c) quota-exhausted 3600000ms
```

- 第一行（fetch 层）：用了 account-a 账号的 key#0，HTTP 200，耗时 342ms
- 第二行（event 层）：本次消息 token 用量，含 session/model/provider/mode/agent/duration 等业务上下文
- 第三行（请求太快）：account-b 被限流，冷却 60 秒
- 第四行（配额耗尽）：account-c 配额用完，冷却 1 小时
- 第五行（余额不足）：account-d 收到 402 响应，按配额耗尽冷却 1 小时

key 脱敏：只记录序号与末 4 位。
