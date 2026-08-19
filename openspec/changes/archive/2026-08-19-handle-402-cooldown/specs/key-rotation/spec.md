## MODIFIED Requirements

### Requirement: 429/402 熔断 per-provider

收到 429 或 402 响应时,插件 SHALL 标记该 provider 熔断。429 响应 SHALL 读取响应体区分类型:配额耗尽(`error.message` 含 `exceeded` 与 `quota`,不区分大小写)使用 `quotaCooldownMs`(默认 3600000ms,可配)熔断;其他 429 使用 `cooldownMs`(默认 60000ms,可配)熔断;无法读取或解析响应体时 SHALL 按 `cooldownMs` 处理。402 响应(余额不足)SHALL 无条件使用 `quotaCooldownMs` 熔断,不读取响应体分类。熔断到期后自动恢复。读取 429 响应体 SHALL 使用 `response.clone()` 以保证原始 response 不被消费。

#### Scenario: 请求太快 429 标记短熔断

- **WHEN** 某 provider 的请求返回 429
- **AND** 响应体 `error.message` 不含 `exceeded` 与 `quota`
- **THEN** 该 provider SHALL 被标记熔断 `cooldownMs` 毫秒
- **AND** 后续 `next()` SHALL 跳过该 provider

#### Scenario: 配额耗尽 429 标记长熔断

- **WHEN** 某 provider 的请求返回 429
- **AND** 响应体 `error.message` 含 `exceeded` 与 `quota`(不区分大小写)
- **THEN** 该 provider SHALL 被标记熔断 `quotaCooldownMs` 毫秒
- **AND** 后续 `next()` SHALL 跳过该 provider

#### Scenario: 余额不足 402 标记长熔断

- **WHEN** 某 provider 的请求返回 402
- **THEN** 该 provider SHALL 被标记熔断 `quotaCooldownMs` 毫秒
- **AND** 后续 `next()` SHALL 跳过该 provider
- **AND** 冷却类型 SHALL 归为 `quota-exhausted`

#### Scenario: 响应体不可读时按短熔断处理

- **WHEN** 某 provider 的请求返回 429
- **AND** 响应体无法读取或 JSON 解析失败
- **THEN** 该 provider SHALL 被标记熔断 `cooldownMs` 毫秒

#### Scenario: 未配 quotaCooldownMs 时配额耗尽走默认长熔断

- **WHEN** `quotaCooldownMs` 未配置(使用默认值 3600000ms)
- **AND** 某 provider 收到配额耗尽 429
- **THEN** 该 provider SHALL 被标记熔断默认 3600000 毫秒

#### Scenario: 未配 quotaCooldownMs 时余额不足 402 走默认长熔断

- **WHEN** `quotaCooldownMs` 未配置(使用默认值 3600000ms)
- **AND** 某 provider 收到 402 响应
- **THEN** 该 provider SHALL 被标记熔断默认 3600000 毫秒

#### Scenario: 熔断到期恢复

- **WHEN** 某 provider 的熔断时间已过
- **THEN** 该 provider SHALL 恢复可用
- **AND** `next()` 可能选中该 provider

#### Scenario: 部分 provider 熔断时仍随机选

- **WHEN** 4 个 provider 中 1 个熔断
- **THEN** `next()` SHALL 从剩余 3 个非熔断 provider 中随机选
