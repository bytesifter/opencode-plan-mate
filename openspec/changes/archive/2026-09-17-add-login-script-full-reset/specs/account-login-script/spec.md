## MODIFIED Requirements

### Requirement: HOME 污染检测与防护

脚本 SHALL 检测并防护账号 HOME 路径污染：`~` 展开基于的可信 home 目录若含 `.arkcli-accounts` 片段（脚本自管目录标记），SHALL 判定为污染并回退到真实用户 home。启动后 SHALL 校验每个解析出的账号 HOME：若仍含嵌套 `.arkcli-accounts` 片段，SHALL 打印警告并以非零退出码中止，SHALL NOT 在嵌套路径上执行登录。磁盘上的历史嵌套残留（账号根目录 `~/.arkcli-accounts/` 下层层嵌套的 `.arkcli-accounts` 分支）SHALL 通过启动时**全量清空账号根目录**消除，SHALL NOT 依赖逐分支局部清理。

#### Scenario: 污染环境回退真实 home

- **WHEN** `homedir()` 返回值含 `.arkcli-accounts` 片段
- **THEN** 脚本 SHALL 以 `HOMEDRIVE+HOMEPATH`（兜底 `C:\Users\<USERNAME>`）作为可信 home 展开 `~`，SHALL NOT 沿用污染路径

#### Scenario: 配置写死嵌套路径时中止

- **WHEN** 解析出的某账号 HOME 路径含 `.arkcli-accounts` 片段（如配置里写死了历史嵌套路径）
- **THEN** 脚本 SHALL 输出警告说明路径可疑，并以非零退出码中止，SHALL NOT 执行登录

#### Scenario: 启动时全量清空账号根目录

- **WHEN** 脚本开始执行且已解析出账号清单，账号根目录 `~/.arkcli-accounts/` 存在（含历史嵌套残留或旧登录态）
- **THEN** 脚本 SHALL 删除整个 `~/.arkcli-accounts/` 目录（含所有账号 HOME 与嵌套残留），再逐账号重新登录

### Requirement: 浏览器 + 贴码交互登录

脚本 SHALL 执行 `arkcli auth login --no-browser`，从 stdout 解析 `authorize_url`，使用系统默认浏览器打开；待用户在浏览器完成授权后，脚本 SHALL 在终端提示用户粘贴 base64 授权码，并以 `arkcli auth login --no-browser --code <code>` 完成登录。授权码获取失败或超时 SHALL 标注账号失败。打开浏览器的子进程 SHALL 注入 `HOME` 与 `USERPROFILE` 为当前账号的独立 HOME，SHALL NOT 继承可能被污染的进程环境。

#### Scenario: 自动打开授权 URL

- **WHEN** 脚本触发某账号的 `auth login --no-browser` 且 stdout 含 `authorize_url`
- **THEN** 脚本 SHALL 用系统默认浏览器打开该 URL，并在终端提示用户完成浏览器授权

#### Scenario: 粘贴授权码完成登录

- **WHEN** 用户在浏览器完成授权后返回 base64 授权码并粘贴到终端
- **THEN** 脚本 SHALL 以 `--code` 喂回授权码完成登录，SHALL 校验命令退出码并标注成功/失败

#### Scenario: 浏览器子进程注入隔离 HOME

- **WHEN** 脚本为某账号打开浏览器授权 URL
- **THEN** 浏览器子进程 SHALL 以该账号 HOME 目录作为 `HOME` 与 `USERPROFILE` 执行，SHALL NOT 把浏览器缓存写入脚本进程继承的污染路径
