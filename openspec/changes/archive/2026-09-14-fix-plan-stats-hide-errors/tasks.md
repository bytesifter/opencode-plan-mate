## 1. 渲染守卫调整（src/quota.ts）

- [x] 1.1 修改 `renderPlanChart` 早退守卫：从「无 periods」改为「无 periods 且无 error」（`hasData || hasError` 时进入渲染循环），复用既有错误行 / 未订阅行分支
- [x] 1.2 确认纯错误场景渲染表头 + 每账号 ⚠ 错误行（及未订阅行），不再返回"暂无统计数据"

## 2. 测试更新（tests/quota.test.ts）

- [x] 2.1 拆分 `全失败/全未订阅返回暂无统计数据`：新增「全失败显示错误行」用例，断言输出含表头与错误文本、不含"暂无统计数据"
- [x] 2.2 保留「全未订阅无错误返回暂无统计数据」「空数组返回暂无统计数据」用例不变

## 3. 验证

- [x] 3.1 运行 `bun test` 全量通过
- [x] 3.2 运行 `bunx tsc --noEmit` 类型检查通过

## 4. 构建产物同步（运行时生效）

- [x] 4.1 运行 `bun run build` 重新生成 `dist/index.js`，使 `renderPlanChart` 与 `src/quota.ts` 一致
- [x] 4.2 校验产物：`dist/index.js` 的 `renderPlanChart` 含 `hasData`/`hasError` 守卫，且不再含旧早退 `filter((q) => q.periods.length > 0).length === 0`
- [x] 4.3 重新加载插件后实测 `plan_stats`：6 账号 SSO 全部失效场景下输出表头 + ⚠ 错误行，而非"暂无统计数据"
