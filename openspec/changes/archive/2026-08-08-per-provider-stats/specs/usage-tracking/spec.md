## MODIFIED Requirements

### Requirement: 按天累计请求数与 token

插件 SHALL 通过 `event` hook 监听 `message.updated` 事件，按天、按 provider 累计请求数与 token 消耗。统计 SHALL 在内存对象上累积，定时器每 60 秒整体刷盘一次；进程退出时 SHALL 兜底刷盘。

token 归因到实际服务的 provider（而非 opencode 配置的 provider），通过 fetch-patch 层建立的 sessionID-provider 关联映射实现。当关联映射中无记录时（如全熔断 passthrough），SHALL fallback 到 `info.providerID`。

去重逻辑 SHALL 以 token 快照变化检测为基础：同一 `info.id` 的事件，仅当 token 快照与上次记录的不同时才累加（即新 step 的 token）；相同 token 快照的重复事件（如 cleanup re-emission）SHALL 跳过。

#### Scenario: 多步对话每步 token 均累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件依次到达：第一步 `finish="tool-calls"` tokens={in:1000}，第二步 `finish="stop"` tokens={in:3000}
- **THEN** 插件 SHALL 累加两步的 token（总计 in=4000），`req` SHALL 为 2
- **AND** 第一步的 token SHALL 归因到第一步 fetch 时关联的 provider，第二步的 token SHALL 归因到第二步 fetch 时关联的 provider

#### Scenario: 相同 token 快照的重复事件不重复累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件到达，且其 token 快照与上次记录的完全相同
- **THEN** 插件 SHALL 跳过该事件，不累加 token，不增加 `req`

#### Scenario: token 归因到实际服务的 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中存在
- **THEN** 插件 SHALL 将 token 累加到该 sessionID 对应的 provider 名下

#### Scenario: passthrough 时 fallback 到配置 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中不存在（如全熔断 passthrough）
- **THEN** 插件 SHALL 将 token 累加到 `info.providerID` 名下

#### Scenario: 缺 id 或 tokens 的事件忽略

- **WHEN** `message.updated` 事件的 `info` 缺 `id` 字段或缺 `tokens` 字段
- **THEN** 插件 SHALL 忽略该事件

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生（含 token 累加）
- **THEN** 插件 SHALL 只更新内存对象，SHALL NOT 立即写磁盘

#### Scenario: 进程退出兜底刷盘

- **WHEN** 进程收到 `beforeExit` / `SIGINT` / `SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: JSON 文件存储结构

统计文件 SHALL 为 JSON，路径默认 `~/.local/share/opencode/round-robin-stats.json`（可由 `statsPath` 配置）。结构为以日期为 key 的对象，每个日期下为以 provider 名为 key 的对象，每个 provider 对应当天的累计。

#### Scenario: 存储结构

- **WHEN** 读取统计文件
- **THEN** 内容形如 `{ "2026-07-25": { "account-a": { req, in, out, reasoning, cacheRead, cacheWrite, cost }, "account-b": { ... } } }`

#### Scenario: 旧格式文件不兼容

- **WHEN** 插件加载时读取到旧格式（日期下直接为 DayStats 而非 provider 嵌套）的统计文件
- **THEN** 插件 SHALL 按空统计处理（置空 store），SHALL NOT 崩溃

### Requirement: 图表查询工具

插件 SHALL 注册名为 `roundrobin_stats` 的工具，执行时返回近 N 天（默认 7）的 ASCII 柱状图，按 provider 分列展示请求数与 token 消耗。工具参数 SHALL 支持可选 `days` 指定天数。日维度汇总通过遍历当天所有 provider 求和获得。

#### Scenario: 调用工具返回 per-provider 图表

- **WHEN** 调用 `roundrobin_stats` 工具（无参数）
- **THEN** 工具 SHALL 返回近 7 天的 ASCII 柱状图字符串，按 provider 分列展示每 provider 的请求数与 token

#### Scenario: 指定天数

- **WHEN** 调用 `roundrobin_stats` 工具且参数 `days` 为 30
- **THEN** 工具 SHALL 返回近 30 天的图表

#### Scenario: 无数据

- **WHEN** 统计文件不存在或为空
- **THEN** 工具 SHALL 返回提示"暂无统计数据"

### Requirement: 历史数据不回溯

本 change 不提供历史统计数据迁移能力。旧格式（日维度直接汇总、无 provider 维度）的 `round-robin-stats.json` SHALL 在加载时被丢弃（按空统计处理），由用户自行决定是否备份旧文件。

#### Scenario: 旧格式文件被丢弃

- **WHEN** 插件加载时读取到旧格式统计文件
- **THEN** 插件 SHALL 正常加载（置空 store），SHALL NOT 自动迁移或修正历史数据

## ADDED Requirements

### Requirement: Provider-session 关联

插件 SHALL 在 fetch-patch 层读取 opencode 注入的 `X-Session-Id` HTTP 请求头，将其与随机选中的 provider 建立关联映射（sessionID -> provider account）。该映射供 event 层的 token 归因使用。SHALL 在读取后从请求头中删除 `X-Session-Id`，不将其发送给 API provider。

#### Scenario: 正常请求建立关联

- **WHEN** fetch-patch 拦截到一个 URL 匹配已配置 baseURL 的请求，且请求头含 `X-Session-Id`
- **THEN** 插件 SHALL 将该 sessionID 与随机选中的 provider account 建立关联
- **AND** SHALL 从请求头中删除 `X-Session-Id`

#### Scenario: 请求头无 X-Session-Id

- **WHEN** fetch-patch 拦截到一个请求，但请求头不含 `X-Session-Id`
- **THEN** 插件 SHALL NOT 建立关联，继续正常替换 URL 和 Authorization

#### Scenario: passthrough 不建立关联

- **WHEN** 全部 provider 熔断，fetch-patch passthrough 原始请求
- **THEN** 插件 SHALL NOT 建立关联（后续 event 层 fallback 到 `info.providerID`）

#### Scenario: 关联映射在消息完成后清理

- **WHEN** `message.updated` 事件的 `info.finish` 为终态值（如 `stop`、`error`）
- **THEN** 插件 SHALL 清理该 sessionID 的关联映射条目，避免内存增长
