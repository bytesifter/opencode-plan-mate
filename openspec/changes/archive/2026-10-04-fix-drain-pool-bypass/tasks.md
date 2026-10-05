# Tasks

## 1. Spike：验证全局 fetch-patch 在 V2 下能否兜住 drain

- [x] 1.1 写最小观测插件（临时目录，不进仓库）：setup 时 patch `globalThis.fetch`，仅对 URL 匹配池 baseURL 且带 `x-opencode-session-id` 头的请求打日志（拦截到/未拦截到），不修改任何请求；验证脚本输出明确拦截计数。验证方式：临时插件加载后触发一次会话恢复（重启服务或恢复会话），在输出中能看到匹配池 URL 的 fetch 调用被 patch 拦截。→ 机制验证 A 通过：Bun+effect 独立脚本实测 FetchHttpClient 请求被 patched fetch 拦截（含 x-opencode-session-id 头）。
- [x] 1.2 在本地 opencode 2.0.18 环境复现 drain：中断一个 volhwy2410 会话后重开，观察观测插件日志是否出现该 URL 的 fetch 拦截记录（与 plan-mate 日志 0 fetch 对照）。验证方式：观测插件出现匹配池 URL 的拦截记录 = 方案 A 可行；无任何记录 = 方案 A 失效。→ 经用户决策：接受机制证据直接实现，真环境复现顺延为实现后验收项。
- [x] 1.3 记录 spike 结论到 design.md：全局 fetch 是否可 patch、drain 是否走全局 fetch、是否存在别处显式 provide fetch。验证方式：design.md 的 Open Questions 被结论替换；若验证失败，本 change 停止实现并标注转方案 B（代理 provider）。→ 已写入 design.md "Spike 结论" 节。

## 2. 兜底层实现

- [x] 2.1 在 src/ 新增 fetch-patch 模块（或并入 http-hooks.ts）：保存原始 fetch 引用，patch 后按 URL 前缀匹配池 baseURL，命中且无钩子标记的请求走 `pool.next()` 替换 Authorization，其余原样转发。验证方式：新增单测覆盖"匹配池 URL 替换 key / 不匹配放行 / 已标记放行 / 全熔断 passthrough"四个分支，`bun test` 通过。→ 新增 src/fetch-patch.ts,4 分支单测通过。
- [x] 2.2 实现双轨去重标记：session 钩子拦截时在请求上打标记，fetch-patch 检测标记即放行。验证方式：单测覆盖"钩子已拦 → 兜底放行、不二次轮询"，`bun test` 通过。→ POOLED_MARKER_HEADER 由钩子设置、兜底检测,单测通过。
- [x] 2.3 setup 时安装 fetch-patch（模块级单例，仅首个 setup 安装，与钩子注册并列），并增加 `fetchPatch` 配置开关（默认 true，false 时回到纯钩子行为）。验证方式：`bun test` 覆盖"安装一次 / 开关关闭不安装"；`bunx tsc --noEmit` 通过。→ index.ts 安装 + parseOptions 解析 fetchPatch,config/fetch-patch 单测 + tsc 通过。
- [x] 2.4 兜底路径复用现有 `onResponse`/`onCorrelate` 回调与 `Logger`，请求日志与 token 统计归并到同一账号维度。验证方式：单测覆盖兜底路径触发 `onResponse`（429 分类 rate-limit/quota-exhausted 与钩子路径一致），`bun test` 通过。→ fetch-patch 复用 callbacks,429/402 分类与 onCorrelate 单测通过。

## 3. 在途感知

- [x] 3.1 `ProviderPool` 增加 key → 在途计数：请求发出 +1、响应/错误 -1，复用现有超时清理模式（如 `START_TIME_MAX_AGE_MS`）兜底清零。验证方式：单测覆盖"发出+1、响应-1、abort 超时清零"，`bun test` 通过。→ acquire/release/pruneInflight + INFLIGHT_MAX_AGE_MS,单测通过。
- [x] 3.2 `next()` 改为 least-loaded：分组内选在途数最小的非熔断 provider，同在途数时随机；全 0 在途时行为与现状一致。验证方式：单测覆盖"优先 0 在途 / 同在途随机 / 全 0 随机"，`bun test` 通过。→ next 选在途最小,三类单测通过。
- [x] 3.3 在途计数与熔断状态共享（fetch-patch 与钩子路径读写同一 pool）。验证方式：集成单测覆盖"兜底路径 429 熔断后钩子路径 `next()` 跳过该 provider"，`bun test` 通过。→ fetch-patch 与 http-hooks 读写同一 pool,集成单测通过。

## 4. 观测指标（病 C 验证）

- [x] 4.1 统计层增加"按账号 60s 窗口 token"维度，`plan_mate_stats` 工具可按账号输出窗口分布（p50/p90/max）。验证方式：单测覆盖窗口聚合正确性，`bun test` 通过；工具文档同步更新。→ 新增 src/tpm.ts + Logger.readTodayLines,plan_mate_stats 追加窗口表,13 单测 + 真实日志冒烟通过。
- [x] 4.2 文档记录 TPM 观测方法：用窗口 token 分布 + 429 时刻对照验证修复效果（429 是否随同账号重叠下降）。验证方式：docs/user-guide 相应章节更新并核对可读。→ plan-mate-stats.md 新增"TPM 窗口观测（病 C 验证）"小节。

## 5. 文档与收尾

- [x] 5.1 更新 docs 的 key-rotation/安装文档：兜底层说明（覆盖范围、配置开关、去重行为）与在途感知说明。验证方式：文档描述与实现一致（`bun test` 全绿 + 文档 review）。→ plan-mate-stats.md 兜底层/在途感知章节 + installation.md fetchPatch 选项,与实现一致。
- [x] 5.2 全量回归：`bun test`、`bunx tsc --noEmit`、`bun run build` 全部通过，确认 dist/ 产物由构建生成且不被手改。验证方式：三条命令零失败。→ 209 测试通过,tsc 0 错误,build 产物含新模块。
