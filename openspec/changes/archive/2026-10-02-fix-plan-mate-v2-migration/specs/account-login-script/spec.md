# Spec Delta

## MODIFIED Requirements

### Requirement: 从配置读取账号映射

脚本 SHALL 从 `opencode.jsonc` 的 `plugins` 配置中解析 `planStats.accounts`（显示名 → 独立 arkcli HOME 目录映射），作为待登录账号清单。解析范围 SHALL 覆盖 v2 配置形态：`plugins` 数组中的字符串条目与 `{"package": ..., "options": {...}}` 对象条目的 `options.planStats.accounts`。对 V1 遗留的 `plugin` 数组元组形态（`["file:///...", {"planStats": {...}}]`）SHALL 一并兼容解析，以覆盖迁移过渡期。配置缺失或解析失败时脚本 SHALL 报错退出，SHALL NOT 静默继续。脚本 SHALL 支持通过命令行参数指定其他配置文件路径，以覆盖默认的 `opencode.jsonc`。

#### Scenario: 解析 accounts 清单

- **WHEN** `opencode.jsonc` 的 `plugins` 某条目含 `planStats.accounts: { "a": "~/.arkcli-accounts/a", "b": "~/.arkcli-accounts/b" }`
- **THEN** 脚本 SHALL 识别账号 `a` 与 `b` 及其对应 HOME 目录，`~` SHALL 展开为用户 home 目录

#### Scenario: v2 对象形态解析

- **WHEN** 配置文件 `plugins` 数组含 `{"package": "file:///D:/code/opencode-plan-mate", "options": {"planStats": {"accounts": {"账号A": "~/.arkcli-accounts/a"}}}}`
- **THEN** 脚本 SHALL 解析出账号映射 `{"账号A": "~/.arkcli-accounts/a"}`

#### Scenario: V1 元组形态兼容解析

- **WHEN** 配置文件仍含 V1 的 `plugin` 数组元组 `["file:///path/to/opencode-plan-mate", {"planStats": {"accounts": {"账号A": "~/.arkcli-accounts/a"}}}]`
- **THEN** 脚本 SHALL 同样解析出账号映射 `{"账号A": "~/.arkcli-accounts/a"}`

#### Scenario: 配置缺失报错

- **WHEN** 配置文件中不存在任何形态的 `planStats.accounts` 或无法解析
- **THEN** 脚本 SHALL 输出清晰错误信息并以非零退出码结束

#### Scenario: `~` 在 HOME 被污染时仍解析到真实用户 home

- **WHEN** 当前进程的 `USERPROFILE`/`HOME` 环境变量已被污染为含 `.arkcli-accounts` 片段的嵌套路径（如历史手工登录残留）
- **THEN** 脚本展开 `~` 前缀 SHALL 基于真实用户 home 目录（优先 `HOMEDRIVE+HOMEPATH`，兜底 `C:\Users\<USERNAME>`），SHALL NOT 拼出嵌套 `.arkcli-accounts` 路径
