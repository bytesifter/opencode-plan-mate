# Spec Delta

## REMOVED Requirements

### Requirement: 按天累计请求数与 token

**Reason**: 该 requirement 的事件源与数据契约基于 v1 `message.updated` + `properties.info`（含 `info.id` / `info.finish` / `info.providerID`、token 快照去重、`X-Session-Id` 关联）。该事件类型与字段在 v2 事件流中不存在，语义整体被 v2 step 事件模型取代。
**Migration**: 由 ADDED「按天累计请求数与 token（v2 step 事件）」继承按天累计、per-provider 归因、内存累积与定时刷盘语义。

### Requirement: 零 token 事件跳过

**Reason**: v1 专属行为——该事件来自 opencode 创建 assistant 消息时的初始 `updateMessage` 调用（全零 token 的 `message.updated`）。v2 无此初始事件，「全零 token 不累计」已并入 ADDED 的「全零 token 的 step 事件忽略」场景。
**Migration**: 无。行为由「按天累计请求数与 token（v2 step 事件）」的对应场景继承。

### Requirement: Provider-session 关联

**Reason**: 基于 v1 fetch-patch 读取并删除 `X-Session-Id` 请求头；v2 `http.request` 钩子直接携带 `event.sessionID`，无请求头读取逻辑。
**Migration**: 由 ADDED「Provider-session 关联（v2 http.request 钩子）」继承关联映射语义，事件源与清理时机改为 v2 step 事件。

## ADDED Requirements

### Requirement: 按天累计请求数与 token（v2 step 事件）

插件 SHALL 通过 `ctx.event.subscribe()` 订阅 v2 事件 `session.step.ended`（主）与 `session.step.failed`（辅），按天、按 provider 累计请求数与 token 消耗。统计 SHALL 在内存对象上累积，定时器每 60 秒将增量追加刷盘一次；进程退出时 SHALL 兜底刷盘。

token 归因到实际服务的 provider（而非 opencode 配置的 provider），通过 `http.request` 钩子建立的 sessionID-provider 关联映射实现。当关联映射中无记录时（如全熔断 passthrough），SHALL fallback 到该会话当前 provider；仍无法确定时归入 `unknown`。

每次 `session.step.ended` / `session.step.failed`（含 tokens）事件 SHALL 计为一次请求（`req` +1）并按事件携带的 tokens 全字段累加；同一事件（同 `event.id`）重复到达 SHALL NOT 重复累计。

#### Scenario: 多步对话每步 token 均累加

- **WHEN** 同一会话的 `session.step.ended` 事件依次到达：第一步 `finish="tool-calls"` tokens={in:1000}，第二步 `finish="stop"` tokens={in:3000}
- **THEN** 插件 SHALL 累加两步的 token（总计 in=4000），`req` SHALL 为 2
- **AND** 第一步的 token SHALL 归因到第一步请求时关联的 provider，第二步的 token SHALL 归因到第二步请求时关联的 provider

#### Scenario: 同一事件重复到达不重复累计

- **WHEN** 同一 `event.id` 的 `session.step.ended` 事件重复到达（如事件流重放）
- **THEN** 插件 SHALL 跳过重复事件，不累加 token，不增加 `req`

#### Scenario: token 归因到实际服务的 provider

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中存在
- **THEN** 插件 SHALL 将 token 累加到该 sessionID 对应的 provider 名下

#### Scenario: 关联映射缺失时 fallback 到会话当前 provider

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中不存在（如全熔断 passthrough），且该会话的当前 provider 可确定
- **THEN** 插件 SHALL 将 token 累加到该会话当前 provider 名下

#### Scenario: 关联映射缺失且 provider 不可确定时归入 unknown

- **WHEN** `session.step.ended` 事件的 `data.sessionID` 在关联映射中不存在，且会话当前 provider 亦不可确定
- **THEN** 插件 SHALL 将 token 累加到 `unknown` provider 名下

#### Scenario: 缺 sessionID 或 tokens 的事件忽略

- **WHEN** `session.step.ended` / `session.step.failed` 事件缺 `data.sessionID` 或缺 `data.tokens`
- **THEN** 插件 SHALL 忽略该事件

#### Scenario: 全零 token 的 step 事件忽略

- **WHEN** `session.step.ended` / `session.step.failed` 事件的 `data.tokens` 所有字段（input、output、reasoning、cache.read、cache.write）均为 0
- **THEN** 插件 SHALL 跳过该事件，不累加 token，不增加 `req`

#### Scenario: 事件触发只改内存

- **WHEN** 统计事件发生（含 token 累加）
- **THEN** 插件 SHALL 只更新内存对象，SHALL NOT 立即写磁盘

#### Scenario: 进程退出兜底刷盘

- **WHEN** 进程收到 `beforeExit` / `SIGINT` / `SIGTERM`
- **THEN** 插件 SHALL 最后刷盘一次，避免丢失最近统计

### Requirement: Provider-session 关联（v2 http.request 钩子）

插件 SHALL 在 `http.request` 钩子中读取 `event.sessionID`，将其与随机选中的 provider 建立关联映射（sessionID -> provider account）。该映射供事件订阅层的 token 归因使用。v2 钩子事件已直接携带 `event.sessionID`，SHALL NOT 依赖 `X-Session-Id` 请求头。

#### Scenario: 正常请求建立关联

- **WHEN** `http.request` 钩子收到一个 URL 匹配已配置 baseURL 的请求
- **THEN** 插件 SHALL 将该 `event.sessionID` 与随机选中的 provider account 建立关联

#### Scenario: passthrough 不建立关联

- **WHEN** 全部 provider 熔断，`http.request` 钩子 passthrough 原始请求
- **THEN** 插件 SHALL NOT 建立关联（后续事件层 fallback 到会话当前 provider 或 `unknown`）

#### Scenario: 关联映射在 step 结束后清理

- **WHEN** `session.step.ended` 事件的 `data.finish` 为终态值（如 `stop`、`error`、`unknown`），或收到 `session.step.failed`
- **THEN** 插件 SHALL 清理该 sessionID 的关联映射条目，避免内存增长
