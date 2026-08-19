## MODIFIED Requirements

### Requirement: 随机选 provider 并替换 key + URL

插件 SHALL 按"接入点(baseURL) + model"自动分组随机选择 provider。请求从哪个已配置 baseURL 发出(经 `findBaseURL` 匹配),就在该 baseURL 下、支持请求 body 中 `model` 字段的 provider 中组成分组,`next(model, originBaseURL)` SHALL 从该分组中随机选一个(跳过熔断中的)。同一 model 但不同 baseURL 的 provider 不组成同一分组,SHALL NOT 跨接入点轮询。将选中 provider 的 key 与 baseURL 同时应用到请求上;同接入点下 baseURL 不变,实际仅替换 Authorization 头。

当请求 body 无法解析、不含 `model` 字段、或该 model 在该接入点无对应 provider 时,SHALL 退化到从该接入点(baseURL)的所有非熔断 provider 中随机选(同接入点池)。SHALL NOT 退化为跨接入点的扁平池全随机。

#### Scenario: 按接入点+模型分组随机选 provider

- **WHEN** fetch 拦截器收到一个 URL 匹配某 ARK baseURL 的请求
- **AND** 请求 body 的 `model` 字段为 `"deepseek-v4-flash"`
- **AND** 该 ARK baseURL 下有 4 个 provider 支持 `"deepseek-v4-flash"`
- **THEN** 插件 SHALL 从该 4 个非熔断 provider 中随机选一个
- **AND** SHALL 将请求 URL 替换为选中 provider 的 baseURL + 原始路径(同接入点下与原 URL 相同)
- **AND** SHALL 将 Authorization 头替换为选中 provider 的 key

#### Scenario: 跨接入点不轮询

- **WHEN** 请求从 ARK 端点发出(body 的 `model` 为 `"deepseek-v4-flash"`)
- **AND** native deepseek 端点下也有支持 `"deepseek-v4-flash"` 的 provider
- **THEN** 插件 SHALL 仅从 ARK 端点下的 provider 中随机选
- **AND** SHALL NOT 选中任何 native deepseek 的 provider

#### Scenario: 不同模型选择不同分组

- **WHEN** 请求从 ARK 端点发出且 body 的 `model` 为 `"glm-5.2"`
- **AND** ARK 端点下有 4 个 provider 支持 `"glm-5.2"`(native deepseek 不支持)
- **THEN** 插件 SHALL 仅从该 4 个 provider 中随机选

#### Scenario: body 不可解析时退化到同接入点池

- **WHEN** 请求 body 不是字符串、JSON 解析失败、或不含 `model` 字段
- **THEN** 插件 SHALL 从该接入点(baseURL)的所有非熔断 provider 中随机选

#### Scenario: 模型无对应 provider 时退化到同接入点池

- **WHEN** 请求 body 的 `model` 字段值在该接入点下没有任何 provider 支持
- **THEN** 插件 SHALL 从该接入点(baseURL)的所有非熔断 provider 中随机选

#### Scenario: URL 不匹配任何已配置 baseURL

- **WHEN** 请求 URL 不以任何已配置 provider 的 baseURL 开头
- **THEN** 插件 SHALL passthrough 原始请求,不修改 URL 和 headers

#### Scenario: 同接入点下 URL 不变化

- **WHEN** 原始 URL 为 `https://ark.host/coding/v3/chat/completions`
- **AND** 选中 provider 与原始请求同 baseURL(`https://ark.host/coding/v3`)
- **THEN** 新 URL SHALL 为 `https://ark.host/coding/v3/chat/completions`(与原 URL 相同)
- **AND** Authorization 头 SHALL 替换为选中 provider 的 key

### Requirement: 分组内全部熔断时 passthrough

当请求 model 对应且同接入点(baseURL)的分组中所有 provider 都处于熔断状态时,插件 SHALL passthrough 原始请求,不修改 URL 和 headers。SHALL NOT 兜底选择其他接入点支持同 model 的 provider。

#### Scenario: 分组内全部熔断

- **WHEN** 请求 model 对应的同接入点分组中所有 provider 都在熔断冷却中
- **THEN** 插件 SHALL passthrough 原始请求
- **AND** SHALL NOT 修改 URL 或 Authorization

#### Scenario: 分组内全部熔断时不跨接入点兜底

- **WHEN** 请求 model 对应的同接入点分组中所有 provider 都在熔断冷却中
- **AND** 其他接入点存在支持同 model 的非熔断 provider
- **THEN** 插件 SHALL passthrough 原始请求
- **AND** SHALL NOT 选择其他接入点的 provider

#### Scenario: providers 列表为空

- **WHEN** providers 配置为空数组
- **THEN** 插件 SHALL passthrough 所有请求
