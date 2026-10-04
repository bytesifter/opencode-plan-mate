# Proposal

## Why

多账号 SSO 登录脚本 `scripts/login-arkcli-accounts.ts` 当前是**全量仪式**：每次执行清空所有账号 HOME 并逐账号重登。SSO refresh_token 为服务端绝对 48h 有效期（实测约 46h 失效，见 `remove-plan-stats-sso-keepalive` 结论），意味着每约 2 天就要整轮重登 6~7 个账号，每个都要浏览器授权 + 复制 base64 码回终端粘贴，成本高且频繁。

2026-10-03 全链路实测（arkcli 1.0.37，`volhwy2410` pilot 走通 Phase1→浏览器→贴码→Phase2→profile→usage plan）确认三件事，让本轮重构可行：

1. **过期可精确探测**：`auth status` 输出能区分有效/过期——`volc_sso.expired`、`control_plane_auth.status=needs_login`、或刷新失败报错文本（`refresh_token is invalid`），两种过期形态均实测出现。
2. **授权码可校验**：授权码是 `base64("code=..&state=<Phase1 state>")`，Phase 1 的 `state` 可作为剪贴板自动捕获的校验锚点，误捕率极低。
3. **1.0.37 行为更省**：登录后自动创建 coding-plan profile，脚本的 profile 兜底退化为保险；`--no-browser --login-mode legacy` 输出结构不变，脚本解析逻辑兼容。

本轮把「全量重登」重构为「**增量补登 + 剪贴板免粘贴 + 隐身浏览器**」，把每 2 天约 20 分钟的全量仪式降为偶尔 1~2 个账号的快速补充。本地回调（`--flow local-callback`）以 spike 门控决定是否并入备选。

## What Changes

- **增量重登（默认）**：登录前先对每个账号执行 `arkcli auth status`（注入该账号 HOME）探测，仅对过期/未登录/缺失的账号清空其 HOME 并重登；有效账号保留登录态跳过。新增 `--force` 保留旧全量清空行为、`--only <name>` 定向重登单账号；`--dry-run` 展示「跳过/重登」分类计划。
- **剪贴板自动捕获授权码**：打开浏览器后轮询剪贴板，捕获内容经 base64 解码 + `state=<Phase1 state>` 匹配校验后自动喂给 Phase 2，免去「复制→终端粘贴」。校验不中 / 剪贴板不可用 / 超时回退手工粘贴提示。新增 `--code-input clipboard|manual`（默认 clipboard+手工回退）。
- **隐身浏览器**：新增默认浏览器探测（Windows 注册表 `UserChoice`→`ProgId`→`App Paths`；macOS `open -na`；Linux 各浏览器 flag），以隐身模式打开授权 URL（Chrome `--incognito` / Edge `--inprivate` / Firefox `-private-window`），避免跨账号 SSO 会话污染；无法识别浏览器回退普通模式。仍注入可信真实用户 HOME（防污染，既有要求不变）。新增 `--browser incognito|normal`（默认 incognito）。
- **本地回调（spike 门控）**：spike 验证 arkcli 1.0.37 `auth login volc-sso`（auto 模式本地端口回调）的可用性、浏览器自开是否可抑制、是否阻塞 stdin；验证通过则提供 `--flow local-callback`（失败自动回退 cross-device），不通过则记录死因不实现（参照 SSO 保活先例）。
- **文档与规范同步**：更新 `docs/user-guide/plan-stats.md` 登录章节与 `openspec/specs/account-login-script/spec.md`。

## Capabilities

### New Capabilities

- （无全新行为能力，均为 `account-login-script` 既有能力内的子行为增强。）

### Modified Capabilities

- `account-login-script`：
  - **MODIFIED**「全量清空后逐账号登录」→「增量探测后仅重登过期账号」（+ `--force` / `--only` / `--dry-run` 分类预览，fail-safe 探测）
  - **MODIFIED**「浏览器 + 贴码交互登录」→「浏览器 + 剪贴板/贴码交互登录」（剪贴板自动捕获 + state 校验 + 手工回退）
  - **ADDED**「隐身浏览器打开授权 URL」（跨平台探测 + flag + 未知浏览器回退，`--browser incognito|normal`）
  - **ADDED**「本地回调流（spike 门控）」（验证通过则支持 `--flow local-callback` 且失败回退；不通过则记录死因禁止实现）

## Impact

- **代码**：`scripts/login-arkcli-accounts.ts`（重构：probe 增量流程 + 剪贴板捕获 + 隐身浏览器，新增可单测纯函数）。
- **测试**：`tests/login-script.test.ts`（新增 auth status 分类、剪贴板 state 校验、隐身打开计划、增量流程/`--force`/`--only` 测试）。
- **规范**：`openspec/specs/account-login-script/spec.md`（MODIFIED 两条 + ADDED 两条 Requirement）。
- **文档**：`docs/user-guide/plan-stats.md`（登录章节：默认增量、剪贴板免粘贴、隐身说明；FAQ 增补对应条目）。
- **配置**：脚本命令行参数新增 `--force` / `--only` / `--code-input` / `--browser` / `--flow`（默认增量 + clipboard + incognito + cross-device，不改变 `planStats.accounts` 配置形态）。
- **行为边界**：默认行为从「全量重登」变「增量补登」；授权码从「必须手工粘贴」变「剪贴板自动捕获 + 手工回退」；浏览器从「普通模式」变「默认隐身」；`--force` 保留旧行为。
- **操作提示（非代码）**：用户 `opencode.jsonc` 的 `planStats.accounts` 缺第 7 账号 `vollc5427`，需补一行（`"vollc5427": "~/.arkcli-accounts/vollc5427"`）；可顺手把 `volxc5426` 标签对正为 `vollqh5426`（实测该 HOME 身份即 vollqh5426，纯显示名，不影响功能）。
