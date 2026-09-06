## Context

现有插件（见 proposal.md 动机）：round-robin 多账号轮询 + 按天实际请求/token 统计（`roundrobin_stats`）。相关现状约束：

- 官方套餐 quota（`usage plan`）是 ARK **控制面**数据，实测确认仅接受 SSO 登录态；Coding Plan API key（`ark-...`）为数据面凭证，直连 `GetCodingPlanUsage`（OpenTOP 网关）返回 `InvalidAuthorization`，arkcli 亦拒绝 `--api-key` 用于控制面
- 本机已安装 `arkcli`，支持多 profile（每个火山账号一个），`usage plan` 通过 profile 的 SSO 登录态取数，输出结构化 JSON（`viewer` + `items[].periods[]`）
- 插件不直接依赖 opencode provider 的 key/baseURL 来取 quota——取数主体是 arkcli profile 的登录态
- `chart.ts` 已有 `bar()/pad()/fmtTok()` 等渲染原语可复用

## Goals / Non-Goals

**Goals:**
- provider 无关的套餐配额查询框架（adapter 注册表），编排/渲染不感知具体 provider
- 火山 Coding Plan 作为首个 adapter（个人版 `usage plan`，通过子进程取数）
- 新工具 `plan_stats`：显式调用时按 profile 并发查询，ASCII 表 + percent 柱渲染
- 未配置/arkcli 缺失/未登录时优雅降级，不影响插件轮询核心
- 测试可注入（adapter 通过注入的 spawn 执行器做单测，不真跑子进程）

**Non-Goals:**
- 不做 Agent Plan / team seat 支持（adapter 机制已留扩展点）
- 不做后台轮询、不做查询缓存（每次显式调用实时查询）
- 不改动现有 `usage-tracking` / `roundrobin_stats` 行为
- 不提供 used/total 绝对值（CodingPlan 后端只返 percent，数据边界）
- 不在插件内直连 ARK 控制面（统一走 arkcli）

## Decisions

### D1: 子进程调用 arkcli（替代原"原始 fetch 绕过轮询"）

取数统一通过 `node:child_process` spawn arkcli 子进程，天然绕过插件内被 patch 的 `globalThis.fetch`，无需 rawFetch 捕获。adapter 接收**注入的 spawn 执行器**（默认实现 spawn 真实 arkcli，测试注入 fake），并带超时（建议 30s）与 stderr/stdout 分离。

- 备选：插件内直连 OpenTOP（需 AK/SK 签名 / SSO STS 获取）——实测 coding key 不可行，且需要重实现签名与 STS 逻辑
- 决定：spawn arkcli。命令固定为 `arkcli usage plan --product coding-plan --profile <p> --format json`；调用前注入 `ARKCLI_CALLER_TYPE=ai_agent`、`ARKCLI_CALLER_NAME=opencode`、`ARKCLI_SKILL_NAME=arkcli-usage` 归因环境变量

### D2: provider 无关的 adapter 注册表

```
QuotaAdapter {
  id: string
  fetch(ctx: { profile: string }, exec: SpawnExecutor): Promise<PlanQuota>
}
PlanQuota {
  provider: string        // profile 名（行名）
  kind: "coding-plan"
  subscribed: boolean
  periods: { label: string; percent: number; resetAt?: string }[]
  updatedAt?: string
  error?: string          // 失败/跳过原因
}
const adapters: QuotaAdapter[] = [volcArkcliAdapter]
```

编排流程：对每个 profile → `adapters.find(a => a.supports(profile))`（首个实现默认支持全部）→ 无匹配则 `error="不支持的 provider"`；匹配则 `fetch`（单 profile 失败隔离，不阻断 `Promise.all`）。渲染只看 `PlanQuota[]`，与 provider 无关。

- 备选：配置驱动（把 CLI 命令写进 opencode.jsonc）——命令泄漏到配置、无类型安全
- 决定：代码注册表，新增 provider = 新增 adapter 文件 + 注册进数组

### D3: 火山 adapter（spawn arkcli）

- 命令：`arkcli usage plan --product coding-plan --profile <profile> --format json`
- 解析：`items[]` 中取 `product == "coding-plan"` 的桶 → `periods[]`（label=session/weekly/monthly，percent + reset_at）→ `PlanQuota`；`subscribed=false` 或桶缺 `periods` → 未订阅
- 错误分类：进程退出非 0 / stderr 含"SSO"/"login" → 未登录；stdout 无法解析 → 畸形输出；spawn 抛异常（ENOENT）→ arkcli 不可用
- 注册进 `adapters`

### D4: 渲染与工具注册

- 复用 `chart.ts` 的 `bar()/pad()`；新增 `renderPlanChart(quotas: PlanQuota[]): string`，每行一个 profile，三窗口 percent 柱 + reset_at；全空返回"暂无统计数据"
- `tool({ name: "plan_stats", description: "...", args: {} })`；execute 里未配置 `planStats.profiles` 时返回配置提示
- 每个 profile 并发查询（`Promise.all`），失败行内标注

## Risks / Trade-offs

- [依赖本机 arkcli 二进制] → 能力可选：未装/未配时 `plan_stats` 降级提示，轮询与既有统计不受影响；README 注明安装与 per-account SSO 前置
- [官方 quota 需每账号一次性 SSO 登录] → 一次性成本，配置文档给出 `arkcli auth login volc-sso --profile <p>` 步骤；未登录 profile 行内标注
- [`usage plan` 输出结构对 arkcli 版本敏感] → 解析做容错（缺字段/畸形行→该 profile 报错不崩），适配器单测覆盖
- [子进程并发 N 个 arkcli] → 显式低频调用，N 通常个位数，可接受
- [profile 名与 opencode provider 名无关联] → 设计上以 profile 名为行名（形态 2 纯列表），不建立映射，语义清晰

## Migration Plan

- 纯新增能力，向后兼容，无数据迁移
- 回滚：移除 `plan_stats` 工具注册与 adapter 文件即可，不影响轮询与既有统计

## Open Questions

- 无（取数机制、配置形态、降级语义均已在冒烟与决策中确认）
