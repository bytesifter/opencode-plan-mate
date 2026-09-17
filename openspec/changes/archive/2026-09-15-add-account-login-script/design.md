## Context

动机见 `proposal.md`。现状：`plan_stats` 依赖每账号独立 HOME 的 arkcli SSO 登录态；`docs/user-guide/plan-stats.md` 只提供手工命令，多账号实操易踩嵌套目录坑，且 `profile create` 在全新 HOME 下失败（`not configured`）。本 change 引入独立脚本自动化，不触碰插件运行时（`src/`、`dist/index.js`）。

已验证的 arkcli 行为（Windows + bun 实测）：
- `auth login --no-browser` 在全新 HOME 下即可运行，stdout 是干净 JSON（含 `authorize_url` / `stage` / `next_command`），exit 0
- `auth status` 输出 JSON 可判登录态（`logged_in` / `active_profile`）
- `profile create --type coding-plan --region cn-beijing --set-default --no-interactive` 在未初始化 HOME 会失败，须放登录之后
- Windows 上 arkcli 以 `.cmd` 垫片分发：`spawn("arkcli")` → `ENOENT`，`spawn("arkcli.cmd")` → `EINVAL`，须走 `cmd.exe /c`
- arkcli 在 Windows 读 `USERPROFILE`、POSIX 读 `HOME`，须两平台同时注入

## Goals / Non-Goals

**Goals:**

- 独立脚本（非插件），bun 直接运行 `scripts/login-arkcli-accounts.ts`
- 从 `opencode.jsonc` 解析 `planStats.accounts`，支持 `--config` 覆盖
- 每次执行全量清空账号 HOME 后重登，目录干净
- 跨平台（Windows / POSIX）派生 arkcli，浏览器 + 贴码交互
- 登录后 profile 兜底 + 逐账号验证 + 失败隔离 + 汇总退出码
- 文档同步（plan-stats.md 脚本优先、README 用法）

**Non-Goals:**

- 不做浏览器回调自动接收（`--no-browser` 跨设备流本身就是贴码，改本地回调要动 redirect_uri，超出范围）
- 不改插件 `src/` 与 `dist/index.js`（`plan_stats` 取数契约不变）
- 不做凭证管理 / token 刷新（SSO 会话过期后重新跑脚本即可）
- 不实现并发登录（逐账号顺序执行，浏览器交互天然串行）

## Decisions

### 决策一：脚本语言与运行方式 — bun 直跑 TypeScript

脚本用 TypeScript 写在 `scripts/`，`bun scripts/login-arkcli-accounts.ts` 直接运行，无编译步骤，与项目 build/test 工具链一致。不引入插件式构建。

- 备选：Node + tsx —— 需额外 devDependency，且项目未用 Node 直接跑 TS；bun 已就绪，选 bun。

### 决策二：JSONC 解析 — `jsonc-parser`（devDependency）

`opencode.jsonc` 含注释与尾逗号，不能用 `JSON.parse`。引入微软官方 `jsonc-parser`（VS Code 同款）正确处理注释/尾逗号/字符串内 `//`。

- 备选：手写剥注释正则 —— 易在字符串字面量上误伤，不选。

### 决策三：跨平台派生 — 复用 `buildSpawn` 平台分流模式

脚本内置与 `fix-arkcli-windows-spawn` 相同的策略：`win32` → `{ file: ComSpec ?? "cmd.exe", args: ["/c", cmd, ...args] }`，其余 → `{ file: cmd, args }`。每账号 spawn 时 env 同时注入 `HOME` 与 `USERPROFILE`。

- 备选：`shell: true` —— 触发 Node ≥18 `DEP0190` 废弃告警，且转义面大，不选。

### 决策四：登录交互 — `--no-browser` 跨设备流 + 终端贴码

流程：`auth login --no-browser` → 解析 stdout JSON 取 `authorize_url` → `openURL()` 打开系统浏览器（Windows `cmd /c start`，macOS `open`，Linux `xdg-open`）→ `readline` 提示粘贴 base64 码 → `auth login --no-browser --code <code>`。

- 备选：浏览器本地回调自动收码 —— 需改 redirect_uri、起本地 HTTP 服务，复杂度高且 arkcli 跨设备流不依赖它，不选。

### 决策五：profile 兜底时机 — 登录成功且无 coding-plan 默认 profile 时才创建

先尝试 `auth status` / 读配置判断是否已有 `coding-plan` 默认 profile；没有则 `profile create --type coding-plan --region cn-beijing --set-default --no-interactive`。因登录本身可能自动建 profile（用户手动登录实例中自动生成了 coding-plan profile），兜底是防御性分支。

### 决策六：全量清空语义 — 每次先删所有账号 HOME

`fs.rmSync(homeDir, { recursive: true, force: true })` 删除 `planStats.accounts` 中每个账号的 HOME，再逐个登录。满足「每次执行先清空现有内容」的确定性要求，避免嵌套目录残留。

## Risks / Trade-offs

- [每次全量清空] 已登录账号也会被重登 → 由用户明确要求（脚本语义即全量重登），文档明示
- [浏览器交互依赖人工] 授权码需用户在浏览器完成后回贴，无码超时需重跑 → 脚本提示清晰、单账号失败不阻塞后续，可在最后汇总重试失败账号
- [`cmd /c start` 打开浏览器] 极少数无默认浏览器环境打开失败 → 失败时回退打印 URL 让用户手动打开
- [`profile create` 在未初始化 HOME 失败] 已规避：只在登录完成后执行，且先探测是否有 profile
- [`jsonc-parser` 新增依赖] 仅 devDependency，不进入 `dist/index.js`（`bun build` 只打包 `src/index.ts`）
