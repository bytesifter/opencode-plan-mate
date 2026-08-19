## Why

当某 provider 的 DeepSeek/ARK 账户余额耗尽时,API 返回 HTTP 402(Insufficient Balance),但插件只在收到 429 时才标记熔断(`fetch-patch.ts:66` 只检查 `status === 429`)。于是余额耗尽的 provider 继续以等概率被随机选中,每次被选到都以 402 失败报错——浪费约 1/6 的请求并持续产生 "Insufficient Balance" 错误。2026-08-16 的日志中 `deepseek-9208` 就出现了 3 次 `status=402`。

## What Changes

- 将 HTTP 402 响应纳入熔断判定:收到 402 时标记该 provider 熔断
- 402 语义等价于余额耗尽(不会自愈),按 `quota-exhausted` 类型使用 `quotaCooldownMs`(默认 1 小时,可配)长时间冷却
- 402 判定不需要读响应体分类——直接归为 `quota-exhausted`
- 冷却日志复用现有 `quota-exhausted` 类型标签,不新增标签
- 401/403 不纳入本次范围(保持最小改动)

## Capabilities

### New Capabilities
<!-- 无新能力 -->

### Modified Capabilities
- `key-rotation`: 熔断判定从"仅 429"扩展为"429 + 402";402 无条件归为 `quota-exhausted` 长冷却
- `structured-logging`: 冷却日志的 `quota-exhausted` 来源从"仅配额耗尽 429"扩展为"配额耗尽 429 或余额不足 402"

## Impact

- `src/fetch-patch.ts`: `patchFetch` 中的 429 判定扩展为 429/402
- `src/fetch-patch.ts`: `classify429` 语义需与 402 协调(402 不走响应体分类)
- `tests/fetch-patch.test.ts`: 新增 402 → `quota-exhausted` 长冷却用例
- `README.md`: 功能描述、配置表、规则、日志示例中补充 402 行为
- `openspec/specs/key-rotation/spec.md` 与 `openspec/specs/structured-logging/spec.md`: 需求同步更新
- 无新增依赖,不改配置 schema(复用 `quotaCooldownMs`)
