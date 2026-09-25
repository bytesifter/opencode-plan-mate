# Tasks

## 1. 事件解析层：位置字段与判定函数

- [x] 1.1 `src/event-adapter.ts`：`StepUsage` 增加 `locationDirectory`（`event.location.directory`，非字符串取 undefined）；新增纯函数 `isLocationMatch(eventLocation, pluginDirectory)`——两者均为非空字符串且相等时返回 true，`eventLocation` 缺失返回 false；`bun x tsc --noEmit` 通过
- [x] 1.2 `tests/events.test.ts`：新增 `resolveStepUsage` 的 `locationDirectory` 输出断言，与 `isLocationMatch` 三分支场景（匹配 / 不匹配 / 缺 location），全部通过

## 2. 事件处理：位置过滤接入

- [x] 2.1 `src/index.ts#handleEvent`：解析后先做位置过滤——`!isLocationMatch(usage.locationDirectory, pluginDirectory)` 直接返回；`pluginDirectory` 由 setup 从 `ctx.location.directory` 记录（模块级变量，与 `pluginStartTime` 同风格）；`bun x tsc --noEmit` 通过
- [x] 2.2 全量 `bun test` 通过（既有 159 用例 + 新增位置过滤用例无回归）

## 3. 文档同步

- [x] 3.1 `docs/user-guide/plan-mate-stats.md` 机制描述补「按位置过滤（GUI 多位置各加载实例时各管各的位置，避免重复计数）」；验证与实现一致

## 4. 集成验证

- [ ] 4.1 GUI 重启加载新插件后跑真实对话：`plan_mate_stats` 各 provider 的 req 与真实 step 数一致（不再 3~6 倍虚增）；`~/.local/share/opencode/plan-mate-stats/YYYY-MM-DD.jsonl` 无完全相同重复行（**待用户重启 GUI 后实测**）
- [x] 4.2 全量校验：`bun test`（163 pass）、`bun x tsc --noEmit`、`bun run build` 通过；`openspec validate fix-usage-location-filter` 通过；已提交并合并 master（`e033d8b`）、推送远端（归档待 4.1 验证通过后执行）
