## 1. 测试先行

- [x] 1.1 编写 `tests/fetch-patch.test.ts` 用例:某 provider 返回 402 响应 → `onResponse` 收到 `quota-exhausted` cooldownType,`pool.isCoolingDown` 为 true
- [x] 1.2 编写用例:402 响应 → 冷却时长使用 `quotaCooldownMs`(区分 60000/3600000 两个 pool 验证)
- [x] 1.3 编写用例:仅配置 `cooldownMs`(未配 `quotaCooldownMs`)时 402 → 冷却时长使用默认 `quotaCooldownMs`(3600000ms)
- [x] 1.4 回归:现有 429 用例(rate-limit / quota-exhausted / 响应体不可读)全部通过

## 2. 实现

- [x] 2.1 修改 `src/fetch-patch.ts`:熔断判定从仅 `status === 429` 扩展为 `429 || 402`
- [x] 2.2 402 分支直接返回 `quota-exhausted`,不调用 `classify429` body 分类;429 保持原逻辑
- [x] 2.3 补充 402 常量注释说明(Payment Required / Insufficient Balance),不引入新配置

## 3. 文档与 specs 同步

- [x] 3.1 更新 `README.md`:功能列表/规则段补充"402 余额不足按配额耗尽熔断"
- [x] 3.2 更新 `README.md`:配置表 `quotaCooldownMs` 行与日志示例,补充 402 → `quota-exhausted` 行为说明
- [x] 3.3 确认 `openspec/changes/handle-402-cooldown/specs/` 下 delta spec 与实现一致(key-rotation 与 structured-logging)

## 4. 验证

- [x] 4.1 `bun test` 全量通过
- [x] 4.2 `bun x tsc --noEmit` 类型检查通过
- [x] 4.3 `bun run build` 重新构建 `dist/index.js`(预构建产物)
- [x] 4.4 `openspec validate --changes handle-402-cooldown --strict` 通过
