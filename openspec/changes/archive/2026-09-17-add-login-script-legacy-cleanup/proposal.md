## Why

`add-account-login-script` 已实现 HOME 污染防护（配置路径含嵌套时中止），但**磁盘上**历史手工登录残留的嵌套 `.arkcli-accounts` 分支（账号 HOME 内部再次出现 `.arkcli-accounts` 目录）目前只能靠用户手动 `Remove-Item` 清理。用户明确要求**默认执行即自动清理**——脚本启动时扫描并删除这类磁盘垃圾，不让用户背手工清理的负担。

## What Changes

- **默认启动自动清理磁盘嵌套垃圾**：脚本解析账号清单后，扫描 `~/.arkcli-accounts/` 下每个账号 HOME 目录，若内部存在嵌套的 `.arkcli-accounts` 子目录分支，自动 `rmSync` 删除该分支（仅删嵌套分支，保留账号 HOME 顶层），随后继续正常登录流程。
- **`--dry-run` 只报不删**：dry-run 时打印将清理的嵌套分支路径，不实际删除。
- **配置错误仍拦截**：解析出的账号 HOME 若本身含嵌套 `.arkcli-accounts` 片段（配置写死污染路径），仍按现有 `hasNestedPollution` 逻辑中止报错，SHALL NOT 静默清理——那是配置错误，不是磁盘垃圾。
- **新增纯函数 `collectNestedLegacy(homeRoot)` / `cleanupLegacyNested(homeRoot)`**：便于跨平台单测（扫描 + 删除两阶段分离，dry-run 只调扫描）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `account-login-script`: 「HOME 污染检测与防护」requirement 扩展——从「仅配置路径中止」扩展为「磁盘嵌套垃圾默认自动清理 + 配置污染仍中止」：脚本 SHALL 默认扫描并删除账号 HOME 内嵌套 `.arkcli-accounts` 分支，SHALL 保留账号 HOME 顶层，`--dry-run` SHALL 只报告不删除，配置写死嵌套路径 SHALL 仍中止。

## Impact

- `scripts/login-arkcli-accounts.ts`：新增 `collectNestedLegacy` / `cleanupLegacyNested` 纯函数 + `main()` 启动时调用清理逻辑（dry-run 分支只收集不删）
- `tests/login-script.test.ts`：新增嵌套分支收集/删除/保留顶层用例
- `docs/user-guide/plan-stats.md`：登录脚本章节补充「默认自动清理嵌套残留」说明
- 无新依赖（复用 `node:fs` `rmSync`/`readdirSync`）
