# usage-tracking Specification

## Purpose

按天用量统计能力：订阅消息事件累计各 provider 的请求数与 token 消耗，按日追加式 JSONL 落盘，并提供 ASCII 柱状图查询工具。

## Requirements

### Requirement: 内存累积与定时刷盘

插件 SHALL 在内存对象上累积统计，定时器每 60 秒将自上次刷盘以来的**增量**追加写入当天的 JSONL 文件一次。进程退出时 SHALL 兜底刷盘一次。追加写入 SHALL 以单次 append 完成，多个进程并发追加 SHALL 不互相覆盖、不产生交错行。

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生
- **THEN** 插件 SHALL 只更新内存对象，不立即写磁盘

#### Scenario: 定时器触发刷盘

- **WHEN** 距上次刷盘已满 60 秒
- **THEN** 插件 SHALL 将自上次刷盘以来的增量记录追加写入当天的 JSONL 文件，追加完成后 SHALL 清空未落盘增量

#### Scenario: 重复刷盘不重复追加

- **WHEN** 连续两次 flush 之间没有新的统计事件（无新增增量）
- **THEN** 插件 SHALL NOT 追加任何记录

#### Scenario: 进程退出刷盘

- **WHEN** 进程收到 `beforeExit`/`SIGINT`/`SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: JSON 文件存储结构

统计落盘 SHALL 为**追加式 JSONL**，按日一个文件，位于 `statsDir` 目录（默认 `~/.local/share/opencode/round-robin-stats/`，可由 `statsDir` 配置覆盖），文件名 SHALL 为 `YYYY-MM-DD.jsonl`。每行 SHALL 为一条自包含的增量记录：`{ day, provider, req, in, out, reasoning, cacheRead, cacheWrite, cost }`，其中各数值为该条记录的增量（`req` 可为同一 flush 窗口内多条请求合并的 >1 值）。插件 SHALL NOT 加载旧的单文件 `round-robin-stats.json`。

#### Scenario: 存储结构

- **WHEN** 读取某个日期的统计文件
- **THEN** 内容形如一行行增量记录：`{"day":"2026-07-25","provider":"account-a","req":1,"in":100,"out":50,"reasoning":10,"cacheRead":0,"cacheWrite":0,"cost":0}`

#### Scenario: 跨进程追加不互相覆盖

- **WHEN** 多个 opencode 进程各自对同一日期文件追加增量记录
- **THEN** 所有记录 SHALL 均完整保留，无覆盖、无交错

#### Scenario: 旧单文件 JSON 不兼容

- **WHEN** 插件启动时存在旧的单文件 `round-robin-stats.json`
- **THEN** 插件 SHALL NOT 读取该文件，从空统计开始

### Requirement: 图表查询工具

插件 SHALL 注册名为 `plan_mate_stats` 的工具,执行时返回近 N 天(默认 7)的 ASCII 柱状图,按 provider 分列展示请求数与 token 消耗。工具参数 SHALL 支持可选 `days` 指定天数。工具数据源 SHALL 为磁盘上聚合所有进程追加的 JSONL 记录所得结果(先触发本进程 flush 再聚合),SHALL NOT 仅展示本进程内存统计。

#### Scenario: 调用工具返回 per-provider 图表

- **WHEN** 调用 `plan_mate_stats` 工具(无参数)
- **THEN** 工具 SHALL 返回近 7 天的 ASCII 柱状图字符串,按 provider 分列展示每 provider 的请求数与 token

#### Scenario: 指定天数

- **WHEN** 调用 `plan_mate_stats` 工具且参数 `days` 为 30
- **THEN** 工具 SHALL 返回近 30 天的图表

#### Scenario: 跨进程数据可见

- **WHEN** 多个进程各自记录了不同 provider 的用量
- **THEN** 工具 SHALL 返回聚合后包含所有 provider 的图表

#### Scenario: 无数据

- **WHEN** 统计目录不存在或为空
- **THEN** 工具 SHALL 返回提示"暂无统计数据"

### Requirement: 聚合读取

插件 SHALL 提供按日期聚合 JSONL 增量记录为 `StatsStore`（day → provider → 累计值）的能力，供图表工具使用。聚合 SHALL 对同一 `(day, provider)` 的所有增量记录逐字段求和。读取时遇到无法解析的行 SHALL 跳过，SHALL NOT 中断聚合。

#### Scenario: 多进程增量求和

- **WHEN** 同一日期文件中有多条来自不同进程的 `(day, provider)` 增量记录
- **THEN** 聚合结果 SHALL 为该 provider 当日所有增量的逐字段求和

#### Scenario: 损坏行跳过

- **WHEN** JSONL 文件中存在无法解析为 JSON 的行
- **THEN** 聚合 SHALL 跳过该行，其余记录 SHALL 正常聚合

### Requirement: 历史数据不回溯

本 change 不提供历史统计数据迁移能力。旧的单文件 `round-robin-stats.json` SHALL NOT 被读取或迁移；历史数据已因多进程并发覆盖而不完整，由用户自行决定是否备份旧文件。

#### Scenario: 旧单文件 JSON 不被读取

- **WHEN** 插件启动时存在旧的单文件 `round-robin-stats.json`
- **THEN** 插件 SHALL NOT 读取该文件，SHALL 从空的增量记录开始统计

### Requirement: 按位置过滤事件

插件 SHALL 只处理 `event.location.directory` 等于插件加载位置（`ctx.location.directory`）的 `session.step.ended` / `session.step.failed` 事件；其他位置目录的事件 SHALL 被忽略，不累计 token、不增加 `req`。插件加载位置由 setup 时的 `ctx.location.directory` 确定。

#### Scenario: 位置匹配的事件正常累计

- **WHEN** 插件收到一个 `event.location.directory` 等于插件加载目录的 `session.step.ended` 事件
- **THEN** 插件 SHALL 正常解析并累计该事件的 token、增加 `req`

#### Scenario: 位置不匹配的事件忽略

- **WHEN** 插件收到一个 `event.location.directory` 不等于插件加载目录的 `session.step.ended` 事件（来自其他位置/项目的会话）
- **THEN** 插件 SHALL 忽略该事件，不累加 token，不增加 `req`

#### Scenario: 事件缺 location 时忽略

- **WHEN** `session.step.ended` 事件缺 `event.location` 或 `location.directory` 非字符串
- **THEN** 插件 SHALL 忽略该事件（无法确定归属位置，保守丢弃）

### Requirement: 按天累计请求数与 token（v2 step 事件）

插件 SHALL 通过 `ctx.event.subscribe()` 订阅 v2 事件 `session.step.ended`（主）与 `session.step.failed`（辅），按天、按 provider 累计请求数与 token 消耗。统计 SHALL 在内存对象上累积，定时器每 60 秒将增量追加刷盘一次；进程退出时 SHALL 兜底刷盘。

token 归因到实际服务的 provider（而非 opencode 配置的 provider），通过 `http.request` 钩子建立的 sessionID-provider 关联映射实现。当关联映射中无记录时（如全熔断 passthrough），SHALL fallback 到该会话当前 provider；仍无法确定时归入 `unknown`。

每次 `session.step.ended` / `session.step.failed`（含 tokens）事件 SHALL 计为一次请求（`req` +1）并按事件携带的 tokens 全字段累加；同一事件（同 `event.id`）重复到达 SHALL NOT 重复累计。

#### Scenario: 多步对话每步 token 均累加

- **WHEN** 同一会话的 `session.step.ended` 事件依次到达：第一步 `finish="tool-calls"` tokens={in:1000}，第二步 `finish="stop"` tokens={in:3000}
- **THEN** 插件 SHALL 累加两步的 token（总计 in=4000），`req` SHALL 为 2
- **AND** 第一步的 token SHALL 归因到第一步请求时关联的 provider，第二步的 token SHALL 归因到第二步请求时关联的 provider

#### Scenario: 同一事件重复到达不重复累计

- **WHEN** 同一 `event.id` 的 `session.step.ended` 事件重复到达（如事件流重放）
- **THEN** 插件 SHALL 跳过重复事件，不累加 token，不增加 `req`

#### Scenario: token 归因到实际服务的 provider

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中存在
- **THEN** 插件 SHALL 将 token 累加到该 sessionID 对应的 provider 名下

#### Scenario: 关联映射缺失时 fallback 到会话当前 provider

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中不存在（如全熔断 passthrough），且该会话的当前 provider 可确定
- **THEN** 插件 SHALL 将 token 累加到该会话当前 provider 名下

#### Scenario: 关联映射缺失且 provider 不可确定时归入 unknown

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中不存在，且会话当前 provider 亦不可确定
- **THEN** 插件 SHALL 将 token 累加到 `unknown` provider 名下

#### Scenario: 缺 sessionID 或 tokens 的事件忽略

- **WHEN** `session.step.ended` / `session.step.failed` 事件缺 `data.sessionID` 或缺 `data.tokens`
- **THEN** 插件 SHALL 忽略该事件

#### Scenario: 全零 token 的 step 事件忽略

- **WHEN** `session.step.ended` / `session.step.failed` 事件的 `data.tokens` 所有字段（input、output、reasoning、cache.read、cache.write）均为 0
- **THEN** 插件 SHALL 跳过该事件，不累加 token，不增加 `req`

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生（含 token 累加）
- **THEN** 插件 SHALL 只更新内存对象，SHALL NOT 立即写磁盘

#### Scenario: 进程退出兜底刷盘

- **WHEN** 进程收到 `beforeExit` / `SIGINT` / `SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: Provider-session 关联（v2 http.request 钩子）

插件 SHALL 在 `http.request` 钩子中读取 `event.sessionID`，将其与随机选中的 provider 建立关联映射（sessionID -> provider account）。该映射供事件订阅层的 token 归因使用。v2 钩子事件已直接携带 `event.sessionID`，SHALL NOT 依赖 `X-Session-Id` 请求头。

#### Scenario: 正常请求建立关联

- **WHEN** `http.request` 钩子收到一个 URL 匹配已配置 baseURL 的请求
- **THEN** 插件 SHALL 将该 `event.sessionID` 与随机选中的 provider account 建立关联

#### Scenario: passthrough 不建立关联

- **WHEN** 全部 provider 熔断，`http.request` 钩子 passthrough 原始请求
- **THEN** 插件 SHALL NOT 建立关联（后续事件层 fallback 到会话当前 provider 或 `unknown`）

#### Scenario: 关联映射在 step 结束后清理

- **WHEN** `session.step.ended` 事件的 `data.finish` 为终态值（如 `stop`、`error`、`unknown`），或收到 `session.step.failed`
- **THEN** 插件 SHALL 清理该 sessionID 的关联映射条目，避免内存增长

### Requirement: 忽略回放的历史 durable 事件

插件 SHALL 在 setup 时记录插件启动时刻（`startTime`）。事件处理层 SHALL 忽略 `event.created` 早于 `startTime` 的 `session.step.ended` / `session.step.failed` 事件——这些是服务（standalone 或 GUI 重启后）从事件库回放的历史 durable 事件，其 usage 已由历史 JSONL 落盘，重新计入会造成统计虚增。`event.created` 不早于 `startTime` 的实时事件 SHALL 正常累计。

#### Scenario: 回放的历史事件被忽略

- **WHEN** 插件启动后收到一个 `event.created` 早于插件启动时刻的 `session.step.ended` 事件（来自历史 durable 事件回放）
- **THEN** 插件 SHALL 忽略该事件，不累加 token，不增加 `req`

#### Scenario: 实时事件正常累计

- **WHEN** 插件收到一个 `event.created` 不早于插件启动时刻的 `session.step.ended` 事件
- **THEN** 插件 SHALL 正常累计该事件的 token 并增加 `req`

#### Scenario: 启动边界事件正常累计

- **WHEN** `event.created` 恰好等于插件启动时刻
- **THEN** 插件 SHALL 正常累计该事件（边界值视为实时事件）

### Requirement: 去重按 durable 事件身份

插件 SHALL 以 durable 事件身份（`durable.aggregateID` + `durable.seq`）作为去重主键，`event.id` 保留为辅助去重。同一 durable 身份的事件重复到达（事件流重发、多路投递、回放漏网）SHALL 只累计一次。

#### Scenario: 同 durable 身份重复到达只计一次

- **WHEN** 同一 `durable.aggregateID:seq` 的 `session.step.ended` 事件重复到达
- **THEN** 插件 SHALL 只累计第一次，后续重复到达 SHALL NOT 累加 token、SHALL NOT 增加 `req`

#### Scenario: 不同 durable 身份各自累计

- **WHEN** 不同 `durable.aggregateID:seq` 的 `session.step.ended` 事件依次到达
- **THEN** 插件 SHALL 各自累计一次，`req` 逐次递增

#### Scenario: durable 身份缺失时 fallback 到事件 id

- **WHEN** `session.step.ended` 事件缺 `durable` 字段但带 `event.id`
- **THEN** 插件 SHALL 以 `event.id` 作为去重身份，同一 `event.id` 重复到达只累计一次
- **AND** 两者皆缺失时 SHALL NOT 去重（每次到达均累计）

### Requirement: 事件处理异常隔离

插件 SHALL 在事件订阅循环中逐事件隔离处理异常：单个 `session.step.ended` / `session.step.failed` 事件的处理（解析、归因、累计、日志任一环节）抛错时，SHALL 跳过该事件并继续订阅后续事件，SHALL NOT 终止订阅循环。订阅循环整体 SHALL 在异常后保持存活，后续事件的统计 SHALL 正常累计。

#### Scenario: 单事件处理异常不中断订阅

- **WHEN** 事件流中某个 `session.step.ended` 事件的处理抛出异常
- **THEN** 插件 SHALL 跳过该事件（不累计其 token、不增加 `req`）
- **AND** 订阅循环 SHALL 继续存活，后续到达的事件 SHALL 正常处理与累计

#### Scenario: 异常事件前后的正常事件均累计

- **WHEN** 事件流依次到达：正常事件 A → 处理异常的事件 B → 正常事件 C
- **THEN** 插件 SHALL 正常累计事件 A 与事件 C 的用量
- **AND** 事件 B SHALL 不产生任何累计副作用
