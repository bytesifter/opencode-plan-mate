# account-login-script Specification

## Purpose

account-login-script 能力：提供独立的 arkcli 多账号 SSO 登录工具脚本，从 opencode 配置读取 planStats.accounts 账号映射，全量清空后逐账号完成火山 SSO 登录与验证，替代手工多账号登录流程。

## Requirements

### Requirement: 从配置读取账号映射

脚本 SHALL 从 `opencode.jsonc` 的 `plugin` 配置中解析 `planStats.accounts`（显示名 → 独立 arkcli HOME 目录映射），作为待登录账号清单。配置缺失或解析失败时脚本 SHALL 报错退出，SHALL NOT 静默继续。脚本 SHALL 支持通过命令行参数指定其他配置文件路径，以覆盖默认的 `opencode.jsonc`。

#### Scenario: 解析 accounts 清单

- **WHEN** `opencode.jsonc` 的某插件条目含 `planStats.accounts: { "a": "~/.arkcli-accounts/a", "b": "~/.arkcli-accounts/b" }`
- **THEN** 脚本 SHALL 识别账号 `a` 与 `b` 及其对应 HOME 目录，`~` SHALL 展开为用户 home 目录

#### Scenario: 配置缺失报错

- **WHEN** 配置文件中不存在 `planStats.accounts` 或无法解析
- **THEN** 脚本 SHALL 输出清晰错误信息并以非零退出码结束

#### Scenario: `~` 在 HOME 被污染时仍解析到真实用户 home

- **WHEN** 当前进程的 `USERPROFILE`/`HOME` 环境变量已被污染为含 `.arkcli-accounts` 片段的嵌套路径（如历史手工登录残留）
- **THEN** 脚本展开 `~` 前缀 SHALL 基于真实用户 home 目录（优先 `HOMEDRIVE+HOMEPATH`，兜底 `C:\Users\<USERNAME>`），SHALL NOT 拼出嵌套 `.arkcli-accounts` 路径

### Requirement: HOME 污染检测与防护

脚本 SHALL 检测并防护账号 HOME 路径污染，区分两类情形分别处理：

- **磁盘嵌套垃圾**：账号 HOME 顶层目录内部存在嵌套的 `.arkcli-accounts` 子目录分支（历史手工登录残留，账号 HOME 顶层无有效登录态）。脚本默认执行 SHALL 扫描并自动删除这类嵌套分支，仅删除嵌套分支、保留账号 HOME 顶层，随后继续正常登录流程；`--dry-run` 时 SHALL 只报告将清理的分支而不删除。
- **配置污染**：解析出的账号 HOME 路径本身含嵌套 `.arkcli-accounts` 片段（配置写死了历史嵌套路径）。脚本 SHALL 打印警告并以非零退出码中止，SHALL NOT 执行登录，SHALL NOT 以清理磁盘代替修正配置。

此外，`~` 展开基于的可信 home 目录若含 `.arkcli-accounts` 片段（脚本自管目录标记），SHALL 判定为污染并回退到真实用户 home。

#### Scenario: 污染环境回退真实 home

- **WHEN** `homedir()` 返回值含 `.arkcli-accounts` 片段
- **THEN** 脚本 SHALL 以 `HOMEDRIVE+HOMEPATH`（兜底 `C:\Users\<USERNAME>`）作为可信 home 展开 `~`，SHALL NOT 沿用污染路径

#### Scenario: 磁盘嵌套垃圾默认自动清理

- **WHEN** 某账号 HOME 顶层目录内部存在嵌套的 `.arkcli-accounts` 子目录分支（如 `~/.arkcli-accounts/volhwy2410/.arkcli-accounts/account-a/`）
- **THEN** 脚本 SHALL 自动删除该嵌套分支（保留 `~/.arkcli-accounts/volhwy2410/` 顶层），SHALL 输出被清理的分支路径，SHALL 继续正常登录流程

#### Scenario: dry-run 只报告不删除

- **WHEN** 以 `--dry-run` 运行且存在磁盘嵌套垃圾
- **THEN** 脚本 SHALL 打印将清理的嵌套分支路径，SHALL NOT 实际删除任何目录

#### Scenario: 配置写死嵌套路径时中止

- **WHEN** 解析出的某账号 HOME 路径含 `.arkcli-accounts` 片段（如配置里写死了历史嵌套路径）
- **THEN** 脚本 SHALL 输出警告说明路径可疑，并以非零退出码中止，SHALL NOT 执行登录

### Requirement: 全量清空后逐账号登录

脚本每次执行 SHALL 先删除所有账号的独立 HOME 目录（清空登录态），再逐个完成登录，确保不残留旧目录与嵌套路径。单账号失败 SHALL 标注原因并继续后续账号，全部完成后汇总结果。

#### Scenario: 清空全部账号 HOME

- **WHEN** 脚本开始执行且已解析出账号清单
- **THEN** 脚本 SHALL 先删除每个账号对应的 HOME 目录（含其下所有内容），再开始登录流程

#### Scenario: 单账号失败不中断

- **WHEN** 某账号登录失败（如授权码无效）
- **THEN** 脚本 SHALL 标注该账号失败原因，SHALL 继续处理其余账号，最后汇总展示成功/失败清单

### Requirement: 跨平台派生 arkcli 并注入隔离环境

脚本 SHALL 通过子进程执行 arkcli，并在 Windows 与 POSIX 上均可用：Windows 上 SHALL 通过命令解释器（如 `cmd.exe /c`）解析 arkcli 的 `.cmd`/`.bat` 垫片，POSIX 上 SHALL 直接执行。每个账号执行时 SHALL 同时注入 `HOME` 与 `USERPROFILE` 为该账号独立目录，SHALL NOT 使用全局登录态。

#### Scenario: Windows 下解析垫片执行

- **WHEN** 在 Windows 平台执行 arkcli 且本机以 `arkcli.cmd` 垫片安装
- **THEN** 脚本 SHALL 通过命令解释器执行 arkcli，使垫片被正确解析，SHALL NOT 因 `ENOENT`/`EINVAL` 失败

#### Scenario: 每账号注入隔离 HOME

- **WHEN** 脚本对某账号执行 arkcli
- **THEN** 子进程 SHALL 以该账号 HOME 目录作为 `HOME` 与 `USERPROFILE` 执行，SHALL 落在该账号独立登录态

### Requirement: 浏览器 + 贴码交互登录

脚本 SHALL 执行 `arkcli auth login --no-browser --login-mode legacy`，从 stdout 解析 `authorize_url`，使用系统默认浏览器打开；待用户在浏览器完成授权后，脚本 SHALL 在终端提示用户粘贴 base64 授权码，并以 `arkcli auth login --no-browser --login-mode legacy --code <code>` 完成登录。授权码获取失败或超时 SHALL 标注账号失败。登录子进程 SHALL 显式指定 `--login-mode legacy`（旧跨设备链路，stdout 返回含 `authorize_url` 的 JSON 并立即退出），SHALL NOT 依赖默认 `auto` 模式（其 broker 链路在非交互管道下阻塞等待本地浏览器回调，导致脚本死等）。打开浏览器的子进程 SHALL 注入 `HOME` 与 `USERPROFILE` 为可信真实用户 home（经污染回退，见「HOME 污染检测与防护」），SHALL NOT 注入账号独立 HOME，SHALL NOT 继承可能被污染的进程环境，SHALL NOT 把浏览器/WinINet 缓存（含受保护 ACL 的 `Content.IE5` 等目录）写入账号 HOME 目录。

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

### Requirement: 登录后 profile 兜底

脚本对每个账号在登录完成后 SHALL 确认存在可用的 coding-plan 默认 profile；不存在时 SHALL 执行 `arkcli profile create --type coding-plan` 兜底创建。兜底失败 SHALL 标注账号失败。

#### Scenario: 无 profile 时兜底创建

- **WHEN** 某账号登录成功但其 HOME 下无可用的 coding-plan 默认 profile
- **THEN** 脚本 SHALL 执行 `arkcli profile create`（coding-plan 类型）创建默认 profile，失败则标注该账号

#### Scenario: 已有 profile 跳过

- **WHEN** 某账号登录成功且已有可用 coding-plan 默认 profile
- **THEN** 脚本 SHALL 跳过 profile 创建，直接进入验证

### Requirement: 逐账号验证与进度输出

脚本 SHALL 对每个账号登录后用 `arkcli usage plan --product coding-plan --format json` 验证取数（返回含 percent 数据即成功），并以进度方式输出每账号结果；验证失败 SHALL 标注原因。全部结束后脚本 SHALL 汇总成功与失败账号清单，存在失败时以非零退出码结束。

#### Scenario: 验证成功

- **WHEN** 某账号登录后执行 `usage plan` 返回含 `percent` 的配额数据
- **THEN** 脚本 SHALL 将该账号标记为成功并显示进度

#### Scenario: 存在失败则非零退出

- **WHEN** 至少一个账号登录或验证失败
- **THEN** 脚本 SHALL 输出失败清单及原因，并以非零退出码结束
