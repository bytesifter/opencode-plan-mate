## Context

动机见 `proposal.md`。当前取数链路：`src/index.ts` 的 `plan_stats` 工具 → `collectPlanQuotas` → `volcArkcliAdapter.fetch` → `defaultSpawn("arkcli", [...], { env })`（`src/quota.ts`）。`defaultSpawn` 是唯一真实派生 arkcli 的地方，且只被 plan_stats 使用；单测通过注入 fake `exec` 绕过它，因此其平台行为此前没有测试覆盖。

实测约束（Node v24，Windows）：

| 派生方式 | 结果 |
|---|---|
| `spawn("arkcli", args)` | `ENOENT`（不按 `PATHEXT` 补 `.cmd`） |
| `spawn("arkcli.cmd", args)` | `EINVAL`（Node≥18 拒绝无 shell 执行 `.cmd`/`.bat`） |
| `spawn("arkcli", args, { shell: true })` | 成功，但触发 `DEP0190` 废弃告警 |
| `spawn("cmd.exe", ["/c", "arkcli", ...args])` | 成功 |

即「补后缀」路线已被 EINVAL 堵死，必须走命令解释器。

## Goals / Non-Goals

**Goals:**

- Windows + POSIX 下都能稳定派生 arkcli，且不引入运行时依赖（保持自包含构建）。
- 平台分支可在任意平台被单测覆盖（不依赖本机真的安装 arkcli）。
- 文档 Windows 登录示例不再产生嵌套目录。

**Non-Goals:**

- 不改动 `QuotaAdapter` / `SpawnExecutor` 接口契约。
- 不改动渲染（`renderPlanChart`）与解析（`parseUsagePlan`）。
- 不引入自动登录 / 凭证管理（账号 SSO 仍是一次性人工步骤）。
- 不处理 `timeoutMs` 到点时 Windows 上子进程树是否被完整 kill（只查询、短时，超出范围）。

## Decisions

### 决策一：Windows 用命令解释器包装（`cmd.exe /c`），而非 `shell:true`

`defaultSpawn` 内部新增一个纯函数 `buildSpawn(platform, cmd, args)`，返回 `{ file, args }`：

```
buildSpawn("win32", "arkcli", ["usage","plan","--product","coding-plan","--format","json"])
  → { file: process.env.ComSpec ?? "cmd.exe",
      args: ["/c","arkcli","usage","plan","--product","coding-plan","--format","json"] }

buildSpawn("linux" | "darwin", "arkcli", [...args])
  → { file: "arkcli", args: [...args 原样] }
```

`defaultSpawn` 用其返回值派生（env / 超时逻辑不变）。

**为何不选其它：**

| 方案 | 放弃原因 |
|---|---|
| 显式补 `.cmd` 后缀 | Node≥18 对 `.cmd`/`.bat` 无 shell 派生直接 `EINVAL`，实测不通 |
| `{ shell: true }` | Node≥22 每次调用打 `DEP0190` 告警刷日志；POSIX 也进 shell，行为面变大 |
| 先 `where arkcli` 解析绝对路径 | 多一次子进程与解析逻辑；且解析到 `.cmd` 后仍要面对 EINVAL |
| 引入 `cross-spawn` | 破坏项目「零运行时依赖 + 自包含构建」的既有约束 |

参数安全：本处 `args` 均为固定常量（`usage plan --product coding-plan --format json`），账号 home 通过 env 传递而非参数，`cmd.exe` 的转义/注入面可控。

### 决策二：抽纯函数 `buildSpawn` 以便跨平台单测

`SpawnExecutor` 的测试注入口（fake `exec`）在 adapter 层，测不到 `defaultSpawn` 的分支。把「按平台构造 file/args」抽成纯函数后，可在 Linux CI 上直接断言 `buildSpawn("win32", ...)` 的执行计划，无需本机有 Windows 或 arkcli。

### 决策三：错误标注区分「未安装」与「无法启动」

`defaultSpawn` 在 `error` 事件里记录底层 `code`（`ENOENT`→未安装；`EINVAL` 等→无法启动/解析失败），`adapter.fetch` 据其返回不同文案。渲染层不变，仅错误字符串更精确，避免统一显示「arkcli 不可用」误导排查。

### 决策四：文档改用独立基准变量

`docs/user-guide/plan-stats.md` 的 Windows 段：

```powershell
$base = "$env:USERPROFILE\.arkcli-accounts"
$env:USERPROFILE = "$base\account-a"
$env:HOME        = "$base\account-a"
arkcli profile create --type coding-plan --set-default
arkcli auth login --no-browser
```

不再在循环里用「已覆盖的 `USERPROFILE`」去拼下一个账号路径；并删除冗余 `mkdir`（实测 arkcli 自建 `$HOME/.arkcli` 含父目录）。POSIX 段同步说明目录自建。

## Risks / Trade-offs

- [cmd 参数转义] 若未来 `args` 变为动态（如带空格路径），`cmd.exe /c` 需自行加引号 → 当前 args 为常量，且约定「动态量走 env」；在 tasks 中落下注释约束。
- [超时 kill 不彻底] `child.kill()` 在 Windows 只杀 `cmd.exe`，可能遗留子进程 → 查询短时、无副作用，接受；如需可在后续 change 处理。
- [CI 覆盖盲区] 单测断言的是「执行计划」而非真机执行 → 另设一条「有 arkcli 时才跑」的可跳过集成验证，避免依赖环境。
- [dist 未同步] 改了 src 忘重建 → tasks 显式包含 `bun run build` 并校验 `dist/index.js` 含 `cmd.exe`/`buildSpawn` 逻辑。
