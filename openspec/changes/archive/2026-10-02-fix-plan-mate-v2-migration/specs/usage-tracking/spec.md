# Spec Delta

## MODIFIED Requirements

### Requirement: 按天累计请求数与 token

插件 SHALL 通过 `ctx.event.subscribe()` 订阅 `message.updated` 事件,按天、按 provider 累计请求数与 token 消耗。统计 SHALL 在内存对象上累积,定时器每 60 秒将增量追加刷盘一次;进程退出时 SHALL 兜底刷盘。

token 归因到实际服务的 provider(而非 opencode 配置的 provider),通过 `http.request` 拦截层建立的 sessionID-provider 关联映射实现。当关联映射中无记录时(如全熔断 passthrough),SHALL fallback 到 `info.providerID`。

去重逻辑 SHALL 以 token 快照变化检测为基础:同一 `info.id` 的事件,仅当 token 快照与上次记录的不同时才累加(即新 step 的 token);相同 token 快照的重复事件(如 cleanup re-emission)SHALL 跳过。

#### Scenario: 多步对话每步 token 均累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件依次到达:第一步 `finish="tool-calls"` tokens={in:1000},第二步 `finish="stop"` tokens={in:3000}
- **THEN** 插件 SHALL 累加两步的 token(总计 in=4000),`req` SHALL 为 2
- **AND** 第一步的 token SHALL 归因到第一步请求时关联的 provider,第二步的 token SHALL 归因到第二步请求时关联的 provider

#### Scenario: 相同 token 快照的重复事件不重复累加

- **WHEN** 同一 `info.id` 的 `message.updated` 事件到达,且其 token 快照与上次记录的完全相同
- **THEN** 插件 SHALL 跳过该事件,不累加 token,不增加 `req`

#### Scenario: token 归因到实际服务的 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中存在
- **THEN** 插件 SHALL 将 token 累加到该 sessionID 对应的 provider 名下

#### Scenario: passthrough 时 fallback 到配置 provider

- **WHEN** `message.updated` 事件的 `info.sessionID` 在关联映射中不存在(如全熔断 passthrough)
- **THEN** 插件 SHALL 将 token 累加到 `info.providerID` 名下

#### Scenario: 缺 id 或 tokens 的事件忽略

- **WHEN** `message.updated` 事件的 `info` 缺 `id` 字段或缺 `tokens` 字段
- **THEN** 插件 SHALL 忽略该事件

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生(含 token 累加)
- **THEN** 插件 SHALL 只更新内存对象,SHALL NOT 立即写磁盘

#### Scenario: 进程退出兜底刷盘

- **WHEN** 进程收到 `beforeExit` / `SIGINT` / `SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次,避免丢失最近统计

### Requirement: Provider-session 关联

插件 SHALL 在 `http.request` 拦截层读取请求头中的会话标识(如 `X-Session-Id`),将其与随机选中的 provider 建立关联映射(sessionID -> provider account)。该映射供事件订阅层的 token 归因使用。SHALL 在读取后从请求头中删除该会话标识头,不将其发送给 API provider。

#### Scenario: 正常请求建立关联

- **WHEN** `http.request` 钩子收到一个 URL 匹配已配置 baseURL 的请求,且请求头含 `X-Session-Id`
- **THEN** 插件 SHALL 将该 sessionID 与随机选中的 provider account 建立关联
- **AND** SHALL 从请求头中删除 `X-Session-Id`

#### Scenario: 请求头无 X-Session-Id

- **WHEN** `http.request` 钩子收到一个请求,但请求头不含 `X-Session-Id`
- **THEN** 插件 SHALL NOT 建立关联,继续正常替换 URL 和 Authorization

#### Scenario: passthrough 不建立关联

- **WHEN** 全部 provider 熔断,`http.request` 钩子 passthrough 原始请求
- **THEN** 插件 SHALL NOT 建立关联(后续事件层 fallback 到 `info.providerID`)

#### Scenario: 关联映射在消息完成后清理

- **WHEN** `message.updated` 事件的 `info.finish` 为终态值(如 `stop`、`error`)
- **THEN** 插件 SHALL 清理该 sessionID 的关联映射条目,避免内存增长

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
