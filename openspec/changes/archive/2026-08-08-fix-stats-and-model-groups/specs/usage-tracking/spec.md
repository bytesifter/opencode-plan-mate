## ADDED Requirements

### Requirement: 零 token 事件跳过

插件 SHALL 跳过所有 token 值（input、output、reasoning、cacheRead、cacheWrite）均为零的 `message.updated` 事件。这些事件来自 opencode 创建 assistant 消息时的初始 `updateMessage` 调用，非真实 LLM 用量报告，SHALL NOT 累加到统计中。

#### Scenario: 全零 token 事件跳过

- **WHEN** `message.updated` 事件的 `info.tokens` 所有字段（input、output、reasoning、cache.read、cache.write）均为 0
- **THEN** 插件 SHALL 跳过该事件，不累加 req，不累加 token
- **AND** SHALL NOT 更新 lastTokens 快照

#### Scenario: 全零后跟真实 token 正常累加

- **WHEN** 同一 `info.id` 先到达全零 token 事件（被跳过），再到达非零 token 事件
- **THEN** 插件 SHALL 正常累加非零事件（lastTokens 无记录，视为新 step）
