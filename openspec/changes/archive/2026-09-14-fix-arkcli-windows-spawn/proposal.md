## Why

`plan_stats` 在 Windows 上必然失败：`src/quota.ts` 用 `spawn("arkcli", ...)`（`shell:false`）派生子进程，而 npm 安装的 arkcli 在 Windows 上只有 `.cmd`/`.ps1` 垫片。Node 既不会按 `PATHEXT` 把 `arkcli` 补成 `arkcli.cmd`（实测 `ENOENT`），显式写成 `arkcli.cmd` 又会被 Node≥18 的安全策略拒绝（实测 `EINVAL`），导致 6 个账号全部返回「arkcli 不可用」。上一个 `fix-cross-platform-compat` 只补了每账号 `USERPROFILE` 注入与 `~` 展开，未覆盖可执行文件解析，是本次漏网的根因。

同时，`docs/user-guide/plan-stats.md` 的 Windows 登录示例直接覆盖 `$env:USERPROFILE`，多账号逐个执行时会把后续账号路径拼成嵌套目录（实测复现：`...\volxc9208\.arkcli-accounts\volhwy2410\...`）；示例中的 `mkdir` 也是冗余的——实测 arkcli 首次运行会自建 `$HOME/.arkcli`（含父目录）。

## What Changes

- **Windows 可执行文件解析**：派生 arkcli 时按平台构造执行计划——Windows 走命令解释器（`cmd.exe /c`）包装以解析 `.cmd` 垫片，POSIX 保持直接 `spawn`。抽成纯函数 `buildSpawn(platform, cmd, args)`，使 Windows 分支可在任意平台单测。
- **错误标注细化**：区分「arkcli 未安装」（无法定位可执行文件）与「arkcli 无法启动」两类，避免笼统归为「arkcli 不可用」。
- **文档修正**：Windows 登录示例改用独立基准变量拼接账号路径，不再覆盖 `$env:USERPROFILE`；移除冗余 `mkdir`，说明 arkcli 自建 `$HOME/.arkcli`。
- **构建产物同步**：重建 `dist/index.js`，使修复在 opencode 运行时（`main: ./dist/index.js`）生效。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `plan-quota-stats`: 「通过 arkcli 子进程取数（每账号隔离 HOME）」要求扩展为**跨平台派生**——Windows 下 SHALL 通过命令解释器解析 `.cmd`/`.bat` 垫片执行 arkcli，POSIX 下 SHALL 直接执行；「arkcli 缺失标注」场景细化为区分「未安装」与「无法启动」。

## Impact

- `src/quota.ts`：`defaultSpawn` 增加平台分流；新增 `buildSpawn` 纯函数
- `tests/quota.test.ts`：新增 `buildSpawn` 跨平台用例（win32/POSIX 分别断言执行计划）
- `docs/user-guide/plan-stats.md`：Windows 登录示例修正
- `dist/index.js`：重建，运行时入口与源码一致
- 无新增运行时依赖（不使用 `cross-spawn`），保持自包含构建
