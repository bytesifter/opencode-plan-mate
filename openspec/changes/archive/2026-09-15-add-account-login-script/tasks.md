## 1. 依赖与脚手架

- [x] 1.1 在 `package.json` 的 `devDependencies` 增加 `jsonc-parser` 并执行 `bun install`，验证 `node_modules/jsonc-parser` 存在
- [x] 1.2 创建 `scripts/` 目录并放置 `scripts/login-arkcli-accounts.ts` 骨架（含 shebang 注释与模块导出），验证 `bun scripts/login-arkcli-accounts.ts --help` 能打印用法
- [x] 1.3 实现 `parseAccounts(configPath)`：用 `jsonc-parser` 解析 `opencode.jsonc`，抽取 `plugin` 条目中 `planStats.accounts`（显示名 → HOME 路径），`~` 展开为用户 home；验证用含注释的真实 opencode.jsonc 能正确解析出 6 个账号映射

## 2. 跨平台 arkcli 派生

- [x] 2.1 实现 `buildSpawn(platform, cmd, args)` 纯函数：`win32` → `cmd.exe /c ...`，其余原样；验证对 `win32`/`linux`/`darwin` 分别断言 file 与 args（bun test 或用内联断言）
- [x] 2.2 实现 `execArkcli(cmd, args, { home })`：按 `buildSpawn` 构造，env 同时注入 `HOME` 与 `USERPROFILE`，收集 stdout/stderr，带超时；验证对已登录 HOME 执行 `arkcli auth status` 返回 JSON 且 `logged_in: true`
- [x] 2.3 实现 `openURL(url)`：Windows `cmd /c start <url>`、macOS `open`、Linux `xdg-open`，失败回退打印 URL；验证在 Windows 上能触发默认浏览器（或至少不抛错）

## 3. 登录流程与 profile 兜底

- [x] 3.1 实现 `loginAccount(account, home)`：删除该账号 HOME 目录 → 设隔离 env → 执行 `auth login --no-browser` → 解析 stdout JSON 取 `authorize_url` → `openURL` → 终端 `readline` 提示粘贴 base64 码 → `auth login --no-browser --code <code>`；验证完整跑通一个账号（如 volhwy2410）返回成功
- [x] 3.2 实现 profile 兜底：登录成功后探测是否已有 coding-plan 默认 profile（`auth status` / 配置判断），没有则 `profile create --type coding-plan --region cn-beijing --set-default --no-interactive`；验证无 profile 的账号能兜底创建、已有 profile 的账号跳过
- [x] 3.3 实现 `verifyAccount(account, home)`：执行 `arkcli usage plan --product coding-plan --format json`，返回含 `percent` 即成功；验证返回真实 percent 时标记成功

## 4. 编排与输出

- [x] 4.1 实现主流程：`--config` 参数（默认 `opencode.jsonc`）→ 解析 accounts → 全量清空各账号 HOME → 逐账号 `loginAccount` + profile 兜底 + `verifyAccount` → 每账号打勾显示进度；验证对多账号清单按顺序执行、单账号失败不中断
- [x] 4.2 实现汇总与退出码：全部结束输出成功/失败清单，存在失败时以非零退出码结束，`--dry-run` 仅打印将执行的账号与 HOME 不实际登录；验证失败场景返回非零、全成功返回 0

## 5. 文档同步

- [x] 5.1 更新 `docs/user-guide/plan-stats.md`：SSO 登录章节改为「推荐脚本 + 手工兜底」，脚本用法（`bun scripts/login-arkcli-accounts.ts`、`--config`、`--dry-run`）与全量重登语义说明
- [x] 5.2 更新 `README.md`：使用说明补充脚本用法与前置依赖（bun + arkcli + jsonc-parser）；验证文档命令可复制执行

## 6. 验证与构建

- [x] 6.1 运行 `bun test` 全量通过（既有测试不受影响）
- [x] 6.2 运行 `bunx tsc --noEmit` 类型检查通过（沿用本地固定版 TypeScript 处理 baseUrl 已知问题）
- [x] 6.3 运行 `openspec validate add-account-login-script` 校验通过
- [x] 6.4 运行时实测（可选）：`--dry-run` 打印清单不登录；对至少一个账号实际跑通完整登录+验证，确认 `plan_stats` 能取到该账号 percent

## 7. HOME 污染防护（bug 修复）

- [x] 7.1 实现 `trustedHomeDir()`：`homedir()` 含 `.arkcli-accounts` 片段时回退 `HOMEDRIVE+HOMEPATH`（兜底 `C:\Users\<USERNAME>`）；`expandHome` 改用它；验证在模拟污染 `USERPROFILE` 下 `~` 仍展开到 `C:\Users\nixgn`
- [x] 7.2 主流程启动后校验每个账号 HOME：含嵌套 `.arkcli-accounts` 片段时打印警告并返回非零退出；验证配置写死嵌套路径时脚本中止
- [x] 7.3 新增/更新单测覆盖 7.1/7.2（污染回退 + 嵌套中止）；运行 `bun test`、`bunx tsc --noEmit`、`openspec validate` 全绿
- [x] 7.4 运行时回归：模拟污染环境跑 `--dry-run` 确认 6 账号 HOME 均为干净 `C:\Users\nixgn\.arkcli-accounts\<acct>` 路径
