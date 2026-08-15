## Context

per-provider-stats 实现后暴露两个问题：

1. **零 token 幽灵记录**：opencode 在 `prompt.ts:1201` 创建 assistant 消息时立即调用 `updateMessage`，触发 `message.updated` 事件，此时 tokens 全零。token 快照比较将 `{0,0,0,0,0}` 视为"新 step"（与无记录不同），导致 req 翻倍。日志验证：每个真实 usage 后 ~40ms 跟一个全零 usage。

2. **扁平池不支持异构 provider**：用户配置了 4 个 ARK provider（baseURL 相同，支持 glm-5.2 + deepseek-v4-flash）和 1 个 native deepseek provider（baseURL 不同，仅支持 deepseek-v4-flash）。扁平池随机选 provider 时可能将 ARK 请求重定向到 deepseek API。按 baseURL 分组也不行--deepseek-v4-flash 请求可能从 ARK URL 或 deepseek URL 发出，用户希望跨 baseURL 轮询。

## Goals / Non-Goals

**Goals:**

- 跳过零 token 事件，修复 req 翻倍
- 按 model 自动分组，同一模型的 provider 跨 baseURL 参与轮询
- 安全降级：body 解析失败或 model 未知时退化到扁平池

**Non-Goals:**

- 不改 cooldown 机制（仍 per-key，不 per-model）
- 不改 X-Session-Id 关联机制
- 不改 stats 数据模型和图表
- 不改日志格式

## Decisions

### 决策 1: 跳过全零 token 事件

**选择**: `recordUsage` 在构建 token 快照后检查是否全零，全零则直接返回 false（跳过），不更新 lastTokens。

**理由**: opencode 在 `prompt.ts:1195-1201` 创建 assistant 消息时用 `tokens: { input: 0, output: 0, ... }` 调用 `updateMessage`。真实 LLM 响应至少有非零 input token。全零事件是初始创建，不是用量报告。

**副作用**: 如果 LLM 真的返回零 token（极不可能），会被跳过。可接受。

### 决策 2: 按 model 自动分组，非按 baseURL

**选择**: `collectProviders` 额外读取 `config.provider[name].models` 的 key 列表。`ProviderPool` 构建 `Map<model, ProviderEntry[]>`。`next(model?)` 优先从 model 分组选，无 model 或无分组时退化到扁平池。

**理由**: 用户需要 deepseek-v4-flash 跨 ARK 和 native deepseek 轮询。两个 baseURL 都是合法入口，按 baseURL 分组无法跨组轮询。按 model 分组通过解析请求 body 的 model 字段确定分组，天然支持跨 baseURL。

**替代方案**: 按 baseURL 分组。否决--deepseek-v4-flash 请求可能从任一 baseURL 发出，需要跨组轮询。

### 决策 3: 解析请求 body 提取 model

**选择**: fetch-patch 在选中 entry 前解析 `init.body`（JSON 字符串），提取 `model` 字段，传给 `pool.next(model)`。

**理由**: `@ai-sdk/openai-compatible` 发的请求 body 是 JSON 字符串（`{"model":"deepseek-v4-flash","messages":[...]}`）。解析成本极低（一次 `JSON.parse` + 取字段）。

**边界处理**:
- body 不是字符串 -> model = undefined -> 退化扁平池
- JSON.parse 失败 -> model = undefined -> 退化扁平池
- body 有 model 但无对应分组 -> 退化扁平池

### 决策 4: URL 替换逻辑不变

**选择**: 保留当前路径提取 + 拼接逻辑：`path = url.slice(originalBaseURL.length)`，`newUrl = entry.baseURL + path`。

**理由**: 所有 provider 都是 OpenAI 兼容 API，路径均为 `/chat/completions` 等。不同 baseURL 只是前缀不同，路径相同。ARK -> deepseek URL 替换：`/chat/completions` 拼到 `https://api.deepseek.com` 上，得到 `https://api.deepseek.com/chat/completions`，正确。

## Risks / Trade-offs

- **[body 解析开销]** 每次请求多一次 `JSON.parse`。 -> body 通常几 KB 到几十 KB，JSON.parse 性能远低于网络 IO，可忽略。

- **[model 字段名变化]** 未来 AI SDK 可能改 body 格式。 -> 降级到扁平池全随机，不会比当前更差。

- **[同 model 不同 API 协议]** 如果用户混用 `@ai-sdk/openai-compatible` 和 `@ai-sdk/anthropic` 但配了相同 model 名。 -> URL 替换后 API 协议不匹配会失败。当前用户已将 deepseek 改为 `@ai-sdk/openai-compatible`，所有 provider 协议一致。

- **[分组内单 provider]** native deepseek 单独在 deepseek-v4-flash 分组时（如果 ARK 未配 deepseek-v4-flash model）。 -> 单 provider 分组等于 passthrough，不报错。
