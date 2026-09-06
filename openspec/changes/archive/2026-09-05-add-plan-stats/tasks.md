## 1. 冒烟验证（已完成）

- [x] 1.1 实测确认：Coding Plan API key 直连 `GetCodingPlanUsage`（OpenTOP 网关 / ark host）被拒，`usage plan` 为控制面操作、仅接受 SSO；`arkcli usage plan --product coding-plan --profile <p>` 为取数命令
- [x] 1.2 将冒烟结论回写 proposal/design/specs（"依赖 arkcli 子进程"方案）

## 2. 类型与 adapter 接口

- [x] 2.1 在 `src/types.ts` 新增 `PlanQuota`（provider/kind/subscribed/periods/updatedAt/error）、`QuotaAdapter`（id/fetch）、`SpawnExecutor` 类型，及 `ParsedOptions.planStats`（`profiles: string[]` 可选）
- [x] 2.2 新建 `src/quota.ts`：导出 adapter 注册表 `adapters: QuotaAdapter[]` 与编排函数 `collectPlanQuotas(profiles, exec)`（并发查询、单 profile 失败隔离、无匹配标注"不支持的 provider"）

## 3. 火山 arkcli adapter

- [x] 3.1 实现 `volcArkcliAdapter`：构造 `arkcli usage plan --product coding-plan --profile <p> --format json` 并 spawn（注入 `ARKCLI_CALLER_*` 归因 env、超时、stdout/stderr 分离）
- [x] 3.2 实现输出解析：`items[]` → `PlanQuota`（periods percent + reset_at、subscribed），错误分类（未登录/profile 不存在/arkcli 缺失/畸形输出）
- [x] 3.3 把 `volcArkcliAdapter` 注册进 `adapters` 数组

## 4. 渲染

- [x] 4.1 新增 `renderPlanChart(quotas: PlanQuota[]): string`：每行一个 profile，session/weekly/monthly 三窗口 percent 柱 + reset_at，复用 `chart.ts` 的 `bar()/pad()`
- [x] 4.2 全空/全失败时返回"暂无统计数据"

## 5. 插件集成

- [x] 5.1 `config.ts` 解析可选 `planStats.profiles: string[]`（校验元素为非空字符串），加入 `ParsedOptions`
- [x] 5.2 `index.ts` 注册 `plan_stats` 工具：execute 读取 `opts.planStats?.profiles` → `collectPlanQuotas`（注入真实 spawn 执行器）→ `renderPlanChart` 返回；未配置时返回配置提示

## 6. 测试

- [x] 6.1 新增 adapter 单元测试（注入 fake spawn）：正常解析/未订阅/未登录/profile 不存在/命令缺失/畸形输出
- [x] 6.2 新增编排测试：多 profile 并发、单 profile 失败隔离、无匹配 adapter 标注
- [x] 6.3 新增渲染测试：有数据出图、无数据提示
- [x] 6.4 `bun run test` 全绿、`bunx tsc --noEmit` 通过、`bun run build` 成功
