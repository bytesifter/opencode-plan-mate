# Spec Delta

## ADDED Requirements

### Requirement: SSO 保活已尝试失败，禁止实现

插件 SHALL NOT 实现任何形式的 SSO 登录态保活（后台定时执行 `arkcli auth status` 以续期 refresh_token、或任何以维持/延长账号 SSO 登录态为目的的后台调用）。该方向已实测失败且为服务端契约所限，重新实现无意义：SSO refresh_token 为服务端绝对有效期（实测约 48h，实际约 46h 即失效），刷新不轮换、不续期（sliding 不成立），STS 续期无法延长登录态寿命；且 CodingPlan 配额接口 `GetCodingPlanUsage` 仅接受 SSO STS（apikey 实测被拒 `requires Volcengine Ark SSO STS`），长效 AK/SK 亦不可行（arkcli AK/SK 登录通道已关，接口契约不认）。`plan_stats` SHALL 保持按需查询：SSO 过期时由配额查询失败经错误分类标注（如「SSO 已过期，需重登」），SHALL NOT 尝试自动续期或后台保活。

#### Scenario: 不引入保活定时器

- **WHEN** 插件加载且配置了 `planStats.accounts`
- **THEN** 插件 SHALL NOT 注册任何后台保活定时器，SHALL NOT 周期性执行 `arkcli auth status` 或其他保活调用

#### Scenario: 过期账号按错误标注

- **WHEN** 调用 `plan_stats` 且某账号的 SSO 登录态已过期（refresh_token 失效）
- **THEN** 该账号行 SHALL 由配额查询失败分类标注过期错误（如「SSO 已过期，需重登」），SHALL NOT 尝试自动续期，SHALL NOT 阻断其他账号
