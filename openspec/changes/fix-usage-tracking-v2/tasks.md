# Tasks

## 1. 基线准备

- [ ] 1.1 `git push` 将 master 的 3 个未推送提交（v2 迁移整条线）推到 origin/master，验证 `git status` 显示 `up to date`
- [ ] 1.2 从 origin/master 创建并切换到新 worktree 分支 `fix-usage-tracking-v2`（`git worktree add` 到独立目录），验证 `git worktree list` 可见且目录干净

## 2. 事件解析层（核心修复）

- [ ] 2.1 新增 `src/event-adapter.ts`：实现 `resolveStepUsage(event)`，将 v2 `session.step.ended` / `session.step.failed` 事件解析为归一化 `{ sessionID, assistantMessageID, finish, tokens, cost }`，`data.sessionID` / `data.tokens` 缺失或 tokens 全零时返回 null；`bun x tsc --noEmit` 通过
- [ ] 2.2 重写 `src/index.ts#handleEvent`：按 `resolveStepUsage` 结果累计（每事件计一次 `req`），携带 `finish` 供清理逻辑使用，事件循环改为异步以支持归因查询；`bun x tsc --noEmit` 通过
- [ ] 2.3 新增 `tests/events.test.ts`：喂 v2 形态事件对象，覆盖 `session.step.ended`（tool-calls/stop）、`session.step.failed`、缺 sessionID/tokens、全零 tokens 等解析分支，全部通过

## 3. 统计去重与归因

- [ ] 3.1 调整 `src/stats.ts#StatsCollector`：退役 token 快照 diff（移除 `lastTokens` 与 `sameSnapshot`），新增有界事件 id 去重（容量上限 + 过期裁剪），同一事件重复到达不重复累计；`bun x tsc --noEmit` 通过
- [ ] 3.2 更新 `tests/stats.test.ts`：去重用例从「token 快照相同跳过」改为「事件 id 重复跳过」，新增「重复事件不重复累计」「事件 id 集合超限后正常累计新事件」用例，全部通过
- [ ] 3.3 实现归因 fallback：corrMap miss 时经 `ctx.session.get({sessionID})` 取会话当前 provider，失败降级 `unknown`；单测覆盖「corrMap 命中」「corrMap miss 且会话 provider 可确定」「corrMap miss 且查询失败 → unknown」三条路径，全部通过
- [ ] 3.4 corrMap 清理适配：`session.step.ended` 终态 `finish`（stop/error/unknown）或 `session.step.failed` 时清理该 sessionID 关联，`tool-calls` 保留；单测覆盖清理与保留两种情形，全部通过

## 4. spec 与文档同步

- [ ] 4.1 更新 `openspec/specs/usage-tracking/spec.md` 基线（合并本 change 的 delta：`按天累计请求数与 token`、`Provider-session 关联`、`零 token 事件跳过` 的 v2 契约），`openspec validate fix-usage-tracking-v2` 通过
- [ ] 4.2 更新 `docs/user-guide/plan-mate-stats.md` 与 `docs/technical/plan-stats/README.md` 中「message.updated / info.providerID / X-Session-Id」的 v1 表述为 v2 事件契约，验证文档与实现一致
- [ ] 4.3 修正 `openspec/changes/fix-plan-mate-v2-migration` 的 tasks.md 8.1/9.3「message.updated 以 v1 兼容形态送达」的错误结论，标注本 change 的修正依据

## 5. 集成验证

- [ ] 5.1 重启 opencode GUI 后台服务，真实跑一轮含多步/工具调用的对话，验证：插件日志出现 `usage` 行、统计目录出现当天 JSONL、`plan_mate_stats` 返回非空图表且 per-provider 归因与轮询日志一致
- [ ] 5.2 全量校验：`bun test`、`bun x tsc --noEmit`、`bun run build` 通过；`openspec validate fix-usage-tracking-v2` 通过；提交并（如确认后）归档 `fix-plan-mate-v2-migration`
