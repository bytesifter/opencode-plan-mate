# Spec Delta

## MODIFIED Requirements

### Requirement: plan_stats 工具注册与按需触发

插件 SHALL 注册名为 `plan_stats` 的工具。工具 SHALL 仅在用户显式调用时执行套餐配额查询，SHALL NOT 在后台轮询或定时查询配额，SHALL NOT 维护配额查询缓存。后台 SSO 保活（对账号隔离 HOME 执行 `arkcli auth status` 以维持登录态）SHALL 不属于套餐配额查询，SHALL NOT 受本条的按需/不缓存约束。

#### Scenario: 显式调用返回套餐统计

- **WHEN** 调用 `plan_stats` 工具（无参数）且已配置 `planStats.accounts`
- **THEN** 工具 SHALL 对每个配置的账号查询其官方套餐配额并返回聚合结果

#### Scenario: 不调用不查询

- **WHEN** 插件运行且无人调用 `plan_stats`
- **THEN** 插件 SHALL 不发起任何套餐配额查询（后台 SSO 保活的 `auth status` 调用除外）

#### Scenario: 未配置返回提示

- **WHEN** 调用 `plan_stats` 工具但未配置 `planStats.accounts`
- **THEN** 工具 SHALL 返回配置提示信息，SHALL NOT 报错崩溃

## ADDED Requirements

### Requirement: SSO 登录态保活

插件 SHALL 对 `planStats.accounts` 中每个账号的隔离 arkcli HOME 提供 SSO 登录态保活：后台定时（默认每 12 小时，可配 `ssoKeepaliveMs`）对该 HOME 执行 `arkcli auth status --format json`；STS 已过期时该调用 SHALL 自动用 refresh_token 续期（`reason=identity_sts_refreshed`）。保活定时器 SHALL 只在首个插件实例注册（模块级单例，多加载位置不重复）。保活调用失败（refresh_token invalid / 未登录 / arkcli 不可用）SHALL 标记该账号过期。`plan_stats` 调用前 SHALL 对每个账号执行一次保活探活：成功则继续取配额；失败则该行 SHALL 标注过期分类与重登指引，SHALL NOT 阻断其他账号。

#### Scenario: 定时保活触发刷新

- **WHEN** 距上次保活超过 `ssoKeepaliveMs`（默认 43200000ms），且某账号的 STS 已过期
- **THEN** 插件 SHALL 以该账号隔离 HOME 执行 `arkcli auth status --format json`
- **AND** 该调用 SHALL 触发 refresh_token 续期并成功返回（`control_plane_auth.status=ok`）

#### Scenario: 保活失败标记过期

- **WHEN** 某账号保活调用返回错误（如 refresh_token invalid）
- **THEN** 该账号 SHALL 被标记为 SSO 过期，且 `plan_stats` 对应行 SHALL 显示过期提示与重登指引

#### Scenario: plan_stats 前置探活

- **WHEN** 调用 `plan_stats` 且某账号 SSO 已过期
- **THEN** 该账号行 SHALL 直接标注"SSO 已过期（含重登命令指引）"，SHALL NOT 先执行完整配额查询再报错

#### Scenario: 定时器只注册一次

- **WHEN** 插件在多个加载位置执行 setup
- **THEN** 保活定时器 SHALL 只被创建一次（后续 setup 复用），SHALL NOT 为每个位置各起一个定时器

#### Scenario: 未配置账号不保活

- **WHEN** `planStats.accounts` 未配置或为空
- **THEN** 插件 SHALL 不执行任何保活/探活调用
