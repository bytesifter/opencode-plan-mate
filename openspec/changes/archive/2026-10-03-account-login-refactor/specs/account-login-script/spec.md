# Spec Delta

## MODIFIED Requirements

### Requirement: 全量清空后逐账号登录

（本条目为 MODIFIED：标题沿用主 spec 既有名，内容替换为增量行为。）脚本默认执行 SHALL 先对每个账号执行 `arkcli auth status`（注入该账号独立 HOME）探测登录态有效性，仅对判定为过期/未登录/缺失的账号清空其独立 HOME 并重登；有效账号 SHALL 保留登录态并跳过，SHALL NOT 清空其 HOME。探测判定 SHALL 覆盖：HOME 目录缺失；`auth status` 非零退出且错误文本含 `sso`/`not logged`/`refresh` 等过期特征；退出 0 但 `volc_sso.expired == true`；退出 0 但 `control_plane_auth.status == "needs_login"`。探测输出异常或 JSON 不可解析 SHALL 视为需重登（fail-safe：宁可多登一次，不跳过陈旧会话）。脚本 SHALL 支持 `--force` 恢复旧全量清空重登行为、`--only <name>` 仅探测并重登指定账号；`--dry-run` SHALL 输出每账号「跳过/重登」分类与原因，SHALL NOT 清空或登录任何账号。

#### Scenario: 清空全部账号 HOME

- **WHEN** 脚本开始执行且已解析出账号清单
- **THEN** 脚本 SHALL 仅清空判定为需重登的账号 HOME（含其下所有内容）后再登录；对判定为有效的账号 SHALL 保留其 HOME；以 `--force` 运行时 SHALL 清空全部账号 HOME

#### Scenario: 单账号失败不中断

- **WHEN** 某账号登录失败（如授权码无效）
- **THEN** 脚本 SHALL 标注该账号失败原因，SHALL 继续处理其余账号，最后汇总展示成功/失败清单

#### Scenario: 有效账号跳过

- **WHEN** 某账号 `auth status` 退出 0 且无 `volc_sso.expired` / `needs_login` 过期标记
- **THEN** 脚本 SHALL 保留其登录态，SHALL NOT 清空其 HOME，SHALL 跳过该账号登录流程

#### Scenario: 过期账号仅清自身并重登

- **WHEN** 某账号探测为过期（`volc_sso.expired` / `needs_login` / 刷新失败报错 / HOME 缺失）
- **THEN** 脚本 SHALL 仅清空该账号 HOME 并重登，SHALL NOT 清空其他有效账号

#### Scenario: --force 全量重登

- **WHEN** 以 `--force` 运行
- **THEN** 脚本 SHALL 恢复旧行为：清空全部账号 HOME 后逐账号重登

#### Scenario: --only 定向重登

- **WHEN** 以 `--only <name>` 运行
- **THEN** 脚本 SHALL 仅探测并重登指定账号，其他账号 SHALL NOT 被处理

#### Scenario: --dry-run 分类预览

- **WHEN** 以 `--dry-run` 运行
- **THEN** 脚本 SHALL 输出每账号「跳过/重登」分类与原因，SHALL NOT 执行任何清空或登录

### Requirement: 浏览器 + 贴码交互登录

（本条目为 MODIFIED：标题沿用主 spec 既有名，内容替换为剪贴板优先的交互登录。）脚本 SHALL 执行 `arkcli auth login --no-browser --login-mode legacy`，从 stdout 解析 `authorize_url` 后使用系统默认浏览器打开。默认 SHALL 轮询剪贴板自动捕获 base64 授权码：捕获内容 SHALL 经 base64 解码并校验包含 Phase 1 的 `state` 与 `code=` 后才接受，随后以 `arkcli auth login --no-browser --login-mode legacy --code <code>` 完成登录。剪贴板不可用、校验不中或轮询超时（Phase 1 TTL）SHALL 回退到终端手工粘贴提示；`--code-input manual` SHALL 强制跳过剪贴板轮询直接手工粘贴。登录子进程 SHALL 显式指定 `--login-mode legacy`（stdout 返回含 `authorize_url` 的 JSON 并立即退出），SHALL NOT 依赖默认 `auto` 模式（其 broker 链路在非交互管道下阻塞等待本地浏览器回调）。打开浏览器的子进程 SHALL 注入 `HOME` 与 `USERPROFILE` 为可信真实用户 home（经污染回退，见「HOME 污染检测与防护」），SHALL NOT 注入账号独立 HOME，SHALL NOT 继承可能被污染的进程环境，SHALL NOT 把浏览器/WinINet 缓存（含受保护 ACL 的 `Content.IE5` 等目录）写入账号 HOME 目录。

#### Scenario: 自动打开授权 URL

- **WHEN** 脚本触发某账号的 `auth login --no-browser --login-mode legacy` 且 stdout 含 `authorize_url`
- **THEN** 脚本 SHALL 用系统默认浏览器打开该 URL，并在终端提示用户完成浏览器授权

#### Scenario: 粘贴授权码完成登录

- **WHEN** 用户在浏览器完成授权后返回 base64 授权码并粘贴到终端
- **THEN** 脚本 SHALL 以 `--code` 喂回授权码完成登录，SHALL 校验命令退出码并标注成功/失败

#### Scenario: 登录走 legacy 链路且立即返回

- **WHEN** 脚本为某账号执行 `auth login --no-browser`
- **THEN** 登录子进程 SHALL 携带 `--login-mode legacy` 执行，stdout SHALL 返回含 `authorize_url` 的 JSON 并以退出码 0 立即结束，SHALL NOT 阻塞等待本地浏览器回调

#### Scenario: 浏览器子进程注入可信真实 home

- **WHEN** 脚本为某账号打开浏览器授权 URL
- **THEN** 浏览器子进程 SHALL 以可信真实用户 home（污染回退后）作为 `HOME` 与 `USERPROFILE` 执行，SHALL NOT 使用账号独立 HOME，SHALL NOT 继承被污染的进程环境，SHALL NOT 把浏览器缓存写入账号 HOME 目录

#### Scenario: 剪贴板自动捕获授权码

- **WHEN** 打开浏览器后用户完成授权并将页面显示的 base64 授权码复制到剪贴板
- **THEN** 脚本 SHALL 轮询捕获该内容，经 base64 解码 + `state` 校验通过后自动执行 Phase 2，SHALL NOT 等待手工粘贴

#### Scenario: 剪贴板校验不中回退手工

- **WHEN** 剪贴板内容无法解码出匹配当前 Phase 1 `state` 的授权码，或轮询超时
- **THEN** 脚本 SHALL 提示用户手工粘贴授权码完成登录

#### Scenario: --code-input manual 强制手工

- **WHEN** 以 `--code-input manual` 运行
- **THEN** 脚本 SHALL 跳过剪贴板轮询，直接提示用户手工粘贴授权码

## ADDED Requirements

### Requirement: 隐身浏览器打开授权 URL

脚本默认 SHALL 以隐身（隐私）模式打开授权 URL，以避免跨账号 SSO 会话污染。Windows SHALL 经注册表 `UserChoice`→`ProgId`→`App Paths` 探测默认浏览器，并以对应隐身 flag 打开（Chrome `--incognito` / Edge `--inprivate` / Firefox `-private-window`）；macOS SHALL 以 `open -na` + 对应 flag 打开；Linux SHALL 以对应浏览器 flag 打开。无法识别浏览器或 flag 打开失败 SHALL 回退普通模式（win `rundll32 url.dll,FileProtocolHandler` / mac `open` / linux `xdg-open`）。`--browser normal` SHALL 强制普通模式打开。隐身与普通模式打开均 SHALL 注入可信真实用户 home（污染回退后）为 `HOME`/`USERPROFILE`，SHALL NOT 注入账号独立 HOME，SHALL NOT 把浏览器缓存写入账号 HOME。

#### Scenario: 默认隐身打开

- **WHEN** 脚本打开授权 URL 且未指定 `--browser normal`
- **THEN** 脚本 SHALL 探测默认浏览器并以隐身模式打开（Chrome `--incognito` / Edge `--inprivate` / Firefox `-private-window`）；无法识别浏览器 SHALL 回退普通模式打开

#### Scenario: --browser normal 强制普通模式

- **WHEN** 以 `--browser normal` 运行
- **THEN** 脚本 SHALL 以普通模式打开授权 URL，SHALL NOT 使用隐身 flag

### Requirement: 本地回调流（--flow local-callback）

脚本 SHALL 以 cross-device 跨设备流（Phase 1 / Phase 2）为默认登录路径。`--flow local-callback` SHALL 提供基于 arkcli `auth login volc-sso`（auto 模式）本地端口回调的登录流：arkcli 启动本地回调（`redirect_uri=http://127.0.0.1:<随机端口>/oauth/callback`）并自行打开普通模式浏览器，授权后浏览器自动跳回回调完成登录，用户无需复制/粘贴授权码。该 flow 由 arkcli 自开浏览器且**无法叠加隐身**（无 flag/env 可抑制，2026-10-03 spike 实测确认），选择该 flow 即接受普通模式窗口；该 flow 执行失败或超时 SHALL 自动回退 cross-device 流完成该账号登录。`--flow` 默认 cross-device，隐身（见「隐身浏览器打开授权 URL」）不受影响。

#### Scenario: local-callback 流授权后自动完成

- **WHEN** 以 `--flow local-callback` 运行，且用户在 arkcli 打开的浏览器完成火山 SSO 授权
- **THEN** 脚本 SHALL 经本地回调自动完成登录，SHALL NOT 要求用户复制/粘贴授权码

#### Scenario: local-callback 失败回退 cross-device

- **WHEN** 以 `--flow local-callback` 运行但本地回调登录失败或超时
- **THEN** 脚本 SHALL 自动回退 cross-device 流（Phase 1 / Phase 2）完成该账号登录，SHALL 标注回退原因
