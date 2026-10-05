# Spec Delta

## ADDED Requirements

### Requirement: 兜底层覆盖绕过 session 钩子的请求

插件 SHALL 在 setup 时安装全局 fetch 兜底层（patch `globalThis.fetch`），用于拦截走全局 fetch 但未被 `session.hook("http.request")` 拦截的、URL 匹配任一已配置池 baseURL 的请求（典型如 opencode core 层会话恢复/排空路径），并将这些请求纳入与 session 钩子路径相同的 key 轮询与 429/402 熔断。兜底层 SHALL 与 session 钩子共享同一个 `ProviderPool` 实例；对已被 session 钩子处理过的请求（以请求对象标记或头标记识别）SHALL 放行，SHALL NOT 重复轮询。兜底层 SHALL 在 patch 前保存原始 fetch 引用，转发时以原始 fetch 执行；对 URL 不匹配任何已配置 baseURL 的请求 SHALL 原样放行，不修改 URL 与 headers。

#### Scenario: 绕过钩子的 drain 请求被兜底轮询

- **WHEN** opencode core 层发起一个 URL 匹配某池 baseURL 的请求（会话恢复/drain 路径）
- **AND** 该请求未经过 `session.hook("http.request")` 拦截
- **THEN** 全局 fetch 兜底层 SHALL 拦截该请求
- **AND** SHALL 从匹配池中按池规则选一个非熔断 provider
- **AND** SHALL 将请求 Authorization 头替换为选中 provider 的 key
- **AND** SHALL 以原始 fetch 转发请求

#### Scenario: 不匹配池 baseURL 的请求放行

- **WHEN** 全局 fetch 兜底层收到一个 URL 不以任何已配置 baseURL 开头的请求（如 opencode 内部 API、MCP 等）
- **THEN** 兜底层 SHALL 原样放行，不修改 URL 与 headers

#### Scenario: 已拦请求不重复轮询

- **WHEN** 某请求已由 session http 钩子处理（带插件识别标记）
- **THEN** 全局 fetch 兜底层 SHALL 放行该请求
- **AND** SHALL NOT 再次替换 Authorization 或重复轮询

#### Scenario: 全熔断时兜底 passthrough

- **WHEN** 兜底层拦截到匹配池的请求
- **AND** 该接入点分组内所有 provider 均处于熔断
- **THEN** 兜底层 SHALL 放行原始请求（原始 Authorization 与 URL 不变）

### Requirement: 兜底路径与钩子路径共享熔断与统计

兜底层与 session 钩子路径 SHALL 共用同一套 429/402 熔断状态与请求/用量统计：任一路径收到 429/402 并标记 provider 熔断后，另一条路径的 `next()` SHALL 同样跳过该 provider；任一路径的请求日志与 token 统计 SHALL 归并到同一账号维度。兜底路径收到的 429 响应 SHALL 按与钩子路径相同的规则分类（配额耗尽用 `quotaCooldownMs`，其他用 `cooldownMs`）。

#### Scenario: 兜底路径 429 触发熔断且钩子路径感知

- **WHEN** 全局 fetch 兜底层转发的一个请求返回 429（响应体含 `exceeded` 与 `quota`）
- **THEN** 该 provider SHALL 被标记熔断 `quotaCooldownMs` 毫秒
- **AND** 随后 `session.hook("http.request")` 路径的 `next()` SHALL 跳过该 provider

#### Scenario: 兜底路径请求计入统计

- **WHEN** 全局 fetch 兜底层拦截并转发了一个匹配池的请求
- **THEN** 该请求 SHALL 按账号维度计入请求日志与 token 统计，与钩子路径统计口径一致

### Requirement: 在途感知的 provider 选择

`pool.next()` SHALL 在"接入点 + 模型"分组内选择 provider 时考虑在途请求数：优先选择当前在途请求数最少的非熔断 provider（在途数为 0 的 provider 优先于在途数 > 0 的）；分组内多个 provider 在途数相同时仍随机选择。在途计数 SHALL 在请求发出时增加、响应返回（含 429/402/错误）时减少；请求异常中断导致无法配对响应时 SHALL 有超时兜底清理，避免在途计数泄漏。该策略 SHALL 为软约束（不阻塞等待），分组内全部非熔断 provider 在途数均为 0 时行为与现状随机选择一致。

#### Scenario: 优先选 0 在途 provider

- **WHEN** 接入点分组内有 3 个非熔断 provider
- **AND** 其中 2 个各有 1 个在途请求、1 个在途数为 0
- **THEN** `next()` SHALL 选中在途数为 0 的那个 provider

#### Scenario: 同在途数时随机

- **WHEN** 接入点分组内所有非熔断 provider 在途数均为 0（或均为同一值）
- **THEN** `next()` SHALL 在这些 provider 中随机选择

#### Scenario: 在途计数超时清理

- **WHEN** 某请求发出后在超时窗口内未收到响应（异常中断/abort）
- **THEN** 该请求占用的在途计数 SHALL 被清理
- **AND** 后续 `next()` SHALL NOT 因残留计数而误判该 provider 为忙
