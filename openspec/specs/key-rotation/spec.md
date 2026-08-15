### Requirement: providers 配置必填

`options.providers` SHALL 为非空字符串数组。未配或为空时插件 SHALL 抛出错误且不安装 fetch-patch。

#### Scenario: 缺少 providers

- **WHEN** `options` 未提供 `providers` 或为空数组
- **THEN** 插件 SHALL 抛出配置错误,不安装 fetch-patch

#### Scenario: provider 名不存在

- **WHEN** `providers` 列表中某名字在 `Config.provider` 中不存在
- **THEN** 插件 SHALL 抛出配置错误

### Requirement: 从 provider 配置收集扁平列表

插件 SHALL 通过 `config` hook 读取 opencode 的 `Config.provider`,过滤出 `options.providers` 列表中的 provider,读取各自的 `baseURL`、`apiKey` 与 `models`(models 对象的 key 列表),收集为扁平 `ProviderEntry[]` 列表(每个 entry 含 key/baseURL/account/models)。SHALL NOT 按 baseURL 分组。key SHALL 去重(相同 key 只保留第一个)。收集的 models 信息用于后续按模型自动分组。

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

插件 SHALL 按请求 body 中的 `model` 字段自动分组随机选择 provider。同一 model 的所有 provider 组成一个分组,`next(model)` SHALL 从该分组中随机选一个(跳过熔断中的)。将选中 provider 的 key 和 baseURL 同时应用到请求上。SHALL NOT 仅替换 Authorization 头。

当请求 body 无法解析、不含 `model` 字段、或该 model 无对应分组时,SHALL 退化到从所有非熔断 provider 中随机选(扁平池全随机,安全降级)。

#### Scenario: 按模型分组随机选 provider

- **WHEN** fetch 拦截器收到一个 URL 匹配某已配置 baseURL 的请求
- **AND** 请求 body 的 `model` 字段为 `"deepseek-v4-flash"`
- **AND** `"deepseek-v4-flash"` 分组含 5 个 provider(4 ARK + 1 native deepseek)
- **THEN** 插件 SHALL 从该 5 个非熔断 provider 中随机选一个
- **AND** SHALL 将请求 URL 替换为选中 provider 的 baseURL + 原始路径
- **AND** SHALL 将 Authorization 头替换为选中 provider 的 key

#### Scenario: 不同模型选择不同分组

- **WHEN** 请求 body 的 `model` 为 `"glm-5.2"`
- **AND** `"glm-5.2"` 分组含 4 个 ARK provider(不含 native deepseek)
- **THEN** 插件 SHALL 仅从该 4 个 provider 中随机选

#### Scenario: body 不可解析时退化到扁平池

- **WHEN** 请求 body 不是字符串、JSON 解析失败、或不含 `model` 字段
- **THEN** 插件 SHALL 从所有非熔断 provider 中随机选(扁平池全随机降级)

#### Scenario: 模型无对应分组时退化到扁平池

- **WHEN** 请求 body 的 `model` 字段值不在任何 provider 的 models 列表中
- **THEN** 插件 SHALL 从所有非熔断 provider 中随机选(扁平池全随机降级)

#### Scenario: URL 不匹配任何已配置 baseURL

- **WHEN** 请求 URL 不以任何已配置 provider 的 baseURL 开头
- **THEN** 插件 SHALL passthrough 原始请求,不修改 URL 和 headers

#### Scenario: 路径提取与拼接

- **WHEN** 原始 URL 为 `https://ark.host/coding/v3/chat/completions`
- **AND** 原始 baseURL 为 `https://ark.host/coding/v3`
- **AND** 选中 provider 的 baseURL 为 `https://api.deepseek.com`
- **THEN** 新 URL SHALL 为 `https://api.deepseek.com/chat/completions`

### Requirement: 分组内全部熔断时 passthrough

当请求 model 对应分组中所有 provider 都处于熔断状态时,插件 SHALL passthrough 原始请求,不修改 URL 和 headers。SHALL NOT 兜底随机选一个 provider。

#### Scenario: 分组内全部熔断

- **WHEN** 请求 model 对应的分组中所有 provider 都在熔断冷却中
- **THEN** 插件 SHALL passthrough 原始请求
- **AND** SHALL NOT 修改 URL 或 Authorization

#### Scenario: providers 列表为空

- **WHEN** providers 配置为空数组
- **THEN** 插件 SHALL passthrough 所有请求

### Requirement: 429 熔断 per-provider

收到 429 响应时,插件 SHALL 读取响应体区分 429 类型:配额耗尽(`error.message` 含 `exceeded` 与 `quota`,不区分大小写)使用 `quotaCooldownMs`(默认 3600000ms,可配)熔断;其他 429 使用 `cooldownMs`(默认 60000ms,可配)熔断。无法读取或解析响应体时 SHALL 按 `cooldownMs` 处理。熔断到期后自动恢复。读取响应体 SHALL 使用 `response.clone()` 以保证原始 response 不被消费。

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

#### Scenario: 响应体不可读时按短熔断处理

- **WHEN** 某 provider 的请求返回 429
- **AND** 响应体无法读取或 JSON 解析失败
- **THEN** 该 provider SHALL 被标记熔断 `cooldownMs` 毫秒

#### Scenario: 未配 quotaCooldownMs 时配额耗尽走短熔断

- **WHEN** `quotaCooldownMs` 未配置
- **AND** 某 provider 收到配额耗尽 429
- **THEN** 该 provider SHALL 被标记熔断 `cooldownMs` 毫秒

#### Scenario: 熔断到期恢复

- **WHEN** 某 provider 的熔断时间已过
- **THEN** 该 provider SHALL 恢复可用
- **AND** `next()` 可能选中该 provider

#### Scenario: 部分 provider 熔断时仍随机选

- **WHEN** 4 个 provider 中 1 个熔断
- **THEN** `next()` SHALL 从剩余 3 个非熔断 provider 中随机选
