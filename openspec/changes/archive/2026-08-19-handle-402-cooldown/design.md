## Context

现状:`patchFetch`(`src/fetch-patch.ts`)只在 `response.status === 429` 时调用 `classify429` 并 `markCooldown`。HTTP 402(Insufficient Balance)不在判定内,因此余额耗尽的 provider 不被熔断,继续以等概率被随机选中,每次命中都以 402 失败。日志(`onResponse` → `globalLogger.logFetch`)会记录 402 状态,但不会标记 cooldown。详见 `proposal.md - Why`。

熔断类型 `CooldownType = "rate-limit" | "quota-exhausted"` 已存在,`quotaCooldownMs`(默认 3600000ms)已用于配额耗尽 429。无需新增配置或类型。

## Goals / Non-Goals

**Goals:**
- 402 响应触发该 provider 熔断,复用 `quota-exhausted` 类型与 `quotaCooldownMs` 时长
- 402 判定不读响应体(与 429 的分类逻辑分离)
- 冷却日志、README、specs 同步反映 402 行为

**Non-Goals:**
- 不处理 401/403(保持最小改动,可作后续 change)
- 不新增配置项(复用 `quotaCooldownMs`)
- 不新增日志类型标签(复用 `quota-exhausted`)
- 不改动轮询/熔断到期恢复/随机选择逻辑

## Decisions

**决策 1:402 直接归为 `quota-exhausted`,不读响应体分类**

- 余额不足不会自愈(不像配额有月度重置周期),处置方式与配额耗尽完全一致
- 402 状态码语义明确(Payment Required),无需像 429 那样读 body 区分"请求太快 vs 配额耗尽"
- 备选方案:为 402 新增 `insufficient-balance` 类型标签——语义更精确,但需改 `CooldownType`、日志 spec、README 示例,收益仅为日志标签,违背"太复杂就不做"原则,否决

**决策 2:熔断判定由 `status === 429` 扩展为 `status === 429 || status === 402`**

- `fetch-patch.ts:66` 的 `if (response.status === HTTP_TOO_MANY_REQUESTS)` 改为同时识别 402
- 429 走 `classify429` 读 body 分类;402 直接返回 `quota-exhausted`
- 保持 `CooldownType` 不变,`pool.markCooldown(key, quotaCooldownMs)` 复用

**决策 3:`classify429` 的重构边界**

- `classify429` 保留只处理 429 的 body 分类逻辑(不混入 402)
- 在 `patchFetch` 中增加 402 分支,单独决定 cooldownType,避免函数职责混乱
- 备选方案:把 `classify429` 泛化为 `classifyCooldown` 同时处理 429/402——需要函数读 status + body,签名与现有测试耦合,改动更大,否决(保持最小 diff)

## Risks / Trade-offs

- [402 判断仅靠状态码,无法区分"余额不足"与"其他 Payment Required"] → 语义上 402 即余额/支付问题,均按 `quota-exhausted` 长冷却处理是安全的;即便误判也只会延长冷却,不会错误放行
- [长冷却期(1 小时)内余额未充值,provider 持续不可用] → 这是期望行为(避免浪费请求);充值后冷却到期自动恢复,无需手动干预
- [README/文章中 402 行为描述与实际不符的风险] → 本 change 同步更新 README;`articles/` 教学版为简化实现不含完整熔断,不改

## Migration Plan

- 无需数据迁移。`dist/index.js` 为预构建产物,源码改动后需 `bun run build` 重新构建,重启 opencode 加载新产物
- 回滚:恢复 `fetch-patch.ts` 的 402 分支并重新构建;无状态、无配置变更
