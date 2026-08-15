## Why

per-provider-stats 实现后发现两个问题：(1) `message.updated` 在创建 assistant 消息时先触发一次全零 token 事件，token 快照比较将其误判为新 step 导致 req 翻倍（无工具调用 2 条、有工具调用 3 条）；(2) 扁平池设计无法支持异构 provider——用户需要同时使用 ARK（glm-5.2 + deepseek-v4-flash）和 native deepseek（deepseek-v4-flash），但两者 baseURL 不同，扁平池会把 ARK 请求重定向到 deepseek API 导致 404。

## What Changes

- 修复零 token 幽灵记录：`recordUsage` SHALL 跳过所有 token 值为零的 `message.updated` 事件（opencode 创建 assistant 消息时触发的初始事件，非真实 LLM 用量）
- **BREAKING** provider 池从扁平列表改为按模型自动分组：`collectProviders` 额外读取每个 provider 的 `models` 字段，`ProviderPool` 构建 `Map<model, ProviderEntry[]>` 分组映射
- fetch-patch 解析请求 body 提取 `model` 字段，调用 `pool.next(model)` 从该模型的分组中随机选 provider
- body 解析失败、无 model 字段、或模型无对应分组时，SHALL 退化到扁平池全随机（当前行为，安全降级）
- `ProviderEntry` 新增 `models: string[]` 字段
- cooldown 仍 per-key（不按模型隔离）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `usage-tracking`: 新增零 token 事件跳过要求，修复 message.updated 初始事件导致的 req 翻倍
- `key-rotation`: provider 选择从扁平全随机改为按模型分组随机；`collectProviders` 额外读取 models 字段；fetch-patch 解析请求 body 提取 model

## Impact

- `src/types.ts`: `ProviderEntry` 新增 `models: string[]`
- `src/config.ts`: `collectProviders` 读取 `config.provider[name].models` 的 key 列表
- `src/pool.ts`: `ProviderPool` 内部构建 `Map<model, ProviderEntry[]>`，`next(model?)` 支持按模型分组选择
- `src/fetch-patch.ts`: 解析 `init.body` 提取 model，传给 `pool.next(model)`
- `src/stats.ts`: `recordUsage` 新增全零 token 跳过判断
- `tests/stats.test.ts`: 新增零 token 跳过场景
- `tests/pool.test.ts`: 新增按模型分组选择场景
- `tests/fetch-patch.test.ts`: 新增 body 解析 + 模型分组场景
