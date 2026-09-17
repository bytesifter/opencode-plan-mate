## MODIFIED Requirements

### Requirement: 通过 arkcli 子进程取数（每账号隔离 HOME）

插件 SHALL 通过派生 arkcli 子进程获取官方配额，SHALL NOT 在插件进程内直连 ARK 控制面 HTTP 接口。每个账号 SHALL 以该账号独立的 arkcli HOME 目录作为子进程 home 环境变量（POSIX 设 `HOME`，Windows 设 `USERPROFILE`）执行 `arkcli usage plan --product coding-plan --format json`（使用该 HOME 内的默认 profile），并对每次调用注入调用归因环境变量（如 `ARKCLI_CALLER_TYPE/NAME/SKILL_NAME`）。派生 SHALL 跨平台可用：Windows 上的 arkcli 常以 `.cmd`/`.bat` 垫片分发，插件 SHALL 通过命令解释器解析并执行该垫片，SHALL NOT 依赖把裸命令名按 `PATHEXT` 直接派生。

#### Scenario: 子进程带隔离 HOME 取数

- **WHEN** 查询某账号的套餐配额，其 HOME 目录为 `~/.arkcli-accounts/<acct>`
- **THEN** 插件 SHALL 以该账号隔离的 home 环境变量（POSIX `HOME` / Windows `USERPROFILE`）执行 `arkcli usage plan --product coding-plan --format json` 并解析其 stdout

#### Scenario: Windows 解析 .cmd 垫片执行

- **WHEN** 在 Windows 上查询某账号的套餐配额，且本机 arkcli 以 `arkcli.cmd`（npm 垫片）形式安装
- **THEN** 插件 SHALL 通过命令解释器（如 `cmd.exe /c`）执行 arkcli，使该垫片被正确解析

#### Scenario: 归因环境变量注入

- **WHEN** 查询某账号的套餐配额
- **THEN** 子进程 SHALL 同时注入 `ARKCLI_CALLER_TYPE`、`ARKCLI_CALLER_NAME`、`ARKCLI_SKILL_NAME` 等归因环境变量

#### Scenario: arkcli 缺失标注

- **WHEN** 本机未安装 arkcli（无法定位可执行文件）
- **THEN** 对应行 SHALL 标注「arkcli 不可用」类错误，SHALL NOT 阻断其他账号

#### Scenario: arkcli 无法启动标注

- **WHEN** 本机已安装 arkcli 但子进程无法执行（可执行文件解析失败）
- **THEN** 对应行 SHALL 标注「arkcli 无法启动」类错误并附底层错误摘要，SHALL NOT 阻断其他账号
