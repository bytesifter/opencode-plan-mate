# fix-login-openurl-trusted-home Spec

## MODIFIED Requirements

### Requirement: 浏览器 + 贴码交互登录

脚本 SHALL 执行 `arkcli auth login --no-browser`，从 stdout 解析 `authorize_url`，使用系统默认浏览器打开；待用户在浏览器完成授权后，脚本 SHALL 在终端提示用户粘贴 base64 授权码，并以 `arkcli auth login --no-browser --code <code>` 完成登录。授权码获取失败或超时 SHALL 标注账号失败。打开浏览器的子进程 SHALL 注入 `HOME` 与 `USERPROFILE` 为可信真实用户 home（经污染回退，见「HOME 污染检测与防护」），SHALL NOT 注入账号独立 HOME，SHALL NOT 继承可能被污染的进程环境，SHALL NOT 把浏览器/WinINet 缓存（含受保护 ACL 的 `Content.IE5` 等目录）写入账号 HOME 目录。

#### Scenario: 自动打开授权 URL

- **WHEN** 脚本触发某账号的 `auth login --no-browser` 且 stdout 含 `authorize_url`
- **THEN** 脚本 SHALL 用系统默认浏览器打开该 URL，并在终端提示用户完成浏览器授权

#### Scenario: 粘贴授权码完成登录

- **WHEN** 用户在浏览器完成授权后返回 base64 授权码并粘贴到终端
- **THEN** 脚本 SHALL 以 `--code` 喂回授权码完成登录，SHALL 校验命令退出码并标注成功/失败

#### Scenario: 浏览器子进程注入可信真实 home

- **WHEN** 脚本为某账号打开浏览器授权 URL
- **THEN** 浏览器子进程 SHALL 以可信真实用户 home（污染回退后）作为 `HOME` 与 `USERPROFILE` 执行，SHALL NOT 使用账号独立 HOME，SHALL NOT 继承被污染的进程环境，SHALL NOT 把浏览器缓存写入账号 HOME 目录
