# plan-quota-stats Specification

## Purpose

plan-quota-stats 能力：插件按 arkcli profile（账号）聚合展示各账号官方套餐配额用量（已用百分比与重置时间），通过依赖 arkcli 子进程与 provider 无关的 adapter 框架支持多服务商扩展，首个实现为火山 ARK Coding Plan。

## Requirements

### Requirement: plan_stats 工具注册与按需触发

插件 SHALL 注册名为 `plan_stats` 的工具。工具 SHALL 仅在用户显式调用时执行查询，SHALL NOT 在后台轮询或定时查询，SHALL NOT 维护查询缓存。

#### Scenario: 显式调用返回套餐统计

- **WHEN** 调用 `plan_stats` 工具（无参数）且已配置 `planStats.accounts`
- **THEN** 工具 SHALL 对每个配置的账号查询其官方套餐配额并返回聚合结果

#### Scenario: 不调用不查询

- **WHEN** 插件运行且无人调用 `plan_stats`
- **THEN** 插件 SHALL 不发起任何套餐配额查询

#### Scenario: 未配置返回提示

- **WHEN** 调用 `plan_stats` 工具但未配置 `planStats.accounts`
- **THEN** 工具 SHALL 返回配置提示信息，SHALL NOT 报错崩溃

### Requirement: 按账号聚合官方配额

插件 SHALL 为 `planStats.accounts` 中每个账号（显示名 → 独立 arkcli HOME 目录）单独查询其官方套餐配额，并以显示名为行聚合展示。单账号查询失败 SHALL 不影响其他账号的结果。

#### Scenario: 多账号各查各的套餐

- **WHEN** 配置了 `planStats.accounts: { "账号A": "~/.arkcli-accounts/a", "账号B": "~/.arkcli-accounts/b", "账号C": "~/.arkcli-accounts/c" }`
- **THEN** 工具 SHALL 分别以各账号隔离的 arkcli 登录态查询对应套餐配额，并在结果中各自成行（行名 = 显示名）

#### Scenario: 单账号失败不阻塞

- **WHEN** 查询账号A 失败（未登录/网络错误）而账号B、账号C 成功
- **THEN** 结果 SHALL 包含账号B、账号C 的配额，账号A 行 SHALL 标注错误信息

### Requirement: 通过 arkcli 子进程取数（每账号隔离 HOME）

插件 SHALL 通过派生 arkcli 子进程获取官方配额，SHALL NOT 在插件进程内直连 ARK 控制面 HTTP 接口。每个账号 SHALL 以该账号独立的 arkcli HOME 目录作为子进程 `HOME` 环境变量执行 `arkcli usage plan --product coding-plan --format json`（使用该 HOME 内的默认 profile），并对每次调用注入调用归因环境变量（如 `ARKCLI_CALLER_TYPE/NAME/SKILL_NAME`）。

#### Scenario: 子进程带隔离 HOME 取数

- **WHEN** 查询某账号的套餐配额，其 HOME 目录为 `~/.arkcli-accounts/<acct>`
- **THEN** 插件 SHALL 以 `HOME=~/.arkcli-accounts/<acct>` 执行 `arkcli usage plan --product coding-plan --format json` 并解析其 stdout

#### Scenario: 归因环境变量注入

- **WHEN** 查询某账号的套餐配额
- **THEN** 子进程 SHALL 同时注入 `ARKCLI_CALLER_TYPE`、`ARKCLI_CALLER_NAME`、`ARKCLI_SKILL_NAME` 等归因环境变量

#### Scenario: arkcli 缺失标注

- **WHEN** 本机未安装 arkcli 或命令不可执行
- **THEN** 对应行 SHALL 标注"arkcli 不可用"类错误，SHALL NOT 阻断其他账号

### Requirement: provider 无关的扩展框架

插件 SHALL 通过 provider 无关的 adapter 机制查询套餐配额：取数机制（子进程/HTTP/其他）封装在 adapter 内；新增 provider 支持 SHALL 通过新增 adapter 实现，SHALL NOT 需要修改编排、渲染或工具注册逻辑。

#### Scenario: 匹配到适配器则查询

- **WHEN** 某账号命中已注册 adapter 的适用范围
- **THEN** 工具 SHALL 使用该 adapter 查询配额

#### Scenario: 无匹配 adapter 则标注

- **WHEN** 某账号不匹配任何已注册 adapter
- **THEN** 工具 SHALL 跳过该账号并在结果中标注"不支持的 provider"

### Requirement: 火山 Coding Plan adapter

插件 SHALL 提供火山 ARK 的 adapter：通过 `arkcli usage plan --product coding-plan` 查询 Coding Plan 配额。配额结果 SHALL 反映后端返回的 `session / weekly / monthly` 三个窗口的已用百分比与重置时间；未订阅时 SHALL 标记 `subscribed=false`（显示"未订阅/无套餐"）。

#### Scenario: 未订阅返回未订阅

- **WHEN** 某账号未绑定任何 Coding Plan（`subscribed=false`）
- **THEN** 该账号行 SHALL 显示"未订阅/无套餐"

#### Scenario: 查询失败标注原因

- **WHEN** `arkcli usage plan` 返回错误（如账号未登录 / 账号 HOME 目录缺失）
- **THEN** 该账号行 SHALL 标注对应错误信息

### Requirement: ASCII 表 + percent 柱渲染

`plan_stats` 工具返回 SHALL 为 ASCII 表格/柱状图文本：每行一个账号，展示 session / weekly / monthly 三个窗口的百分比柱状图与重置时间；无任何数据时 SHALL 返回"暂无统计数据"。

#### Scenario: 有数据返回图表

- **WHEN** 至少一个账号查询到配额
- **THEN** 返回文本 SHALL 每行包含一个账号、三个窗口的 percent 柱与 reset_at

#### Scenario: 无数据提示

- **WHEN** 所有账号均无可用配额数据（未订阅/失败/无配置）
- **THEN** 工具 SHALL 返回"暂无统计数据"
