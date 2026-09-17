## Why

登录脚本仍残留嵌套目录污染：`add-login-script-legacy-cleanup` 实现了「账号 HOME 内部嵌套分支自动清理」，但实测发现残留会**再次出现**——脚本启动清理后，登录过程中 `openURL` 打开的浏览器子进程继承了脚本进程（可能被污染的）`USERPROFILE`，把浏览器缓存写进错误路径，且历史多层嵌套（`account-a/.arkcli-accounts/...`）无法被「只删最外层分支」的清干净。用户明确要求：**每次启动直接清空整个 `~/.arkcli-accounts/` 再重登**，并修复浏览器子进程的环境注入。

## What Changes

- **全量清空语义**：脚本启动解析账号清单后，直接 `rmSync("~/.arkcli-accounts", { recursive, force })` 删除整个账号根目录（含所有账号 HOME 与历史嵌套残留），再逐账号重新登录。替代当前「只清账号内部嵌套分支」的局部清理。
- **`openURL` 注入隔离 env**：浏览器子进程（Windows `rundll32` / macOS `open` / Linux `xdg-open`）执行时注入 `HOME` 与 `USERPROFILE` 为当前账号的独立 HOME，避免继承被污染的进程环境把缓存写入错误路径。
- **简化清理逻辑**：`collectNestedLegacy` / `cleanupLegacyNested` 局部清理被全量清空取代（保留 `trustedHomeDir` 污染回退与 `hasNestedPollution` 配置校验）。
- **`--dry-run` 语义保持**：dry-run 仍只报告将清空与登录的账号，不实际删除。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `account-login-script`: 「HOME 污染检测与防护」requirement 的磁盘垃圾处理策略从「账号内部嵌套分支自动清理」改为「启动时全量清空 `~/.arkcli-accounts/` 根目录」；「浏览器 + 贴码交互登录」requirement 增加「浏览器子进程 SHALL 注入隔离 HOME/USERPROFILE」约束。

## Impact

- `scripts/login-arkcli-accounts.ts`：
  - `main()`：启动清理从 `cleanupLegacyNested(homeRoot)` 改为 `rmSync(账号根目录, recursive, force)`
  - `openURL(url, home)`：新增 home 参数，spawn 时注入 `env: { HOME: home, USERPROFILE: home }`
  - `loginAccount`：删除 `collectNestedLegacy`/`cleanupLegacyNested` 调用（全量清空已覆盖），保留每账号 `rmSync(home)`（幂等冗余）
  - 移除 `collectNestedLegacy`/`cleanupLegacyNested` 及其测试
- `tests/login-script.test.ts`：移除嵌套清理用例，新增全量清空 + `openURL` env 注入用例
- `docs/user-guide/plan-stats.md`：清理说明从「自动清理嵌套残留」改为「每次启动全量清空账号根目录重登」
- 无新依赖
