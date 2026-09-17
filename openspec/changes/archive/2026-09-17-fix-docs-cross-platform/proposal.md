## Why

文档中多处操作只按 POSIX（Linux/macOS）写法给出，Windows 用户照着执行会困惑甚至失败：最典型的是登录脚本 `--config ~/.config/opencode/opencode.jsonc`——登录脚本对 `--config` 路径不做 `~` 展开，Windows PowerShell 会把 `~` 原样传给子进程，导致「配置文件不存在」；其余默认产物路径（`~/.local/share/opencode/...`）与 FAQ 里的 `HOME=<账号> arkcli ...` 也缺 Windows 等价拼写。

## What Changes

- 修 bug 级问题：`docs/user-guide/plan-stats.md` 与 `README.md` 的登录脚本示例补 Windows（PowerShell）变体，`--config` 用 `$env:USERPROFILE\...` 展开
- `docs/getting-started/installation.md` 补 Windows 拼写：配置路径 `%USERPROFILE%\.config\opencode\opencode.jsonc`、默认产物路径 `%USERPROFILE%\.local\share\opencode\...`
- `docs/user-guide/round-robin.md` 补统计文件位置的 Windows 拼写
- `docs/user-guide/plan-stats.md` FAQ 排障行补充 Windows 手工核对命令写法；沿用该文档「方式二」已有的 POSIX / Windows 分平台小标题格式
- 不改任何插件行为，纯文档修正

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本变更为纯文档修正（skip_specs），插件运行时行为不变。

## Impact

- 受影响文档：`README.md`、`docs/getting-started/installation.md`、`docs/user-guide/round-robin.md`、`docs/user-guide/plan-stats.md`
- 无代码、无 API、无依赖变更
