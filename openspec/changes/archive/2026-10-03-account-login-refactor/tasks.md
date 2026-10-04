# Tasks

## 1. 增量探测模块（probe）

- [x] 1.1 在 `scripts/login-arkcli-accounts.ts` 新增 `buildProbePlan`/`classifyAuthStatus` 纯函数：注入账号 HOME 执行 `arkcli auth status`，按 D1 规则分类（HOME 缺失 / 非零退出含 sso|not logged|refresh / `volc_sso.expired` / `control_plane_auth.status==needs_login` / 有效跳过 / 不可解析视为需重登）
- [x] 1.2 重构主流程：默认增量——先逐账号探测，仅对需重登账号 `rmSync` 其 HOME 并走登录；`--force` 恢复旧全量清空重登；`--only <name>` 只处理指定账号；`--dry-run` 输出每账号「跳过/重登」分类与原因
- [x] 1.3 新增 `tests/login-script.test.ts` 测试块：分类规则各分支、`--force`/`--only`/`--dry-run` 行为；确认 `bun test` 通过

## 2. 剪贴板自动捕获模块（clipboard）

- [x] 2.1 新增 `readClipboard()`（win `powershell Get-Clipboard -Raw` / mac `pbpaste` / linux `xclip`|`wl-paste`）与 `extractAuthCode(text, state)` 纯函数：base64 解码（容错填充/URL-safe）+ 含 `state=<state>` 与 `code=` 校验
- [x] 2.2 登录流程集成：Phase1 打开浏览器后轮询剪贴板（间隔 ~2s，超时到 Phase1 TTL 600s），捕获成功自动走 Phase2；剪贴板不可用/校验不中/超时回退手工粘贴；`--code-input manual` 强制手工
- [x] 2.3 新增测试：`extractAuthCode` 命中/误捕/坏 base64/state 不匹配各分支；确认 `bun test` 通过

## 3. 隐身浏览器模块（browser）

- [x] 3.1 新增 `detectDefaultBrowser()`/`buildIncognitoPlan()` 纯函数：win 注册表 UserChoice→ProgId→App Paths 取 exe + flag（Chrome `--incognito` / Edge `--inprivate` / Firefox `-private-window`），macOS/Linux 各浏览器 flag，未知回退普通模式（win `rundll32` / mac `open` / linux `xdg-open`）
- [x] 3.2 `openURL` 升级：默认隐身打开（`--browser incognito`），`--browser normal` 强制普通模式；所有路径仍注入可信真实用户 home（污染回退后）
- [x] 3.3 新增测试：三平台计划构造、未知浏览器回退、`--browser` 参数解析；确认 `bun test` 通过

## 4. 本地回调 spike（门控）

- [x] 4.1 spike：实测 arkcli 1.0.37 `arkcli auth login volc-sso`（auto 模式）——本地端口回调是否稳定、是否自开浏览器及可否抑制（env/flag）、是否阻塞 stdin
- [x] 4.2 按 D4 结论分支落地：通过且浏览器可控制 → 实现 `--flow local-callback`（失败自动回退 cross-device）及测试；通过但自开不可抑制 → 实现该 flow 但注明普通模式；不通过 → 设计文档记录死因 + spec 写入禁止条，不实现

## 5. 规范 delta（openspec/specs/account-login-script/spec.md）

- [x] 5.1 并入 MODIFIED「增量探测后仅重登过期账号」（替代「全量清空后逐账号登录」，含 `--force`/`--only`/`--dry-run`/fail-safe 场景）
- [x] 5.2 并入 MODIFIED「浏览器 + 剪贴板/贴码交互登录」（剪贴板捕获 + state 校验 + 手工回退场景）
- [x] 5.3 并入 ADDED「隐身浏览器打开授权 URL」与（若 spike 通过）ADDED「本地回调流（spike 门控）」；确认 `openspec validate account-login-refactor` 通过

## 6. 文档更新（docs/）

- [x] 6.1 更新 `docs/user-guide/plan-stats.md` 登录章节：默认增量重登、剪贴板免粘贴、隐身说明、新 flag；FAQ 增补「增量只补过期」「剪贴板捕获」条目
- [x] 6.2 （操作提示）文档或变更说明中注明：`planStats.accounts` 需补 `vollc5427`（第 7 账号），可顺手对正 `volxc5426`→`vollqh5426` 标签

## 7. 集成验证

- [x] 7.1 全量校验：`bun test`、`bun run typecheck`、`bun run build` 全部通过；`openspec validate account-login-refactor` 通过
- [x] 7.2 真实环境抽查：`--dry-run` 对 6 账号输出分类计划；对 1 个过期账号走增量重登（剪贴板捕获 + 隐身）验证成功；`--force` 确认旧行为可用
