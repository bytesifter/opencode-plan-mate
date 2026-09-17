## MODIFIED Requirements

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
