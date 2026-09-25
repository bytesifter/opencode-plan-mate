# Spec Delta

## ADDED Requirements

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
