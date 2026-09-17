## 1. 扫描与清理函数

- [x] 1.1 实现 `collectNestedLegacy(homeRoot)`：遍历 `homeRoot/<acct>/` 每个账号目录，递归收集其中名为 `.arkcli-accounts` 的子目录分支路径（账号顶层自身不算）；验证用临时目录构造合法账号 + 嵌套分支，断言只返回嵌套分支路径
- [x] 1.2 实现 `cleanupLegacyNested(homeRoot)`：对 `collectNestedLegacy` 产物逐个 `rmSync(recursive, force)`，返回 `{ removed, failed }`，单分支删除失败隔离不中断；验证删除后嵌套分支消失、账号顶层仍在、failed 收集 EPERM 场景

## 2. 主流程接入

- [x] 2.1 `main()` 启动顺序调整为：解析 accounts → 配置污染校验（中止）→ 磁盘嵌套垃圾清理 → dry-run / 登录；验证正常流程在清理后继续登录
- [x] 2.2 dry-run 分支：只调 `collectNestedLegacy` 打印将清理的分支，不调用 `cleanupLegacyNested`；验证 dry-run 下不产生删除副作用

## 3. 测试与文档

- [x] 3.1 新增单测覆盖 1.1/1.2（扫描命中/不命中、删除保留顶层、失败隔离）；运行 `bun test`、`bunx tsc --noEmit`、`openspec validate` 全绿
- [x] 3.2 更新 `docs/user-guide/plan-stats.md`：登录脚本章节补充「默认自动清理账号 HOME 内嵌套残留」说明与 dry-run 预览行为
- [x] 3.3 运行时实测（可选）：构造临时嵌套目录后跑 `--dry-run` 确认报告不删、默认跑确认自动删且登录继续
