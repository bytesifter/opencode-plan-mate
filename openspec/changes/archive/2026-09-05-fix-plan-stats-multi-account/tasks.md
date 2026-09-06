## 1. 类型与配置

- [x] 1.1 `src/types.ts`：`ParsedOptions.planStats` 从 `{ profiles: string[] }` 改为 `{ accounts: Record<string, string> }`（显示名 → arkcli HOME 目录）
- [x] 1.2 `src/config.ts`：`parsePlanStats` 解析 `accounts` 映射（key/value 均非空字符串、`~` 展开复用 homedir）；非对象/空映射视为未配置返回 undefined

## 2. 取数逻辑

- [x] 2.1 `src/quota.ts`：`volcArkcliAdapter.fetch` 签名从 `(profile, exec)` 改为 `(account, home, exec)`，spawn 命令去掉 `--profile`，env 合并 `HOME=<home>` + 归因 env（`...process.env` 在前、显式覆盖在后）
- [x] 2.2 `collectPlanQuotas` 输入从 `profiles: string[]` 改为 `accounts: { 显示名: home }[]`（或 Record），按账号并发、失败隔离不变

## 3. 工具集成

- [x] 3.1 `src/index.ts`：`plan_stats` execute 读取 `opts.planStats?.accounts`，按 `[显示名, home]` 传给 `collectPlanQuotas`；未配置返回配置提示（提示含 accounts 示例）

## 4. 测试

- [x] 4.1 更新 adapter 测试：断言 spawn env 含 `HOME`、命令不含 `--profile`、归因 env 仍注入；正常/未订阅/未登录/ENOENT/畸形输出用例保留
- [x] 4.2 更新编排测试：多账号并发、单账号失败隔离；断言每账号用各自 HOME
- [x] 4.3 更新配置测试：`accounts` 解析（合法/过滤非法/未配置）；`profiles` 旧键不再生效
- [x] 4.4 `bun test` 全绿、`bun x tsc --noEmit` 通过、`bun run build` 成功

## 5. 文档

- [x] 5.1 README 增加 `plan_stats` 使用说明：`planStats.accounts` 配置示例 + 每账号隔离 HOME 的一次性 SSO setup 步骤（`config init` + `--no-browser` 两段式）
