## Why

当前按 model 分组允许跨厂商轮询:deepseek-v4-flash 分组同时包含 4 个 ARK provider 和 2 个 native deepseek provider,同一 session 的请求可能在 ARK 与 deepseek 原生端点之间随机跳转。不同厂商接入点的 token 计数、定价、配额语义与 limits 配置不一致,导致 input/output token 统计与成本归属不可比,且请求可能携带源 provider 的 limit/thinking 配置被发往不匹配的目标端点。

## What Changes

- 轮询分组键从 `model` 改为 `baseURL|model`(同接入点 + 同模型)
- `pool.next()` 增加按原始请求 baseURL 限定分组:请求从哪个接入点发出,就在该接入点内、支持该 model 的 provider 间随机轮询(URL 不变,只换 key)
- model 无法解析时退化为"同 baseURL 池"随机,不再退化为跨厂商扁平池
- 不新增配置项,不引入跨厂商兜底(某接入点全熔断时 passthrough,与现状一致)

## Capabilities

### New Capabilities
<!-- 无新能力 -->

### Modified Capabilities
- `key-rotation`: 分组依据从"仅 model"改为"baseURL + model";退化路径从"扁平池"改为"同接入点池"

## Impact

- `src/pool.ts`: `groups` 的 key 从 model 改为 `${baseURL}|${model}`;新增 `byBaseURL` 兜底池;`next(model, originBaseURL)` 签名变更
- `src/fetch-patch.ts`: 调用 `pool.next()` 时传入已计算出的 `originalBaseURL`
- `tests/pool.test.ts` 与 `tests/fetch-patch.test.ts`: 更新跨厂商轮询用例,新增同接入点分组用例
- `README.md`: 规则段从"不按 baseURL 分组"改为"按 baseURL+model 分组"
- `openspec/specs/key-rotation/spec.md`: 需求同步更新
