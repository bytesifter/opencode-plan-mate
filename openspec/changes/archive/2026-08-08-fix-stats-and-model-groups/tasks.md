## 1. 修复零 token 幽灵记录

- [x] 1.1 `stats.ts`: `recordUsage` 在构建 token 快照后检查全零（input/output/reasoning/cacheRead/cacheWrite 均为 0），全零则返回 false 跳过，不更新 lastTokens
- [x] 1.2 `tests/stats.test.ts`: 新增全零 token 事件跳过场景
- [x] 1.3 `tests/stats.test.ts`: 新增全零后跟真实 token 正常累加场景

## 2. ProviderEntry 新增 models 字段

- [x] 2.1 `types.ts`: `ProviderEntry` 新增 `models: string[]` 字段
- [x] 2.2 `config.ts`: `collectProviders` 读取 `config.provider[name].models` 的 Object.keys 作为 models 列表，填入 ProviderEntry

## 3. ProviderPool 按模型分组

- [x] 3.1 `pool.ts`: 新增 `private groups: Map<string, ProviderEntry[]>`，constructor 中按 entry.models 构建分组映射
- [x] 3.2 `pool.ts`: `next(model?: string)` 重写--model 存在且有分组时从分组中随机选（跳过熔断）；否则从全量 entries 随机选（降级）
- [x] 3.3 `pool.ts`: 新增 `hasGroup(model: string): boolean` 方法供 fetch-patch 判断是否退化
- [x] 3.4 `tests/pool.test.ts`: 新增按模型分组选择场景（同模型跨 baseURL）
- [x] 3.5 `tests/pool.test.ts`: 新增 model 无分组时退化到扁平池场景

## 4. fetch-patch 解析 body 提取 model

- [x] 4.1 `fetch-patch.ts`: 新增 `extractModel(init?: RequestInit): string | undefined` 工具函数--解析 init.body 为 JSON 字符串取 model 字段
- [x] 4.2 `fetch-patch.ts`: `patchedFetch` 中调 `extractModel(init)` 获取 model，传给 `pool.next(model)`
- [x] 4.3 `fetch-patch.ts`: body 不是字符串 / JSON 解析失败 / model 为 undefined 时传 undefined 给 next（降级）
- [x] 4.4 `tests/fetch-patch.test.ts`: 新增 body 含 model 字段时按分组选 provider 场景
- [x] 4.5 `tests/fetch-patch.test.ts`: 新增 body 不可解析时退化到扁平池场景

## 5. 构建与验证

- [x] 5.1 `bun x tsc --noEmit` 类型检查通过
- [x] 5.2 `bun test` 全部测试通过
- [x] 5.3 `bun run build` 构建成功
