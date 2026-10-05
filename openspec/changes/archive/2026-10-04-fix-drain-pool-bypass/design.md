# Design

## Context

现状与约束（动机详见 proposal.md - Why，需求详见 specs/key-rotation/spec.md）：

- 插件轮询依赖 `ctx.session.hook("http.request")`，只覆盖 session 运行时路径。opencode core 层 `SessionRunner.runTurn` 直接调 `llm.stream(request)`（`packages/core/src/session/runner/llm.ts`），经 `RequestExecutor` → effect `FetchHttpClient` → **全局 fetch** 发请求，**不经过 session http 钩子**。实测 drain 请求全部用会话原生绑定账号（volhwy2410）直发，10-03 的 8/9 次 429 由此产生。
- 静态源码证据：`FetchHttpClient` 的 `Fetch` 是 `Context.Reference`，`defaultValue: () => globalThis.fetch`（惰性箭头函数，每次 `getRef` 动态求值）；`HttpClient.make` 回调每次请求执行。因此 **patch 全局 fetch 会在下一个请求生效**（前提：opencode 未在别处显式 provide 自定义 fetch）。
- 池内 `next()` 为无在途感知的纯随机，多会话并发时同账号瞬时重叠（当天 104 对重叠），叠加单请求 90 万+ cache token，反复撞 RPM/TPM。

## Goals / Non-Goals

**Goals:**

- 让绕过 session 钩子的请求（drain/恢复路径）也进入 key 轮询与熔断，消除单账号直发。
- 用最小区间覆盖（fetch-patch 兜底 + 在途感知）降低同账号并发重叠与 429 频率。
- 两条路径（钩子 + 兜底）共享 pool 状态，熔断与统计一致。

**Non-Goals:**

- 不设 TPM 硬阈值软限流（病 C 验证结论：服务端 TPM 判定逻辑客户端无法精确预测，只靠减少重叠间接缓解，不做启发式限流）。
- 不做"会话绑定池子代理 provider"方案（方案 B，改动面大，作为 fetch-patch 兜底失效时的后备，不在本 change 实现）。
- 不修改 opencode 源码（fetch-patch 为进程内运行时补丁，卸载插件即恢复）。
- 不跨进程共享在途/熔断状态（单进程内共享；多进程同事会话由各自插件实例负责，不引入共享存储）。

## Decisions

### 决策 1：用全局 fetch-patch 做兜底层（而非只依赖 session 钩子）

**选择**：setup 时保存 `globalThis.fetch` 原引用，替换为包装函数；包装函数按 URL 匹配池 baseURL，命中且未被 session 钩子标记的请求走池轮询，否则原样转发。

**理由**：drain 路径走 `FetchHttpClient` → 全局 fetch，这是唯一能同时覆盖钩子路径与 core 路径的拦截点。V1 时代 `opencode-round-robin` 已验证 fetch monkey-patch 覆盖所有 HTTP 请求（含子 agent/compact）。

**替代方案**：
- 仅依赖 session 钩子——漏掉 drain（本 change 要解决的问题本身）。
- 会话绑定代理 provider（方案 B）——覆盖全但需本地代理进程 + 配置迁移，改动面大，留作后备。

**前置风险（必须先 spike 验证）**：Bun 打包的 opencode exe 里 `globalThis.fetch` 是否可被重新赋值、drain 是否真走全局 fetch。验证不通过则本决策失效，转入方案 B（见 Risks）。spike 作为 tasks 第一组。

### 决策 2：双轨去重，不重复轮询

**选择**：session 钩子拦截时在请求上打标记（如自定义头或 Request 属性）；fetch-patch 检测到标记则放行。兜底层只处理"未经钩子"的请求。

**理由**：钩子路径已按"接入点+模型"精细分组（读 body model），兜底层若重复处理会二次轮询、且兜底层读 body 成本高。钩子优先、兜底补漏，职责清晰。

**替代方案**：兜底层一律先判断"是否池内请求"再轮询——会与钩子路径重复且可能选到不同 provider，不取。

### 决策 3：在途感知为软约束（least-loaded），不做阻塞信号量

**选择**：`ProviderPool` 维护 key → 在途计数；`next()` 选分组内在途数最小的非熔断 provider，同数随机。请求发出 +1，响应/错误 -1，超时兜底清理。

**理由**：数据证明同账号 2 并发绝大多数成功（104 对重叠全 200），严格 1 在途是过度治疗且拖低吞吐；软感知在保留并行的同时降低碰撞。不阻塞请求，无信号量死锁风险。

**替代方案**：严格信号量（每账号 1 在途 + abort 超时释放）——吞吐锁死为"同时 4 请求"，且 drain 多会话恢复时排队严重，不取。

### 决策 4：在途计数与熔断状态共享，统计口径统一

**选择**：fetch-patch 兜底层复用现有 `ProviderPool.markCooldown/isCoolingDown` 与 `Logger`，不新建状态；`onResponse`/`onCorrelate` 回调同时供两条路径使用，日志与 token 统计归并到同一账号维度。

**理由**：避免两条路径各自记账导致熔断不一致（钩子路径熔断的账号被兜底路径继续用）。复用现有回调签名，改动集中在 fetch-patch 模块。

### 决策 5：病 C（TPM）不作为独立限流目标，作为观测指标

**选择**：不在客户端设 TPM 阈值或启发式限流；改为在统计中增加"按账号 60s 窗口 token"维度，用于验证修复后 429 是否随重叠下降。

**理由**：病 C 验证显示服务端并非固定 TPM 阈值（峰值 337 万/377 万未触发、260 万触发），客户端无法精确建模；唯一确定有效的动作是降低瞬时重叠（决策 3 覆盖）。设硬阈值反而可能误伤正常流量。

## Risks / Trade-offs

- **[fetch-patch 在 V2 环境可能无效]** Bun 打包 exe 全局 fetch 不可覆盖，或 opencode 显式 provide 了自定义 fetch（http-recorder 风格）→ **Mitigation**：spike 先行（tasks 第 1 组），验证通过才进入实现；失败则本 change 暂停，转方案 B（代理 provider）评估。spike 结论记录在 design 的 Open Questions 对应处。
- **[兜底层误伤 opencode 内部请求]** patch 全局 fetch 会拦截进程内所有 fetch → **Mitigation**：严格按 baseURL 前缀匹配 + 不匹配即原样放行（决策 1）；兜底层只替换 Authorization，不改 URL/方法/body。
- **[在途计数泄漏]** 请求 abort 无响应导致计数只增不减 → **Mitigation**：复用现有 `START_TIME_MAX_AGE_MS` 超时清理模式，超时兜底清零。
- **[双轨 provider 不一致]** 钩子与兜底选到不同 provider、或熔断状态不同步 → **Mitigation**：共享同一 `ProviderPool` 实例与回调（决策 4），去重标记（决策 2）。
- **[流式响应转发]** drain 为 SSE 流，fetch-patch 转发需保证流不被吞 → **Mitigation**：兜底层只改 headers 后交给原始 fetch，不读 body，流式响应原样透传（参考 V1 fetch-patch 已验证的转发方式）。

## Migration Plan

- 本 change 为插件内行为扩展：发布后现有用户升级插件即生效，无配置迁移。
- 兜底层默认开启；若 spike/上线后发现问题，可通过配置开关（`fetchPatch` 选项，默认 true）回退到纯 session 钩子行为。
- 回滚：还原插件版本即可完全恢复旧行为，无持久状态残留。

## Open Questions

- spike 结果未知：V2（2.0.18）下全局 fetch 是否可 patch、drain 是否走全局 fetch —— 这是实现前置门，由 tasks 第 1 组验证；验证失败会改变整体方案（转方案 B），属于实现前必须解答的问题，故列入 tasks 而非本节的"可延后"问题。

## Spike 结论（2026-10-04，机制验证已通过）

- **机制验证 A（通过）**：在 Bun + 项目 `effect` 运行时用独立脚本实测，通过 effect `FetchHttpClient` 发起的请求（与 opencode drain/`SessionRunner` 相同路径）被 patch 后的 `globalThis.fetch` 成功拦截，且携带的 `x-opencode-session-id` drain 特征头完整可见；patch 对下一个请求立即生效。这证实了 `FetchHttpClient` 的 `Fetch` reference 是惰性 `defaultValue: () => globalThis.fetch`、请求时动态求值。
- **证据链**：源码（`core/src/session/runner/llm.ts` → `RequestExecutor` → effect `FetchHttpClient` → 全局 fetch）+ 日志铁证（10-03 的 8/9 次 429 全打 volhwy2410、drain 时段 plugin 日志 0 fetch、DB 会话绑定 7 个 drain 失败会话全为 volhwy2410）。
- **真环境复现（1.2）**：经用户决策，接受上述证据直接进入实现，不重启 opencode 服务；真环境（opencode 2.0.18 exe 内 fetch 可 patch 性）验证顺延为**实现后验收项**（见 tasks 5.2 之后的验证，或上线后观测 drain 429 是否随兜底层落地而消失）。fetchPatch 默认开启 + 配置开关可回滚，风险可控。
