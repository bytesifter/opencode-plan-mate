### Requirement: providers 配置必填

`options.providers` SHALL 为非空字符串数组。未配或为空时插件 SHALL 抛出错误且不安装 fetch-patch。

#### Scenario: 缺少 providers

- **WHEN** `options` 未提供 `providers` 或为空数组
- **THEN** 插件 SHALL 抛出配置错误,不安装 fetch-patch

#### Scenario: provider 名不存在

- **WHEN** `providers` 列表中某名字在 `Config.provider` 中不存在
- **THEN** 插件 SHALL 抛出配置错误

### Requirement: 从 provider 配置收集扁平列表

插件 SHALL 通过 `config` hook 读取 opencode 的 `Config.provider`,过滤出 `options.providers` 列表中的 provider,读取各自的 `baseURL`、`apiKey` 与 `models`(models 对象的 key 列表),收集为扁平 `ProviderEntry[]` 列表(每个 entry 含 key/baseURL/account/models)。key SHALL 去重(相同 key 只保留第一个)。收集的 models 信息用于后续按"接入点 + 模型"分组时过滤。

#### Scenario: 收集所有 provider 含 models 字段

- **WHEN** `options.providers = ["volxc9208","volxc5425","deepseek"]`
- **AND** `volxc9208` 的 models 为 `{ "glm-5.2": {...}, "deepseek-v4-flash": {...} }`
- **AND** `deepseek` 的 models 为 `{ "deepseek-v4-flash": {...} }`
- **THEN** 插件 SHALL 返回 ProviderEntry[],每个 entry 的 `models` 字段包含该 provider 支持的模型名列表
- **AND** `volxc9208` 的 entry.models SHALL 为 `["glm-5.2", "deepseek-v4-flash"]`
- **AND** `deepseek` 的 entry.models SHALL 为 `["deepseek-v4-flash"]`

#### Scenario: key 自动去重

- **WHEN** 同一 `apiKey` 出现在多个 provider 中
- **THEN** 插件 SHALL 去重,只保留第一个

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
