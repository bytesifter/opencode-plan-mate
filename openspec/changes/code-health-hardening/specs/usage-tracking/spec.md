# Spec Delta

## ADDED Requirements

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
