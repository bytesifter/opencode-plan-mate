# Proposal

## Why

opencode 会话恢复（drain）与部分辅助请求走 core 层 `SessionRunner` → `FetchHttpClient`（全局 fetch），不经过插件的 `session.hook("http.request")` 拦截层，导致这些请求用会话原生绑定的单账号（实测为 `volhwy2410`）直发、绕过 key 轮询与 429 熔断。日志实测：10-03 全天 9 次 "Requests are too frequent" 429 中，8 次来自 drain 路径，且全部打在 volhwy2410 一个账号上（DB 会话绑定铁证 + drain 时段 plugin 日志 0 条 fetch）。与此同时，池内轮询为无在途感知的纯随机，多个会话并发时同账号瞬时重叠（当天 104 对重叠），叠加单请求 90 万+ cache token 的大上下文，反复撞上火山 RPM/TPM 限流（官方错误码 `AccountRateLimitExceeded` = 请求超出 RPM/TPM 限制）。

## What Changes

- 新增**全局 fetch 兜底层**：patch `globalThis.fetch`，拦截走全局 fetch 但绕过 session http 钩子的请求（drain/恢复路径），应用 key 轮询与 429/402 熔断；与现有 session 钩子双轨共享同一个 `ProviderPool`，避免重复轮询。
- `pool.next()` 加入**在途感知**（least-loaded）：优先选 0 在途账号，全在途时选最闲，降低同账号并发重叠（对 TPM 的间接缓解）。
- 兜底层与 session 钩子**共用熔断/统计**：429/402 熔断状态、请求日志、token 统计在两条路径间一致，不各自记账。
- 新增**观测指标**：按账号统计"60s 窗口 token"分布，作为修复效果验证指标（病 C 不设硬阈值，靠减少重叠间接缓解）。

## Capabilities

### New Capabilities

（无 —— 行为变化归属既有能力 key-rotation）

### Modified Capabilities

- `key-rotation`: 轮询覆盖范围从"session http 钩子路径"扩展为"所有匹配池 baseURL 的 provider 请求（含绕过钩子的 core/drain 路径）"；选池策略从纯随机改为"在途感知优先"。熔断与统计从"仅钩子路径"扩展为"钩子 + 兜底路径共用"。

## Impact

- `src/pool.ts`：`next()` 增加在途计数感知；`markCooldown`/`isCoolingDown` 保持不变（供两条路径共用）。
- `src/http-hooks.ts`：现有 session 钩子逻辑保留，作为"已拦路径"；新增兜底路径识别与去重标记，避免双轨重复。
- `src/` 新增 fetch-patch 模块（或并入 `http-hooks.ts`）：patch 全局 fetch 的分发与流式转发。
- `src/index.ts`：setup 时安装 fetch-patch（仅首个 setup，模块级单例），与现有钩子注册并列。
- `tests/`：新增兜底路径单测（识别、去重、转发、熔断贯通）。
- `docs/`：`key-rotation` 相关用户文档补充兜底层与在途感知说明。
- 运行时无新外部依赖（fetch-patch 为进程内补丁，依赖 opencode core 走全局 fetch 的实现细节）。
