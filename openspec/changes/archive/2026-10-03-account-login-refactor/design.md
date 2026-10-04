# Design

## Context

`scripts/login-arkcli-accounts.ts` 现为全量重登：`resetAccountRoot` 清空账号根目录后逐账号走 Phase1→浏览器→贴码→Phase2→profile 兜底→`usage plan` 验证。SSO refresh_token 服务端绝对 48h（实测约 46h 失效），每约 2 天全量重登一次，6~7 个账号成本高。

2026-10-03 pilot 实测（arkcli 1.0.37，账号 volhwy2410）确认：
- `--no-browser --login-mode legacy` Phase1 输出结构（`authorize_url`/`stage`/`expires_in_sec`）与脚本 `parseAuthorizeUrl` 兼容，1.0.37 无破坏性变更。
- 1.0.37 登录后自动创建 `coding-plan_cn-beijing_personal`（默认）profile，`ensureCodingPlanProfile` 兜底退化为保险。
- 过期检测两种形态均实测：① `auth status` 直接报错（`refresh_token is invalid`）；② `logged_in:true` 但 `volc_sso.expired:true` + `control_plane_auth.status:needs_login`。
- 授权码 = `base64("code=..&state=<Phase1 state>")`，state 可作剪贴板校验锚点。

## Goals / Non-Goals

**Goals:**
- 默认增量重登：有效账号跳过，过期账号仅清自身并重登
- 剪贴板自动捕获授权码（state 校验），免终端粘贴
- 隐身浏览器打开授权 URL（跨平台探测 + 回退），避免跨账号 SSO 会话污染
- 本地回调 `--flow local-callback` 以 spike 门控决定并入或记录死因
- 旧行为可用 `--force` 保留；纯函数模块化、可单测

**Non-Goals:**
- 不改 arkcli（纯插件侧，仅使用其既有命令/flag；不重实现 OAuth，本地回调只能借 arkcli auto 模式）
- 不动 `src/quota.ts` / `plan_stats` 取数逻辑
- 不实现任何 SSO 保活（延续 `remove-plan-stats-sso-keepalive` 死因结论；本 change 的探测是**一次性读有效性的重登前置**，非后台续期，与保活无冲突）
- 脚本配置不引入 config 联动（CLI flag 为准，保持脚本独立可测）

## Decisions

### D1: 增量重登为默认，探测偏保守（歧义即重登，fail-safe）

逐账号探测分类（注入该账号 HOME 执行 `arkcli auth status`）：

```
HOME 缺失                                    → 需重登
非零退出 + 错误文本含 sso/not logged/refresh → 需重登
退出 0 + volc_sso.expired==true              → 需重登
退出 0 + control_plane_auth.status==needs_login → 需重登
退出 0 + 无过期标记                           → 有效,跳过
输出异常/JSON 不可解析                        → 视为需重登
```

fail-safe 依据：跳过陈旧会话会让 `plan_stats` 持续报错（坏影响大）；重登一个已有效账号只是多一次浏览器授权（坏影响小）。歧义时偏向重登，退化为当前全量行为，安全性不降。

- `--force`：恢复旧「清空全部 HOME 后逐账号重登」。
- `--only <name>`：只探测并重登指定账号（如新增 vollc5427 后单独补登）。
- `--dry-run`：输出每账号「跳过/重登」分类与原因，不执行任何清空/登录。
- 探测只读有效性、不尝试续期，与 SSO 保活死因结论不冲突。

### D2: 剪贴板捕获用 state 锚点校验

授权码形如 `base64("code=..&state=<Phase1 state>")`。捕获流程：

```
打开浏览器后 → 轮询剪贴板(间隔 ~2s)
  → base64 解码(容错填充/URL-safe)
  → 含 "state=<Phase1 state>" 且含 "code="  → 捕获成功,喂 Phase2
  → 否则继续轮询;超时到 Phase1 TTL(600s) → 回退手工粘贴
```

剪贴板读取：Windows `powershell -NoProfile -Command "Get-Clipboard -Raw"`（每次 spawn ~数百 ms，间隔 2s 可接受）；macOS `pbpaste`；Linux `xclip -o -selection clipboard`（无则 `wl-paste`）。剪贴板命令不可用 → 直接回退手工粘贴。`--code-input manual` 强制跳过轮询直接手工。

**备选**：本地回调（无粘贴也无需复制）——见 D4，与隐身存在冲突，故默认 cross-device + 剪贴板。

### D3: 隐身浏览器跨平台探测 + 回退

- Windows：注册表 `HKCU\...\Shell\Associations\UrlAssociations\https\UserChoice` 的 `ProgId`（`ChromeHTML`/`MSEdgeHTM`/`FirefoxURL`）→ `App Paths\chrome.exe` 等取 exe → 对应 flag（Chrome `--incognito` / Edge `--inprivate` / Firefox `-private-window`）；ProgId 未知 → 回退 `rundll32 url.dll,FileProtocolHandler` 普通模式。
- macOS：`open -na "Google Chrome" --args --incognito <url>`（Edge `--inprivate` / Firefox `-private-window`），未知回退 `open <url>`。
- Linux：`google-chrome --incognito` / `microsoft-edge --inprivate` / `firefox -private-window`，未知回退 `xdg-open`。
- 所有路径仍注入可信真实用户 home（污染回退后）为 `HOME`/`USERPROFILE`，不注入账号独立 HOME（既有 spec 要求不变）。
- `--browser incognito|normal`（默认 incognito）。

**张力**：隐身与「密码管理器自动填充」存在取舍——内置密码管理器（Chrome/Edge/Firefox）在隐身/隐私窗口通常仍可填充已存密码；第三方管理器（LastPass 等）需按站点开启 "Allow in Incognito"。默认隐身（服务多账号场景的「免跨账号会话污染」收益更大），需要自动填充时可 `--browser normal` 显式切回。

### D4: 本地回调 spike 门控

spike 验证点（arkcli 1.0.37，`arkcli auth login volc-sso` auto 模式）：
1. auto 模式本地端口回调是否稳定（历史 `redirect_uri` 报错根因疑为 cmd 拆 URL，脚本侧已改 rundll32 直传；但 auto 模式浏览器由 arkcli 自开，其开法不可控，需实测确认回调可用）。
2. arkcli 自开浏览器能否抑制（env 变量或 flag），以便脚本接管并叠加隐身。
3. 是否阻塞 stdin / 与脚本非交互 spawn 的兼容性。

**Spike 结论（2026-10-03 实测）**：auto 模式本地回调机制存在且可用形态确认——`redirect_uri=http://127.0.0.1:<随机端口>/oauth/callback`，arkcli **自行打开普通模式浏览器**（输出「正在打开浏览器进行火山 SSO 认证...」），随后**阻塞等待本地回调**（非交互下 20s 未退出，需长超时）。**无 flag/env 可抑制自开浏览器**。命中「自开不可抑制」分支 → 实现 `--flow local-callback`（普通模式浏览器，授权后自动回调完成、免复制/粘贴），超时/失败自动回退 cross-device；与 D3 隐身冲突由用户显式选择 `--flow` 时承担（默认 cross-device + 隐身不受影响）。

结论分支（备查）：
- **通过且浏览器可受脚本控制** → 实现 `--flow local-callback`（脚本开隐身浏览器 + 本地回调自动完成，失败自动回退 cross-device）。
- **通过但 arkcli 自开不可抑制**（实测命中）→ 提供 `--flow local-callback` 但注明放弃隐身（普通模式），与 D3 冲突由用户显式选择；仍提供失败回退。
- **不通过** → 记录死因于本 change 设计文档，`account-login-script` spec 写入禁止实现（同 SSO 保活先例），保持 cross-device 主路径。

### D5: 代码组织保持脚本单文件 + 纯函数导出

保持 `scripts/login-arkcli-accounts.ts` 单文件，新增纯函数导出（`classifyAuthStatus` / `extractAuthCode` / `buildIncognitoPlan` / `buildProbePlan` 等）供 `tests/login-script.test.ts` 单测，延续现有「脚本 + 对应测试」模式。文件过大时可拆 `scripts/lib/` 子模块（可选，不强制）。

## Risks / Trade-offs

- [探测误判] → fail-safe：歧义即重登，最坏退化为当前全量行为，不跳过陈旧会话。
- [剪贴板误捕] → state 锚点校验，非当前 Phase1 state 的内容一律忽略。
- [隐身与密码自动填充张力] → 默认隐身，`--browser normal` 显式切回。
- [本地回调 spike 失败] → 记录死因 + spec 禁止条，cross-device（增量+剪贴板+隐身）已是足够的摩擦下降，不阻塞本轮交付。
- [arkcli 未来版本探测字段变化] → probe 容错：字段缺失/JSON 不可解析一律视为需重登。
- [剪贴板轮询开销] → 间隔 2s + state 校验，仅在登录窗口期运行，可接受。
