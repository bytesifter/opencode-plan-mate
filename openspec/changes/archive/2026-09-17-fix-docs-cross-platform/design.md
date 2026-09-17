## Context

现有文档对「操作命令与路径」的跨平台覆盖不一致：`docs/user-guide/plan-stats.md`「方式二：手工逐个登录」已按 POSIX / Windows 分平台小标题写好样板，但其余位置（安装文档、round-robin 统计文件位置、登录脚本示例、FAQ 排障命令、README）只给了 POSIX 写法。动机与范围见 proposal.md。

关键事实（决定改写方式）：

- 登录脚本 `scripts/login-arkcli-accounts.ts` 的 `--config` 路径**不做 `~` 展开**（仅账号 HOME 走 `expandHome`），配置路径直接 `existsSync`/`readFileSync`
- PowerShell 对传给原生命令的参数**不展开 `~`**（实测 `node ... "~/.config/x"` 收到字面 `~`）；bash/zsh 由 shell 展开，POSIX 无此问题
- 插件默认数据路径用 `homedir()` 拼接，Windows 上 `~/.local/share/opencode` 实际落在 `%USERPROFILE%\.local\share\opencode`
- opencode 全局配置在 Windows 上位于 `%USERPROFILE%\.config\opencode\opencode.jsonc`（与本机实测一致）

## Goals / Non-Goals

**Goals:**

- 文档里每处「用户要执行的命令 / 查看的路径」都给出 Windows（PowerShell）等价写法，或在 POSIX 写法旁标注 Windows 对应拼写
- 修复会真实失败的操作（登录脚本 `--config ~/...`）
- 与 `plan-stats.md` 方式二已有的分平台格式保持一致

**Non-Goals:**

- 不改插件/脚本代码——`--config` 不展开 `~` 是现状，文档层面规避即可
- 不改 `docs/technical/plan-stats/README.md`（机制描述，非用户操作）
- 不为 opencode 本身补 Windows 文档（那是上游项目）

## Decisions

### 决策一：bug 级操作（登录脚本 `--config`）→ 分平台示例块

`plan-stats.md:53-58` 与 `README.md:43-47` 的登录脚本示例目前是单 bash 块。改为「POSIX」/「Windows（PowerShell）」两个子块：

- POSIX 维持原样（bash 展开 `~`，脚本能读到 `~/.config/...`）
- Windows 用 `--config "$env:USERPROFILE\.config\opencode\opencode.jsonc"`

依据：脚本不展开 `--config` 的 `~`，PowerShell 也不展开传给原生命令的 `~`，只有显式 `$env:USERPROFILE` 才能解析到真实文件。备选「让脚本对 config 路径也做 expandHome」被否决——那属于行为变更，超出纯文档修正范围。

### 决策二：路径拼写（配置路径 + 默认产物路径）→ POSIX 写法旁补 Windows 等价拼写

- `installation.md:17`：`~/.config/opencode/opencode.jsonc` → 补 `%USERPROFILE%\.config\opencode\opencode.jsonc`
- `installation.md:49-52`：`~/.local/share/opencode/...` → 补 `%USERPROFILE%\.local\share\opencode\...`
- `round-robin.md:49`：统计文件位置同上补 Windows 拼写

依据：`~` 是 POSIX 约定，Windows 用户无法直接照抄；给出 `%USERPROFILE%` 等价形式即可定位。不改为「两套目录说明」，只在默认路径处加一行 Windows 等价，保持文档精简。

### 决策三：FAQ 排障命令 → 行内补 Windows 变体

`plan-stats.md:124` 的 `HOME=<该账号> arkcli usage plan ...` 是 POSIX 行内 env 语法。在该行补 Windows 写法（`$env:USERPROFILE="<该账号>"; arkcli usage plan ...`），沿用表格单元格内的简洁格式。

### 决策四：沿用方式二的格式样板

统一用「POSIX（Linux / macOS）」与「Windows（PowerShell）」作为小标题/引导词，避免每处自定义措辞。`README.md` 为精简速览页，登录脚本示例用与 plan-stats.md 相同的分平台块但可略短。

## Risks / Trade-offs

- [README 与 plan-stats.md 的脚本示例重复] → 两处保持内容一致；README 指向 plan-stats.md 完整说明（已有点名），仅保留分平台命令块
- [文档改写后 Windows 写法未实测] → 所有命令均为本机已验证可用形式（`$env:USERPROFILE`、`cmd`/PowerShell 语法），且方式二已有同类先例
- [`%USERPROFILE%` 在 cmd vs PowerShell 语义不同] → 文档统一标注「Windows（PowerShell）」，PowerShell 下 `$env:USERPROFILE` 明确可展开；`%USERPROFILE%` 仅作为路径展示拼写，不要求用户在 PowerShell 直接粘贴执行
