## MODIFIED Requirements

### Requirement: 通过 arkcli 子进程取数（每账号隔离 HOME）

插件 SHALL 通过派生 arkcli 子进程获取官方配额，SHALL NOT 在插件进程内直连 ARK 控制面 HTTP 接口。每个账号 SHALL 以该账号独立的 home 目录作为子进程的隔离身份执行 `arkcli usage plan --product coding-plan --format json`（使用该 home 内的默认 profile）。隔离身份 SHALL 通过跨平台环境变量注入：POSIX 平台 SHALL 设 `HOME=<home>`，Windows 平台 SHALL 设 `USERPROFILE=<home>`，并 MAY 同时设置两者以覆盖两平台。每次调用 SHALL 注入调用归因环境变量（如 `ARKCLI_CALLER_TYPE/NAME/SKILL_NAME`）。

#### Scenario: 子进程带隔离 HOME 取数

- **WHEN** 在 Linux/macOS 查询某账号的套餐配额，其 home 目录为 `~/.arkcli-accounts/<acct>`
- **THEN** 插件 SHALL 以 `HOME=~/.arkcli-accounts/<acct>` 执行 `arkcli usage plan --product coding-plan --format json` 并解析其 stdout

#### Scenario: Windows 平台带隔离 USERPROFILE 取数

- **WHEN** 在 Windows 查询某账号的套餐配额，其 home 目录为 `~/.arkcli-accounts/<acct>`
- **THEN** 插件 SHALL 以 `USERPROFILE=~/.arkcli-accounts/<acct>` 执行 `arkcli usage plan --product coding-plan --format json`，使 arkcli 读取该 home 下的 profile，而非全局 `~/.arkcli`
- **AND** 各账号 SHALL 落在彼此独立的 home，SHALL NOT 共用同一份登录态

#### Scenario: 归因环境变量注入

- **WHEN** 查询某账号的套餐配额
- **THEN** 子进程 SHALL 同时注入 `ARKCLI_CALLER_TYPE`、`ARKCLI_CALLER_NAME`、`ARKCLI_SKILL_NAME` 等归因环境变量

#### Scenario: arkcli 缺失标注

- **WHEN** 本机未安装 arkcli 或命令不可执行
- **THEN** 对应行 SHALL 标注"arkcli 不可用"类错误，SHALL NOT 阻断其他账号

## ADDED Requirements

### Requirement: 账号 home 路径展开（跨平台）

插件 SHALL 对 `planStats.accounts` 中每个账号的 home 路径值展开 `~` 前缀为当前用户 home 目录，SHALL 同时接受 POSIX 写法 `~/…` 与 Windows 写法 `~\…`。展开后的路径 SHALL 作为子进程隔离环境变量传入。

#### Scenario: 两种前缀写法均可展开

- **WHEN** `planStats.accounts` 的某个配置值为 `~/.arkcli-accounts/a` 或 `~\.arkcli-accounts\a`
- **THEN** 插件 SHALL 将两者都展开为当前用户 home 目录下的 `.arkcli-accounts/a` 路径
