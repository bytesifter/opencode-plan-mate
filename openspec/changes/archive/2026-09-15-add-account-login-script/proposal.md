## Why

`plan_stats` 需要每个火山账号在独立 HOME 目录下完成一次性 SSO 登录，而 `docs/user-guide/plan-stats.md` 目前只有手工命令。手工登录 6 个账号极易出错：用户在文档示例上实测就踩了嵌套目录坑（`USERPROFILE` 被覆盖后继续拼接），且 `profile create` 在全新 HOME 下会失败（`not configured`）。需要一个可重复、跨平台、防呆的脚本，一次跑完所有账号的 SSO 登录，避免手工重复劳动与路径污染。

## What Changes

- **新增独立脚本 `scripts/login-arkcli-accounts.ts`**（bun 直接运行，非 opencode 插件）：读取 `opencode.jsonc` 的 `plugin[].planStats.accounts`，逐账号完成 SSO 登录。
- **每次执行全量重登**：脚本运行时先清空 `planStats.accounts` 中所有账号的独立 HOME 目录（如 `~/.arkcli-accounts/<acct>`），再逐个重新登录，保证目录干净、不残留嵌套。
- **跨平台派生 arkcli**：复用 `fix-arkcli-windows-spawn` 的平台分流经验——Windows 走 `cmd.exe /c` 解析 `.cmd` 垫片，POSIX 直接 spawn；同时注入 `HOME` 与 `USERPROFILE`。
- **浏览器 + 贴码交互**：脚本解析 `auth login --no-browser` 的 stdout JSON 提取 `authorize_url`，自动用系统默认浏览器打开，用户在浏览器授权后把 base64 授权码粘贴回终端完成 Phase 2。
- **profile 兜底**：登录完成后，若该账号 HOME 下无 coding-plan 默认 profile，则执行 `arkcli profile create --name default --type coding-plan --region cn-beijing --set-default --no-interactive` 兜底。
- **逐账号验证**：每个账号登录后用 `arkcli usage plan --product coding-plan --format json` 验证能取到数据，打勾显示进度；失败账号标注原因但不中断其余账号。
- **依赖**：新增 `jsonc-parser`（devDependencies，解析带注释的 opencode.jsonc）。
- **文档更新**：`docs/user-guide/plan-stats.md` 的「每账号一次性 SSO 登录」章节改为「推荐脚本 + 手工兜底」两段式；README 使用说明补充脚本用法。

## Capabilities

### New Capabilities

- `account-login-script`: 独立的 arkcli 多账号 SSO 登录工具脚本能力。覆盖：从 `opencode.jsonc` 读取 `planStats.accounts` 账号映射；全量清空后逐账号登录；跨平台派生 arkcli；浏览器 + 贴码交互；登录后 profile 兜底；逐账号验证与错误隔离。

### Modified Capabilities

（无）——脚本是独立工具，不改动插件 `plan-quota-stats` / `cross-platform-runtime` 的运行时行为 requirement；`plan_stats` 取数契约不变。

## Impact

- `scripts/login-arkcli-accounts.ts`：新增（脚本主体，含 buildSpawn 平台分流、JSONC 解析、交互流程）
- `package.json`：新增 devDependency `jsonc-parser`
- `docs/user-guide/plan-stats.md`：SSO 登录章节改为「脚本优先、手工兜底」
- `README.md`：补充脚本用法
- 无运行时依赖注入插件 `dist/index.js`（脚本独立，`bun build` 不打包 `scripts/`）
