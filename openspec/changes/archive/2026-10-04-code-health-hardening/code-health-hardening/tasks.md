# Tasks

## 1. 公共工具函数收敛

- [x] 1.1 新建 `src/util.ts`,迁入 `num()` 与 `todayLocal()`;`stats.ts` 保留 `todayLocal` re-export(兼容 `tests/stats.test.ts` 的 import),`logger.ts` 删除本地 `todayLocal` 改用 util。验证 `bun test tests/stats.test.ts tests/logger.test.ts` 与 `bunx tsc --noEmit` 通过
- [x] 1.2 `event-adapter.ts` / `quota.ts` 的本地 `num()` 改用 util。验证 `bun test tests/events.test.ts tests/quota.test.ts` 通过且无重复定义残留

## 2. 死代码清理

- [x] 2.1 删除 `types.ts` 中 `EventContext` 的 `modelID`/`agent`/`mode`/`durationMs` 字段及 `logger.ts:94-98` 对应分支。验证 `bunx tsc --noEmit` 通过,无其他引用残留
- [x] 2.2 简化 `quota.ts:139,144` 的 `col(pad(q.provider, COL_W))` 双重 pad。验证 `bun test tests/quota.test.ts` 通过,`renderPlanChart` 输出与改动前逐字符一致

## 3. ProviderPool key 级索引

- [x] 3.1 构造时建立 `byKeyIndex`/`byKeyEntry`/`byKeyAccount` 三个 Map,`keyIndex`/`entryByKey`/`accountName` 改用索引(未知 key 的 `keyIndex` 保持返回 -1)。验证 `bun test tests/pool.test.ts` 通过
- [x] 3.2 `findBaseURL` 改为遍历 `byBaseURL` 的键,保持"首个匹配 baseURL"与"不匹配返回 null"语义。验证 `tests/pool.test.ts` 的 findBaseURL 用例通过

## 4. extractModel 模型集一致守卫

- [x] 4.1 pool 构造时按 baseURL 组计算模型指纹(排序后 join),新增 `hasModelVariance(baseURL)`。验证 `tests/pool.test.ts` 新增用例:同组模型集一致返回 false、有差异返回 true
- [x] 4.2 `handleHttpRequest` 在 `hasModelVariance` 为 false 时跳过 `extractModel`,直接 `pool.next(undefined, baseURL)`。验证 `tests/http-hooks.test.ts` 新增用例:模型集一致时不读请求体、有差异时仍读 body 提取 model

## 5. 事件循环错误隔离(对应 specs/usage-tracking 新增需求)

- [x] 5.1 将单事件处理包装为不抛出的处理函数(循环内 try/catch 或 `safeHandle` 包装),订阅循环 `for await` 保持存活。验证新增单测:`handleEvent` 抛错的事件被跳过且不向调用方抛出、其后正常事件仍被处理
- [x] 5.2 按 `specs/usage-tracking` 的「事件处理异常隔离」需求逐场景补测试(异常中断不生效、异常前后正常事件均累计)。验证 `bun test` 全部通过

## 6. startTimes 泄漏修复

- [x] 6.1 `handleHttpResponse` 中 `startTimes.delete` 提前到 key 匹配检查之前无条件执行。验证 `tests/http-hooks.test.ts` 新增用例:响应到达且 key 不匹配池时条目仍被清理
- [x] 6.2 `startTimes.set` 时顺带清理超过阈值(10 分钟)的旧条目。验证新增用例:超时旧条目在下次 set 后被移除,Map 有界

## 7. spawn 错误分类区分

- [x] 7.1 `SpawnResult` 增加可选 `timedOut?: boolean`;`defaultSpawn` 超时 kill 后在 close 回调置位。验证 `tests/quota.test.ts` 新增用例:超时场景 `timedOut` 为 true
- [x] 7.2 `volcArkcliAdapter.fetch` 先判 `res.timedOut` 报「arkcli 查询超时」,再走既有 ENOENT 分类。验证 `tests/quota.test.ts` 新增用例:timedOut 时错误文案为超时、ENOENT 路径文案不变、正常路径 `exitCode` 语义不变

## 8. 文档说明(provider 归因粒度,不改逻辑)

- [x] 8.1 `docs/user-guide/plan-mate-stats.md` 用量统计小节补充:corrMap 命中记池账号名、fallback 记会话 model 的 providerID;文档化配置下两者同串不产生混合列。验证文档描述与 `event-adapter.ts` 实际行为一致

## 9. 集成验证

- [x] 9.1 `bun test` + `bunx tsc --noEmit` + `bun run build` 全绿
- [x] 9.2 `openspec validate code-health-hardening` 通过
- [ ] 9.3 GUI 实测一轮真实多步对话:图表输出(账号列与数量级)与改动前一致、日志格式不变、无轮询/熔断回归
