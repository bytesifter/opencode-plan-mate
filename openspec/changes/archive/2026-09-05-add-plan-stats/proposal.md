## Why

用户持有多个独立火山个人账号，每个账号一份个人版 Coding Plan。现有 `roundrobin_stats` 只统计本机经插件发出的实际请求/token，看不到各账号**官方套餐额度桶**（用了几成、几号刷新）。需要一个能一次拉齐多个账号 coding plan 官方 quota 的统一视图，且框架要与插件"多服务商"定位一致、可扩展到未来其他 provider。

**关键约束（冒烟实测确认）**：官方 quota（`usage plan`）是 ARK **控制面**数据，只接受该账号的 SSO 登录态；Coding Plan API key（`ark-...`）是数据面凭证，直连 `GetCodingPlanUsage` / OpenTOP 网关均被拒（`InvalidAuthorization`），arkcli 也拒绝用 `--api-key` 查控制面。因此必须**依赖本机 arkcli**，每个火山账号一次性 SSO 登录后，由插件通过子进程调用 `arkcli usage plan` 取数。

## What Changes

- 新增 `plan_stats` 工具：仅在用户显式调用时，对 `planStats.profiles` 中每个 arkcli profile 并发查询官方套餐 quota，返回按 profile 分行的 ASCII 表 + percent 柱状图
- **依赖本机 arkcli CLI**（`plan_stats` 的运行时依赖，不影响插件轮询核心）：插件通过子进程执行 `arkcli usage plan --product coding-plan --profile <p> --format json` 取数；每个火山账号需一次性 `arkcli auth login volc-sso` 建立登录态
- 新增可选配置 `planStats.profiles: string[]`（arkcli profile 名列表，行名 = profile 名）；未配置时 `plan_stats` 返回提示
- 引入 **provider 无关的 QuotaAdapter 注册表框架**：编排/渲染层不感知具体 provider，取数机制（子进程/HTTP/其他）封装在 adapter 内；新增 provider 支持 = 新增 adapter，不改编排/渲染
- 首个实现 `volc-arkcli` adapter：spawn `arkcli usage plan` 并解析输出
- 渲染基于 CodingPlan 后端实际返回：`session / weekly / monthly` 三个窗口的 `percent` + `reset_at`（后端不提供 used/total 绝对值）
- 降级策略：arkcli 缺失 / profile 未登录 / 未订阅 / 查询失败 → 行内标注错误，不阻塞其他
- **不做**后台轮询、**不做**查询缓存（每次显式调用实时查询）

## Capabilities

### New Capabilities
- `plan-quota-stats`: 插件新增的套餐额度统计能力——按 profile 聚合的官方 quota 视图、provider 无关的 adapter 框架、依赖 arkcli 的火山 coding plan 首个 adapter 实现

### Modified Capabilities
- （无。现有 `usage-tracking` 的按天请求/token 统计与 `roundrobin_stats` 行为不变）

## Impact

- `src/index.ts`：解析 `planStats.profiles` 配置；注册 `plan_stats` 工具
- 新增 `src/quota/`（或等价结构）：`adapter.ts`（接口 + 注册表）、`volc-arkcli.ts`（spawn arkcli 实现）、渲染复用 `chart.ts` 的 `bar()/pad()` 风格
- `src/types.ts`：新增 `PlanQuota` / `QuotaAdapter` / `planStats` 配置类型
- 运行时依赖：本机安装 `arkcli`（能力可选，未装/未配时 `plan_stats` 降级提示，轮询与既有统计不受影响）；`node:child_process` 用于子进程
- 配置：新增可选 `planStats.profiles`
- 测试：adapter 以注入 spawn 方式单测（正常/未订阅/未登录/命令缺失/畸形输出）、渲染、降级路径
