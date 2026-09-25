# Spec Delta

## ADDED Requirements

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
