## 1. 登录脚本示例分平台化（bug 级修复）

- [x] 1.1 修改 `docs/user-guide/plan-stats.md` 方式一登录脚本示例：将单 bash 块拆为「POSIX（Linux / macOS）」与「Windows（PowerShell）」两块；POSIX 维持 `--config ~/.config/opencode/opencode.jsonc`，Windows 用 `--config "$env:USERPROFILE\.config\opencode\opencode.jsonc"`，并保留 `--dry-run` 说明
- [x] 1.2 修改 `README.md` 一键登录示例：与 plan-stats.md 同步分平台，Windows 变体同上；完成后检查两处命令一致
- [x] 1.3 验证：grep 确认 `--config ~/` 仅出现在 POSIX 块，Windows 块为 `$env:USERPROFILE\...`；无遗留纯 POSIX 登录脚本示例

## 2. 路径拼写补 Windows 等价

- [x] 2.1 `docs/getting-started/installation.md` 配置路径处（`~/.config/opencode/opencode.jsonc`）补 Windows 拼写 `%USERPROFILE%\.config\opencode\opencode.jsonc`
- [x] 2.2 `docs/getting-started/installation.md` 默认产物路径处补 Windows 拼写 `%USERPROFILE%\.local\share\opencode\...`（统计与日志两行）
- [x] 2.3 `docs/user-guide/round-robin.md` 统计文件位置补 Windows 拼写
- [x] 2.4 验证：grep 各默认路径处均有 POSIX + Windows 两种拼写

## 3. FAQ 排障命令补 Windows 变体

- [x] 3.1 `docs/user-guide/plan-stats.md` FAQ「usage plan 未返回 coding-plan 桶」行补 Windows 手工核对写法（`$env:USERPROFILE="<该账号>"; arkcli usage plan --product coding-plan --format json`），保留原 POSIX 写法
- [x] 3.2 验证：FAQ 行同时含 `HOME=` 与 `$env:USERPROFILE=` 两种写法

## 4. 通篇一致性核验

- [x] 4.1 通读 4 份文档 + README，确认所有「用户操作命令 / 路径」均已双平台覆盖，且小标题措辞统一为「POSIX（Linux / macOS）」与「Windows（PowerShell）」
- [x] 4.2 验证：`docs/` 与 `README.md` 中无仅含 `~/` 或 `HOME=` 且无 Windows 等价说明的用户操作描述
